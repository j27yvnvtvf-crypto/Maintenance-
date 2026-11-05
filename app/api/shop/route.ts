import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, type MemberRow } from "@/lib/access";
import { localDate } from "@/lib/time";
import {
  applyMovement,
  canAccessShop,
  canChangeReorderStatus,
  canLoanTool,
  canReturnTool,
  isBelowMinimum,
  isOpenReorder,
  isValidMovement,
  isValidRefrigerantEntry,
  needsAutoReorder,
  suggestedReorderQuantity,
  warrantyStatus,
  MOVEMENT_TYPES,
  REORDER_STATUSES,
  SOP_COLOR_KEYS,
  type AssetStatus,
  type MovementType,
  type ReorderStatus,
  type ToolStatus,
} from "@/lib/inventory-vendors-rules";

/**
 * Shop API (Phase 3B): inventory, reorder requests, tools, assets,
 * refrigerant records and training sessions.
 *
 * Every permission decision is made HERE, on the server, per request,
 * from the database state — the UI only mirrors them:
 * - Unapproved accounts get 403 on everything (access model v2).
 * - Every approved account has the SAME operational permissions in
 *   this module; the administrator gains nothing extra, and neither
 *   job_title nor the legacy role grants anything.
 * - STOCK INTEGRITY: inventory_items.quantity_on_hand changes ONLY in
 *   the same request that inserts its inventory_movements ledger row.
 *   update_item rejects quantity fields outright — there is no silent
 *   stock edit. The ledger, the tool-loan history, the refrigerant
 *   records and every history table in this module are APPEND-ONLY:
 *   this API exposes no update or delete path for them.
 * - When a movement leaves an item at or below its minimum and no
 *   open reorder request exists, the server raises one (source
 *   'auto') in the same request — one open request per shelf gap,
 *   never a stack of duplicates.
 * - Items, tools and assets are archived / retired, never deleted.
 * - Assets link their manual to an existing Library document; the
 *   file is never duplicated. Training sessions pin the exact Library
 *   document VERSIONS reviewed; read confirmations stay in the
 *   Library (document_reads) and are never duplicated either.
 */

const LIST_LIMIT = 300;

type ItemRow = {
  id: number; name: string; color_category: string;
  quantity_on_hand: number; min_quantity: number; unit: string | null;
  supplier: string | null; location_zone: string | null;
  location_shelf: string | null; location_bin: string | null;
  notes: string | null; status: string;
  created_at: string; updated_at: string;
};

type MovementRow = {
  id: number; item_id: number; movement_type: MovementType;
  quantity: number; reason: string | null;
  work_order_id: number | null; log_event_id: number | null;
  actor_member_id: number | null; actor_email: string; created_at: string;
};

type ReorderRow = {
  id: number; item_id: number; quantity_requested: number;
  status: ReorderStatus; source: string;
  responsible_member_id: number | null; notes: string | null;
  created_by_member_id: number | null;
  ordered_by_member_id: number | null; ordered_at: string | null;
  received_by_member_id: number | null; received_at: string | null;
  created_at: string; updated_at: string;
};

type ToolRow = {
  id: number; name: string; description: string | null;
  serial_number: string | null; status: ToolStatus;
  current_holder_member_id: number | null; loaned_at: string | null;
  notes: string | null; created_at: string; updated_at: string;
};

type LoanRow = {
  id: number; tool_id: number; action: string;
  holder_member_id: number | null; actor_member_id: number | null;
  actor_email: string; note: string | null; created_at: string;
};

type AssetRow = {
  id: number; name: string; asset_type: string | null;
  building: string | null; unit: string | null; area: string | null;
  brand: string | null; model: string | null; serial_number: string | null;
  installed_date: string | null; purchase_date: string | null;
  warranty_end_date: string | null; manual_document_id: number | null;
  status: string; notes: string | null;
  created_at: string; updated_at: string;
};

type RefrigerantRow = {
  id: number; log_date: string; asset_id: number | null;
  equipment_text: string | null; refrigerant_type: string;
  amount_added: number; amount_recovered: number; amount_unit: string;
  technician_member_id: number | null; reason: string | null;
  work_order_id: number | null; log_event_id: number | null;
  created_by_member_id: number | null; actor_email: string; created_at: string;
};

type HistoryRow = {
  id: number; actor_member_id: number | null; actor_email: string;
  action: string; detail: Record<string, unknown>; created_at: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

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

async function requireOperationalMember() {
  const me = await getCurrentMember();
  // Per-request state check: a suspended account with an open session is
  // stopped here, exactly like every other data endpoint.
  if (!canAccessShop(me)) throw new Error("APPROVAL_REQUIRED");
  return me;
}

async function memberNames(admin: AdminClient) {
  const { data, error } = await admin.from("members").select("id, name");
  if (error) throw error;
  return new Map(((data || []) as { id: number; name: string }[]).map((p) => [p.id, p.name]));
}

async function requireAssignableMember(admin: AdminClient, memberId: number) {
  const { data, error } = await admin
    .from("members")
    .select("id, approval_status, active")
    .eq("id", memberId)
    .maybeSingle<{ id: number; approval_status: string; active: boolean }>();
  if (error) throw error;
  if (!data) return false;
  return data.active === true && data.approval_status === "approved";
}

function textField(value: unknown, max: number) {
  const text = String(value ?? "").trim().slice(0, max);
  return text || null;
}

function parseDateField(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "INVALID";
  return text;
}

function numField(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function getItemOr404(admin: AdminClient, id: number) {
  const { data, error } = await admin
    .from("inventory_items").select("*").eq("id", id).maybeSingle<ItemRow>();
  if (error) throw error;
  return data;
}

async function getToolOr404(admin: AdminClient, id: number) {
  const { data, error } = await admin
    .from("tools").select("*").eq("id", id).maybeSingle<ToolRow>();
  if (error) throw error;
  return data;
}

async function getAssetOr404(admin: AdminClient, id: number) {
  const { data, error } = await admin
    .from("assets").select("*").eq("id", id).maybeSingle<AssetRow>();
  if (error) throw error;
  return data;
}

async function openReorderFor(admin: AdminClient, itemId: number) {
  const { data, error } = await admin
    .from("reorder_requests").select("id")
    .eq("item_id", itemId).in("status", ["pending", "ordered"]).limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

/** Append-only per-item trail: the ONLY write ever made to it. */
async function writeItemHistory(
  admin: AdminClient, actor: MemberRow, itemId: number,
  action: string, detail: Record<string, unknown> = {}, reorderRequestId: number | null = null,
) {
  const { error } = await admin.from("inventory_history").insert({
    item_id: itemId,
    reorder_request_id: reorderRequestId,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    action,
    detail,
  });
  if (error) throw error;
}

/** Append-only per-asset trail: the ONLY write ever made to it. */
async function writeAssetHistory(
  admin: AdminClient, actor: MemberRow, assetId: number,
  action: string, detail: Record<string, unknown> = {},
) {
  const { error } = await admin.from("asset_history").insert({
    asset_id: assetId,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    action,
    detail,
  });
  if (error) throw error;
}

/** Append-only per-session trail: the ONLY write ever made to it. */
async function writeTrainingHistory(
  admin: AdminClient, actor: MemberRow, sessionId: number,
  action: string, detail: Record<string, unknown> = {},
) {
  const { error } = await admin.from("training_history").insert({
    session_id: sessionId,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    action,
    detail,
  });
  if (error) throw error;
}

/**
 * Records a stock movement and the resulting quantity as one unit of
 * work: ledger row first, then the item's quantity. Returns the
 * updated item and the auto reorder raised, if any.
 */
async function recordMovement(
  admin: AdminClient, actor: MemberRow, item: ItemRow,
  type: MovementType, quantity: number,
  reason: string | null, workOrderId: number | null, logEventId: number | null,
) {
  const newQuantity = applyMovement(Number(item.quantity_on_hand), type, quantity);
  const { error: movementError } = await admin.from("inventory_movements").insert({
    item_id: item.id,
    movement_type: type,
    quantity,
    reason,
    work_order_id: workOrderId,
    log_event_id: logEventId,
    actor_member_id: actor.id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
  });
  if (movementError) throw movementError;
  const { error: updateError } = await admin.from("inventory_items")
    .update({ quantity_on_hand: newQuantity, updated_at: new Date().toISOString() })
    .eq("id", item.id);
  if (updateError) throw updateError;

  const updated = { ...item, quantity_on_hand: newQuantity };
  let reorderCreated: number | null = null;
  const open = await openReorderFor(admin, item.id);
  if (needsAutoReorder(updated, Boolean(open))) {
    const { data: reorder, error: reorderError } = await admin.from("reorder_requests").insert({
      item_id: item.id,
      quantity_requested: suggestedReorderQuantity(updated),
      status: "pending",
      source: "auto",
      notes: null,
      created_by_member_id: actor.id,
      created_by_user_id: actor.user_id,
    }).select("id").single<{ id: number }>();
    if (reorderError) throw reorderError;
    reorderCreated = reorder.id;
    await writeItemHistory(admin, actor, item.id, "reorder_created", {
      reorderRequestId: reorder.id, source: "auto",
      quantityRequested: suggestedReorderQuantity(updated),
    }, reorder.id);
  }
  return { newQuantity, reorderCreated };
}

function itemForClient(item: ItemRow, openReorderIds: Set<number>) {
  return {
    id: item.id,
    name: item.name,
    colorCategory: item.color_category,
    quantityOnHand: Number(item.quantity_on_hand),
    minQuantity: Number(item.min_quantity),
    unit: item.unit,
    supplier: item.supplier,
    locationZone: item.location_zone,
    locationShelf: item.location_shelf,
    locationBin: item.location_bin,
    location: [item.location_zone, item.location_shelf, item.location_bin]
      .map((part) => (part || "").trim()).filter(Boolean).join(" · "),
    notes: item.notes,
    status: item.status,
    belowMinimum: isBelowMinimum(item),
    hasOpenReorder: openReorderIds.has(item.id),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function reorderForClient(row: ReorderRow, names: Map<number, string>, itemName: string | null) {
  const name = (id: number | null) => (id ? names.get(id) || null : null);
  return {
    id: row.id,
    itemId: row.item_id,
    itemName,
    quantityRequested: Number(row.quantity_requested),
    status: row.status,
    source: row.source,
    responsibleMemberId: row.responsible_member_id,
    responsibleName: name(row.responsible_member_id),
    notes: row.notes,
    createdByName: name(row.created_by_member_id),
    orderedByName: name(row.ordered_by_member_id),
    orderedAt: row.ordered_at,
    receivedByName: name(row.received_by_member_id),
    receivedAt: row.received_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toolForClient(tool: ToolRow, names: Map<number, string>) {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    serialNumber: tool.serial_number,
    status: tool.status,
    holderMemberId: tool.current_holder_member_id,
    holderName: tool.current_holder_member_id ? names.get(tool.current_holder_member_id) || null : null,
    loanedAt: tool.loaned_at,
    notes: tool.notes,
    createdAt: tool.created_at,
    updatedAt: tool.updated_at,
  };
}

function assetForClient(asset: AssetRow, today: string, manualTitle: string | null) {
  return {
    id: asset.id,
    name: asset.name,
    assetType: asset.asset_type,
    building: asset.building,
    unit: asset.unit,
    area: asset.area,
    location: [asset.building, asset.unit, asset.area]
      .map((part) => (part || "").trim()).filter(Boolean).join(" · "),
    brand: asset.brand,
    model: asset.model,
    serialNumber: asset.serial_number,
    installedDate: asset.installed_date,
    purchaseDate: asset.purchase_date,
    warrantyEndDate: asset.warranty_end_date,
    warranty: warrantyStatus(asset, today),
    manualDocumentId: asset.manual_document_id,
    manualTitle,
    status: asset.status,
    notes: asset.notes,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
  };
}

function historyForClient(entry: HistoryRow, names: Map<number, string>) {
  return {
    id: entry.id,
    action: entry.action,
    detail: entry.detail,
    actorMemberId: entry.actor_member_id,
    actorName: entry.actor_member_id ? names.get(entry.actor_member_id) || null : null,
    actorEmail: entry.actor_email,
    createdAt: entry.created_at,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireOperationalMember();
    const admin = createAdminClient();
    const today = localDate(new Date());
    const names = await memberNames(admin);
    const params = req.nextUrl.searchParams;

    // --- Summary for the Hoy / Today attention card ---
    if (params.get("summary")) {
      const [{ data: itemRows, error: itemError },
        { data: reorderRows, error: reorderError },
        { data: toolRows, error: toolError },
        { data: jobRows, error: jobError }] = await Promise.all([
        admin.from("inventory_items").select("*").eq("status", "active").limit(1000),
        admin.from("reorder_requests").select("id, status").in("status", ["pending", "ordered"]).limit(1000),
        admin.from("tools").select("id").eq("status", "loaned").limit(1000),
        admin.from("vendor_jobs").select("id, kind, status").in("kind", ["pending_part", "pending_service"])
          .not("status", "in", "(completed,verified,cancelled)").limit(1000),
      ]);
      if (itemError) throw itemError;
      if (reorderError) throw reorderError;
      if (toolError) throw toolError;
      if (jobError) throw jobError;
      const lowStock = ((itemRows || []) as ItemRow[])
        .filter((item) => isBelowMinimum(item))
        .sort((a, b) => Number(a.quantity_on_hand) - Number(b.quantity_on_hand));
      return NextResponse.json({
        lowStockCount: lowStock.length,
        openReorders: (reorderRows || []).length,
        toolsOut: (toolRows || []).length,
        openVendorPendings: (jobRows || []).length,
        lowStock: lowStock.slice(0, 5).map((item) => ({
          id: item.id, name: item.name, colorCategory: item.color_category,
          quantityOnHand: Number(item.quantity_on_hand), minQuantity: Number(item.min_quantity),
          unit: item.unit, location: [item.location_zone, item.location_shelf, item.location_bin]
            .map((part) => (part || "").trim()).filter(Boolean).join(" · "),
        })),
      });
    }

    // --- Item detail: movements ledger + reorders + trail ---
    const itemId = Number(params.get("itemId") || 0);
    if (itemId) {
      const item = await getItemOr404(admin, itemId);
      if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      const [{ data: movementRows, error: movementError },
        { data: reorderRows, error: reorderError },
        { data: historyRows, error: historyError }] = await Promise.all([
        admin.from("inventory_movements").select("*").eq("item_id", item.id)
          .order("created_at", { ascending: false }).limit(200),
        admin.from("reorder_requests").select("*").eq("item_id", item.id)
          .order("created_at", { ascending: false }).limit(100),
        admin.from("inventory_history").select("*").eq("item_id", item.id)
          .order("created_at", { ascending: true }).limit(300),
      ]);
      if (movementError) throw movementError;
      if (reorderError) throw reorderError;
      if (historyError) throw historyError;
      const openIds = new Set(
        ((reorderRows || []) as ReorderRow[]).filter((row) => isOpenReorder(row.status)).map((row) => row.item_id),
      );
      const woIds = [...new Set(((movementRows || []) as MovementRow[])
        .map((row) => row.work_order_id).filter(Boolean))] as number[];
      const woLabel = new Map<number, string>();
      if (woIds.length) {
        const { data, error } = await admin.from("work_orders").select("id, title").in("id", woIds);
        if (error) throw error;
        for (const row of (data || []) as { id: number; title: string }[]) woLabel.set(row.id, `#${row.id} — ${row.title}`);
      }
      return NextResponse.json({
        item: itemForClient(item, openIds),
        movements: ((movementRows || []) as MovementRow[]).map((row) => ({
          id: row.id, type: row.movement_type, quantity: Number(row.quantity),
          reason: row.reason,
          workOrderId: row.work_order_id,
          workOrderLabel: row.work_order_id ? woLabel.get(row.work_order_id) || null : null,
          logEventId: row.log_event_id,
          actorName: row.actor_member_id ? names.get(row.actor_member_id) || null : null,
          actorEmail: row.actor_email, createdAt: row.created_at,
        })),
        reorders: ((reorderRows || []) as ReorderRow[]).map((row) => reorderForClient(row, names, item.name)),
        history: ((historyRows || []) as HistoryRow[]).map((row) => historyForClient(row, names)),
      });
    }

    // --- Tool detail: loan history ---
    const toolId = Number(params.get("toolId") || 0);
    if (toolId) {
      const tool = await getToolOr404(admin, toolId);
      if (!tool) return NextResponse.json({ error: "Tool not found" }, { status: 404 });
      const { data: loanRows, error: loanError } = await admin
        .from("tool_loans").select("*").eq("tool_id", tool.id)
        .order("created_at", { ascending: false }).limit(200);
      if (loanError) throw loanError;
      return NextResponse.json({
        tool: toolForClient(tool, names),
        loans: ((loanRows || []) as LoanRow[]).map((row) => ({
          id: row.id, action: row.action,
          holderName: row.holder_member_id ? names.get(row.holder_member_id) || null : null,
          actorName: row.actor_member_id ? names.get(row.actor_member_id) || null : null,
          note: row.note, createdAt: row.created_at,
        })),
      });
    }

    // --- Asset detail: history, links, refrigerant use ---
    const assetId = Number(params.get("assetId") || 0);
    if (assetId) {
      const asset = await getAssetOr404(admin, assetId);
      if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      let manualTitle: string | null = null;
      if (asset.manual_document_id) {
        const { data: doc } = await admin.from("documents")
          .select("title").eq("id", asset.manual_document_id)
          .maybeSingle<{ title: string }>();
        manualTitle = doc?.title || null;
      }
      const [{ data: historyRows, error: historyError },
        { data: linkRows, error: linkError },
        { data: bornEvents, error: bornError },
        { data: refrRows, error: refrError }] = await Promise.all([
        admin.from("asset_history").select("*").eq("asset_id", asset.id)
          .order("created_at", { ascending: true }).limit(300),
        admin.from("asset_links").select("*").eq("asset_id", asset.id)
          .order("created_at", { ascending: true }),
        admin.from("log_events").select("id, folio, description, status, occurred_at")
          .eq("asset_id", asset.id).order("occurred_at", { ascending: false }).limit(100),
        admin.from("refrigerant_logs").select("*").eq("asset_id", asset.id)
          .order("log_date", { ascending: false }).limit(100),
      ]);
      if (historyError) throw historyError;
      if (linkError) throw linkError;
      if (bornError) throw bornError;
      if (refrError) throw refrError;
      type LinkRow = { id: number; log_event_id: number | null; work_order_id: number | null; created_at: string };
      const links = (linkRows || []) as LinkRow[];
      const eventIds = [...new Set(links.map((row) => row.log_event_id).filter(Boolean))] as number[];
      const woIds = [...new Set(links.map((row) => row.work_order_id).filter(Boolean))] as number[];
      const eventLabel = new Map<number, string>();
      const woLabel = new Map<number, string>();
      if (eventIds.length) {
        const { data, error } = await admin.from("log_events").select("id, folio, description").in("id", eventIds);
        if (error) throw error;
        for (const row of (data || []) as { id: number; folio: string; description: string }[]) {
          eventLabel.set(row.id, `${row.folio} — ${row.description.slice(0, 60)}`);
        }
      }
      if (woIds.length) {
        const { data, error } = await admin.from("work_orders").select("id, title").in("id", woIds);
        if (error) throw error;
        for (const row of (data || []) as { id: number; title: string }[]) woLabel.set(row.id, `#${row.id} — ${row.title}`);
      }
      // Link options: recent logbook events and work orders.
      const [{ data: eventOptions }, { data: woOptions }] = await Promise.all([
        admin.from("log_events").select("id, folio, description").order("created_at", { ascending: false }).limit(200),
        admin.from("work_orders").select("id, title").order("created_at", { ascending: false }).limit(200),
      ]);
      return NextResponse.json({
        asset: assetForClient(asset, today, manualTitle),
        history: ((historyRows || []) as HistoryRow[]).map((row) => historyForClient(row, names)),
        bornEvents: ((bornEvents || []) as { id: number; folio: string; description: string; status: string; occurred_at: string }[])
          .map((row) => ({ id: row.id, folio: row.folio, label: `${row.folio} — ${row.description.slice(0, 60)}`, status: row.status, occurredAt: row.occurred_at })),
        links: links.map((row) => ({
          id: row.id,
          logEventId: row.log_event_id,
          logEventLabel: row.log_event_id ? eventLabel.get(row.log_event_id) || null : null,
          workOrderId: row.work_order_id,
          workOrderLabel: row.work_order_id ? woLabel.get(row.work_order_id) || null : null,
          createdAt: row.created_at,
        })),
        refrigerant: ((refrRows || []) as RefrigerantRow[]).map((row) => refrigerantForClient(row, names, asset.name)),
        linkOptions: {
          logEvents: ((eventOptions || []) as { id: number; folio: string; description: string }[])
            .map((row) => ({ id: row.id, label: `${row.folio} — ${row.description.slice(0, 60)}` })),
          workOrders: ((woOptions || []) as { id: number; title: string }[])
            .map((row) => ({ id: row.id, label: `#${row.id} — ${row.title}` })),
        },
      });
    }

    // --- Lists ---
    const [{ data: itemRows, error: itemError },
      { data: reorderRows, error: reorderError },
      { data: toolRows, error: toolError },
      { data: assetRows, error: assetError },
      { data: refrRows, error: refrError },
      { data: sessionRows, error: sessionError },
      { data: docRows, error: docError }] = await Promise.all([
      admin.from("inventory_items").select("*").order("name", { ascending: true }).limit(LIST_LIMIT),
      admin.from("reorder_requests").select("*").order("created_at", { ascending: false }).limit(LIST_LIMIT),
      admin.from("tools").select("*").order("name", { ascending: true }).limit(LIST_LIMIT),
      admin.from("assets").select("*").order("name", { ascending: true }).limit(LIST_LIMIT),
      admin.from("refrigerant_logs").select("*").order("log_date", { ascending: false }).limit(100),
      admin.from("training_sessions").select("*").order("session_date", { ascending: false }).limit(100),
      admin.from("documents").select("id, title, status").eq("status", "published").order("title", { ascending: true }),
    ]);
    if (itemError) throw itemError;
    if (reorderError) throw reorderError;
    if (toolError) throw toolError;
    if (assetError) throw assetError;
    if (refrError) throw refrError;
    if (sessionError) throw sessionError;
    if (docError) throw docError;

    const reorders = (reorderRows || []) as ReorderRow[];
    const openItemIds = new Set(reorders.filter((row) => isOpenReorder(row.status)).map((row) => row.item_id));
    const itemName = new Map(((itemRows || []) as ItemRow[]).map((row) => [row.id, row.name]));
    const docTitle = new Map(((docRows || []) as { id: number; title: string }[]).map((row) => [row.id, row.title]));
    const assetName = new Map(((assetRows || []) as AssetRow[]).map((row) => [row.id, row.name]));

    // Training enrichment: attendees, pinned document versions, actions.
    const sessions = (sessionRows || []) as {
      id: number; session_date: string; start_time: string | null; end_time: string | null;
      topic: string; presenter_name: string | null; presenter_member_id: number | null;
      location: string | null; key_points: string | null;
      created_by_member_id: number | null; created_at: string;
    }[];
    const sessionIds = sessions.map((row) => row.id);
    const attendeesBySession = new Map<number, { memberId: number; name: string | null }[]>();
    const docsBySession = new Map<number, { documentId: number; versionId: number; title: string | null; versionNumber: number | null }[]>();
    const actionsBySession = new Map<number, unknown[]>();
    if (sessionIds.length) {
      const [{ data: attRows }, { data: tdocRows }, { data: tactRows }, { data: versionRows }] = await Promise.all([
        admin.from("training_attendees").select("session_id, member_id").in("session_id", sessionIds),
        admin.from("training_documents").select("session_id, document_id, document_version_id").in("session_id", sessionIds),
        admin.from("training_actions").select("*").in("session_id", sessionIds).order("created_at", { ascending: true }),
        admin.from("document_versions").select("id, document_id, version_number").limit(2000),
      ]);
      const versionNumber = new Map(((versionRows || []) as { id: number; version_number: number }[])
        .map((row) => [row.id, row.version_number]));
      for (const row of (attRows || []) as { session_id: number; member_id: number }[]) {
        attendeesBySession.set(row.session_id, [...(attendeesBySession.get(row.session_id) || []), {
          memberId: row.member_id, name: names.get(row.member_id) || null,
        }]);
      }
      for (const row of (tdocRows || []) as { session_id: number; document_id: number; document_version_id: number }[]) {
        docsBySession.set(row.session_id, [...(docsBySession.get(row.session_id) || []), {
          documentId: row.document_id, versionId: row.document_version_id,
          title: docTitle.get(row.document_id) || null,
          versionNumber: versionNumber.get(row.document_version_id) ?? null,
        }]);
      }
      for (const row of (tactRows || []) as Record<string, unknown>[]) {
        const sid = Number(row.session_id);
        actionsBySession.set(sid, [...(actionsBySession.get(sid) || []), {
          id: row.id, description: row.description,
          responsibleMemberId: row.responsible_member_id,
          responsibleName: row.responsible_member_id ? names.get(Number(row.responsible_member_id)) || null : null,
          dueDate: row.due_date, status: row.status,
          completedByName: row.completed_by_member_id ? names.get(Number(row.completed_by_member_id)) || null : null,
          completedAt: row.completed_at,
        }]);
      }
    }

    // Library picker: published documents with ALL their versions, so a
    // training record can pin the exact version that was reviewed.
    let libraryDocs: { id: number; title: string; versions: { id: number; versionNumber: number }[] }[] = [];
    if ((docRows || []).length) {
      const { data: versionRows, error: versionError } = await admin
        .from("document_versions").select("id, document_id, version_number")
        .in("document_id", (docRows || []).map((row: { id: number }) => row.id))
        .order("version_number", { ascending: true });
      if (versionError) throw versionError;
      const byDoc = new Map<number, { id: number; versionNumber: number }[]>();
      for (const row of (versionRows || []) as { id: number; document_id: number; version_number: number }[]) {
        byDoc.set(row.document_id, [...(byDoc.get(row.document_id) || []), { id: row.id, versionNumber: row.version_number }]);
      }
      libraryDocs = ((docRows || []) as { id: number; title: string }[])
        .map((row) => ({ id: row.id, title: row.title, versions: byDoc.get(row.id) || [] }));
    }

    const q = (params.get("q") || "").trim().toLowerCase();
    let items = ((itemRows || []) as ItemRow[]).map((row) => itemForClient(row, openItemIds));
    if (q) {
      items = items.filter((row) =>
        [row.name, row.location, row.supplier, row.unit].some((field) => (field || "").toLowerCase().includes(q)));
    }

    return NextResponse.json({
      items,
      reorders: reorders.map((row) => reorderForClient(row, names, itemName.get(row.item_id) || null)),
      tools: ((toolRows || []) as ToolRow[]).map((row) => toolForClient(row, names)),
      assets: ((assetRows || []) as AssetRow[]).map((row) => assetForClient(row, today, row.manual_document_id ? docTitle.get(row.manual_document_id) || null : null)),
      refrigerant: ((refrRows || []) as RefrigerantRow[]).map((row) => refrigerantForClient(row, names, row.asset_id ? assetName.get(row.asset_id) || null : null)),
      training: sessions.map((row) => ({
        id: row.id, sessionDate: row.session_date, startTime: row.start_time, endTime: row.end_time,
        topic: row.topic, presenterName: row.presenter_name,
        presenterMemberId: row.presenter_member_id,
        presenterMemberName: row.presenter_member_id ? names.get(row.presenter_member_id) || null : null,
        location: row.location, keyPoints: row.key_points,
        attendees: attendeesBySession.get(row.id) || [],
        documents: docsBySession.get(row.id) || [],
        actions: actionsBySession.get(row.id) || [],
        createdByName: row.created_by_member_id ? names.get(row.created_by_member_id) || null : null,
        createdAt: row.created_at,
      })),
      libraryDocs,
    });
  } catch (error) {
    return failure(error);
  }
}

function refrigerantForClient(row: RefrigerantRow, names: Map<number, string>, assetName: string | null) {
  return {
    id: row.id,
    logDate: row.log_date,
    assetId: row.asset_id,
    assetName,
    equipmentText: row.equipment_text,
    refrigerantType: row.refrigerant_type,
    amountAdded: Number(row.amount_added),
    amountRecovered: Number(row.amount_recovered),
    amountUnit: row.amount_unit,
    technicianMemberId: row.technician_member_id,
    technicianName: row.technician_member_id ? names.get(row.technician_member_id) || null : null,
    reason: row.reason,
    workOrderId: row.work_order_id,
    logEventId: row.log_event_id,
    createdByName: row.created_by_member_id ? names.get(row.created_by_member_id) || null : null,
    createdAt: row.created_at,
  };
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireOperationalMember();
    const admin = createAdminClient();
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const action = String(body.action || "");
    const now = new Date().toISOString();

    /* ---------------- Inventory items ---------------- */

    if (action === "create_item") {
      const name = textField(body.name, 200);
      if (!name) return NextResponse.json({ error: "Item name is required" }, { status: 400 });
      const colorCategory = String(body.colorCategory || "");
      if (!SOP_COLOR_KEYS.includes(colorCategory as never)) {
        return NextResponse.json({ error: "Choose a valid SOP 5025 color category" }, { status: 400 });
      }
      const initial = numField(body.quantityOnHand) ?? 0;
      const minimum = numField(body.minQuantity) ?? 0;
      if (initial < 0 || minimum < 0) {
        return NextResponse.json({ error: "Quantities cannot be negative" }, { status: 400 });
      }
      const { data: created, error } = await admin.from("inventory_items").insert({
        name,
        color_category: colorCategory,
        quantity_on_hand: 0,
        min_quantity: minimum,
        unit: textField(body.unit, 30),
        supplier: textField(body.supplier, 160),
        location_zone: textField(body.locationZone, 80),
        location_shelf: textField(body.locationShelf, 80),
        location_bin: textField(body.locationBin, 80),
        notes: textField(body.notes, 2000),
        status: "active",
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("*").single<ItemRow>();
      if (error) throw error;
      await writeItemHistory(admin, me, created.id, "created", { name, colorCategory });
      // Opening stock enters through the ledger, like every other unit.
      let reorderCreated: number | null = null;
      if (initial > 0) {
        const result = await recordMovement(
          admin, me, created, "in", initial, "Initial stock / Existencia inicial", null, null,
        );
        reorderCreated = result.reorderCreated;
      } else {
        const open = await openReorderFor(admin, created.id);
        if (needsAutoReorder(created, Boolean(open))) {
          const qty = suggestedReorderQuantity(created);
          const { data: reorder, error: reorderError } = await admin.from("reorder_requests").insert({
            item_id: created.id, quantity_requested: qty, status: "pending", source: "auto",
            created_by_member_id: me.id, created_by_user_id: me.user_id,
          }).select("id").single<{ id: number }>();
          if (reorderError) throw reorderError;
          reorderCreated = reorder.id;
          await writeItemHistory(admin, me, created.id, "reorder_created", {
            reorderRequestId: reorder.id, source: "auto", quantityRequested: qty,
          }, reorder.id);
        }
      }
      return NextResponse.json({ itemId: created.id, reorderCreated });
    }

    if (action === "update_item") {
      const item = await getItemOr404(admin, Number(body.id || 0));
      if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      // Stock is ledger-only: reject any attempt to edit it here.
      if (body.quantityOnHand !== undefined || body.quantity_on_hand !== undefined) {
        return NextResponse.json({
          error: "Stock changes only through movements — record an in / out / adjustment instead",
        }, { status: 400 });
      }
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      if (body.name !== undefined) {
        const name = textField(body.name, 200);
        if (!name) return NextResponse.json({ error: "Item name is required" }, { status: 400 });
        update.name = name; changed.push("name");
      }
      if (body.colorCategory !== undefined) {
        if (!SOP_COLOR_KEYS.includes(String(body.colorCategory) as never)) {
          return NextResponse.json({ error: "Choose a valid SOP 5025 color category" }, { status: 400 });
        }
        update.color_category = String(body.colorCategory); changed.push("colorCategory");
      }
      if (body.minQuantity !== undefined) {
        const minimum = numField(body.minQuantity);
        if (minimum === null || minimum < 0) {
          return NextResponse.json({ error: "Minimum cannot be negative" }, { status: 400 });
        }
        update.min_quantity = minimum; changed.push("minQuantity");
      }
      const textMap: [string, string, number][] = [
        ["unit", "unit", 30], ["supplier", "supplier", 160],
        ["locationZone", "location_zone", 80], ["locationShelf", "location_shelf", 80],
        ["locationBin", "location_bin", 80], ["notes", "notes", 2000],
      ];
      for (const [input, column, max] of textMap) {
        if (body[input] !== undefined) { update[column] = textField(body[input], max); changed.push(input); }
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("inventory_items").update(update).eq("id", item.id);
      if (error) throw error;
      await writeItemHistory(admin, me, item.id, "details_updated", { changed });
      return NextResponse.json({ ok: true });
    }

    if (action === "set_item_status") {
      const item = await getItemOr404(admin, Number(body.id || 0));
      if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      const target = String(body.status || "");
      if (target !== "active" && target !== "archived") {
        return NextResponse.json({ error: "Choose a valid item status" }, { status: 400 });
      }
      if (target === item.status) return NextResponse.json({ ok: true });
      const { error } = await admin.from("inventory_items")
        .update({ status: target, updated_at: now }).eq("id", item.id);
      if (error) throw error;
      await writeItemHistory(admin, me, item.id, target === "archived" ? "archived" : "reactivated", {
        from: item.status, to: target,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "record_movement") {
      const item = await getItemOr404(admin, Number(body.itemId || 0));
      if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      const type = String(body.type || "") as MovementType;
      if (!MOVEMENT_TYPES.includes(type)) {
        return NextResponse.json({ error: "Choose a valid movement type" }, { status: 400 });
      }
      const quantity = numField(body.quantity);
      if (quantity === null || !isValidMovement(item, type, quantity)) {
        return NextResponse.json({
          error: "Invalid movement: check the quantity against the stock on hand",
        }, { status: 400 });
      }
      const result = await recordMovement(
        admin, me, item, type, quantity,
        textField(body.reason, 500),
        body.workOrderId ? Number(body.workOrderId) : null,
        body.logEventId ? Number(body.logEventId) : null,
      );
      return NextResponse.json({ ok: true, newQuantity: result.newQuantity, reorderCreated: result.reorderCreated });
    }

    if (action === "create_reorder") {
      const item = await getItemOr404(admin, Number(body.itemId || 0));
      if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      const existing = await openReorderFor(admin, item.id);
      if (existing) {
        return NextResponse.json({
          error: "An open reorder request already exists for this item",
          reorderId: existing.id,
        }, { status: 400 });
      }
      const quantity = numField(body.quantityRequested) ?? suggestedReorderQuantity(item);
      if (!quantity || quantity <= 0) {
        return NextResponse.json({ error: "A quantity to order is required" }, { status: 400 });
      }
      const responsibleMemberId = body.responsibleMemberId ? Number(body.responsibleMemberId) : null;
      if (responsibleMemberId && !(await requireAssignableMember(admin, responsibleMemberId))) {
        return NextResponse.json({ error: "Responsible member is not an approved account" }, { status: 400 });
      }
      const { data: created, error } = await admin.from("reorder_requests").insert({
        item_id: item.id,
        quantity_requested: quantity,
        status: "pending",
        source: "manual",
        responsible_member_id: responsibleMemberId,
        notes: textField(body.notes, 2000),
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("id").single<{ id: number }>();
      if (error) throw error;
      await writeItemHistory(admin, me, item.id, "reorder_created", {
        reorderRequestId: created.id, source: "manual", quantityRequested: quantity,
      }, created.id);
      return NextResponse.json({ reorderId: created.id });
    }

    if (action === "set_reorder_status") {
      const reorderId = Number(body.id || body.reorderId || 0);
      const { data: reorder, error: reorderError } = await admin
        .from("reorder_requests").select("*").eq("id", reorderId).maybeSingle<ReorderRow>();
      if (reorderError) throw reorderError;
      if (!reorder) return NextResponse.json({ error: "Reorder request not found" }, { status: 404 });
      const target = String(body.status || "") as ReorderStatus;
      if (!REORDER_STATUSES.includes(target) || !canChangeReorderStatus(reorder.status, target)) {
        return NextResponse.json({
          error: `A ${reorder.status} request cannot become ${target || "that"}`,
        }, { status: 400 });
      }
      const update: Record<string, unknown> = { status: target, updated_at: now };
      if (target === "ordered") { update.ordered_by_member_id = me.id; update.ordered_at = now; }
      if (target === "received") { update.received_by_member_id = me.id; update.received_at = now; }
      const { error } = await admin.from("reorder_requests").update(update).eq("id", reorder.id);
      if (error) throw error;
      await writeItemHistory(admin, me, reorder.item_id, "reorder_status_changed", {
        reorderRequestId: reorder.id, from: reorder.status, to: target,
      }, reorder.id);
      // Receiving closes the loop: the units enter through the ledger.
      let newQuantity: number | null = null;
      const quantityReceived = numField(body.quantityReceived);
      if (target === "received" && quantityReceived && quantityReceived > 0) {
        const item = await getItemOr404(admin, reorder.item_id);
        if (item) {
          const result = await recordMovement(
            admin, me, item, "in", quantityReceived, `Reorder #${reorder.id} received`, null, null,
          );
          newQuantity = result.newQuantity;
        }
      }
      return NextResponse.json({ ok: true, newQuantity });
    }

    /* ---------------- Tools ---------------- */

    if (action === "create_tool") {
      const name = textField(body.name, 200);
      if (!name) return NextResponse.json({ error: "Tool name is required" }, { status: 400 });
      const { data: created, error } = await admin.from("tools").insert({
        name,
        description: textField(body.description, 1000),
        serial_number: textField(body.serialNumber, 120),
        notes: textField(body.notes, 2000),
        status: "available",
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("id").single<{ id: number }>();
      if (error) throw error;
      return NextResponse.json({ toolId: created.id });
    }

    if (action === "update_tool") {
      const tool = await getToolOr404(admin, Number(body.id || 0));
      if (!tool) return NextResponse.json({ error: "Tool not found" }, { status: 404 });
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      if (body.name !== undefined) {
        const name = textField(body.name, 200);
        if (!name) return NextResponse.json({ error: "Tool name is required" }, { status: 400 });
        update.name = name; changed.push("name");
      }
      const textMap: [string, string, number][] = [
        ["description", "description", 1000], ["serialNumber", "serial_number", 120], ["notes", "notes", 2000],
      ];
      for (const [input, column, max] of textMap) {
        if (body[input] !== undefined) { update[column] = textField(body[input], max); changed.push(input); }
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("tools").update(update).eq("id", tool.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "set_tool_status") {
      const tool = await getToolOr404(admin, Number(body.id || 0));
      if (!tool) return NextResponse.json({ error: "Tool not found" }, { status: 404 });
      const target = String(body.status || "");
      // 'loaned' is never set directly: it happens through loan_tool.
      if (target !== "available" && target !== "maintenance" && target !== "retired") {
        return NextResponse.json({ error: "Choose a valid tool status" }, { status: 400 });
      }
      if (tool.status === "loaned") {
        return NextResponse.json({ error: "Return the tool before changing its status" }, { status: 400 });
      }
      const { error } = await admin.from("tools")
        .update({ status: target, updated_at: now }).eq("id", tool.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "loan_tool") {
      const tool = await getToolOr404(admin, Number(body.id || body.toolId || 0));
      if (!tool) return NextResponse.json({ error: "Tool not found" }, { status: 404 });
      if (!canLoanTool(tool)) {
        return NextResponse.json({ error: "Only an available tool can be loaned" }, { status: 400 });
      }
      const holderMemberId = body.holderMemberId ? Number(body.holderMemberId) : me.id;
      if (!(await requireAssignableMember(admin, holderMemberId))) {
        return NextResponse.json({ error: "The holder must be an approved account" }, { status: 400 });
      }
      const { error } = await admin.from("tools").update({
        status: "loaned", current_holder_member_id: holderMemberId, loaned_at: now, updated_at: now,
      }).eq("id", tool.id);
      if (error) throw error;
      const { error: loanError } = await admin.from("tool_loans").insert({
        tool_id: tool.id, action: "loan", holder_member_id: holderMemberId,
        actor_member_id: me.id, actor_user_id: me.user_id, actor_email: me.email,
        note: textField(body.note, 500),
      });
      if (loanError) throw loanError;
      return NextResponse.json({ ok: true });
    }

    if (action === "return_tool") {
      const tool = await getToolOr404(admin, Number(body.id || body.toolId || 0));
      if (!tool) return NextResponse.json({ error: "Tool not found" }, { status: 404 });
      if (!canReturnTool(tool)) {
        return NextResponse.json({ error: "Only a loaned tool can be returned" }, { status: 400 });
      }
      const previousHolder = tool.current_holder_member_id;
      const { error } = await admin.from("tools").update({
        status: "available", current_holder_member_id: null, loaned_at: null, updated_at: now,
      }).eq("id", tool.id);
      if (error) throw error;
      const { error: loanError } = await admin.from("tool_loans").insert({
        tool_id: tool.id, action: "return", holder_member_id: previousHolder,
        actor_member_id: me.id, actor_user_id: me.user_id, actor_email: me.email,
        note: textField(body.note, 500),
      });
      if (loanError) throw loanError;
      return NextResponse.json({ ok: true });
    }

    /* ---------------- Assets ---------------- */

    if (action === "create_asset") {
      const name = textField(body.name, 200);
      if (!name) return NextResponse.json({ error: "Asset name is required" }, { status: 400 });
      const dates: Record<string, string | null> = {};
      for (const [input, column] of [["installedDate", "installed_date"], ["purchaseDate", "purchase_date"], ["warrantyEndDate", "warranty_end_date"]] as const) {
        const parsed = parseDateField(body[input]);
        if (parsed === "INVALID") {
          return NextResponse.json({ error: "Dates must use YYYY-MM-DD format" }, { status: 400 });
        }
        dates[column] = parsed;
      }
      const manualDocumentId = body.manualDocumentId ? Number(body.manualDocumentId) : null;
      if (manualDocumentId) {
        const { data: doc } = await admin.from("documents").select("id").eq("id", manualDocumentId).maybeSingle();
        if (!doc) return NextResponse.json({ error: "Manual document not found in the Library" }, { status: 400 });
      }
      const { data: created, error } = await admin.from("assets").insert({
        name,
        asset_type: textField(body.assetType, 80),
        building: textField(body.building, 120),
        unit: textField(body.unit, 60),
        area: textField(body.area, 120),
        brand: textField(body.brand, 120),
        model: textField(body.model, 120),
        serial_number: textField(body.serialNumber, 120),
        installed_date: dates.installed_date,
        purchase_date: dates.purchase_date,
        warranty_end_date: dates.warranty_end_date,
        manual_document_id: manualDocumentId,
        notes: textField(body.notes, 3000),
        status: "active",
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("*").single<AssetRow>();
      if (error) throw error;
      await writeAssetHistory(admin, me, created.id, "created", { name });
      if (manualDocumentId) {
        await writeAssetHistory(admin, me, created.id, "manual_linked", { documentId: manualDocumentId });
      }
      return NextResponse.json({ assetId: created.id });
    }

    if (action === "update_asset") {
      const asset = await getAssetOr404(admin, Number(body.id || 0));
      if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      const update: Record<string, unknown> = { updated_at: now };
      const changed: string[] = [];
      if (body.name !== undefined) {
        const name = textField(body.name, 200);
        if (!name) return NextResponse.json({ error: "Asset name is required" }, { status: 400 });
        update.name = name; changed.push("name");
      }
      const textMap: [string, string, number][] = [
        ["assetType", "asset_type", 80], ["building", "building", 120], ["unit", "unit", 60],
        ["area", "area", 120], ["brand", "brand", 120], ["model", "model", 120],
        ["serialNumber", "serial_number", 120], ["notes", "notes", 3000],
      ];
      for (const [input, column, max] of textMap) {
        if (body[input] !== undefined) { update[column] = textField(body[input], max); changed.push(input); }
      }
      for (const [input, column] of [["installedDate", "installed_date"], ["purchaseDate", "purchase_date"], ["warrantyEndDate", "warranty_end_date"]] as const) {
        if (body[input] !== undefined) {
          const parsed = parseDateField(body[input]);
          if (parsed === "INVALID") {
            return NextResponse.json({ error: "Dates must use YYYY-MM-DD format" }, { status: 400 });
          }
          update[column] = parsed; changed.push(input);
        }
      }
      let manualChanged = false;
      if (body.manualDocumentId !== undefined) {
        const manualDocumentId = body.manualDocumentId ? Number(body.manualDocumentId) : null;
        if (manualDocumentId) {
          const { data: doc } = await admin.from("documents").select("id").eq("id", manualDocumentId).maybeSingle();
          if (!doc) return NextResponse.json({ error: "Manual document not found in the Library" }, { status: 400 });
        }
        update.manual_document_id = manualDocumentId;
        manualChanged = manualDocumentId !== asset.manual_document_id;
        changed.push("manualDocumentId");
      }
      if (!changed.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      const { error } = await admin.from("assets").update(update).eq("id", asset.id);
      if (error) throw error;
      await writeAssetHistory(admin, me, asset.id, "details_updated", { changed });
      if (manualChanged) {
        await writeAssetHistory(admin, me, asset.id, "manual_linked", {
          documentId: update.manual_document_id ?? null,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "set_asset_status") {
      const asset = await getAssetOr404(admin, Number(body.id || 0));
      if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      const target = String(body.status || "") as AssetStatus;
      if (!["active", "inactive", "retired"].includes(target)) {
        return NextResponse.json({ error: "Choose a valid asset status" }, { status: 400 });
      }
      if (target === asset.status) return NextResponse.json({ ok: true });
      const { error } = await admin.from("assets")
        .update({ status: target, updated_at: now }).eq("id", asset.id);
      if (error) throw error;
      await writeAssetHistory(admin, me, asset.id, "status_changed", { from: asset.status, to: target });
      return NextResponse.json({ ok: true });
    }

    if (action === "link_asset_event" || action === "link_asset_work_order") {
      const asset = await getAssetOr404(admin, Number(body.assetId || 0));
      if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      if (action === "link_asset_event") {
        const eventId = Number(body.logEventId || 0);
        const { data: event } = await admin.from("log_events")
          .select("id, asset_id").eq("id", eventId)
          .maybeSingle<{ id: number; asset_id: number | null }>();
        if (!event) return NextResponse.json({ error: "Logbook event not found" }, { status: 404 });
        if (event.asset_id === asset.id) return NextResponse.json({ ok: true, alreadyLinked: true });
        const { data: existing } = await admin.from("asset_links")
          .select("id").eq("asset_id", asset.id).eq("log_event_id", eventId).limit(1);
        if (existing && existing.length) return NextResponse.json({ ok: true, alreadyLinked: true });
        const { error } = await admin.from("asset_links").insert({
          asset_id: asset.id, log_event_id: eventId,
          created_by_member_id: me.id, created_by_user_id: me.user_id,
        });
        if (error) throw error;
        await writeAssetHistory(admin, me, asset.id, "event_linked", { logEventId: eventId });
        return NextResponse.json({ ok: true });
      }
      const workOrderId = Number(body.workOrderId || 0);
      const { data: job } = await admin.from("work_orders")
        .select("id").eq("id", workOrderId).maybeSingle<{ id: number }>();
      if (!job) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
      const { data: existing } = await admin.from("asset_links")
        .select("id").eq("asset_id", asset.id).eq("work_order_id", workOrderId).limit(1);
      if (existing && existing.length) return NextResponse.json({ ok: true, alreadyLinked: true });
      const { error } = await admin.from("asset_links").insert({
        asset_id: asset.id, work_order_id: workOrderId,
        created_by_member_id: me.id, created_by_user_id: me.user_id,
      });
      if (error) throw error;
      await writeAssetHistory(admin, me, asset.id, "work_order_linked", { workOrderId });
      return NextResponse.json({ ok: true });
    }

    /* ---------------- Refrigerant records ---------------- */

    if (action === "log_refrigerant") {
      const refrigerantType = textField(body.refrigerantType, 60);
      if (!refrigerantType) {
        return NextResponse.json({ error: "Refrigerant type is required" }, { status: 400 });
      }
      const amountAdded = numField(body.amountAdded) ?? 0;
      const amountRecovered = numField(body.amountRecovered) ?? 0;
      if (!isValidRefrigerantEntry({ amount_added: amountAdded, amount_recovered: amountRecovered })) {
        return NextResponse.json({
          error: "Record at least one amount (added or recovered) greater than zero",
        }, { status: 400 });
      }
      const logDate = parseDateField(body.logDate) ?? localDate(new Date());
      if (logDate === "INVALID") {
        return NextResponse.json({ error: "Log date must use YYYY-MM-DD format" }, { status: 400 });
      }
      const assetId = body.assetId ? Number(body.assetId) : null;
      let asset: AssetRow | null = null;
      if (assetId) {
        asset = await getAssetOr404(admin, assetId);
        if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      }
      const technicianMemberId = body.technicianMemberId ? Number(body.technicianMemberId) : me.id;
      if (!(await requireAssignableMember(admin, technicianMemberId))) {
        return NextResponse.json({ error: "Technician is not an approved account" }, { status: 400 });
      }
      const { data: created, error } = await admin.from("refrigerant_logs").insert({
        log_date: logDate,
        asset_id: assetId,
        equipment_text: textField(body.equipmentText, 160),
        refrigerant_type: refrigerantType,
        amount_added: amountAdded,
        amount_recovered: amountRecovered,
        amount_unit: textField(body.amountUnit, 10) || "lb",
        technician_member_id: technicianMemberId,
        reason: textField(body.reason, 2000),
        work_order_id: body.workOrderId ? Number(body.workOrderId) : null,
        log_event_id: body.logEventId ? Number(body.logEventId) : null,
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
        actor_email: me.email,
      }).select("id").single<{ id: number }>();
      if (error) throw error;
      if (asset) {
        await writeAssetHistory(admin, me, asset.id, "refrigerant_logged", {
          refrigerantLogId: created.id, refrigerantType, amountAdded, amountRecovered,
        });
      }
      return NextResponse.json({ refrigerantLogId: created.id });
    }

    /* ---------------- Training & safety meetings ---------------- */

    if (action === "create_training_session" || action === "update_training_session") {
      let sessionId = 0;
      if (action === "update_training_session") {
        sessionId = Number(body.id || body.sessionId || 0);
        const { data: existing } = await admin.from("training_sessions")
          .select("id").eq("id", sessionId).maybeSingle<{ id: number }>();
        if (!existing) return NextResponse.json({ error: "Training session not found" }, { status: 404 });
      }
      const sessionDate = parseDateField(body.sessionDate);
      if (sessionDate === "INVALID") {
        return NextResponse.json({ error: "Session date must use YYYY-MM-DD format" }, { status: 400 });
      }
      const topic = body.topic !== undefined ? textField(body.topic, 300) : null;
      if (action === "create_training_session" && !topic) {
        return NextResponse.json({ error: "Topic is required" }, { status: 400 });
      }
      if (action === "create_training_session" && !sessionDate) {
        return NextResponse.json({ error: "Session date is required" }, { status: 400 });
      }
      const presenterMemberId = body.presenterMemberId ? Number(body.presenterMemberId) : null;
      if (presenterMemberId && !(await requireAssignableMember(admin, presenterMemberId))) {
        return NextResponse.json({ error: "Presenter is not an approved account" }, { status: 400 });
      }
      // Validate pinned versions before writing anything.
      let versionRows: { id: number; document_id: number }[] = [];
      if (body.documentVersionIds !== undefined) {
        const ids = [...new Set((Array.isArray(body.documentVersionIds) ? body.documentVersionIds : [])
          .map((value: unknown) => Number(value)).filter((value: number) => value > 0))];
        if (ids.length) {
          const { data, error } = await admin.from("document_versions")
            .select("id, document_id").in("id", ids);
          if (error) throw error;
          versionRows = (data || []) as { id: number; document_id: number }[];
          if (versionRows.length !== ids.length) {
            return NextResponse.json({ error: "A selected document version was not found" }, { status: 400 });
          }
        }
      }
      let attendeeIds: number[] = [];
      if (body.attendeeIds !== undefined) {
        attendeeIds = [...new Set((Array.isArray(body.attendeeIds) ? body.attendeeIds : [])
          .map((value: unknown) => Number(value)).filter((value: number) => value > 0))];
        for (const memberId of attendeeIds) {
          if (!(await requireAssignableMember(admin, memberId))) {
            return NextResponse.json({ error: "An attendee is not an approved account" }, { status: 400 });
          }
        }
      }

      if (action === "create_training_session") {
        const { data: created, error } = await admin.from("training_sessions").insert({
          session_date: sessionDate,
          start_time: textField(body.startTime, 20),
          end_time: textField(body.endTime, 20),
          topic,
          presenter_name: textField(body.presenterName, 160),
          presenter_member_id: presenterMemberId,
          location: textField(body.location, 160),
          key_points: textField(body.keyPoints, 5000),
          created_by_member_id: me.id,
          created_by_user_id: me.user_id,
        }).select("id").single<{ id: number }>();
        if (error) throw error;
        sessionId = created.id;
        await writeTrainingHistory(admin, me, sessionId, "created", { topic, sessionDate });
      } else {
        const update: Record<string, unknown> = { updated_at: now };
        const changed: string[] = [];
        if (sessionDate) { update.session_date = sessionDate; changed.push("sessionDate"); }
        if (topic) { update.topic = topic; changed.push("topic"); }
        const textMap: [string, string, number][] = [
          ["startTime", "start_time", 20], ["endTime", "end_time", 20],
          ["presenterName", "presenter_name", 160], ["location", "location", 160],
          ["keyPoints", "key_points", 5000],
        ];
        for (const [input, column, max] of textMap) {
          if (body[input] !== undefined) { update[column] = textField(body[input], max); changed.push(input); }
        }
        if (body.presenterMemberId !== undefined) {
          update.presenter_member_id = presenterMemberId; changed.push("presenterMemberId");
        }
        if (changed.length) {
          const { error } = await admin.from("training_sessions").update(update).eq("id", sessionId);
          if (error) throw error;
          await writeTrainingHistory(admin, me, sessionId, "details_updated", { changed });
        }
      }

      if (body.attendeeIds !== undefined) {
        const { error: deleteError } = await admin
          .from("training_attendees").delete().eq("session_id", sessionId);
        if (deleteError) throw deleteError;
        if (attendeeIds.length) {
          const { error } = await admin.from("training_attendees").insert(
            attendeeIds.map((memberId) => ({ session_id: sessionId, member_id: memberId })),
          );
          if (error) throw error;
        }
        await writeTrainingHistory(admin, me, sessionId, "attendees_updated", { count: attendeeIds.length });
      }
      if (body.documentVersionIds !== undefined) {
        const { error: deleteError } = await admin
          .from("training_documents").delete().eq("session_id", sessionId);
        if (deleteError) throw deleteError;
        if (versionRows.length) {
          const { error } = await admin.from("training_documents").insert(
            versionRows.map((row) => ({
              session_id: sessionId, document_id: row.document_id, document_version_id: row.id,
            })),
          );
          if (error) throw error;
        }
        await writeTrainingHistory(admin, me, sessionId, "documents_updated", { count: versionRows.length });
      }
      return NextResponse.json({ sessionId });
    }

    if (action === "create_training_action") {
      const sessionId = Number(body.sessionId || 0);
      const { data: session } = await admin.from("training_sessions")
        .select("id").eq("id", sessionId).maybeSingle<{ id: number }>();
      if (!session) return NextResponse.json({ error: "Training session not found" }, { status: 404 });
      const description = textField(body.description, 2000);
      if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
      const dueDate = parseDateField(body.dueDate);
      if (dueDate === "INVALID") {
        return NextResponse.json({ error: "Due date must use YYYY-MM-DD format" }, { status: 400 });
      }
      const responsibleMemberId = body.responsibleMemberId ? Number(body.responsibleMemberId) : null;
      if (responsibleMemberId && !(await requireAssignableMember(admin, responsibleMemberId))) {
        return NextResponse.json({ error: "Responsible member is not an approved account" }, { status: 400 });
      }
      const { data: created, error } = await admin.from("training_actions").insert({
        session_id: sessionId,
        description,
        responsible_member_id: responsibleMemberId,
        due_date: dueDate,
        status: "open",
        created_by_member_id: me.id,
        created_by_user_id: me.user_id,
      }).select("id").single<{ id: number }>();
      if (error) throw error;
      await writeTrainingHistory(admin, me, sessionId, "action_created", { trainingActionId: created.id });
      return NextResponse.json({ trainingActionId: created.id });
    }

    if (action === "complete_training_action") {
      const id = Number(body.id || body.trainingActionId || 0);
      const { data: row, error: rowError } = await admin.from("training_actions")
        .select("id, session_id, status").eq("id", id)
        .maybeSingle<{ id: number; session_id: number; status: string }>();
      if (rowError) throw rowError;
      if (!row) return NextResponse.json({ error: "Action item not found" }, { status: 404 });
      if (row.status === "completed") return NextResponse.json({ ok: true });
      const { error } = await admin.from("training_actions").update({
        status: "completed", completed_by_member_id: me.id, completed_at: now, updated_at: now,
      }).eq("id", row.id);
      if (error) throw error;
      await writeTrainingHistory(admin, me, row.session_id, "action_completed", { trainingActionId: row.id });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
