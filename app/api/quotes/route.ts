import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, isApproved, type MemberRow } from "@/lib/access";

/**
 * Job quotes API (Phase 5 — Centro de Operaciones, spec §9).
 *
 * Quoted / authorized / real cost live in job_quotes, linked to a work
 * order and/or a vendor visit (at least one parent, enforced here and
 * by the table CHECK). Editing a quote NEVER modifies a work order:
 * its status and its verified_* fields are out of reach of this route
 * by design — only append-only history rows are written on the parent
 * (work_order_history quote_added / quote_updated / cost_updated, or
 * vendor_history job_updated for visit-linked quotes). Approved
 * accounts only (access model v2, re-checked per request).
 */

type AdminClient = ReturnType<typeof createAdminClient>;

type QuoteRow = {
  id: number; work_order_id: number | null; vendor_visit_id: number | null;
  vendor_id: number | null;
  quoted_amount: number | string | null; authorized_amount: number | string | null;
  actual_cost: number | string | null;
  po_number: string | null; gl_code: string | null;
  reference: string | null; scope: string | null; notes: string | null;
  created_by_member_id: number | null;
  created_at: string; updated_at: string;
};

function failure(error: unknown) {
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Request failed";
  if (message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (message === "APPROVAL_REQUIRED") {
    return NextResponse.json({ error: "Account approval required" }, { status: 403 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

async function requireApproved(): Promise<MemberRow> {
  const me = await getCurrentMember();
  if (!isApproved(me)) throw new Error("APPROVAL_REQUIRED");
  return me;
}

function textField(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
}

function amountField(value: unknown): number | null | "INVALID" {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "INVALID";
  return amount;
}

function quoteForClient(
  quote: QuoteRow,
  names: Map<number, string>,
  vendorNames: Map<number, string>,
) {
  return {
    id: quote.id,
    workOrderId: quote.work_order_id,
    vendorVisitId: quote.vendor_visit_id,
    vendorId: quote.vendor_id,
    vendorName: quote.vendor_id ? vendorNames.get(quote.vendor_id) || null : null,
    quotedAmount: quote.quoted_amount != null ? Number(quote.quoted_amount) : null,
    authorizedAmount: quote.authorized_amount != null ? Number(quote.authorized_amount) : null,
    actualCost: quote.actual_cost != null ? Number(quote.actual_cost) : null,
    poNumber: quote.po_number,
    glCode: quote.gl_code,
    reference: quote.reference,
    scope: quote.scope,
    notes: quote.notes,
    createdByMemberId: quote.created_by_member_id,
    createdByName: quote.created_by_member_id
      ? names.get(quote.created_by_member_id) || null : null,
    createdAt: quote.created_at,
    updatedAt: quote.updated_at,
  };
}

async function writeWorkOrderHistory(
  admin: AdminClient, actor: MemberRow, workOrderId: number,
  action: string, detail: Record<string, unknown>,
) {
  const { error } = await admin.from("work_order_history").insert({
    work_order_id: workOrderId,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    action,
    detail,
  });
  if (error) throw error;
}

async function writeVisitQuoteHistory(
  admin: AdminClient, actor: MemberRow, quote: QuoteRow,
  detail: Record<string, unknown>,
) {
  if (!quote.vendor_visit_id) return;
  const { data: visit, error: visitError } = await admin
    .from("vendor_visits").select("vendor_id, vendor_job_id")
    .eq("id", quote.vendor_visit_id)
    .maybeSingle<{ vendor_id: number; vendor_job_id: number | null }>();
  if (visitError) throw visitError;
  if (!visit) return;
  const { error } = await admin.from("vendor_history").insert({
    vendor_id: visit.vendor_id,
    vendor_job_id: visit.vendor_job_id,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    action: "job_updated",
    detail: { quoteId: quote.id, vendorVisitId: quote.vendor_visit_id, ...detail },
  });
  if (error) throw error;
}

const AMOUNT_INPUTS: [string, string][] = [
  ["quotedAmount", "quoted_amount"],
  ["authorizedAmount", "authorized_amount"],
  ["actualCost", "actual_cost"],
];
const TEXT_INPUTS: [string, string, number][] = [
  ["poNumber", "po_number", 120], ["glCode", "gl_code", 120],
  ["reference", "reference", 200], ["scope", "scope", 4000], ["notes", "notes", 4000],
];

export async function GET(req: NextRequest) {
  try {
    await requireApproved();
    const admin = createAdminClient();
    const params = req.nextUrl.searchParams;
    let query = admin.from("job_quotes").select("*")
      .order("created_at", { ascending: false }).limit(200);
    const workOrderId = Number(params.get("workOrderId") || 0);
    const vendorVisitId = Number(params.get("vendorVisitId") || 0);
    if (workOrderId) query = query.eq("work_order_id", workOrderId);
    if (vendorVisitId) query = query.eq("vendor_visit_id", vendorVisitId);
    const { data, error } = await query;
    if (error) throw error;
    const [{ data: memberRows, error: memberError }, { data: vendorRows, error: vendorError }] =
      await Promise.all([
        admin.from("members").select("id, name"),
        admin.from("vendors").select("id, company_name"),
      ]);
    if (memberError) throw memberError;
    if (vendorError) throw vendorError;
    const names = new Map(
      ((memberRows || []) as { id: number; name: string }[]).map((p) => [p.id, p.name]),
    );
    const vendorNames = new Map(
      ((vendorRows || []) as { id: number; company_name: string }[]).map((v) => [v.id, v.company_name]),
    );
    return NextResponse.json({
      quotes: ((data || []) as QuoteRow[]).map((quote) => quoteForClient(quote, names, vendorNames)),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireApproved();
    const admin = createAdminClient();
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const action = String(body.action || (body.id ? "update" : "create"));
    const now = new Date().toISOString();

    if (action === "create") {
      const workOrderId = body.workOrderId ? Number(body.workOrderId) : null;
      const vendorVisitId = body.vendorVisitId ? Number(body.vendorVisitId) : null;
      if (!workOrderId && !vendorVisitId) {
        return NextResponse.json(
          { error: "A quote needs a work order or a vendor visit" },
          { status: 400 },
        );
      }
      if (workOrderId) {
        const { data, error } = await admin.from("work_orders")
          .select("id").eq("id", workOrderId).maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
      }
      if (vendorVisitId) {
        const { data, error } = await admin.from("vendor_visits")
          .select("id").eq("id", vendorVisitId).maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Vendor visit not found" }, { status: 404 });
      }
      const vendorId = body.vendorId ? Number(body.vendorId) : null;
      if (vendorId) {
        const { data, error } = await admin.from("vendors")
          .select("id").eq("id", vendorId).maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
      }
      const insert: Record<string, unknown> = {
        work_order_id: workOrderId,
        vendor_visit_id: vendorVisitId,
        vendor_id: vendorId,
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      };
      for (const [input, column] of AMOUNT_INPUTS) {
        const parsed = amountField(body[input]);
        if (parsed === "INVALID") {
          return NextResponse.json({ error: "Amounts must be numbers of 0 or more" }, { status: 400 });
        }
        insert[column] = parsed;
      }
      for (const [input, column, max] of TEXT_INPUTS) {
        insert[column] = textField(body[input], max);
      }
      const { data: created, error } = await admin.from("job_quotes")
        .insert(insert).select("*").single<QuoteRow>();
      if (error) throw error;
      if (created.work_order_id) {
        await writeWorkOrderHistory(admin, me, created.work_order_id, "quote_added", {
          quoteId: created.id,
          quotedAmount: created.quoted_amount != null ? Number(created.quoted_amount) : null,
          authorizedAmount: created.authorized_amount != null ? Number(created.authorized_amount) : null,
          actualCost: created.actual_cost != null ? Number(created.actual_cost) : null,
          vendorId: created.vendor_id,
        });
      }
      await writeVisitQuoteHistory(admin, me, created, { event: "quote_added" });
      return NextResponse.json({ quoteId: created.id });
    }

    if (action === "update") {
      const id = Number(body.id || body.quoteId || 0);
      if (!id) return NextResponse.json({ error: "Quote is required" }, { status: 400 });
      const { data: current, error: findError } = await admin.from("job_quotes")
        .select("*").eq("id", id).maybeSingle<QuoteRow>();
      if (findError) throw findError;
      if (!current) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
      const update: Record<string, unknown> = { updated_at: now };
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [input, column] of AMOUNT_INPUTS) {
        if (body[input] !== undefined) {
          const parsed = amountField(body[input]);
          if (parsed === "INVALID") {
            return NextResponse.json({ error: "Amounts must be numbers of 0 or more" }, { status: 400 });
          }
          update[column] = parsed;
          const before = (current as unknown as Record<string, unknown>)[column];
          const beforeNumber = before != null ? Number(before) : null;
          if (beforeNumber !== parsed) changes[input] = { from: beforeNumber, to: parsed };
        }
      }
      for (const [input, column, max] of TEXT_INPUTS) {
        if (body[input] !== undefined) {
          const value = textField(body[input], max);
          update[column] = value;
          const before = (current as unknown as Record<string, unknown>)[column] as string | null;
          if (before !== value) changes[input] = { from: before, to: value };
        }
      }
      if (body.vendorId !== undefined) {
        const vendorId = body.vendorId ? Number(body.vendorId) : null;
        if (vendorId) {
          const { data, error } = await admin.from("vendors")
            .select("id").eq("id", vendorId).maybeSingle();
          if (error) throw error;
          if (!data) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
        }
        update.vendor_id = vendorId;
        if (current.vendor_id !== vendorId) {
          changes.vendorId = { from: current.vendor_id, to: vendorId };
        }
      }
      if (!Object.keys(changes).length && Object.keys(update).length <= 1) {
        return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      }
      const { error } = await admin.from("job_quotes").update(update).eq("id", id);
      if (error) throw error;
      const amountChanged = ["quotedAmount", "authorizedAmount", "actualCost"]
        .some((key) => key in changes);
      if (current.work_order_id) {
        await writeWorkOrderHistory(admin, me, current.work_order_id, "quote_updated", {
          quoteId: id, changes,
        });
        if (amountChanged) {
          await writeWorkOrderHistory(admin, me, current.work_order_id, "cost_updated", {
            quoteId: id, changes,
          });
        }
      }
      await writeVisitQuoteHistory(admin, me, current, { event: "quote_updated", changes });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
