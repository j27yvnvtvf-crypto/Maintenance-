"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Building2, ClipboardList, Paperclip, Plus, Printer, Search, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Language = "en" | "es";
type TeamLite = { id: number; name: string; jobTitle?: string | null };

type Vendor = {
  id: number; company: string; contactName: string | null; phone: string | null;
  email: string | null; specialty: string | null; notes: string | null; status: string;
};
type Job = {
  id: number; vendorId: number; vendorName: string; kind: string; title: string;
  description: string | null; status: string; scheduledDate: string | null;
  relatedLocation: string | null; relatedAssetId: number | null; equipmentText: string | null;
  responsibleMemberId: number | null; responsibleName: string; nextAction: string | null;
  nextActionDate: string | null; nextActionOverdue: boolean;
  relatedWorkOrderId: number | null; relatedLogEventId: number | null;
  completedAt: string | null; completedByName: string; verifiedAt: string | null;
  verifiedByName: string; createdByName: string; createdAt: string;
};

const JOB_KINDS = ["request", "appointment", "quote", "report", "pending_part", "pending_service"];

const copy = {
  en: {
    title: "Vendors", subtitle: "Vendor directory, scheduled work, quotes and reports, and pending parts & services with an owner and a next action. Final verification is recorded with name and date.",
    sections: { jobs: "Work & pendings", directory: "Directory" } as Record<string, string>,
    search: "Search company, contact, specialty…",
    saved: "Saved.", loadError: "Unable to load vendors.",
    newVendor: "New vendor", company: "Company", contact: "Contact", phone: "Phone", email: "Email",
    specialty: "Specialty", notes: "Notes", create: "Create", save: "Save changes", cancel: "Cancel",
    edit: "Edit", archive: "Archive", reactivate: "Reactivate", archived: "Archived", active: "Active",
    noVendors: "No vendors yet. Add the first company — the directory starts empty on purpose.",
    newJob: "New vendor job", vendor: "Vendor", kind: "Type", jobTitle: "Title", description: "Description",
    scheduledDate: "Scheduled date", location: "Apartment / area", equipmentText: "Equipment (free text)",
    relatedAsset: "Related asset", responsible: "Responsible", nextAction: "Next action",
    nextActionDate: "Next action date", overdue: "Overdue",
    kinds: {
      request: "Request", appointment: "Appointment", quote: "Quote", report: "Report",
      pending_part: "Pending part", pending_service: "Pending service",
    } as Record<string, string>,
    statuses: {
      open: "Open", scheduled: "Scheduled", in_progress: "In progress",
      completed: "Completed", verified: "Verified", cancelled: "Cancelled",
    } as Record<string, string>,
    allKinds: "All types", pendingOnly: "Pending parts & services",
    noJobs: "No vendor work matches.",
    back: "Back", attachments: "Quotes, reports & evidence", attach: "Attach file", download: "Download",
    history: "History", complete: "Mark completed", evidenceNotes: "Completion notes / evidence",
    verify: "Verify final result", verifiedBy: "Verified by", completedBy: "Completed by",
    createdBy: "Created by", linkEvent: "Linked logbook event", linkWo: "Linked work order",
    printLog: "Pending parts & vendor log", printBlank: "Blank form",
    none: "—", noAttachments: "No files attached yet.",
    setStatus: "Move to",
  },
  es: {
    title: "Vendors", subtitle: "Directorio de vendors, trabajo programado, presupuestos e informes, y piezas y servicios pendientes con responsable y próxima acción. La verificación final queda registrada con nombre y fecha.",
    sections: { jobs: "Trabajo y pendientes", directory: "Directorio" } as Record<string, string>,
    search: "Buscar empresa, contacto, especialidad…",
    saved: "Guardado.", loadError: "No se pudieron cargar los vendors.",
    newVendor: "Vendor nuevo", company: "Empresa", contact: "Contacto", phone: "Teléfono", email: "Correo",
    specialty: "Especialidad", notes: "Notas", create: "Crear", save: "Guardar cambios", cancel: "Cancelar",
    edit: "Editar", archive: "Archivar", reactivate: "Reactivar", archived: "Archivado", active: "Activo",
    noVendors: "Sin vendors todavía. Agrega la primera empresa — el directorio nace vacío a propósito.",
    newJob: "Trabajo de vendor nuevo", vendor: "Vendor", kind: "Tipo", jobTitle: "Título", description: "Descripción",
    scheduledDate: "Fecha programada", location: "Apartamento / área", equipmentText: "Equipo (texto libre)",
    relatedAsset: "Activo relacionado", responsible: "Responsable", nextAction: "Próxima acción",
    nextActionDate: "Fecha de próxima acción", overdue: "Vencida",
    kinds: {
      request: "Solicitud", appointment: "Cita", quote: "Presupuesto", report: "Informe",
      pending_part: "Pieza pendiente", pending_service: "Servicio pendiente",
    } as Record<string, string>,
    statuses: {
      open: "Abierto", scheduled: "Programado", in_progress: "En proceso",
      completed: "Completado", verified: "Verificado", cancelled: "Cancelado",
    } as Record<string, string>,
    allKinds: "Todos los tipos", pendingOnly: "Piezas y servicios pendientes",
    noJobs: "Sin trabajo de vendors que coincida.",
    back: "Volver", attachments: "Presupuestos, informes y evidencia", attach: "Adjuntar archivo", download: "Descargar",
    history: "Historial", complete: "Marcar completado", evidenceNotes: "Notas de cierre / evidencia",
    verify: "Verificar resultado final", verifiedBy: "Verificado por", completedBy: "Completado por",
    createdBy: "Creado por", linkEvent: "Evento de bitácora vinculado", linkWo: "Orden de trabajo vinculada",
    printLog: "Registro de partes y vendors pendientes", printBlank: "Formato en blanco",
    none: "—", noAttachments: "Sin archivos adjuntos todavía.",
    setStatus: "Mover a",
  },
} as const;

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function uploadFile(form: FormData) {
  const res = await fetch("/api/vendors", { method: "POST", body: form });
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Upload failed");
  return payload;
}

function fmtDateTime(value: string | null | undefined, lang: Language) {
  if (!value) return "—";
  return new Date(value).toLocaleString(lang === "es" ? "es-US" : "en-US", {
    dateStyle: "medium", timeStyle: "short",
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function statusBadgeClass(status: string) {
  return status === "verified" ? "bg-emerald-600"
    : status === "completed" ? "bg-teal-600"
    : status === "in_progress" ? "bg-sky-600"
    : status === "scheduled" ? "bg-indigo-500"
    : status === "cancelled" ? "bg-slate-300" : "bg-amber-500";
}

export function VendorsPanel({ lang, team }: { lang: Language; team: TeamLite[] }) {
  const t = copy[lang];
  const [section, setSection] = useState("jobs");
  const [data, setData] = useState<{ vendors: Vendor[]; jobs: Job[] } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api("/api/vendors")); }
    catch (error) { setMessage(error instanceof Error ? error.message : t.loadError); }
  }, [t.loadError]);

  useEffect(() => { void load(); }, [load]);

  async function act(body: unknown) {
    setBusy(true);
    try {
      const result = await api("/api/vendors", body);
      setMessage(t.saved);
      await load();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="size-5 text-[#007a9f]" />{t.title}</CardTitle>
          <p className="text-sm text-slate-500">{t.subtitle}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={section === "jobs" ? "default" : "outline"} onClick={() => setSection("jobs")} className="gap-1.5">
              <ClipboardList className="size-4" />{t.sections.jobs}
            </Button>
            <Button size="sm" variant={section === "directory" ? "default" : "outline"} onClick={() => setSection("directory")} className="gap-1.5">
              <Building2 className="size-4" />{t.sections.directory}
            </Button>
            <a href="/print/pending-parts-vendors" target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5"><Printer className="size-4" />{t.printLog}</Button>
            </a>
            <a href="/print/pending-parts-vendors?blank=1" target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">{t.printBlank}</Button>
            </a>
          </div>
          {message && <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">{message}</p>}
        </CardContent>
      </Card>

      {section === "directory"
        ? <DirectorySection t={t} lang={lang} data={data} busy={busy} act={act} />
        : <JobsSection t={t} lang={lang} team={team} data={data} busy={busy} act={act} setMessage={setMessage} reload={load} />}
    </div>
  );
}

/* ------------------------------ Directory ------------------------------ */

function DirectorySection({ t, data, busy, act }: any) {
  const [showNew, setShowNew] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ company: "", contactName: "", phone: "", email: "", specialty: "", notes: "" });
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [showArchived, setShowArchived] = useState(false);

  const vendors: Vendor[] = (data?.vendors || []).filter((row: Vendor) => {
    if (!showArchived && row.status === "archived") return false;
    if (!q) return true;
    const needle = q.toLowerCase();
    return [row.company, row.contactName, row.specialty, row.email]
      .some((field) => (field || "").toLowerCase().includes(needle));
  });

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder={t.search} value={q} onChange={(e: any) => setQ(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => setShowNew(!showNew)} className="gap-1.5"><Plus className="size-4" />{t.newVendor}</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? t.active : t.archived}
          </Button>
        </div>

        {showNew && (
          <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await act({ action: "create_vendor", ...form });
              if (result) { setForm({ company: "", contactName: "", phone: "", email: "", specialty: "", notes: "" }); setShowNew(false); }
            }}>
            <Field label={t.company}><Input required value={form.company} onChange={(e: any) => setForm({ ...form, company: e.target.value })} /></Field>
            <Field label={t.contact}><Input value={form.contactName} onChange={(e: any) => setForm({ ...form, contactName: e.target.value })} /></Field>
            <Field label={t.phone}><Input value={form.phone} onChange={(e: any) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={t.email}><Input value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={t.specialty}><Input value={form.specialty} onChange={(e: any) => setForm({ ...form, specialty: e.target.value })} /></Field>
            <Field label={t.notes}><Input value={form.notes} onChange={(e: any) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy}>{t.create}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNew(false)}>{t.cancel}</Button>
            </div>
          </form>
        )}

        {vendors.length === 0 && <p className="text-sm text-slate-500">{t.noVendors}</p>}
        <div className="grid gap-2">
          {vendors.map((vendor) => (
            <div key={vendor.id} className="rounded-2xl bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <strong>{vendor.company}</strong>
                  {vendor.specialty ? <span className="text-slate-500"> · {vendor.specialty}</span> : null}
                  <span className="block text-slate-500">
                    {[vendor.contactName, vendor.phone, vendor.email].filter(Boolean).join(" · ") || t.none}
                  </span>
                  {vendor.notes ? <span className="block text-slate-500">{vendor.notes}</span> : null}
                </span>
                <span className="flex gap-2">
                  {vendor.status === "archived" && <Badge className="bg-slate-400">{t.archived}</Badge>}
                  <Button size="sm" variant="outline" onClick={() => {
                    setEditId(editId === vendor.id ? null : vendor.id);
                    setEdit({ company: vendor.company, contactName: vendor.contactName || "", phone: vendor.phone || "", email: vendor.email || "", specialty: vendor.specialty || "", notes: vendor.notes || "" });
                  }}>{t.edit}</Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => act({ action: "set_vendor_status", id: vendor.id, status: vendor.status === "archived" ? "active" : "archived" })}>
                    {vendor.status === "archived" ? t.reactivate : t.archive}
                  </Button>
                </span>
              </div>
              {editId === vendor.id && edit && (
                <form className="mt-3 grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const result = await act({ action: "update_vendor", id: vendor.id, ...edit });
                    if (result) setEditId(null);
                  }}>
                  <Field label={t.company}><Input required value={edit.company} onChange={(e: any) => setEdit({ ...edit, company: e.target.value })} /></Field>
                  <Field label={t.contact}><Input value={edit.contactName} onChange={(e: any) => setEdit({ ...edit, contactName: e.target.value })} /></Field>
                  <Field label={t.phone}><Input value={edit.phone} onChange={(e: any) => setEdit({ ...edit, phone: e.target.value })} /></Field>
                  <Field label={t.email}><Input value={edit.email} onChange={(e: any) => setEdit({ ...edit, email: e.target.value })} /></Field>
                  <Field label={t.specialty}><Input value={edit.specialty} onChange={(e: any) => setEdit({ ...edit, specialty: e.target.value })} /></Field>
                  <Field label={t.notes}><Input value={edit.notes} onChange={(e: any) => setEdit({ ...edit, notes: e.target.value })} /></Field>
                  <div className="flex gap-2 sm:col-span-2">
                    <Button type="submit" size="sm" disabled={busy}>{t.save}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditId(null)}>{t.cancel}</Button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Jobs --------------------------------- */

function emptyJobForm() {
  return {
    vendorId: "", kind: "request", title: "", description: "", scheduledDate: "",
    relatedLocation: "", equipmentText: "", relatedAssetId: "", responsibleMemberId: "",
    nextAction: "", nextActionDate: "",
  };
}

function JobsSection({ t, lang, team, data, busy, act, setMessage, reload }: any) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyJobForm());
  const [kindFilter, setKindFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (selectedId) {
    return (
      <JobDetail t={t} lang={lang} team={team} jobId={selectedId} busy={busy} act={act}
        setMessage={setMessage} onBack={() => { setSelectedId(null); void reload(); }} />
    );
  }

  const vendors: Vendor[] = (data?.vendors || []).filter((row: Vendor) => row.status === "active");
  const jobs: Job[] = (data?.jobs || []).filter((row: Job) => {
    if (kindFilter === "pending") return (row.kind === "pending_part" || row.kind === "pending_service")
      && !["completed", "verified", "cancelled"].includes(row.status);
    if (kindFilter !== "all") return row.kind === kindFilter;
    return true;
  });

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.allKinds}</SelectItem>
              <SelectItem value="pending">{t.pendingOnly}</SelectItem>
              {JOB_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{t.kinds[kind]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setShowNew(!showNew)} className="gap-1.5"><Plus className="size-4" />{t.newJob}</Button>
        </div>

        {showNew && (
          <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await act({
                action: "create_job", vendorId: Number(form.vendorId), kind: form.kind, title: form.title,
                description: form.description, scheduledDate: form.scheduledDate || undefined,
                relatedLocation: form.relatedLocation, equipmentText: form.equipmentText,
                responsibleMemberId: form.responsibleMemberId ? Number(form.responsibleMemberId) : undefined,
                nextAction: form.nextAction, nextActionDate: form.nextActionDate || undefined,
              });
              if (result) { setForm(emptyJobForm()); setShowNew(false); }
            }}>
            <Field label={t.vendor}>
              <Select value={form.vendorId || "none"} onValueChange={(v: string) => setForm({ ...form, vendorId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.none}</SelectItem>
                  {vendors.map((vendor) => <SelectItem key={vendor.id} value={String(vendor.id)}>{vendor.company}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.kind}>
              <Select value={form.kind} onValueChange={(v: string) => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JOB_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{t.kinds[kind]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.jobTitle}><Input required value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label={t.scheduledDate}><Input type="date" value={form.scheduledDate} onChange={(e: any) => setForm({ ...form, scheduledDate: e.target.value })} /></Field>
            <Field label={t.location}><Input value={form.relatedLocation} onChange={(e: any) => setForm({ ...form, relatedLocation: e.target.value })} /></Field>
            <Field label={t.equipmentText}><Input value={form.equipmentText} onChange={(e: any) => setForm({ ...form, equipmentText: e.target.value })} /></Field>
            <Field label={t.responsible}>
              <Select value={form.responsibleMemberId || "none"}
                onValueChange={(v: string) => setForm({ ...form, responsibleMemberId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.none}</SelectItem>
                  {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.nextAction}><Input value={form.nextAction} onChange={(e: any) => setForm({ ...form, nextAction: e.target.value })} /></Field>
            <Field label={t.nextActionDate}><Input type="date" value={form.nextActionDate} onChange={(e: any) => setForm({ ...form, nextActionDate: e.target.value })} /></Field>
            <Field label={t.description}><Textarea value={form.description} onChange={(e: any) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy || !form.vendorId}>{t.create}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNew(false)}>{t.cancel}</Button>
            </div>
          </form>
        )}

        {jobs.length === 0 && <p className="text-sm text-slate-500">{t.noJobs}</p>}
        <div className="grid gap-2">
          {jobs.map((job) => (
            <button key={job.id} type="button" onClick={() => setSelectedId(job.id)}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3 text-left hover:bg-slate-100">
              <span>
                <span className="font-bold">{job.title}</span>
                <span className="block text-sm text-slate-500">
                  {job.vendorName} · {t.kinds[job.kind] || job.kind}
                  {job.relatedLocation ? ` · ${job.relatedLocation}` : ""}
                  {job.nextAction ? ` · ${t.nextAction}: ${job.nextAction}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {job.nextActionOverdue && <Badge className="bg-red-600">{t.overdue}</Badge>}
                <Badge className={statusBadgeClass(job.status)}>{t.statuses[job.status] || job.status}</Badge>
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function JobDetail({ t, lang, team, jobId, busy, act, onBack, setMessage }: any) {
  const [detail, setDetail] = useState<any>(null);
  const [evidence, setEvidence] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDetail = useCallback(async () => {
    try { setDetail(await api(`/api/vendors?jobId=${jobId}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, [jobId, setMessage]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function actAndReload(body: unknown) {
    const result = await act(body);
    if (result) await loadDetail();
    return result;
  }

  if (!detail?.job) {
    return (
      <Card className="rounded-3xl border-0 shadow-sm"><CardContent className="pt-5">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1.5"><ArrowLeft className="size-4" />{t.back}</Button>
      </CardContent></Card>
    );
  }
  const job: Job & { attachments?: any[]; history?: any[] } = detail.job;
  const workingStatuses = ["open", "scheduled", "in_progress", "cancelled"]
    .filter((s) => s !== job.status && !["completed", "verified"].includes(job.status));

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{job.title}</CardTitle>
          <Button size="sm" variant="ghost" onClick={onBack} className="gap-1.5"><ArrowLeft className="size-4" />{t.back}</Button>
        </div>
        <p className="text-sm text-slate-500">
          {job.vendorName} · {t.kinds[job.kind] || job.kind}
          {job.relatedLocation ? ` · ${job.relatedLocation}` : ""}
          {job.equipmentText ? ` · ${job.equipmentText}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={statusBadgeClass(job.status)}>{t.statuses[job.status] || job.status}</Badge>
          {job.nextActionOverdue && <Badge className="bg-red-600">{t.overdue}</Badge>}
          <span className="text-sm text-slate-600">
            {job.scheduledDate ? `${t.scheduledDate}: ${job.scheduledDate} · ` : ""}
            {t.createdBy}: {job.createdByName || t.none} · {fmtDateTime(job.createdAt, lang)}
          </span>
        </div>
        {job.description && <p className="whitespace-pre-wrap text-sm text-slate-600">{job.description}</p>}
        <div className="grid gap-1 text-sm text-slate-600">
          <p>{t.responsible}: {job.responsibleName || t.none}</p>
          <p>{t.nextAction}: {job.nextAction || t.none}{job.nextActionDate ? ` · ${job.nextActionDate}` : ""}</p>
          {job.relatedLogEventId ? <p>{t.linkEvent}: #{job.relatedLogEventId}</p> : null}
          {job.relatedWorkOrderId ? <p>{t.linkWo}: #{job.relatedWorkOrderId}</p> : null}
          {job.completedAt ? <p>{t.completedBy}: {job.completedByName || t.none} · {fmtDateTime(job.completedAt, lang)}</p> : null}
          {job.verifiedAt ? <p className="flex items-center gap-1.5"><ShieldCheck className="size-4 text-emerald-600" />{t.verifiedBy}: {job.verifiedByName || t.none} · {fmtDateTime(job.verifiedAt, lang)}</p> : null}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {workingStatuses.map((status) => (
            <Button key={status} size="sm" variant="outline" disabled={busy}
              onClick={() => actAndReload({ action: "set_job_status", id: job.id, status })}>
              {t.setStatus}: {t.statuses[status]}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => setEdit(edit ? null : {
            title: job.title, kind: job.kind, description: job.description || "",
            scheduledDate: job.scheduledDate || "", relatedLocation: job.relatedLocation || "",
            equipmentText: job.equipmentText || "", nextAction: job.nextAction || "",
            nextActionDate: job.nextActionDate || "",
            responsibleMemberId: job.responsibleMemberId ? String(job.responsibleMemberId) : "",
            relatedAssetId: job.relatedAssetId ? String(job.relatedAssetId) : "",
            relatedLogEventId: job.relatedLogEventId ? String(job.relatedLogEventId) : "",
            relatedWorkOrderId: job.relatedWorkOrderId ? String(job.relatedWorkOrderId) : "",
          })}>{t.edit}</Button>
        </div>

        {edit && (
          <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await actAndReload({
                action: "update_job", id: job.id, title: edit.title, kind: edit.kind,
                description: edit.description, scheduledDate: edit.scheduledDate || null,
                relatedLocation: edit.relatedLocation, equipmentText: edit.equipmentText,
                nextAction: edit.nextAction, nextActionDate: edit.nextActionDate || null,
                responsibleMemberId: edit.responsibleMemberId ? Number(edit.responsibleMemberId) : null,
                relatedAssetId: edit.relatedAssetId ? Number(edit.relatedAssetId) : null,
                relatedLogEventId: edit.relatedLogEventId ? Number(edit.relatedLogEventId) : null,
                relatedWorkOrderId: edit.relatedWorkOrderId ? Number(edit.relatedWorkOrderId) : null,
              });
              if (result) setEdit(null);
            }}>
            <Field label={t.jobTitle}><Input required value={edit.title} onChange={(e: any) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label={t.kind}>
              <Select value={edit.kind} onValueChange={(v: string) => setEdit({ ...edit, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JOB_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{t.kinds[kind]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.scheduledDate}><Input type="date" value={edit.scheduledDate} onChange={(e: any) => setEdit({ ...edit, scheduledDate: e.target.value })} /></Field>
            <Field label={t.location}><Input value={edit.relatedLocation} onChange={(e: any) => setEdit({ ...edit, relatedLocation: e.target.value })} /></Field>
            <Field label={t.equipmentText}><Input value={edit.equipmentText} onChange={(e: any) => setEdit({ ...edit, equipmentText: e.target.value })} /></Field>
            <Field label={t.responsible}>
              <Select value={edit.responsibleMemberId || "none"}
                onValueChange={(v: string) => setEdit({ ...edit, responsibleMemberId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.none}</SelectItem>
                  {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.nextAction}><Input value={edit.nextAction} onChange={(e: any) => setEdit({ ...edit, nextAction: e.target.value })} /></Field>
            <Field label={t.nextActionDate}><Input type="date" value={edit.nextActionDate} onChange={(e: any) => setEdit({ ...edit, nextActionDate: e.target.value })} /></Field>
            <Field label={t.relatedAsset}>
              <Select value={edit.relatedAssetId || "none"}
                onValueChange={(v: string) => setEdit({ ...edit, relatedAssetId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.none}</SelectItem>
                  {(detail.assetOptions || []).map((row: any) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.linkEvent}>
              <Select value={edit.relatedLogEventId || "none"}
                onValueChange={(v: string) => setEdit({ ...edit, relatedLogEventId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.none}</SelectItem>
                  {(detail.eventOptions || []).map((row: any) => <SelectItem key={row.id} value={String(row.id)}>{row.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.description}><Textarea value={edit.description} onChange={(e: any) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy}>{t.save}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>{t.cancel}</Button>
            </div>
          </form>
        )}

        {["open", "scheduled", "in_progress"].includes(job.status) && (
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="mb-2 font-bold">{t.complete}</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t.evidenceNotes}>
                <Input className="min-w-52" value={evidence} onChange={(e: any) => setEvidence(e.target.value)} />
              </Field>
              <Button size="sm" disabled={busy}
                onClick={() => actAndReload({ action: "set_job_status", id: job.id, status: "completed", evidenceNotes: evidence })}>
                {t.complete}
              </Button>
            </div>
          </div>
        )}
        {job.status === "completed" && !job.verifiedAt && (
          <Button size="sm" className="gap-1.5" disabled={busy}
            onClick={() => actAndReload({ action: "verify_job", id: job.id })}>
            <ShieldCheck className="size-4" />{t.verify}
          </Button>
        )}

        <div>
          <p className="mb-2 flex items-center gap-2 font-bold"><Paperclip className="size-4" />{t.attachments}</p>
          <div className="space-y-1.5">
            {(job.attachments || []).length === 0 && <p className="text-sm text-slate-500">{t.noAttachments}</p>}
            {(job.attachments || []).map((row: any) => (
              <p key={row.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                {row.fileName}
                <span className="text-slate-400">· {row.uploadedByName || ""} · {fmtDateTime(row.uploadedAt, lang)}</span>
                <a href={`/api/vendors/download?attachmentId=${row.id}`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline">{t.download}</Button>
                </a>
              </p>
            ))}
          </div>
          <input ref={fileRef} type="file" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const formData = new FormData();
            formData.set("jobId", String(job.id));
            formData.set("file", file);
            try {
              await uploadFile(formData);
              setMessage(t.saved);
              await loadDetail();
            } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
          }} />
          <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => fileRef.current?.click()}>
            <Paperclip className="size-4" />{t.attach}
          </Button>
        </div>

        <div>
          <p className="mb-2 font-bold">{t.history}</p>
          <div className="space-y-1.5">
            {(job.history || []).map((row: any) => (
              <p key={row.id} className="text-sm text-slate-600">
                {row.action}<span className="text-slate-400"> · {row.actorName} · {fmtDateTime(row.createdAt, lang)}</span>
              </p>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
