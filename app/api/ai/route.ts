import { NextRequest, NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentMember, isApproved, isServiceSupervisor } from "@/lib/access";
import { localDate } from "@/lib/time";

function extractText(payload: any) {
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && part?.text) return part.text;
    }
  }
  return "";
}

async function askModel(prompt: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
      store: false,
    }),
  });
  if (!response.ok) return null;
  return extractText(await response.json());
}

const bilingual: Record<string, string> = {
  "in progress": "en progreso",
  completed: "completado",
  assigned: "asignado",
  emergency: "emergencia",
  high: "alta",
  medium: "media",
  low: "baja",
  plumbing: "plomería",
  electrical: "electricidad",
  appliance: "electrodoméstico",
  hvac: "HVAC",
  "general maintenance": "mantenimiento general",
};

function fallbackTranslate(text: string, target: string) {
  let out = text;
  for (const [en, es] of Object.entries(bilingual)) {
    const [from, to] = target === "es" ? [en, es] : [es, en];
    out = out.replace(new RegExp(`\\b${from}\\b`, "gi"), to);
  }
  return out;
}

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!isApproved(member)) return NextResponse.json({ error: "Account approval required" }, { status: 403 });
  const body = await req.json() as Record<string, any>;
  const language = body.language === "es" ? "Spanish" : "English";

  if (body.action === "professional_comment") {
    if (member.role === "manager") return NextResponse.json({ error: "Manager access is read-only" }, { status: 403 });
    const prompt = `Write a concise professional multifamily maintenance closure in ${language}. Return strict JSON with maintenanceComment and residentNote. Include inspection/findings, corrective action, operational verification, current condition, and a clear completion statement. Facts only; do not invent. Work performed: ${body.whatDone}. Result: ${body.result}.`;
    const model = await askModel(prompt);
    if (model) {
      try { return NextResponse.json({ result: JSON.parse(model), source: "ai" }); } catch {}
    }
    const what = String(body.whatDone || "Work was inspected and corrective action was completed").trim();
    const result = String(body.result || "The system was tested and is operating properly at this time").trim();
    const fallback = body.language === "es"
      ? {
          maintenanceComment: `Se inspeccionó el área. ${what}. ${result}. El área quedó limpia y la orden de trabajo fue completada.`,
          residentNote: "El mantenimiento fue completado y se verificó el funcionamiento correcto.",
        }
      : {
          maintenanceComment: `The area was inspected. ${what}. ${result}. The area was left clean and the work order was completed.`,
          residentNote: "Maintenance was completed and proper operation was verified.",
        };
    return NextResponse.json({ result: fallback, source: "smart-template" });
  }

  if (body.action === "translate") {
    if (member.role === "manager") return NextResponse.json({ error: "Manager access is read-only" }, { status: 403 });
    const target = body.target === "es" ? "Spanish" : "English";
    const model = await askModel(`Translate this maintenance text into natural ${target}. Preserve technical meaning and return only the translation:\n${body.text}`);
    return NextResponse.json({
      result: model || fallbackTranslate(String(body.text || ""), body.target),
      source: model ? "ai" : "smart-template",
    });
  }

  if (body.action === "recommend") {
    if (!isServiceSupervisor(member)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const admin = createAdminClient();
    const [{ data: team, error: teamError }, { data: open, error: workError }] = await Promise.all([
      admin.from("members").select("id,name,role").eq("active", true),
      admin.from("work_orders").select("assigned_to").neq("status", "completed"),
    ]);
    if (teamError) throw teamError;
    if (workError) throw workError;
    const loads = (team || []).filter((m) => m.role === "technician").map((m) => ({
      id: m.id,
      name: m.name,
      open: (open || []).filter((j) => j.assigned_to === m.id).length,
    }));
    const text = `${body.title} ${body.description}`.toLowerCase();
    const priority = /fire|smoke|flood|active leak|no ac|sparking|emergency/.test(text)
      ? "emergency"
      : /leak|not working|broken|no power/.test(text) ? "high" : "medium";
    const technician = [...loads].sort((a, b) => a.open - b.open)[0] || null;
    const model = await askModel(`Recommend a priority (low, medium, high, emergency) and technician for this maintenance work. Return strict JSON with priority, technicianId, reason. Available technicians: ${JSON.stringify(loads)}. Work: ${body.title}. ${body.description}`);
    if (model) {
      try { return NextResponse.json({ result: JSON.parse(model), source: "ai" }); } catch {}
    }
    return NextResponse.json({
      result: {
        priority,
        technicianId: technician?.id || null,
        reason: technician ? `${technician.name} has the lightest active workload.` : "No technician is available yet.",
      },
      source: "smart-rules",
    });
  }

  if (body.action === "daily_summary") {
    if (member.role === "technician") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const admin = createAdminClient();
    const { data: jobs, error } = await admin.from("work_orders").select("status,priority,created_at,updated_at");
    if (error) throw error;
    const today = localDate();
    const todays = (jobs || []).filter((j) => localDate(j.created_at) === today || localDate(j.updated_at) === today);
    const data = {
      total: todays.length,
      completed: todays.filter((j) => j.status === "completed").length,
      active: todays.filter((j) => ["assigned", "in_progress"].includes(j.status)).length,
      onHold: todays.filter((j) => j.status === "on_hold").length,
      emergencies: todays.filter((j) => j.priority === "emergency" && j.status !== "completed").length,
    };
    const model = await askModel(`Write a concise maintenance supervisor daily summary in ${language} from these exact metrics: ${JSON.stringify(data)}. Do not invent details.`);
    const fallback = body.language === "es"
      ? `Resumen de hoy: ${data.total} trabajos activos o actualizados, ${data.completed} completados, ${data.active} en proceso, ${data.onHold} en espera y ${data.emergencies} emergencias abiertas.`
      : `Today's summary: ${data.total} jobs created or updated, ${data.completed} completed, ${data.active} active, ${data.onHold} on hold, and ${data.emergencies} open emergencies.`;
    return NextResponse.json({ result: model || fallback, source: model ? "ai" : "smart-summary" });
  }

  return NextResponse.json({ error: "Unknown AI action" }, { status: 400 });
}
