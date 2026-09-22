import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  getCurrentMember, isApproved, isServiceSupervisor, memberForClient,
  type MemberRow, type Role,
} from "@/lib/access";
import { localDate } from "@/lib/time";

const roles: Role[] = ["manager", "service_supervisor", "technician"];
const priorities = ["low", "medium", "high", "emergency"];
const statuses = ["open", "assigned", "in_progress", "on_hold", "completed"];

type WorkOrderRow = {
  id: number; title: string; description: string; area: string; category: string;
  priority: string; status: string; assigned_to: number | null; due_date: string | null;
  completion_comment: string | null; resident_note: string | null;
  created_at: string; updated_at: string;
};

function jobForClient(job: WorkOrderRow, names: Map<number, string>) {
  return {
    id: job.id, title: job.title, description: job.description, area: job.area,
    category: job.category, priority: job.priority, status: job.status,
    assignedTo: job.assigned_to, assignedName: job.assigned_to ? names.get(job.assigned_to) || null : null,
    dueDate: job.due_date, completionComment: job.completion_comment,
    residentNote: job.resident_note, createdAt: job.created_at, updatedAt: job.updated_at,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  return NextResponse.json({ error: message === "UNAUTHENTICATED" ? "Sign in required" : message }, { status: message === "UNAUTHENTICATED" ? 401 : 500 });
}

export async function GET() {
  try {
    const me = await getCurrentMember();
    if (!isApproved(me)) {
      return NextResponse.json({ me: memberForClient(me), team: [], jobs: [], registrationRequired: me.approval_status === "unregistered" });
    }
    const admin = createAdminClient();
    const [{ data: teamRows, error: teamError }, { data: jobRows, error: jobError }] = await Promise.all([
      admin.from("members").select("*").order("name"),
      admin.from("work_orders").select("*").order("created_at", { ascending: false }),
    ]);
    if (teamError) throw teamError;
    if (jobError) throw jobError;
    const allTeam = (teamRows || []) as MemberRow[];
    const names = new Map(allTeam.map((person) => [person.id, person.name]));
    const allJobs = ((jobRows || []) as WorkOrderRow[]).map((job) => jobForClient(job, names));
    const today = localDate();
    const jobs = me.role === "technician"
      ? allJobs.filter((job) => job.status !== "completed" || localDate(job.updatedAt) === today || job.dueDate === today)
      : allJobs;
    const team = me.role === "service_supervisor"
      ? allTeam
      : allTeam.filter((person) => person.active && person.approval_status === "approved");
    return NextResponse.json({ me: memberForClient(me), team: team.map(memberForClient), jobs, registrationRequired: false });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = createAdminClient();
    const me = await getCurrentMember();
    const body = await req.json() as Record<string, unknown>;
    const now = new Date().toISOString();

    if (body.action === "request_role") {
      const role = roles.includes(body.role as Role) ? body.role as Role : null;
      if (!role) return NextResponse.json({ error: "Select a valid role" }, { status: 400 });
      const { error } = await admin.from("members").update({ requested_role: role, approval_status: "pending", active: false }).eq("id", me.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (body.action === "set_language") {
      const { error } = await admin.from("members").update({ language: body.language === "es" ? "es" : "en" }).eq("id", me.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (!isApproved(me)) return NextResponse.json({ error: "Account approval required" }, { status: 403 });

    if (body.action === "add_member") {
      if (!isServiceSupervisor(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim();
      const role = roles.includes(body.role as Role) ? body.role as Role : "technician";
      if (!email || !name) return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
      const existing = await admin.from("members").select("id").eq("email", email).maybeSingle();
      const mutation = existing.data
        ? admin.from("members").update({ name, role, requested_role: role, approval_status: "approved", active: true, language: body.language === "es" ? "es" : "en" }).eq("id", existing.data.id).select("*").single()
        : admin.from("members").insert({ email, name, role, requested_role: role, approval_status: "approved", active: true, language: body.language === "es" ? "es" : "en" }).select("*").single();
      const { data, error } = await mutation;
      if (error) throw error;
      return NextResponse.json({ member: memberForClient(data as MemberRow) });
    }

    if (body.action === "approve_member" || body.action === "change_member_role") {
      if (!isServiceSupervisor(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const id = Number(body.id);
      const role = roles.includes(body.role as Role) ? body.role as Role : null;
      if (!id || !role) return NextResponse.json({ error: "Member and role are required" }, { status: 400 });
      const { error } = await admin.from("members").update({ role, requested_role: role, approval_status: "approved", active: true }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "create_job") {
      if (!isServiceSupervisor(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      if (!title || !description) return NextResponse.json({ error: "Title and details are required" }, { status: 400 });
      const assignedTo = body.assignedTo ? Number(body.assignedTo) : null;
      const { data, error } = await admin.from("work_orders").insert({
        title, description, area: String(body.area || "General Area"), category: String(body.category || "General Maintenance"),
        priority: priorities.includes(String(body.priority)) ? body.priority : "medium",
        status: assignedTo ? "assigned" : "open", assigned_to: assignedTo,
        due_date: body.dueDate || null, created_by: me.user_id, created_at: now, updated_at: now,
      }).select("*").single();
      if (error) throw error;
      return NextResponse.json({ job: data });
    }

    if (body.action === "update_job") {
      if (me.role === "manager") return NextResponse.json({ error: "Manager access is read-only" }, { status: 403 });
      const id = Number(body.id);
      const current = await admin.from("work_orders").select("*").eq("id", id).maybeSingle<WorkOrderRow>();
      if (current.error) throw current.error;
      if (!current.data) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
      const update: Record<string, unknown> = {
        status: statuses.includes(String(body.status)) ? body.status : current.data.status,
        updated_at: now,
      };
      if (isServiceSupervisor(me) && body.assignedTo !== undefined) update.assigned_to = body.assignedTo ? Number(body.assignedTo) : null;
      if (body.completionComment !== undefined) update.completion_comment = String(body.completionComment || "");
      if (body.residentNote !== undefined) update.resident_note = String(body.residentNote || "");
      const { error } = await admin.from("work_orders").update(update).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
