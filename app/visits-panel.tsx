"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, List, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { JOB_BUILDINGS } from "@/lib/jobs-rules";

type Language = "en" | "es";
type TeamLite = { id: number; name: string };

export type Visit = {
  id: number; vendorId: number; vendorName: string; service: string;
  visitDate: string; visitTime: string | null; building: string | null; unit: string | null;
  responsibleMemberId: number | null; responsibleName: string | null;
  confirmationStatus: string; status: string; scope: string | null;
  accessRequirements: string | null; result: string | null; pendingNotes: string | null;
  quotedAmount: number | null; poNumber: string | null; glCode: string | null; actualCost: number | null;
  complianceStatus: string; complianceDueDate: string | null; netvendorRef: string | null;
  workOrderId: number | null; vendorJobId: number | null;
};

const COMPLIANCE = [
  { key: "to_verify", es: "Por verificar", en: "To verify" },
  { key: "verified", es: "Verificado", en: "Verified" },
  { key: "expired", es: "Vencido", en: "Expired" },
  { key: "documented_exception", es: "Excepción documentada", en: "Documented exception" },
];
const CONFIRM_LABELS: Record<string, { es: string; en: string }> = {
  pending: { es: "Pendiente de confirmación", en: "Pending confirmation" },
  confirmed: { es: "Confirmada", en: "Confirmed" },
  rescheduled: { es: "Reprogramada", en: "Rescheduled" },
  cancelled: { es: "Cancelada", en: "Cancelled" },
};
const STATUS_LABELS: Record<string, { es: string; en: string }> = {
  scheduled: { es: "Programada", en: "Scheduled" },
  completed_visit: { es: "Visita realizada", en: "Visit completed" },
  cancelled: { es: "Cancelada", en: "Cancelled" },
  no_show: { es: "No se presentó", en: "No show" },
};

async function api(path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function todayNY(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export function VisitsPanel({ lang, team }: { lang: Language; team: TeamLite[] }) {
  const es = lang === "es";
  const [visits, setVisits] = useState<Visit[]>([]);
  const [vendors, setVendors] = useState<{ id: number; name: string }[]>([]);
  const [view, setView] = useState<"month" | "agenda">("month");
  const [monthCursor, setMonthCursor] = useState(() => todayNY().slice(0, 7));
  const [filters, setFilters] = useState({ vendorId: "all", building: "all", unit: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Visit | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api("/api/visits");
      setVisits(data.visits || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/api/vendors");
        const list = (data.vendors || []).map((v: any) => ({ id: v.id, name: v.company || v.name }));
        if (!cancelled && list.length) setVendors(list);
      } catch { /* vendor list falls back to visits */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const vendorOptions = useMemo(() => {
    const map = new Map<number, string>(vendors.map((v) => [v.id, v.name]));
    for (const visit of visits) if (visit.vendorId && visit.vendorName) map.set(visit.vendorId, visit.vendorName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [vendors, visits]);

  const visible = useMemo(() => visits.filter((visit) => {
    if (filters.vendorId !== "all" && visit.vendorId !== Number(filters.vendorId)) return false;
    if (filters.building !== "all" && visit.building !== filters.building) return false;
    if (filters.unit && (visit.unit || "").toLowerCase() !== filters.unit.trim().toLowerCase()) return false;
    return true;
  }), [visits, filters]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try { await api("/api/visits", body); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const [year, month] = monthCursor.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const startOffset = firstDay.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${monthCursor}-${String(i + 1).padStart(2, "0")}`),
  ];
  const today = todayNY();
  const monthName = new Intl.DateTimeFormat(es ? "es-US" : "en-US", { timeZone: "America/New_York", month: "long", year: "numeric" }).format(new Date(`${monthCursor}-15T12:00:00`));

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setMonthCursor(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{es ? "Calendario de vendors" : "Vendor calendar"}</CardTitle>
              <p className="mt-1 text-sm text-slate-500">{es ? "Visitas como registro propio: completar una visita NO cierra la orden de trabajo vinculada." : "Visits are their own record: completing a visit does NOT close the linked work order."}</p>
            </div>
            <div className="flex gap-2">
              <div className="flex rounded-2xl bg-slate-100 p-1">
                <button onClick={() => setView("month")} className={`flex min-h-11 items-center gap-1 rounded-xl px-3 font-bold ${view === "month" ? "bg-white shadow-sm" : "text-slate-500"}`}><CalendarDays className="size-4" />{es ? "Mes" : "Month"}</button>
                <button onClick={() => setView("agenda")} className={`flex min-h-11 items-center gap-1 rounded-xl px-3 font-bold ${view === "agenda" ? "bg-white shadow-sm" : "text-slate-500"}`}><List className="size-4" />{es ? "Agenda" : "Agenda"}</button>
              </div>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild><Button className="min-h-11 bg-emerald-700 hover:bg-emerald-600"><Plus />{es ? "Nueva visita" : "New visit"}</Button></DialogTrigger>
                <VisitFormDialog
                  lang={lang} team={team} vendors={vendorOptions} busy={busy}
                  onClose={() => setCreateOpen(false)}
                  onSubmit={async (payload: any) => { await act({ action: "create", ...payload }); setCreateOpen(false); }}
                />
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <Select value={filters.vendorId} onValueChange={(v) => setFilters({ ...filters, vendorId: v })}>
              <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{es ? "Todos los vendors" : "All vendors"}</SelectItem>{vendorOptions.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.building} onValueChange={(v) => setFilters({ ...filters, building: v })}>
              <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{es ? "Todos los edificios" : "All buildings"}</SelectItem>{JOB_BUILDINGS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
            <Input className="min-h-11" placeholder={es ? "Apartamento" : "Unit"} value={filters.unit} onChange={(e) => setFilters({ ...filters, unit: e.target.value })} />
          </div>

          {view === "month" ? (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <Button variant="outline" className="min-h-11" onClick={() => shiftMonth(-1)}>←</Button>
                <p className="font-black capitalize">{monthName}</p>
                <Button variant="outline" className="min-h-11" onClick={() => shiftMonth(1)}>→</Button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-400">
                {(es ? ["D", "L", "M", "Mi", "J", "V", "S"] : ["S", "M", "T", "W", "T", "F", "S"]).map((d, i) => <span key={i} className="py-1">{d}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((date, i) => {
                  const dayVisits = date ? visible.filter((v) => v.visitDate === date) : [];
                  return (
                    <div key={i} className={`min-h-16 rounded-xl p-1.5 text-left ${date ? "bg-slate-50" : "bg-transparent"} ${date === today ? "ring-2 ring-emerald-600 bg-emerald-50" : ""}`}>
                      {date && <><p className="text-xs font-black">{Number(date.slice(8))}</p>
                        {dayVisits.map((visit) => (
                          <button key={visit.id} onClick={() => setEditing(visit)} className="mt-1 block w-full truncate rounded-lg bg-emerald-700 px-1.5 py-1 text-left text-[11px] font-bold text-white">
                            {visit.visitTime ? `${visit.visitTime} ` : ""}{visit.vendorName || visit.service}
                          </button>
                        ))}
                      </>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {[...visible].sort((a, b) => `${a.visitDate} ${a.visitTime || ""}`.localeCompare(`${b.visitDate} ${b.visitTime || ""}`)).map((visit) => (
                <VisitRow key={visit.id} visit={visit} lang={lang} busy={busy} act={act} onEdit={() => setEditing(visit)} />
              ))}
              {visible.length === 0 && <p className="p-6 text-center text-slate-500">{es ? "Sin visitas que coincidan." : "No visits match."}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <Dialog open onOpenChange={(open) => { if (!open) setEditing(null); }}>
          <VisitFormDialog
            lang={lang} team={team} vendors={vendorOptions} busy={busy} visit={editing}
            onClose={() => setEditing(null)}
            onSubmit={async (payload: any) => { await act({ action: "update", id: editing.id, ...payload }); setEditing(null); }}
          />
        </Dialog>
      )}
      {message && <button onClick={() => setMessage("")} className="fixed bottom-24 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl lg:bottom-8">{message}</button>}
    </div>
  );
}

function VisitRow({ visit, lang, busy, act, onEdit }: { visit: Visit; lang: Language; busy: boolean; act: (b: Record<string, unknown>) => Promise<void>; onEdit: () => void }) {
  const es = lang === "es";
  const [reschedule, setReschedule] = useState({ date: visit.visitDate, time: visit.visitTime || "" });
  const [complete, setComplete] = useState({ result: "", pendingNotes: "" });
  const status = STATUS_LABELS[visit.status] ? (es ? STATUS_LABELS[visit.status].es : STATUS_LABELS[visit.status].en) : visit.status;
  const confirmation = CONFIRM_LABELS[visit.confirmationStatus] ? (es ? CONFIRM_LABELS[visit.confirmationStatus].es : CONFIRM_LABELS[visit.confirmationStatus].en) : visit.confirmationStatus;
  const compliance = COMPLIANCE.find((c) => c.key === visit.complianceStatus);

  return (
    <Card className="rounded-3xl border-0 bg-slate-50 shadow-none">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{visit.visitDate}{visit.visitTime ? ` ${visit.visitTime}` : ""}</Badge>
          <span className="font-bold">{visit.vendorName || "—"}</span>
          <span className="text-slate-600">{visit.service}</span>
          <Badge className={visit.status === "completed_visit" ? "bg-emerald-600" : visit.status === "cancelled" ? "bg-slate-400" : "bg-emerald-100 text-emerald-800"}>{status}</Badge>
          <Badge variant="outline">{confirmation}</Badge>
          {visit.workOrderId != null && <Badge variant="outline">WO #{visit.workOrderId}</Badge>}
          {compliance && <Badge className={visit.complianceStatus === "verified" ? "bg-emerald-600" : visit.complianceStatus === "expired" ? "bg-red-600" : "bg-amber-500"}>{es ? compliance.es : compliance.en}</Badge>}
        </div>
        <p className="text-sm text-slate-500">
          {[visit.building, visit.unit].filter(Boolean).join(" · ")} · {es ? "Responsable" : "Responsible"}: {visit.responsibleName || "—"}
          {visit.scope && <> · {visit.scope}</>}
        </p>
        {visit.result && <p className="text-sm"><strong>{es ? "Resultado" : "Result"}:</strong> {visit.result}</p>}
        {visit.pendingNotes && <p className="text-sm"><strong>{es ? "Pendientes" : "Pending"}:</strong> {visit.pendingNotes}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" onClick={onEdit}>{es ? "Editar" : "Edit"}</Button>
          {visit.status === "scheduled" && visit.confirmationStatus !== "confirmed" && (
            <Button className="min-h-11 bg-emerald-700 hover:bg-emerald-600" disabled={busy} onClick={() => act({ action: "confirm", id: visit.id })}>{es ? "Confirmar" : "Confirm"}</Button>
          )}
          {visit.status === "scheduled" && (
            <>
              <span className="flex gap-2">
                <Input type="date" value={reschedule.date} onChange={(e) => setReschedule({ ...reschedule, date: e.target.value })} />
                <Input type="time" value={reschedule.time} onChange={(e) => setReschedule({ ...reschedule, time: e.target.value })} />
                <Button variant="outline" className="min-h-11" disabled={busy || !reschedule.date} onClick={() => act({ action: "reschedule", id: visit.id, visitDate: reschedule.date, visitTime: reschedule.time || undefined })}>{es ? "Reprogramar" : "Reschedule"}</Button>
              </span>
              <span className="flex flex-wrap gap-2">
                <Input placeholder={es ? "Resultado de la visita" : "Visit result"} value={complete.result} onChange={(e) => setComplete({ ...complete, result: e.target.value })} />
                <Input placeholder={es ? "Notas pendientes" : "Pending notes"} value={complete.pendingNotes} onChange={(e) => setComplete({ ...complete, pendingNotes: e.target.value })} />
                <Button className="min-h-11" disabled={busy} onClick={() => act({ action: "complete_visit", id: visit.id, result: complete.result, pendingNotes: complete.pendingNotes })}>
                  {es ? "Completar visita" : "Complete visit"}
                </Button>
              </span>
              <Button variant="destructive" className="min-h-11" disabled={busy} onClick={() => act({ action: "cancel", id: visit.id })}>{es ? "Cancelar visita" : "Cancel visit"}</Button>
            </>
          )}
        </div>
        {visit.status === "scheduled" && <p className="text-xs text-slate-400">{es ? "Completar la visita registra su resultado; NO cierra la orden de trabajo vinculada." : "Completing the visit records its result; it does NOT close the linked work order."}</p>}
      </CardContent>
    </Card>
  );
}

function VisitFormDialog({ lang, team, vendors, busy, visit, onSubmit, onClose }: any) {
  const es = lang === "es";
  const [form, setForm] = useState({
    vendorId: visit ? String(visit.vendorId) : "", service: visit?.service || "",
    visitDate: visit?.visitDate || "", visitTime: visit?.visitTime || "",
    building: visit?.building || "", unit: visit?.unit || "",
    responsibleMemberId: visit?.responsibleMemberId ? String(visit.responsibleMemberId) : "",
    scope: visit?.scope || "", accessRequirements: visit?.accessRequirements || "",
    quotedAmount: visit?.quotedAmount != null ? String(visit.quotedAmount) : "",
    poNumber: visit?.poNumber || "", glCode: visit?.glCode || "",
    actualCost: visit?.actualCost != null ? String(visit.actualCost) : "",
    complianceStatus: visit?.complianceStatus || "to_verify",
    complianceDueDate: visit?.complianceDueDate || "", netvendorRef: visit?.netvendorRef || "",
    workOrderId: visit?.workOrderId != null ? String(visit.workOrderId) : "",
  });

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{visit ? (es ? "Editar visita" : "Edit visit") : (es ? "Nueva visita de vendor" : "New vendor visit")}</DialogTitle>
        <DialogDescription>{es ? "La visita es un registro propio, separado del cierre de la WO." : "The visit is its own record, separate from closing the WO."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Select value={form.vendorId} onValueChange={(v) => setForm({ ...form, vendorId: v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Vendor" /></SelectTrigger>
            <SelectContent>{vendors.map((v: any) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder={es ? "Servicio" : "Service"} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} />
          <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Fecha" : "Date"}<Input type="date" value={form.visitDate} onChange={(e) => setForm({ ...form, visitDate: e.target.value })} /></label>
          <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Hora" : "Time"}<Input type="time" value={form.visitTime} onChange={(e) => setForm({ ...form, visitTime: e.target.value })} /></label>
          <Select value={form.building} onValueChange={(v) => setForm({ ...form, building: v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder={es ? "Edificio" : "Building"} /></SelectTrigger>
            <SelectContent>{JOB_BUILDINGS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder={es ? "Apartamento" : "Unit"} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <Select value={form.responsibleMemberId} onValueChange={(v) => setForm({ ...form, responsibleMemberId: v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder={es ? "Responsable" : "Responsible"} /></SelectTrigger>
            <SelectContent>{team.map((p: TeamLite) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder={es ? "WO vinculada (#)" : "Linked WO (#)"} value={form.workOrderId} onChange={(e) => setForm({ ...form, workOrderId: e.target.value })} />
        </div>
        <Textarea placeholder={es ? "Alcance del trabajo" : "Scope"} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
        <Textarea placeholder={es ? "Requisitos de acceso" : "Access requirements"} value={form.accessRequirements} onChange={(e) => setForm({ ...form, accessRequirements: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input type="number" step="0.01" placeholder={es ? "Monto cotizado" : "Quoted amount"} value={form.quotedAmount} onChange={(e) => setForm({ ...form, quotedAmount: e.target.value })} />
          <Input type="number" step="0.01" placeholder={es ? "Costo real" : "Actual cost"} value={form.actualCost} onChange={(e) => setForm({ ...form, actualCost: e.target.value })} />
          <Input placeholder="PO" value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} />
          <Input placeholder="GL" value={form.glCode} onChange={(e) => setForm({ ...form, glCode: e.target.value })} />
        </div>
        <fieldset className="rounded-2xl bg-slate-50 p-3">
          <legend className="px-1 text-sm font-bold">{es ? "Cumplimiento" : "Compliance"}</legend>
          <div className="grid grid-cols-2 gap-3">
            <Select value={form.complianceStatus} onValueChange={(v) => setForm({ ...form, complianceStatus: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{COMPLIANCE.map((c) => <SelectItem key={c.key} value={c.key}>{es ? c.es : c.en}</SelectItem>)}</SelectContent>
            </Select>
            <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Vence" : "Due"}<Input type="date" value={form.complianceDueDate} onChange={(e) => setForm({ ...form, complianceDueDate: e.target.value })} /></label>
            <Input placeholder="NetVendor ref" value={form.netvendorRef} onChange={(e) => setForm({ ...form, netvendorRef: e.target.value })} />
          </div>
        </fieldset>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{es ? "Cancelar" : "Cancel"}</Button>
        <Button disabled={busy || !form.vendorId || !form.service.trim() || !form.visitDate} onClick={() => onSubmit({
          vendorId: Number(form.vendorId), service: form.service,
          visitDate: form.visitDate, visitTime: form.visitTime || undefined,
          building: form.building || undefined, unit: form.unit || undefined,
          responsibleMemberId: form.responsibleMemberId ? Number(form.responsibleMemberId) : undefined,
          scope: form.scope || undefined, accessRequirements: form.accessRequirements || undefined,
          quotedAmount: form.quotedAmount ? Number(form.quotedAmount) : undefined,
          actualCost: form.actualCost ? Number(form.actualCost) : undefined,
          poNumber: form.poNumber || undefined, glCode: form.glCode || undefined,
          complianceStatus: form.complianceStatus,
          complianceDueDate: form.complianceDueDate || undefined, netvendorRef: form.netvendorRef || undefined,
          workOrderId: form.workOrderId ? Number(form.workOrderId) : undefined,
        })}>{es ? "Guardar visita" : "Save visit"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
