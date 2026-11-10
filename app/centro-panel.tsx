"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CalendarClock, ClipboardCheck, ClipboardList, Clock3,
  PackageMinus, ShieldAlert, Truck, Ban,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  jobPriorityLabel, jobStatusLabel, type Job,
} from "@/lib/jobs-rules";
import type { JobsPreset } from "./jobs-panel";

type Language = "en" | "es";
export type CentroNavigate = (view: string, preset?: JobsPreset) => void;

type Kpis = {
  scheduledToday: number; active: number; overdue: number; blocked: number;
  pendingInspections: number; upcomingVisits: number; lowStock: number; complianceAlerts: number;
};
type CentroData = {
  date: string; timeZone: string; kpis: Kpis;
  priorityJobs: Job[]; alerts: { kind: string; text: string; count: number }[];
};

async function api(path: string) {
  const res = await fetch(path);
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function todayNY(lang: Language): string {
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    timeZone: "America/New_York", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date());
}

/** Live clock for The Darley's time zone (America/New_York), refreshed
 * every 15 seconds. Renders nothing until mounted so the server and
 * first client paint agree. */
function LiveClockNY({ lang }: { lang: Language }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  return (
    <>
      {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
        timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
      }).format(now)}
    </>
  );
}

function priorityClass(priority: string) {
  return priority === "emergency" ? "bg-red-600" : priority === "high" ? "bg-orange-500" : priority === "medium" ? "bg-emerald-600" : "bg-slate-400";
}

export function CentroPanel({ lang, onNavigate }: { lang: Language; onNavigate: CentroNavigate }) {
  const es = lang === "es";
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [data, setData] = useState<CentroData | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try { setData(await api(`/api/centro?scope=${scope}&lang=${lang}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Error"); }
  }, [scope, lang]);
  useEffect(() => { void load(); }, [load]);

  const blockedPreset: JobsPreset = { statuses: ["waiting_vendor", "waiting_parts", "waiting_resident", "on_hold"] };
  const cards: { key: keyof Kpis; label: string; icon: any; view: string; preset?: JobsPreset; tone: string }[] = [
    { key: "scheduledToday", label: es ? "Programados hoy" : "Scheduled today", icon: CalendarClock, view: "work", preset: { scheduledToday: true }, tone: "text-emerald-700 bg-emerald-50" },
    { key: "active", label: es ? "Activos" : "Active", icon: ClipboardList, view: "work", preset: { statuses: ["open", "in_progress"] }, tone: "text-emerald-700 bg-emerald-50" },
    { key: "overdue", label: es ? "Vencidos" : "Overdue", icon: Clock3, view: "work", preset: { overdue: true }, tone: "text-red-700 bg-red-50" },
    { key: "blocked", label: es ? "Bloqueados" : "Blocked", icon: Ban, view: "blocked", preset: blockedPreset, tone: "text-amber-700 bg-amber-50" },
    { key: "pendingInspections", label: es ? "Inspecciones pendientes" : "Pending inspections", icon: ClipboardCheck, view: "inspections", tone: "text-emerald-700 bg-emerald-50" },
    { key: "upcomingVisits", label: es ? "Próximas visitas de vendors" : "Upcoming vendor visits", icon: Truck, view: "visits", tone: "text-emerald-700 bg-emerald-50" },
    { key: "lowStock", label: es ? "Bajo stock" : "Low stock", icon: PackageMinus, view: "shop", tone: "text-amber-700 bg-amber-50" },
    { key: "complianceAlerts", label: es ? "Alertas de cumplimiento" : "Compliance alerts", icon: ShieldAlert, view: "visits", tone: "text-red-700 bg-red-50" },
  ];

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 bg-gradient-to-br from-[#0d3b2a] to-[#1e7a4c] text-white shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-[.12em] text-emerald-100/80">{es ? "Resumen diario" : "Daily summary"}</p>
            <h3 className="mt-1 text-xl font-black capitalize">{todayNY(lang)}</h3>
            <p className="text-sm text-emerald-50/80">The Darley · <LiveClockNY lang={lang} /></p>
          </div>
          <div className="flex rounded-2xl bg-white/15 p-1">
            {(["all", "mine"] as const).map((value) => (
              <button key={value} onClick={() => setScope(value)} className={`min-h-11 rounded-xl px-4 font-bold ${scope === value ? "bg-white text-[#0d3b2a]" : "text-white"}`}>
                {value === "all" ? (es ? "Todo" : "All") : (es ? "Lo mío" : "Mine")}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {!data ? (
        <Card className="rounded-3xl border-0 shadow-sm"><CardContent className="p-10 text-center text-slate-500">{message || "…"}</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {cards.map(({ key, label, icon: Icon, view, preset, tone }) => (
              <button key={key} onClick={() => onNavigate(view, preset)} className="text-left">
                <Card className="h-full rounded-3xl border-0 shadow-sm transition hover:shadow-md">
                  <CardContent className="p-4">
                    <div className={`grid size-11 place-items-center rounded-2xl ${tone}`}><Icon className="size-5" /></div>
                    <p className="mt-3 text-3xl font-black">{data.kpis[key] ?? 0}</p>
                    <p className="text-sm font-semibold text-slate-500">{label}</p>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>

          <Card className="rounded-3xl border-0 shadow-sm">
            <CardHeader><CardTitle className="text-lg">{es ? "Qué hacer primero" : "What to do first"}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.priorityJobs.length === 0 ? <p className="text-slate-500">{es ? "Sin trabajos prioritarios." : "No priority jobs."}</p> : data.priorityJobs.map((job) => (
                <button key={job.id} onClick={() => onNavigate(job.recordType === "task" ? "tasks" : "work", { recordType: job.recordType === "task" ? "task" : "work_order", q: String(job.id) })} className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-slate-50 p-3 text-left">
                  <Badge variant="outline">#{job.id}</Badge>
                  <span className="font-bold">{job.title}</span>
                  <Badge className={priorityClass(job.priority)}>{jobPriorityLabel(job.priority, lang)}</Badge>
                  <Badge variant="outline">{jobStatusLabel(job.status, lang)}</Badge>
                  <span className="text-sm text-slate-500">{[job.building, job.unit].filter(Boolean).join(" · ")}</span>
                  {(job.dueDate || job.scheduledDate) && <span className="ml-auto text-sm font-semibold text-slate-500">{job.dueDate || job.scheduledDate}</span>}
                </button>
              ))}
            </CardContent>
          </Card>

          {data.alerts.length > 0 && (
            <Card className="rounded-3xl border border-amber-200 bg-amber-50 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-5 text-amber-600" />{es ? "Alertas" : "Alerts"}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.alerts.map((alert, i) => (
                  <div key={`${alert.kind}-${i}`} className="flex items-center gap-2 rounded-2xl bg-white/70 p-3 text-sm">
                    <Badge variant="outline">{alert.kind}</Badge><span>{alert.text}</span>
                    {alert.count > 0 && <Badge className="ml-auto bg-amber-500">{alert.count}</Badge>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <div className="flex justify-end"><Button variant="outline" onClick={() => void load()}>{es ? "Actualizar" : "Refresh"}</Button></div>
        </>
      )}
      {message && data && <p className="text-sm text-red-600">{message}</p>}
    </div>
  );
}
