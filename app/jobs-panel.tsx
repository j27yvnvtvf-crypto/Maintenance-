"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CheckCircle2, Copy, History, Paperclip, Pencil, Plus, RotateCcw, Search, Upload, Users, Wallet,
} from "lucide-react";
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
import {
  HOLD_STATUSES, JOB_BUILDINGS, JOB_CATEGORIES, JOB_ORIGINS,
  JOB_PRIORITIES, JOB_STATUSES,
  isHoldStatus, jobMatchesFilters, jobOriginLabel, jobPriorityLabel, jobStatusLabel,
  validateClose, validateHold,
  type Job, type JobFilters,
} from "@/lib/jobs-rules";
import {
  NOTE_ACTION_OPTIONS, NOTE_FINDING_OPTIONS, NOTE_TEST_OPTIONS,
  buildMaintenanceComment, buildResidentNote, hasValidVerification, notesFingerprint,
  type NotePicks,
} from "@/lib/notes-rules";

type Language = "en" | "es";
type TeamLite = { id: number; name: string };

export type JobsPreset = {
  recordType?: string;
  statuses?: string[];
  status?: string;
  building?: string | null;
  unit?: string | null;
  category?: string | null;
  assignedTo?: number | null;
  priority?: string | null;
  origin?: string | null;
  vendorId?: number | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  scheduledToday?: boolean;
  overdue?: boolean;
};

type ApiError = Error & { status?: number; code?: string; fields?: string[] };

async function api(path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(payload.error || "Request failed") as ApiError;
    err.status = res.status;
    err.code = typeof payload.error === "string" ? payload.error : undefined;
    err.fields = Array.isArray(payload.fields) ? payload.fields : undefined;
    throw err;
  }
  return payload;
}

function todayNY(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function priorityClass(priority: string) {
  return priority === "emergency" ? "bg-red-600" : priority === "high" ? "bg-orange-500" : priority === "medium" ? "bg-emerald-600" : "bg-slate-400";
}
function statusLabel(status: string, es: boolean) {
  return jobStatusLabel(status, es ? "es" : "en");
}
function categoryLabel(key: string | null | undefined, lang: Language) {
  if (!key) return "—";
  const found = JOB_CATEGORIES.find((c) => c.key === key);
  return found ? (lang === "es" ? found.es : found.en) : key;
}

/** Translate a server / client validation failure into UI text. */
function describeError(error: unknown, es: boolean): string {
  const err = error as ApiError;
  if (err?.status === 409) return es ? "Este registro cambió en otro dispositivo; recarga" : "This record changed on another device; reload";
  if (err?.code === "HOLD_FIELDS_REQUIRED") {
    return (es ? "Faltan datos obligatorios de la espera" : "Required hold fields are missing") + (err.fields?.length ? `: ${err.fields.join(", ")}` : "");
  }
  if (err?.code === "VERIFICATION_REQUIRED") {
    return (es ? "Falta la verificación obligatoria para cerrar" : "Verification is required to close") + (err.fields?.length ? `: ${err.fields.join(", ")}` : "");
  }
  return err instanceof Error ? err.message : String(error);
}

export function JobsPanel({ jobs, team, me, lang, preset, onRefresh }: {
  jobs: Job[]; team: TeamLite[]; me: { id: number; name: string };
  lang: Language; preset: JobsPreset; onRefresh: () => Promise<void> | void;
}) {
  const es = lang === "es";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [vendors, setVendors] = useState<{ id: number; name: string }[]>([]);
  const [filters, setFilters] = useState({
    q: preset.q || "", building: "all", unit: "", category: "all", assignedTo: "all",
    priority: "all", status: "all", origin: "all", vendorId: "all", from: "", to: "",
  });

  // A new preset (KPI card / nav) reapplies the search term it carries.
  useEffect(() => { setFilters((f) => ({ ...f, q: preset.q || "" })); setSelectedId(null); }, [preset]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/api/vendors");
        const list = (data.vendors || []).map((v: any) => ({ id: v.id, name: v.company || v.name }));
        if (!cancelled && list.length) setVendors(list);
      } catch { /* vendor filter falls back to the vendors named on jobs */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const vendorOptions = useMemo(() => {
    const map = new Map<number, string>(vendors.map((v) => [v.id, v.name]));
    for (const job of jobs) if (job.vendorId != null && job.vendorName) map.set(job.vendorId, job.vendorName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [vendors, jobs]);

  const visible = useMemo(() => {
    const merged: JobFilters = {
      building: filters.building !== "all" ? filters.building : (preset.building ?? null),
      unit: filters.unit || preset.unit || null,
      category: filters.category !== "all" ? filters.category : (preset.category ?? null),
      assignedTo: filters.assignedTo !== "all" ? Number(filters.assignedTo) : (preset.assignedTo ?? null),
      priority: filters.priority !== "all" ? filters.priority : (preset.priority ?? null),
      origin: filters.origin !== "all" ? filters.origin : (preset.origin ?? null),
      vendorId: filters.vendorId !== "all" ? Number(filters.vendorId) : (preset.vendorId ?? null),
      from: filters.from || preset.from || null,
      to: filters.to || preset.to || null,
      q: filters.q || null,
      status: filters.status !== "all" ? filters.status : (preset.statuses?.length ? preset.statuses : (preset.status ?? null)),
    };
    const today = todayNY();
    return jobs.filter((job) => {
      if (preset.recordType && job.recordType !== preset.recordType) return false;
      if (!jobMatchesFilters(job, merged)) return false;
      if (preset.scheduledToday && job.scheduledDate !== today) return false;
      if (preset.overdue) {
        const effective = job.dueDate || job.scheduledDate;
        if (!effective || effective >= today || job.status === "completed") return false;
      }
      return true;
    });
  }, [jobs, filters, preset]);

  const selected = jobs.find((job) => job.id === selectedId) || null;

  if (selected) {
    return (
      <div>
        <Button variant="outline" className="mb-4 min-h-11" onClick={() => { setSelectedId(null); void onRefresh(); }}>
          <ArrowLeft />{es ? "Volver a la lista" : "Back to the list"}
        </Button>
        <JobDetail
          key={`${selected.id}-${selected.version}`}
          job={selected} team={team} me={me} lang={lang} vendors={vendorOptions}
          onRefresh={onRefresh} setMessage={setMessage}
        />
        {message && <Toast message={message} clear={() => setMessage("")} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{preset.recordType === "task" ? (es ? "Tareas de la propiedad" : "Property tasks") : preset.statuses ? (es ? "Pendientes bloqueados" : "Blocked work") : (es ? "Órdenes de trabajo" : "Work orders")}</CardTitle>
            <CreateJobDialog preset={preset} team={team} vendors={vendorOptions} lang={lang} onRefresh={onRefresh} setMessage={setMessage} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="min-h-11 pl-9" placeholder={es ? "Buscar título, descripción, referencia, apartamento, #…" : "Search title, description, reference, unit, #…"} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <FilterSelect value={filters.building} onChange={(v) => setFilters({ ...filters, building: v })} allLabel={es ? "Todos los edificios" : "All buildings"} options={JOB_BUILDINGS.map((b) => ({ value: b, label: b }))} />
            <Input className="min-h-11" placeholder={es ? "Apartamento" : "Unit"} value={filters.unit} onChange={(e) => setFilters({ ...filters, unit: e.target.value })} />
            <FilterSelect value={filters.category} onChange={(v) => setFilters({ ...filters, category: v })} allLabel={es ? "Todas las categorías" : "All categories"} options={JOB_CATEGORIES.map((c) => ({ value: c.key, label: es ? c.es : c.en }))} />
            <FilterSelect value={filters.assignedTo} onChange={(v) => setFilters({ ...filters, assignedTo: v })} allLabel={es ? "Todos los responsables" : "All assignees"} options={team.map((p) => ({ value: String(p.id), label: p.name }))} />
            <FilterSelect value={filters.priority} onChange={(v) => setFilters({ ...filters, priority: v })} allLabel={es ? "Todas las prioridades" : "All priorities"} options={JOB_PRIORITIES.map((p) => ({ value: p, label: jobPriorityLabel(p, lang) }))} />
            <FilterSelect value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} allLabel={es ? "Todos los estados" : "All statuses"} options={JOB_STATUSES.filter((s) => s !== "assigned").map((s) => ({ value: s, label: statusLabel(s, es) }))} />
            <FilterSelect value={filters.origin} onChange={(v) => setFilters({ ...filters, origin: v })} allLabel={es ? "Todos los orígenes" : "All origins"} options={JOB_ORIGINS.map((o) => ({ value: o, label: jobOriginLabel(o, lang) }))} />
            <FilterSelect value={filters.vendorId} onChange={(v) => setFilters({ ...filters, vendorId: v })} allLabel={es ? "Todos los vendors" : "All vendors"} options={vendorOptions.map((v) => ({ value: String(v.id), label: v.name }))} />
            <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Desde" : "From"}<Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
            <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Hasta" : "To"}<Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
          </div>
          <p className="text-sm font-semibold text-slate-500">{visible.length} {es ? "registros" : "records"}</p>
          {visible.length === 0 ? (
            <p className="p-6 text-center text-slate-500">{es ? "Ningún trabajo coincide con los filtros." : "No jobs match the filters."}</p>
          ) : visible.map((job) => (
            <button key={job.id} onClick={() => setSelectedId(job.id)} className="block w-full text-left">
              <Card className="overflow-hidden rounded-3xl border-0 shadow-sm transition hover:shadow">
                <div className={`h-1.5 ${priorityClass(job.priority)}`} />
                <CardContent className="p-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">#{job.id}</Badge>
                    {job.externalRef && <Badge variant="outline">{job.externalRef}</Badge>}
                    <Badge className="bg-slate-100 text-slate-700">{categoryLabel(job.category, lang)}</Badge>
                    <Badge className={priorityClass(job.priority)}>{jobPriorityLabel(job.priority, lang)}</Badge>
                    <Badge className={job.status === "completed" ? "bg-emerald-600" : isHoldStatus(job.status) ? "bg-amber-500" : "bg-emerald-100 text-emerald-800"}>{statusLabel(job.status, es)}</Badge>
                    {hasValidVerification(job) && <Badge className="bg-emerald-600"><CheckCircle2 className="mr-1 size-3" />{es ? "Verificado" : "Verified"}</Badge>}
                  </div>
                  <p className="text-lg font-extrabold">{job.title}</p>
                  <p className="mt-1 line-clamp-2 text-slate-600">{job.description}</p>
                  <p className="mt-3 text-sm font-semibold text-slate-500">
                    {[job.building, job.unit, job.area].filter(Boolean).join(" · ") || "—"} · {es ? "Asignado a" : "Assigned to"}: {job.assignedName || (es ? "Sin asignar" : "Unassigned")}
                    {(job.dueDate || job.scheduledDate) && <> · {job.dueDate || job.scheduledDate}</>}
                    {job.vendorName && <> · {job.vendorName}</>}
                  </p>
                </CardContent>
              </Card>
            </button>
          ))}
        </CardContent>
      </Card>
      {message && <Toast message={message} clear={() => setMessage("")} />}
    </div>
  );
}

function FilterSelect({ value, onChange, allLabel, options }: { value: string; onChange: (v: string) => void; allLabel: string; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Toast({ message, clear }: { message: string; clear: () => void }) {
  return <button aria-live="polite" onClick={clear} className="fixed bottom-24 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl lg:bottom-8">{message}</button>;
}

function CreateJobDialog({ preset, team, vendors, lang, onRefresh, setMessage }: any) {
  const es = lang === "es";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", recordType: preset.recordType || "work_order", category: "general",
    building: "", unit: "", area: "", origin: "daily_operation", externalRef: "",
    priority: "medium", assignedTo: "", scheduledDate: "", dueDate: "",
  });
  const [collaborators, setCollaborators] = useState<number[]>([]);

  async function create() {
    setBusy(true);
    try {
      await api("/api/dashboard", {
        action: "create_job", lang,
        title: form.title, description: form.description,
        recordType: form.recordType, category: form.category,
        building: form.building || undefined, unit: form.unit || undefined, area: form.area || undefined,
        origin: form.origin, externalRef: form.externalRef || undefined,
        priority: form.priority,
        assignedTo: form.assignedTo ? Number(form.assignedTo) : undefined,
        collaboratorIds: collaborators,
        scheduledDate: form.scheduledDate || undefined, dueDate: form.dueDate || undefined,
      });
      setOpen(false);
      setForm({ title: "", description: "", recordType: preset.recordType || "work_order", category: "general", building: "", unit: "", area: "", origin: "daily_operation", externalRef: "", priority: "medium", assignedTo: "", scheduledDate: "", dueDate: "" });
      setCollaborators([]);
      await onRefresh();
    } catch (error) { setMessage(describeError(error, es)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="min-h-11 bg-emerald-700 hover:bg-emerald-600"><Plus />{es ? "Nuevo registro" : "New record"}</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{es ? "Crear trabajo" : "Create job"}</DialogTitle><DialogDescription>{es ? "Orden de trabajo o tarea de la propiedad." : "Work order or property task."}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Input placeholder={es ? "Título" : "Title"} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea placeholder={es ? "Descripción" : "Description"} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select value={form.recordType} onValueChange={(v) => setForm({ ...form, recordType: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="work_order">{es ? "Orden de trabajo" : "Work order"}</SelectItem><SelectItem value="task">{es ? "Tarea" : "Task"}</SelectItem></SelectContent>
            </Select>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{JOB_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{es ? c.es : c.en}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.building} onValueChange={(v) => setForm({ ...form, building: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder={es ? "Edificio / área" : "Building / area"} /></SelectTrigger>
              <SelectContent>{JOB_BUILDINGS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder={es ? "Apartamento / unidad" : "Unit"} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            <Input placeholder={es ? "Área (áreas comunes)" : "Area (common areas)"} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            <Select value={form.origin} onValueChange={(v) => setForm({ ...form, origin: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{JOB_ORIGINS.map((o) => <SelectItem key={o} value={o}>{jobOriginLabel(o, lang)}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder={es ? "Referencia externa (WO)" : "External ref (WO)"} value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} />
            <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{JOB_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{jobPriorityLabel(p, lang)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.assignedTo} onValueChange={(v) => setForm({ ...form, assignedTo: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder={es ? "Responsable" : "Assignee"} /></SelectTrigger>
              <SelectContent>{team.map((p: TeamLite) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Fecha programada" : "Scheduled date"}<Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} /></label>
            <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Fecha límite" : "Due date"}<Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
          </div>
          <fieldset>
            <legend className="text-sm font-bold">{es ? "Colaboradores" : "Collaborators"}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {team.map((p: TeamLite) => (
                <label key={p.id} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-50 px-3 text-sm font-semibold">
                  <input type="checkbox" className="size-4" checked={collaborators.includes(p.id)} onChange={(e) => setCollaborators(e.target.checked ? [...collaborators, p.id] : collaborators.filter((id) => id !== p.id))} />{p.name}
                </label>
              ))}
            </div>
          </fieldset>
          {vendors.length > 0 && <p className="text-xs text-slate-400">{es ? "El vendor se vincula al editar el registro." : "Link the vendor when editing the record."}</p>}
        </div>
        <DialogFooter><Button onClick={create} disabled={busy || !form.title.trim() || !form.description.trim()}>{es ? "Crear" : "Create"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobDetail({ job, team, me, lang, vendors, onRefresh, setMessage }: {
  job: Job; team: TeamLite[]; me: { id: number; name: string }; lang: Language;
  vendors: { id: number; name: string }[]; onRefresh: () => Promise<void> | void;
  setMessage: (m: string) => void;
}) {
  const es = lang === "es";
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState({
    findings: job.findings || "", cause: job.cause || "", actionPerformed: job.actionPerformed || "",
    nextAction: job.nextAction || "", description: job.description || "",
    building: job.building || "", unit: job.unit || "", area: job.area || "",
    category: job.category || "general", priority: job.priority || "medium",
    assignedTo: job.assignedTo ? String(job.assignedTo) : "none",
    scheduledDate: job.scheduledDate || "", dueDate: job.dueDate || "",
    externalRef: job.externalRef || "", origin: job.origin || "daily_operation",
    vendorId: job.vendorId ? String(job.vendorId) : "none",
  });
  const [statusDraft, setStatusDraft] = useState(job.status);
  const [hold, setHold] = useState({
    holdReason: job.holdReason || "", holdFollowUpDate: job.holdFollowUpDate || "",
    holdFollowUpBy: job.holdFollowUpBy ? String(job.holdFollowUpBy) : String(me.id), nextAction: job.nextAction || "",
  });
  const [verify, setVerify] = useState({
    verificationAction: job.verificationAction || "", verificationTest: job.verificationTest || "",
    verificationResult: job.verificationResult || "", verificationConfirmed: false,
  });
  const [history, setHistory] = useState<any[]>([]);
  const [collabToAdd, setCollabToAdd] = useState("");

  const loadHistory = useCallback(async () => {
    try { const data = await api("/api/dashboard", { action: "job_history", id: job.id }); setHistory(data.history || []); }
    catch { /* history is best-effort in the detail view */ }
  }, [job.id]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErrors([]);
    try { await fn(); await onRefresh(); await loadHistory(); }
    catch (error) { const text = describeError(error, es); setErrors([text]); setMessage(text); }
    finally { setBusy(false); }
  }

  const basePayload = () => ({
    action: "update_job", lang, id: job.id, version: job.version,
    findings: form.findings, cause: form.cause, actionPerformed: form.actionPerformed,
    nextAction: form.nextAction, description: form.description,
    building: form.building || null, unit: form.unit || null, area: form.area || null,
    category: form.category, priority: form.priority,
    assignedTo: form.assignedTo === "none" ? null : Number(form.assignedTo),
    scheduledDate: form.scheduledDate || null, dueDate: form.dueDate || null,
    externalRef: form.externalRef || null, origin: form.origin,
    vendorId: form.vendorId === "none" ? null : Number(form.vendorId),
  });

  async function saveDetails() { await run(() => api("/api/dashboard", basePayload())); }

  async function applyStatus() {
    const candidateStatus = statusDraft;
    if (isHoldStatus(candidateStatus)) {
      const errs = validateHold({ status: candidateStatus, holdReason: hold.holdReason, holdFollowUpDate: hold.holdFollowUpDate, holdFollowUpBy: hold.holdFollowUpBy ? Number(hold.holdFollowUpBy) : null, nextAction: hold.nextAction }, lang);
      if (errs.length) { setErrors(errs); return; }
      await run(() => api("/api/dashboard", {
        ...basePayload(), status: candidateStatus,
        holdReason: hold.holdReason, holdFollowUpDate: hold.holdFollowUpDate,
        holdFollowUpBy: Number(hold.holdFollowUpBy), nextAction: hold.nextAction,
      }));
      return;
    }
    if (candidateStatus === "completed") {
      const errs = validateClose({ actionPerformed: form.actionPerformed, verificationAction: verify.verificationAction, verificationTest: verify.verificationTest, verificationResult: verify.verificationResult, verificationConfirmed: verify.verificationConfirmed }, lang);
      if (errs.length) { setErrors(errs); return; }
      await run(() => api("/api/dashboard", {
        ...basePayload(), status: "completed",
        verificationAction: verify.verificationAction, verificationTest: verify.verificationTest,
        verificationResult: verify.verificationResult, verificationConfirmed: verify.verificationConfirmed,
      }));
      return;
    }
    await run(() => api("/api/dashboard", { ...basePayload(), status: candidateStatus }));
  }

  const collaborators = (job.collaboratorIds || []).map((id) => team.find((p) => p.id === id)).filter(Boolean) as TeamLite[];

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden rounded-3xl border-0 shadow-sm">
        <div className={`h-1.5 ${priorityClass(job.priority)}`} />
        <CardContent className="p-5">
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="outline">#{job.id}</Badge>
            {job.externalRef && <Badge variant="outline">{job.externalRef}</Badge>}
            <Badge className="bg-slate-100 text-slate-700">{categoryLabel(job.category, lang)}</Badge>
            <Badge className={priorityClass(job.priority)}>{jobPriorityLabel(job.priority, lang)}</Badge>
            <Badge variant="outline">{statusLabel(job.status, es)}</Badge>
            <Badge variant="outline">{job.recordType === "task" ? (es ? "Tarea" : "Task") : (es ? "Orden de trabajo" : "Work order")}</Badge>
          </div>
          <h3 className="text-xl font-black">{job.title}</h3>
          <p className="mt-1 text-slate-600">{job.description}</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            {[job.building, job.unit, job.area].filter(Boolean).join(" · ")} · {es ? "Asignado a" : "Assigned to"}: {job.assignedName || "—"}
            {job.vendorName && <> · {job.vendorName}</>} · v{job.version}
          </p>
          {hasValidVerification(job) && (
            <p className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
              <CheckCircle2 className="mr-1 inline size-4" />{es ? "Verificación registrada" : "Verification recorded"}: {job.verificationTest || ""} — {job.verificationResult || ""} ({job.verifiedAt ? new Date(job.verifiedAt).toLocaleString(es ? "es-US" : "en-US") : ""})
            </p>
          )}
          {job.status === "completed" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => run(() => api("/api/dashboard", { action: "update_job", id: job.id, version: job.version, status: "in_progress" }))}>
                <RotateCcw />{es ? "Reabrir" : "Reopen"}
              </Button>
              <span className="text-sm text-slate-500">{es ? "Al reabrir se exigirá una nueva verificación para volver a cerrar." : "Reopening will require a new verification to close again."}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <Card className="rounded-3xl border border-red-200 bg-red-50 shadow-sm"><CardContent className="space-y-1 p-4">
          {errors.map((e) => <p key={e} className="text-sm font-semibold text-red-700">{e}</p>)}
        </CardContent></Card>
      )}

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="text-lg">{es ? "Editar registro" : "Edit record"}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <Textarea placeholder={es ? "Descripción" : "Description"} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select value={form.building} onValueChange={(v) => setForm({ ...form, building: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder={es ? "Edificio" : "Building"} /></SelectTrigger>
              <SelectContent>{JOB_BUILDINGS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder={es ? "Apartamento" : "Unit"} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            <Input placeholder={es ? "Área" : "Area"} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{JOB_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{es ? c.es : c.en}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{JOB_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{jobPriorityLabel(p, lang)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.assignedTo} onValueChange={(v) => setForm({ ...form, assignedTo: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">{es ? "Sin asignar" : "Unassigned"}</SelectItem>{team.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.origin} onValueChange={(v) => setForm({ ...form, origin: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{JOB_ORIGINS.map((o) => <SelectItem key={o} value={o}>{jobOriginLabel(o, lang)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.vendorId} onValueChange={(v) => setForm({ ...form, vendorId: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">{es ? "Sin vendor" : "No vendor"}</SelectItem>{vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder={es ? "Referencia externa" : "External ref"} value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} />
            <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Programado" : "Scheduled"}<Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} /></label>
            <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Fecha límite" : "Due"}<Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
          </div>
          <Textarea placeholder={es ? "Hallazgos" : "Findings"} value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} />
          <Textarea placeholder={es ? "Causa" : "Cause"} value={form.cause} onChange={(e) => setForm({ ...form, cause: e.target.value })} />
          <Textarea placeholder={es ? "Trabajo realizado" : "Work performed"} value={form.actionPerformed} onChange={(e) => setForm({ ...form, actionPerformed: e.target.value })} />
          <Textarea placeholder={es ? "Próxima acción" : "Next action"} value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} />
          <div className="flex justify-end"><Button className="min-h-11 bg-emerald-700 hover:bg-emerald-600" disabled={busy} onClick={saveDetails}>{es ? "Guardar cambios" : "Save changes"}</Button></div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="text-lg">{es ? "Cambiar estado" : "Change status"}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <Select value={statusDraft} onValueChange={setStatusDraft}>
            <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{JOB_STATUSES.filter((s) => s !== "assigned").map((s) => <SelectItem key={s} value={s}>{statusLabel(s, es)}</SelectItem>)}</SelectContent>
          </Select>

          {isHoldStatus(statusDraft) && (
            <div className="grid gap-3 rounded-2xl bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-800">{es ? "Datos obligatorios de la espera (los 4)" : "Required hold details (all 4)"}</p>
              <Textarea placeholder={es ? "Motivo de la espera" : "Hold reason"} value={hold.holdReason} onChange={(e) => setHold({ ...hold, holdReason: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Fecha de seguimiento" : "Follow-up date"}<Input type="date" value={hold.holdFollowUpDate} onChange={(e) => setHold({ ...hold, holdFollowUpDate: e.target.value })} /></label>
                <Select value={hold.holdFollowUpBy} onValueChange={(v) => setHold({ ...hold, holdFollowUpBy: v })}>
                  <SelectTrigger className="mt-4 w-full"><SelectValue placeholder={es ? "Responsable del seguimiento" : "Follow-up owner"} /></SelectTrigger>
                  <SelectContent>{team.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Textarea placeholder={es ? "Próxima acción" : "Next action"} value={hold.nextAction} onChange={(e) => setHold({ ...hold, nextAction: e.target.value })} />
              <p className="text-xs text-slate-500">{es ? "Estados de espera: " : "Hold statuses: "}{(HOLD_STATUSES as string[]).map((s) => statusLabel(s, es)).join(", ")}</p>
            </div>
          )}

          {statusDraft === "completed" && (
            <div className="grid gap-3 rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm font-bold text-emerald-800">{es ? "Verificación obligatoria para cerrar" : "Verification required to close"}</p>
              <Textarea placeholder={es ? "Acción verificada (si difiere del trabajo realizado)" : "Verified action"} value={verify.verificationAction} onChange={(e) => setVerify({ ...verify, verificationAction: e.target.value })} />
              <Textarea placeholder={es ? "Prueba de verificación: qué se probó" : "Verification test"} value={verify.verificationTest} onChange={(e) => setVerify({ ...verify, verificationTest: e.target.value })} />
              <Textarea placeholder={es ? "Resultado de la verificación" : "Verification result"} value={verify.verificationResult} onChange={(e) => setVerify({ ...verify, verificationResult: e.target.value })} />
              <label className="flex min-h-11 items-center gap-2 font-semibold">
                <input type="checkbox" className="size-5" checked={verify.verificationConfirmed} onChange={(e) => setVerify({ ...verify, verificationConfirmed: e.target.checked })} />
                {es ? "Confirmo explícitamente que el trabajo fue verificado en sitio" : "I explicitly confirm the work was verified on site"}
              </label>
            </div>
          )}
          <div className="flex justify-end"><Button className="min-h-11" disabled={busy || statusDraft === job.status} onClick={applyStatus}>{es ? "Aplicar estado" : "Apply status"}</Button></div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Users className="size-5 text-emerald-700" />{es ? "Colaboradores" : "Collaborators"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {collaborators.length === 0 && <span className="text-sm text-slate-500">—</span>}
            {collaborators.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-bold">
                {p.name}
                <button disabled={busy} className="text-red-600" onClick={() => run(() => api("/api/dashboard", { action: "remove_collaborator", id: job.id, memberId: p.id }))}>×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Select value={collabToAdd} onValueChange={setCollabToAdd}>
              <SelectTrigger className="min-h-11 w-full"><SelectValue placeholder={es ? "Agregar colaborador" : "Add collaborator"} /></SelectTrigger>
              <SelectContent>{team.filter((p) => !(job.collaboratorIds || []).includes(p.id)).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button className="min-h-11" disabled={busy || !collabToAdd} onClick={() => run(async () => { await api("/api/dashboard", { action: "add_collaborator", id: job.id, memberId: Number(collabToAdd) }); setCollabToAdd(""); })}>{es ? "Agregar" : "Add"}</Button>
          </div>
        </CardContent>
      </Card>

      <NotesSection job={job} lang={lang} onRefresh={onRefresh} setMessage={setMessage} />
      <QuotesSection job={job} lang={lang} vendors={vendors} setMessage={setMessage} />
      <PhotosSection job={job} lang={lang} setMessage={setMessage} />

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><History className="size-5 text-emerald-700" />{es ? "Historial" : "History"}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 ? <p className="text-sm text-slate-500">—</p> : history.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-baseline gap-x-3 rounded-2xl bg-slate-50 p-3 text-sm">
              <span className="font-bold">{entry.action}</span>
              <span className="text-slate-500">{entry.actorEmail}</span>
              {entry.detail && Object.keys(entry.detail).length > 0 && <span className="text-slate-500">{JSON.stringify(entry.detail).slice(0, 160)}</span>}
              <span className="ml-auto text-xs font-semibold text-slate-400">{entry.createdAt ? new Date(entry.createdAt).toLocaleString(es ? "es-US" : "en-US") : ""}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function NotesSection({ job, lang, onRefresh, setMessage }: { job: Job; lang: Language; onRefresh: () => Promise<void> | void; setMessage: (m: string) => void }) {
  const es = lang === "es";
  const [picks, setPicks] = useState<NotePicks>({ findings: [], actions: [], tests: [] });
  const [maintenance, setMaintenance] = useState(job.maintenanceCommentDraft || "");
  const [resident, setResident] = useState(job.residentNoteDraft || "");
  const [busy, setBusy] = useState(false);
  const stale = Boolean(job.notesFingerprint) && notesFingerprint(job) !== job.notesFingerprint;

  function toggle(group: keyof NotePicks, key: string, checked: boolean) {
    setPicks((current) => ({ ...current, [group]: checked ? [...(current[group] || []), key] : (current[group] || []).filter((k) => k !== key) }));
  }
  function generate() {
    setMaintenance(buildMaintenanceComment(job, picks));
    setResident(buildResidentNote(job, picks));
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setMessage(es ? "Copiado." : "Copied."); } catch { setMessage(es ? "No se pudo copiar." : "Copy failed."); }
  }
  async function save() {
    setBusy(true);
    try {
      await api("/api/dashboard", { action: "save_note_drafts", id: job.id, maintenanceComment: maintenance, residentNote: resident });
      await onRefresh();
      setMessage(es ? "Borradores guardados." : "Drafts saved.");
    } catch (error) { setMessage(describeError(error, es)); }
    finally { setBusy(false); }
  }

  const groups: { key: keyof NotePicks; label: string; options: typeof NOTE_FINDING_OPTIONS }[] = [
    { key: "findings", label: es ? "Hallazgos" : "Findings", options: NOTE_FINDING_OPTIONS },
    { key: "actions", label: es ? "Acciones realizadas" : "Actions performed", options: NOTE_ACTION_OPTIONS },
    { key: "tests", label: es ? "Pruebas de verificación" : "Verification tests", options: NOTE_TEST_OPTIONS },
  ];

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">🔧 {es ? "Notas guiadas" : "Guided notes"}</CardTitle>
        <p className="text-sm text-slate-500">{es ? "Redacción guiada por plantillas — sin IA" : "Template-guided writing — no AI"}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {stale && <p className="rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-800">{es ? "Los datos cambiaron: revisa o regenera las notas" : "The data changed: review or regenerate the notes"}</p>}
        {groups.map((group) => (
          <fieldset key={group.key}>
            <legend className="text-sm font-bold">{group.label}</legend>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {group.options.map((option) => (
                <label key={option.key} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-50 px-3 text-sm font-semibold">
                  <input type="checkbox" className="size-4" checked={(picks[group.key] || []).includes(option.key)} onChange={(e) => toggle(group.key, option.key, e.target.checked)} />
                  {es ? option.es : option.en}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div><Button className="min-h-11 bg-emerald-700 hover:bg-emerald-600" onClick={generate}>{es ? "Generar notas" : "Generate notes"}</Button></div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between"><label className="font-bold">🔧 Maintenance Comment</label><Button variant="outline" size="sm" onClick={() => copy(maintenance)}><Copy />{es ? "Copiar" : "Copy"}</Button></div>
          <Textarea className="min-h-32" value={maintenance} onChange={(e) => setMaintenance(e.target.value)} />
          <div className="flex items-center justify-between"><label className="font-bold">🏠 Resident Note</label><Button variant="outline" size="sm" onClick={() => copy(resident)}><Copy />{es ? "Copiar" : "Copy"}</Button></div>
          <Textarea value={resident} onChange={(e) => setResident(e.target.value)} />
        </div>
        <div className="flex justify-end"><Button className="min-h-11" disabled={busy} onClick={save}>{es ? "Guardar borradores" : "Save drafts"}</Button></div>
      </CardContent>
    </Card>
  );
}

function QuotesSection({ job, lang, vendors, setMessage }: { job: Job; lang: Language; vendors: { id: number; name: string }[]; setMessage: (m: string) => void }) {
  const es = lang === "es";
  const [quotes, setQuotes] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const emptyForm = { quotedAmount: "", authorizedAmount: "", actualCost: "", poNumber: "", glCode: "", reference: "", scope: "", notes: "", vendorId: "none" };
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const load = useCallback(async () => {
    try { const data = await api(`/api/quotes?workOrderId=${job.id}`); setQuotes(data.quotes || []); }
    catch { /* quotes endpoint may not be live yet in this environment */ }
  }, [job.id]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    setBusy(true);
    try {
      await api("/api/quotes", {
        action: "create", workOrderId: job.id,
        vendorId: form.vendorId === "none" ? undefined : Number(form.vendorId),
        quotedAmount: form.quotedAmount ? Number(form.quotedAmount) : undefined,
        authorizedAmount: form.authorizedAmount ? Number(form.authorizedAmount) : undefined,
        actualCost: form.actualCost ? Number(form.actualCost) : undefined,
        poNumber: form.poNumber || undefined, glCode: form.glCode || undefined,
        reference: form.reference || undefined, scope: form.scope || undefined, notes: form.notes || undefined,
      });
      setForm(emptyForm);
      await load();
      setMessage(es ? "Cotización agregada." : "Quote added.");
    } catch (error) { setMessage(describeError(error, es)); }
    finally { setBusy(false); }
  }

  function startEdit(quote: any) {
    setEditForm({
      quotedAmount: quote.quotedAmount != null ? String(quote.quotedAmount) : "",
      authorizedAmount: quote.authorizedAmount != null ? String(quote.authorizedAmount) : "",
      actualCost: quote.actualCost != null ? String(quote.actualCost) : "",
      poNumber: quote.poNumber || "",
      glCode: quote.glCode || "",
      reference: quote.reference || "",
      scope: quote.scope || "",
      notes: quote.notes || "",
      vendorId: quote.vendorId ? String(quote.vendorId) : "none",
    });
    setEditing(quote);
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      await api("/api/quotes", {
        action: "update", id: editing.id,
        vendorId: editForm.vendorId === "none" ? null : Number(editForm.vendorId),
        quotedAmount: editForm.quotedAmount ? Number(editForm.quotedAmount) : null,
        authorizedAmount: editForm.authorizedAmount ? Number(editForm.authorizedAmount) : null,
        actualCost: editForm.actualCost ? Number(editForm.actualCost) : null,
        poNumber: editForm.poNumber, glCode: editForm.glCode,
        reference: editForm.reference, scope: editForm.scope, notes: editForm.notes,
      });
      setEditing(null);
      await load();
      setMessage(es ? "Cotización actualizada." : "Quote updated.");
    } catch (error) { setMessage(describeError(error, es)); }
    finally { setBusy(false); }
  }

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Wallet className="size-5 text-emerald-700" />{es ? "Cotizaciones y costos" : "Quotes & costs"}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {quotes.map((quote) => (
          <div key={quote.id} className="flex flex-wrap gap-x-4 gap-y-1 rounded-2xl bg-slate-50 p-3 text-sm">
            <span><strong>{es ? "Cotizado" : "Quoted"}:</strong> {quote.quotedAmount ?? "—"}</span>
            <span><strong>{es ? "Autorizado" : "Authorized"}:</strong> {quote.authorizedAmount ?? "—"}</span>
            <span><strong>{es ? "Real" : "Actual"}:</strong> {quote.actualCost ?? "—"}</span>
            {quote.poNumber && <span>PO: {quote.poNumber}</span>}
            {quote.glCode && <span>GL: {quote.glCode}</span>}
            {quote.reference && <span>{quote.reference}</span>}
            {quote.vendorName && <span><strong>Vendor:</strong> {quote.vendorName}</span>}
            {quote.scope && <span className="w-full text-slate-500">{quote.scope}</span>}
            {quote.notes && <span className="w-full text-slate-500">{quote.notes}</span>}
            <span className="ml-auto">
              <Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => startEdit(quote)}><Pencil />{es ? "Editar" : "Edit"}</Button>
            </span>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" step="0.01" placeholder={es ? "Monto cotizado" : "Quoted amount"} value={form.quotedAmount} onChange={(e) => setForm({ ...form, quotedAmount: e.target.value })} />
          <Input type="number" step="0.01" placeholder={es ? "Monto autorizado" : "Authorized amount"} value={form.authorizedAmount} onChange={(e) => setForm({ ...form, authorizedAmount: e.target.value })} />
          <Input type="number" step="0.01" placeholder={es ? "Costo real" : "Actual cost"} value={form.actualCost} onChange={(e) => setForm({ ...form, actualCost: e.target.value })} />
          <Input placeholder="PO" value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} />
          <Input placeholder="GL" value={form.glCode} onChange={(e) => setForm({ ...form, glCode: e.target.value })} />
          <Input placeholder={es ? "Referencia" : "Reference"} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <Select value={form.vendorId} onValueChange={(v) => setForm({ ...form, vendorId: v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">{es ? "Sin vendor" : "No vendor"}</SelectItem>{vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder={es ? "Alcance" : "Scope"} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
        </div>
        <Textarea placeholder={es ? "Notas" : "Notes"} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="flex justify-end"><Button className="min-h-11" disabled={busy} onClick={add}>{es ? "Agregar cotización" : "Add quote"}</Button></div>
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{es ? "Editar cotización" : "Edit quote"}</DialogTitle>
            <DialogDescription>{es ? "Actualiza los montos y datos de esta cotización. No cambia el estado ni la verificación de la orden de trabajo." : "Update this quote's amounts and details. It does not change the work order's status or verification."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" step="0.01" placeholder={es ? "Monto cotizado" : "Quoted amount"} value={editForm.quotedAmount} onChange={(e) => setEditForm({ ...editForm, quotedAmount: e.target.value })} />
              <Input type="number" step="0.01" placeholder={es ? "Monto autorizado" : "Authorized amount"} value={editForm.authorizedAmount} onChange={(e) => setEditForm({ ...editForm, authorizedAmount: e.target.value })} />
              <Input type="number" step="0.01" placeholder={es ? "Costo real" : "Actual cost"} value={editForm.actualCost} onChange={(e) => setEditForm({ ...editForm, actualCost: e.target.value })} />
              <Input placeholder="PO" value={editForm.poNumber} onChange={(e) => setEditForm({ ...editForm, poNumber: e.target.value })} />
              <Input placeholder="GL" value={editForm.glCode} onChange={(e) => setEditForm({ ...editForm, glCode: e.target.value })} />
              <Input placeholder={es ? "Referencia" : "Reference"} value={editForm.reference} onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })} />
              <Select value={editForm.vendorId} onValueChange={(v) => setEditForm({ ...editForm, vendorId: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">{es ? "Sin vendor" : "No vendor"}</SelectItem>{vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder={es ? "Alcance" : "Scope"} value={editForm.scope} onChange={(e) => setEditForm({ ...editForm, scope: e.target.value })} />
            </div>
            <Textarea placeholder={es ? "Notas" : "Notes"} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setEditing(null)}>{es ? "Cancelar" : "Cancel"}</Button>
            <Button className="min-h-11 bg-emerald-700 hover:bg-emerald-600" disabled={busy} onClick={saveEdit}>{es ? "Guardar cotización" : "Save quote"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PhotosSection({ job, lang, setMessage }: { job: Job; lang: Language; setMessage: (m: string) => void }) {
  const es = lang === "es";
  const [photos, setPhotos] = useState<any[]>([]);
  const [phase, setPhase] = useState("before");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const data = await api(`/api/photos?workOrderId=${job.id}`); setPhotos(data.photos || []); }
    catch { /* gallery endpoint may not be live yet */ }
  }, [job.id]);
  useEffect(() => { void load(); }, [load]);

  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set("module", "jobs");
      formData.set("workOrderId", String(job.id));
      formData.set("phase", phase);
      formData.set("description", description);
      formData.set("file", file);
      const res = await fetch("/api/photos", { method: "POST", body: formData });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Upload failed");
      setDescription("");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const phaseLabel = (p: string) => p === "before" ? (es ? "Antes" : "Before") : p === "during" ? (es ? "Durante" : "During") : (es ? "Después" : "After");

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Paperclip className="size-5 text-emerald-700" />{es ? "Fotos del trabajo" : "Job photos"}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <figure key={photo.id} className="overflow-hidden rounded-2xl bg-slate-50">
              {photo.signedUrl && <img src={photo.signedUrl} alt={photo.description || photo.fileName} className="aspect-square w-full object-cover" />}
              <figcaption className="p-2 text-xs font-semibold text-slate-500">
                <Badge variant="outline" className="mb-1">{phaseLabel(photo.phase || "before")}</Badge><br />{photo.description || photo.fileName}
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
          <Select value={phase} onValueChange={setPhase}>
            <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="before">{phaseLabel("before")}</SelectItem><SelectItem value="during">{phaseLabel("during")}</SelectItem><SelectItem value="after">{phaseLabel("after")}</SelectItem></SelectContent>
          </Select>
          <Input placeholder={es ? "Descripción de la foto" : "Photo description"} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-4 font-bold text-emerald-700">
          <Upload />{busy ? "…" : (es ? "Subir foto" : "Upload photo")}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0] || null); e.target.value = ""; }} />
        </label>
      </CardContent>
    </Card>
  );
}
