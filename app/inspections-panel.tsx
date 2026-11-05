"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, ClipboardCheck, Download,
  History, Paperclip, PlayCircle, Plus, Search, ShieldCheck, Upload, Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Language = "en" | "es";

type TemplateItem = {
  id?: number; position: number; prompt: string;
  responseType: string; allowsPhoto: boolean; required: boolean;
};
type Template = {
  id: number; name: string; templateType: string; areaLabel: string | null;
  description: string | null; frequencyType: string; frequencyNote: string | null;
  status: string; items: TemplateItem[];
};
type Inspection = {
  id: number; folio: string; templateId: number | null; templateName: string | null;
  templateType: string; frequencyType: string | null; frequencyNote: string | null;
  title: string; building: string | null; unit: string | null; area: string | null;
  equipment: string | null; location: string;
  assignedMemberId: number | null; assignedName: string | null;
  scheduledDate: string | null; status: string; generalNotes: string | null;
  signatureName: string | null; createdByName: string | null;
  startedAt: string | null; completedByName: string | null; completedAt: string | null;
  createdAt: string; overdue: boolean;
  answered: number | null; totalItems: number | null; findings: number | null; openActions: number | null;
};
type Attachment = {
  id: number; resultId: number | null; correctiveActionId: number | null;
  fileName: string; uploadedByName: string | null; createdAt: string;
};
type Result = {
  id: number; position: number; prompt: string; responseType: string;
  allowsPhoto: boolean; required: boolean; status: string | null; answer: string | null;
  note: string | null; answeredByName: string | null; answeredAt: string | null;
  attachments: Attachment[];
};
type Corrective = {
  id: number; resultId: number; resultPrompt: string | null; description: string;
  responsibleMemberId: number | null; responsibleName: string | null;
  dueDate: string | null; status: string;
  workOrderId: number | null; workOrderLabel: string | null;
  logEventId: number | null; logEventFolio: string | null;
  createdByName: string | null; completedByName: string | null; completedAt: string | null;
  verifiedByName: string | null; verifiedAt: string | null; overdue: boolean;
};
type HistoryEntry = {
  id: number; action: string; detail: Record<string, any>;
  correctiveActionId: number | null; actorName: string | null; actorEmail: string; createdAt: string;
};
type TeamLite = { id: number; name: string };
type LinkOption = { id: number; label: string };

const copy = {
  en: {
    title: "Inspections & PM",
    subtitle: "Checklists by area or equipment, findings with corrective actions, and the daily shop closing record.",
    search: "Search folio, title, building, unit, area, equipment…",
    allStatuses: "All statuses", overdueOnly: "Overdue", allTypes: "All types", allAssigned: "All assigned",
    types: { inspection: "Inspection", shop_closing: "Shop closing" } as Record<string, string>,
    statuses: { scheduled: "Scheduled", in_progress: "In progress", completed: "Completed" } as Record<string, string>,
    resultStatuses: {
      no_issue: "No issue", pending: "Pending", in_progress: "In progress",
      waiting_vendor: "Waiting on vendor / approval", completed: "Completed", na: "N/A",
    } as Record<string, string>,
    unanswered: "Not answered",
    answers: { yes: "Yes", no: "No" } as Record<string, string>,
    correctiveStatuses: { open: "Open", in_progress: "In progress", completed: "Completed", verified: "Verified" } as Record<string, string>,
    templateStatuses: { draft: "Draft", published: "Published", archived: "Archived" } as Record<string, string>,
    frequencies: {
      daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly",
      annual: "Annual", custom: "Custom", none: "Not set",
    } as Record<string, string>,
    frequencyDisclaimer: "Frequency is configurable per template. The system does not preset or certify any frequency as official — set it from the applicable SOP or manufacturer instructions.",
    empty: "No inspections match. Start one from a published template or as a free inspection.",
    newInspection: "New inspection",
    createTitle: "Start an inspection",
    fromTemplate: "From a published template", freeInspection: "Free inspection (write the items)",
    freeItemsHint: "One checklist item per line.",
    titleField: "Title", scheduledDate: "Scheduled date", assignedTo: "Assigned to", unassigned: "Unassigned",
    building: "Building", unit: "Apartment / unit", area: "Area", equipment: "Equipment",
    create: "Start inspection", save: "Save", cancel: "Cancel",
    shopClosingTitle: "Shop closing — today",
    shopClosingNone: "No shop closing template is published yet. The administrator publishes it in Templates below.",
    shopStart: "Start today's record", shopOpen: "Open today's record", shopDone: "Today's record is completed",
    templatesTitle: "Checklist templates",
    templatesAdminHint: "Templates are system configuration: only the administrator creates, edits, publishes or archives them. Editing a template never changes inspections already executed — each execution keeps its own snapshot.",
    newTemplate: "New template", editTemplate: "Edit template",
    templateName: "Template name", templateType: "Type", areaLabel: "Area / equipment label",
    templateDescription: "Description", frequency: "Frequency", frequencyNote: "Frequency note (source: SOP, manufacturer…)",
    items: "Checklist items", itemPrompt: "Item to check", responseType: "Answer type",
    responseTypes: { status: "Finding state", yes_no: "Yes / No" } as Record<string, string>,
    allowsPhoto: "Photo", requiredItem: "Required", addItem: "Add item", removeItem: "Remove",
    publish: "Publish", archive: "Archive", toDraft: "Back to draft",
    back: "Back to inspections",
    start: "Start", complete: "Complete inspection", reopen: "Reopen",
    completeHint: "Every required item must be answered. Completing locks the results; reopening is recorded.",
    signatureName: "Signature (type your name)", signedBy: "Signed by",
    completedBy: "Completed by", createdBy: "Created by", startedAt: "Started",
    generalNotes: "General notes & observations", note: "Note", saveNote: "Save note",
    itemNote: "Observation…",
    photos: "Photos & files", attach: "Attach", download: "Download",
    finding: "Finding", findings: "findings", openActions: "open actions",
    newCorrective: "Corrective action", correctiveTitle: "Corrective actions",
    correctiveHint: "Generated from a finding. Follow-up lives here — link a work order or a logbook event instead of duplicating them.",
    correctiveDescription: "What needs to be done", responsible: "Responsible", dueDate: "Due date",
    linkWo: "Linked work order", linkEvent: "Linked logbook event", noLink: "No link",
    completeAction: "Mark completed", verifyAction: "Verify closure", verified: "Verified",
    addCorrective: "Add action",
    historyTitle: "Full history",
    historyActions: {
      created: "Inspection created", started: "Started", result_recorded: "Result recorded",
      details_updated: "Details updated", assigned: "Assignee changed", schedule_changed: "Schedule changed",
      completed: "Completed", reopened: "Reopened", attachment_added: "File attached",
      corrective_created: "Corrective action created", corrective_updated: "Corrective action updated",
      corrective_completed: "Corrective action completed", corrective_verified: "Closure verified",
      corrective_linked: "Corrective action linked",
    } as Record<string, string>,
    overdueBadge: "Overdue", dueToday: "Due today",
    answeredOf: "answered",
    todayTitle: "Inspections — needs attention",
    todayOverdueInsp: "overdue inspections", todayDue: "due today",
    todayOpenActions: "open corrective actions", todayOverdueActions: "of them overdue",
    viewInspections: "Open inspections",
    noAttention: "Nothing overdue. ",
    progress: "Progress",
    template: "Template",
  },
  es: {
    title: "Inspecciones y PM",
    subtitle: "Checklists por área o equipo, hallazgos con acciones correctivas y el registro diario de cierre del shop.",
    search: "Buscar folio, título, edificio, apartamento, área, equipo…",
    allStatuses: "Todos los estados", overdueOnly: "Vencidas", allTypes: "Todos los tipos", allAssigned: "Todos los asignados",
    types: { inspection: "Inspección", shop_closing: "Cierre del shop" } as Record<string, string>,
    statuses: { scheduled: "Programada", in_progress: "En proceso", completed: "Completada" } as Record<string, string>,
    resultStatuses: {
      no_issue: "Sin problemas", pending: "Pendiente", in_progress: "En proceso",
      waiting_vendor: "En espera de proveedor o aprobación", completed: "Completado", na: "N/A",
    } as Record<string, string>,
    unanswered: "Sin responder",
    answers: { yes: "Sí", no: "No" } as Record<string, string>,
    correctiveStatuses: { open: "Abierta", in_progress: "En proceso", completed: "Completada", verified: "Verificada" } as Record<string, string>,
    templateStatuses: { draft: "Borrador", published: "Publicada", archived: "Archivada" } as Record<string, string>,
    frequencies: {
      daily: "Diaria", weekly: "Semanal", monthly: "Mensual", quarterly: "Trimestral",
      annual: "Anual", custom: "Personalizada", none: "Sin definir",
    } as Record<string, string>,
    frequencyDisclaimer: "La frecuencia es configurable por plantilla. El sistema no predefine ni certifica ninguna frecuencia como oficial: se define según el SOP aplicable o las instrucciones del fabricante.",
    empty: "Ninguna inspección coincide. Inicia una desde una plantilla publicada o como inspección libre.",
    newInspection: "Nueva inspección",
    createTitle: "Iniciar una inspección",
    fromTemplate: "Desde una plantilla publicada", freeInspection: "Inspección libre (escribe los ítems)",
    freeItemsHint: "Un ítem del checklist por línea.",
    titleField: "Título", scheduledDate: "Fecha programada", assignedTo: "Asignado a", unassigned: "Sin asignar",
    building: "Edificio", unit: "Apartamento / unidad", area: "Área", equipment: "Equipo",
    create: "Iniciar inspección", save: "Guardar", cancel: "Cancelar",
    shopClosingTitle: "Cierre del shop — hoy",
    shopClosingNone: "Aún no hay una plantilla de cierre del shop publicada. El administrador la publica en Plantillas, abajo.",
    shopStart: "Iniciar el registro de hoy", shopOpen: "Abrir el registro de hoy", shopDone: "El registro de hoy está completado",
    templatesTitle: "Plantillas de checklist",
    templatesAdminHint: "Las plantillas son configuración del sistema: solo el administrador las crea, edita, publica o archiva. Editar una plantilla nunca cambia las inspecciones ya ejecutadas: cada ejecución conserva su propia copia.",
    newTemplate: "Nueva plantilla", editTemplate: "Editar plantilla",
    templateName: "Nombre de la plantilla", templateType: "Tipo", areaLabel: "Etiqueta de área / equipo",
    templateDescription: "Descripción", frequency: "Frecuencia", frequencyNote: "Nota de frecuencia (fuente: SOP, fabricante…)",
    items: "Ítems del checklist", itemPrompt: "Ítem a revisar", responseType: "Tipo de respuesta",
    responseTypes: { status: "Estado del hallazgo", yes_no: "Sí / No" } as Record<string, string>,
    allowsPhoto: "Foto", requiredItem: "Requerido", addItem: "Agregar ítem", removeItem: "Quitar",
    publish: "Publicar", archive: "Archivar", toDraft: "Volver a borrador",
    back: "Volver a inspecciones",
    start: "Iniciar", complete: "Completar inspección", reopen: "Reabrir",
    completeHint: "Todos los ítems requeridos deben estar respondidos. Completar bloquea los resultados; reabrir queda registrado.",
    signatureName: "Firma (escribe tu nombre)", signedBy: "Firmado por",
    completedBy: "Completada por", createdBy: "Creada por", startedAt: "Iniciada",
    generalNotes: "Notas y observaciones generales", note: "Nota", saveNote: "Guardar nota",
    itemNote: "Observación…",
    photos: "Fotos y archivos", attach: "Adjuntar", download: "Descargar",
    finding: "Hallazgo", findings: "hallazgos", openActions: "acciones abiertas",
    newCorrective: "Acción correctiva", correctiveTitle: "Acciones correctivas",
    correctiveHint: "Se generan desde un hallazgo. El seguimiento vive aquí: vincula una orden de trabajo o un evento de la bitácora en vez de duplicarlos.",
    correctiveDescription: "Qué hay que hacer", responsible: "Responsable", dueDate: "Fecha compromiso",
    linkWo: "Orden de trabajo vinculada", linkEvent: "Evento de bitácora vinculado", noLink: "Sin vínculo",
    completeAction: "Marcar completada", verifyAction: "Verificar cierre", verified: "Verificada",
    addCorrective: "Agregar acción",
    historyTitle: "Historial completo",
    historyActions: {
      created: "Inspección creada", started: "Iniciada", result_recorded: "Resultado registrado",
      details_updated: "Detalles actualizados", assigned: "Asignado cambiado", schedule_changed: "Fecha cambiada",
      completed: "Completada", reopened: "Reabierta", attachment_added: "Archivo adjunto",
      corrective_created: "Acción correctiva creada", corrective_updated: "Acción correctiva actualizada",
      corrective_completed: "Acción correctiva completada", corrective_verified: "Cierre verificado",
      corrective_linked: "Acción correctiva vinculada",
    } as Record<string, string>,
    overdueBadge: "Vencida", dueToday: "Vence hoy",
    answeredOf: "respondidos",
    todayTitle: "Inspecciones — requiere atención",
    todayOverdueInsp: "inspecciones vencidas", todayDue: "vencen hoy",
    todayOpenActions: "acciones correctivas abiertas", todayOverdueActions: "de ellas vencidas",
    viewInspections: "Abrir inspecciones",
    noAttention: "Nada vencido. ",
    progress: "Progreso",
    template: "Plantilla",
  },
};

const RESULT_STATUSES = ["no_issue", "pending", "in_progress", "waiting_vendor", "completed", "na"];
const FINDING_STATUSES = ["pending", "in_progress", "waiting_vendor"];
const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "annual", "custom", "none"];

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function uploadFile(form: FormData) {
  const res = await fetch("/api/inspections", { method: "POST", body: form });
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

function statusClass(status: string) {
  return status === "completed" ? "bg-emerald-600"
    : status === "in_progress" ? "bg-sky-600" : "bg-slate-400";
}

function resultClass(status: string | null) {
  if (status === "no_issue" || status === "completed") return "bg-emerald-600";
  if (status === "waiting_vendor") return "bg-purple-600";
  if (status === "pending") return "bg-amber-500";
  if (status === "in_progress") return "bg-sky-600";
  return "bg-slate-300";
}

/** Attention card for the Hoy / Overview tab (light integration). */
export function InspectionsTodayCard({ lang, onOpen }: { lang: Language; onOpen: () => void }) {
  const t = copy[lang];
  const [summary, setSummary] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/api/inspections?summary=1");
        if (!cancelled) setSummary(data);
      } catch { /* the card simply stays hidden if inspections cannot load */ }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!summary) return null;
  const quiet = summary.overdueInspections === 0 && summary.overdueCorrective === 0;
  return (
    <Card className="mt-4 rounded-3xl border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ClipboardCheck className="size-5 text-[#007a9f]" />{t.todayTitle}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onOpen}>{t.viewInspections}</Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-slate-600">
          {quiet ? t.noAttention : null}
          <strong>{summary.overdueInspections}</strong> {t.todayOverdueInsp} ·{" "}
          <strong>{summary.dueToday}</strong> {t.todayDue} ·{" "}
          <strong>{summary.openCorrective}</strong> {t.todayOpenActions} (<strong>{summary.overdueCorrective}</strong> {t.todayOverdueActions})
        </p>
        {(summary.topInspections || []).map((row: Inspection) => (
          <div key={row.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-red-50 p-3">
            <span className="font-semibold">{row.folio} — {row.title}</span>
            <span className="flex items-center gap-2 text-sm text-slate-600">
              {row.location || ""} · {row.scheduledDate || ""}
              <Badge className="bg-red-600">{t.overdueBadge}</Badge>
            </span>
          </div>
        ))}
        {(summary.topCorrective || []).map((row: any) => (
          <div key={row.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-amber-50 p-3">
            <span className="font-semibold">{row.inspectionFolio || ""} — {row.description}</span>
            <span className="flex items-center gap-2 text-sm text-slate-600">
              {t.dueDate}: {row.dueDate || "—"}
              <Badge className="bg-red-600">{t.overdueBadge}</Badge>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function InspectionsPanel({ lang, team, meId, isAdmin }: {
  lang: Language; team: TeamLite[]; meId: number; isAdmin: boolean;
}) {
  const t = copy[lang];
  const [data, setData] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [assignedFilter, setAssignedFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      const payload = await api(`/api/inspections?${params.toString()}`);
      setData(payload);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load"); }
  }, [q]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      setDetail(await api(`/api/inspections?id=${id}`));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load"); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  async function act(body: unknown, refreshDetail = true) {
    setBusy(true);
    try {
      const result = await api("/api/inspections", body);
      await load();
      if (refreshDetail && selectedId) await loadDetail(selectedId);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally { setBusy(false); }
  }

  if (selectedId && detail?.inspection) {
    return (
      <InspectionDetail
        t={t} lang={lang} detail={detail} team={team} busy={busy}
        act={act} setMessage={setMessage}
        onBack={() => { setSelectedId(null); setDetail(null); void load(); }}
        reloadDetail={() => loadDetail(selectedId)}
      />
    );
  }

  const inspections: Inspection[] = (data?.inspections || []).filter((row: Inspection) => {
    if (statusFilter === "overdue") { if (!row.overdue) return false; }
    else if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (typeFilter !== "all" && row.templateType !== typeFilter) return false;
    if (assignedFilter === "me" && row.assignedMemberId !== meId) return false;
    if (assignedFilter !== "all" && assignedFilter !== "me" && row.assignedMemberId !== Number(assignedFilter)) return false;
    return true;
  });
  const templates: Template[] = data?.templates || [];
  const shop = data?.shopClosing;

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardCheck className="size-5 text-[#007a9f]" />{t.title}</CardTitle>
          <p className="text-sm text-slate-500">{t.subtitle}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allStatuses}</SelectItem>
                <SelectItem value="overdue">{t.overdueOnly}</SelectItem>
                {Object.keys(t.statuses).map((s) => <SelectItem key={s} value={s}>{t.statuses[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allTypes}</SelectItem>
                {Object.keys(t.types).map((s) => <SelectItem key={s} value={s}>{t.types[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allAssigned}</SelectItem>
                <SelectItem value="me">{lang === "es" ? "Asignadas a mí" : "Assigned to me"}</SelectItem>
                {team.map((person) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <NewInspectionDialog
              t={t} templates={templates.filter((row) => row.status === "published")} team={team}
              busy={busy}
              onCreate={async (body: any) => {
                const result = await act(body, false);
                if (result?.inspectionId) setSelectedId(result.inspectionId);
                return result;
              }}
            />
          </div>

          {shop && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
              <div>
                <p className="font-bold">{t.shopClosingTitle}</p>
                <p className="text-sm text-slate-500">
                  {!shop.templateId ? t.shopClosingNone
                    : shop.todayRecord
                      ? `${shop.todayRecord.folio} · ${t.statuses[shop.todayRecord.status]}${shop.todayRecord.status === "completed" ? ` — ${t.shopDone.toLowerCase()}` : ""}`
                      : shop.templateName}
                </p>
              </div>
              {shop.templateId && !shop.todayRecord && (
                <Button disabled={busy} onClick={async () => {
                  const result = await act({ action: "create_inspection", templateId: shop.templateId }, false);
                  if (result?.inspectionId) setSelectedId(result.inspectionId);
                }}><PlayCircle />{t.shopStart}</Button>
              )}
              {shop.todayRecord && (
                <Button variant="outline" onClick={() => setSelectedId(shop.todayRecord.id)}>{t.shopOpen}</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {inspections.length === 0 ? (
        <Card className="rounded-3xl border-dashed bg-white/60"><CardContent className="p-10 text-center text-slate-500">{t.empty}</CardContent></Card>
      ) : inspections.map((row) => (
        <Card key={row.id} className="overflow-hidden rounded-3xl border-0 shadow-sm">
          <div className={`h-1.5 ${row.overdue ? "bg-red-600" : statusClass(row.status)}`} />
          <CardContent className="p-5">
            <button type="button" className="block w-full text-left" onClick={() => setSelectedId(row.id)}>
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge variant="outline">{row.folio}</Badge>
                <Badge className="bg-slate-100 text-slate-700">{t.types[row.templateType] || row.templateType}</Badge>
                <Badge className={statusClass(row.status)}>{t.statuses[row.status] || row.status}</Badge>
                {row.overdue && <Badge className="bg-red-600">{t.overdueBadge}</Badge>}
                {row.templateName && <Badge variant="outline">{row.templateName}</Badge>}
              </div>
              <h3 className="text-lg font-extrabold">{row.title}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {[row.location, row.scheduledDate ? `${t.scheduledDate}: ${row.scheduledDate}` : null,
                  row.assignedName ? `${t.assignedTo}: ${row.assignedName}` : null].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                {row.totalItems != null && `${row.answered ?? 0}/${row.totalItems} ${t.answeredOf}`}
                {row.findings ? ` · ${row.findings} ${t.findings}` : ""}
                {row.openActions ? ` · ${row.openActions} ${t.openActions}` : ""}
              </p>
            </button>
          </CardContent>
        </Card>
      ))}

      <TemplatesSection
        t={t} templates={templates} isAdmin={isAdmin} busy={busy}
        act={act}
      />

      {message && (
        <button aria-live="polite" onClick={() => setMessage("")} className="fixed bottom-24 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl lg:bottom-8">
          {message}
        </button>
      )}
    </div>
  );
}

function NewInspectionDialog({ t, templates, team, busy, onCreate }: any) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("template");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [freeItems, setFreeItems] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [building, setBuilding] = useState("");
  const [unit, setUnit] = useState("");
  const [area, setArea] = useState("");
  const [equipment, setEquipment] = useState("");

  async function submit() {
    const body: any = {
      action: "create_inspection",
      title: title || undefined,
      scheduledDate: scheduledDate || undefined,
      assignedMemberId: assignedTo ? Number(assignedTo) : undefined,
      building: building || undefined, unit: unit || undefined,
      area: area || undefined, equipment: equipment || undefined,
    };
    if (mode === "template") {
      if (!templateId) return;
      body.templateId = Number(templateId);
    } else {
      body.items = freeItems.split("\n").map((line: string) => line.trim()).filter(Boolean)
        .map((prompt: string) => ({ prompt, responseType: "status", allowsPhoto: true, required: true }));
      if (!body.items.length) return;
    }
    const result = await onCreate(body);
    if (result?.inspectionId) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="bg-[#caa75d] text-[#143449] hover:bg-[#bb984e]"><Plus />{t.newInspection}</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{t.createTitle}</DialogTitle><DialogDescription>{t.subtitle}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="template">{t.fromTemplate}</SelectItem>
              <SelectItem value="free">{t.freeInspection}</SelectItem>
            </SelectContent>
          </Select>
          {mode === "template" ? (
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t.template} /></SelectTrigger>
              <SelectContent>
                {templates.map((row: Template) => (
                  <SelectItem key={row.id} value={String(row.id)}>
                    {row.name} ({t.types[row.templateType]}){row.areaLabel ? ` — ${row.areaLabel}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Textarea placeholder={t.freeItemsHint} value={freeItems} onChange={(e) => setFreeItems(e.target.value)} rows={6} />
          )}
          <Input placeholder={t.titleField} value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t.assignedTo} /></SelectTrigger>
              <SelectContent>{team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder={t.building} value={building} onChange={(e) => setBuilding(e.target.value)} />
            <Input placeholder={t.unit} value={unit} onChange={(e) => setUnit(e.target.value)} />
            <Input placeholder={t.area} value={area} onChange={(e) => setArea(e.target.value)} />
            <Input placeholder={t.equipment} value={equipment} onChange={(e) => setEquipment(e.target.value)} />
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy || (mode === "template" && !templateId)}>{t.create}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesSection({ t, templates, isAdmin, busy, act }: any) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  function openEditor(template?: Template) {
    setEditing(template ? {
      id: template.id, name: template.name, templateType: template.templateType,
      areaLabel: template.areaLabel || "", description: template.description || "",
      frequencyType: template.frequencyType, frequencyNote: template.frequencyNote || "",
      items: template.items.map((item) => ({ ...item })),
    } : {
      id: null, name: "", templateType: "inspection", areaLabel: "", description: "",
      frequencyType: "none", frequencyNote: "",
      items: [{ prompt: "", responseType: "status", allowsPhoto: false, required: true }],
    });
    setEditorOpen(true);
  }

  async function saveEditor() {
    const items = (editing.items as any[])
      .filter((item) => String(item.prompt || "").trim())
      .map((item, index) => ({
        prompt: item.prompt, responseType: item.responseType,
        allowsPhoto: !!item.allowsPhoto, required: item.required !== false, position: index + 1,
      }));
    if (!editing.name.trim() || !items.length) return;
    const body: any = {
      action: editing.id ? "update_template" : "create_template",
      id: editing.id || undefined,
      name: editing.name, templateType: editing.templateType,
      areaLabel: editing.areaLabel || undefined, description: editing.description || undefined,
      frequencyType: editing.frequencyType, frequencyNote: editing.frequencyNote || undefined,
      items,
    };
    const result = await act(body, false);
    if (result) setEditorOpen(false);
  }

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Wrench className="size-5 text-[#007a9f]" />{t.templatesTitle}</CardTitle>
        {isAdmin && <Button onClick={() => openEditor()}><Plus />{t.newTemplate}</Button>}
      </CardHeader>
      <CardContent className="space-y-3">
        {isAdmin && <p className="text-sm text-slate-500">{t.templatesAdminHint}</p>}
        <p className="text-sm text-slate-500">{t.frequencyDisclaimer}</p>
        {templates.length === 0 && <p className="text-slate-500">{t.empty}</p>}
        {templates.map((template: Template) => (
          <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
            <div className="min-w-0">
              <p className="font-bold">{template.name}</p>
              <p className="text-sm text-slate-500">
                {[t.types[template.templateType], template.areaLabel,
                  `${t.frequency}: ${t.frequencies[template.frequencyType] || template.frequencyType}`,
                  template.frequencyNote, `${template.items.length} ${t.items.toLowerCase()}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={template.status === "published" ? "bg-emerald-600" : template.status === "archived" ? "bg-slate-400" : "bg-amber-500"}>
                {t.templateStatuses[template.status]}
              </Badge>
              {isAdmin && (
                <>
                  <Button variant="outline" size="sm" onClick={() => openEditor(template)}>{t.editTemplate}</Button>
                  {template.status !== "published" && (
                    <Button size="sm" disabled={busy} onClick={() => act({ action: "set_template_status", id: template.id, status: "published" }, false)}>{t.publish}</Button>
                  )}
                  {template.status === "published" && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => act({ action: "set_template_status", id: template.id, status: "draft" }, false)}>{t.toDraft}</Button>
                  )}
                  {template.status !== "archived" && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => act({ action: "set_template_status", id: template.id, status: "archived" }, false)}>{t.archive}</Button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? t.editTemplate : t.newTemplate}</DialogTitle>
            <DialogDescription>{t.frequencyDisclaimer}</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <Input placeholder={t.templateName} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <Select value={editing.templateType} onValueChange={(v) => setEditing({ ...editing, templateType: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.keys(t.types).map((s) => <SelectItem key={s} value={s}>{t.types[s]}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder={t.areaLabel} value={editing.areaLabel} onChange={(e) => setEditing({ ...editing, areaLabel: e.target.value })} />
              </div>
              <Textarea placeholder={t.templateDescription} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} />
              <div className="grid grid-cols-2 gap-3">
                <Select value={editing.frequencyType} onValueChange={(v) => setEditing({ ...editing, frequencyType: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder={t.frequency} /></SelectTrigger>
                  <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{t.frequencies[f]}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder={t.frequencyNote} value={editing.frequencyNote} onChange={(e) => setEditing({ ...editing, frequencyNote: e.target.value })} />
              </div>
              <p className="font-bold">{t.items}</p>
              {(editing.items as any[]).map((item, index) => (
                <div key={index} className="grid gap-2 rounded-2xl bg-slate-50 p-3">
                  <Input placeholder={`${index + 1}. ${t.itemPrompt}`} value={item.prompt}
                    onChange={(e) => { const items = [...editing.items]; items[index] = { ...item, prompt: e.target.value }; setEditing({ ...editing, items }); }} />
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={item.responseType} onValueChange={(v) => { const items = [...editing.items]; items[index] = { ...item, responseType: v }; setEditing({ ...editing, items }); }}>
                      <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.keys(t.responseTypes).map((s) => <SelectItem key={s} value={s}>{t.responseTypes[s]}</SelectItem>)}</SelectContent>
                    </Select>
                    <label className="flex items-center gap-1 text-sm font-semibold">
                      <input type="checkbox" checked={!!item.allowsPhoto}
                        onChange={(e) => { const items = [...editing.items]; items[index] = { ...item, allowsPhoto: e.target.checked }; setEditing({ ...editing, items }); }} />
                      {t.allowsPhoto}
                    </label>
                    <label className="flex items-center gap-1 text-sm font-semibold">
                      <input type="checkbox" checked={item.required !== false}
                        onChange={(e) => { const items = [...editing.items]; items[index] = { ...item, required: e.target.checked }; setEditing({ ...editing, items }); }} />
                      {t.requiredItem}
                    </label>
                    <Button variant="outline" size="sm" onClick={() => setEditing({ ...editing, items: editing.items.filter((_: any, i: number) => i !== index) })}>
                      {t.removeItem}
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" onClick={() => setEditing({ ...editing, items: [...editing.items, { prompt: "", responseType: "status", allowsPhoto: false, required: true }] })}>
                <Plus />{t.addItem}
              </Button>
            </div>
          )}
          <DialogFooter><Button onClick={saveEditor} disabled={busy || !editing?.name?.trim()}>{t.save}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function InspectionDetail({ t, lang, detail, team, busy, act, setMessage, onBack, reloadDetail }: any) {
  const inspection: Inspection = detail.inspection;
  const results: Result[] = detail.results || [];
  const correctives: Corrective[] = detail.correctiveActions || [];
  const history: HistoryEntry[] = detail.history || [];
  const generalAttachments: Attachment[] = detail.attachments || [];
  const actionAttachments: Attachment[] = detail.actionAttachments || [];
  const linkOptions = detail.linkOptions || { workOrders: [], logEvents: [] };
  const completed = inspection.status === "completed";
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});
  const [generalNotes, setGeneralNotes] = useState(inspection.generalNotes || "");
  const [signature, setSignature] = useState(inspection.signatureName || "");
  const [correctiveFor, setCorrectiveFor] = useState<Result | null>(null);
  const [corrForm, setCorrForm] = useState<any>({ description: "", responsible: "", dueDate: "", workOrderId: "", logEventId: "" });

  async function upload(inspectionId: number, file: File, extra: Record<string, string>) {
    const form = new FormData();
    form.append("action", "upload_attachment");
    form.append("inspectionId", String(inspectionId));
    Object.entries(extra).forEach(([key, value]) => form.append(key, value));
    form.append("file", file);
    try { await uploadFile(form); await reloadDetail(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function createCorrective() {
    if (!correctiveFor || !corrForm.description.trim()) return;
    const result = await act({
      action: "create_corrective_action", inspectionId: inspection.id, resultId: correctiveFor.id,
      description: corrForm.description,
      responsibleMemberId: corrForm.responsible ? Number(corrForm.responsible) : undefined,
      dueDate: corrForm.dueDate || undefined,
      workOrderId: corrForm.workOrderId ? Number(corrForm.workOrderId) : undefined,
      logEventId: corrForm.logEventId ? Number(corrForm.logEventId) : undefined,
    });
    if (result) { setCorrectiveFor(null); setCorrForm({ description: "", responsible: "", dueDate: "", workOrderId: "", logEventId: "" }); }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}><ArrowLeft />{t.back}</Button>
      <Card className="overflow-hidden rounded-3xl border-0 shadow-sm">
        <div className={`h-1.5 ${inspection.overdue ? "bg-red-600" : statusClass(inspection.status)}`} />
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{inspection.folio}</Badge>
            <Badge className="bg-slate-100 text-slate-700">{t.types[inspection.templateType] || inspection.templateType}</Badge>
            <Badge className={statusClass(inspection.status)}>{t.statuses[inspection.status] || inspection.status}</Badge>
            {inspection.overdue && <Badge className="bg-red-600">{t.overdueBadge}</Badge>}
            {inspection.templateName && <Badge variant="outline">{t.template}: {inspection.templateName}</Badge>}
            {inspection.frequencyType && inspection.frequencyType !== "none" && (
              <Badge variant="outline">{t.frequency}: {t.frequencies[inspection.frequencyType] || inspection.frequencyType}{inspection.frequencyNote ? ` — ${inspection.frequencyNote}` : ""}</Badge>
            )}
          </div>
          <h2 className="text-xl font-extrabold">{inspection.title}</h2>
          <p className="text-sm text-slate-500">
            {[inspection.location, `${t.createdBy}: ${inspection.createdByName || "—"}`,
              inspection.startedAt ? `${t.startedAt}: ${fmtDateTime(inspection.startedAt, lang)}` : null].filter(Boolean).join(" · ")}
          </p>
          {completed && (
            <p className="text-sm font-semibold text-emerald-700">
              {t.completedBy}: {inspection.completedByName || "—"} · {fmtDateTime(inspection.completedAt, lang)}
              {inspection.signatureName ? ` · ${t.signedBy}: ${inspection.signatureName}` : ""}
            </p>
          )}

          {!completed && (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={inspection.assignedMemberId ? String(inspection.assignedMemberId) : "none"}
                onValueChange={(v) => act({ action: "assign_inspection", id: inspection.id, assignedMemberId: v === "none" ? null : Number(v) })}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder={t.assignedTo} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.unassigned}</SelectItem>
                  {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" className="w-[170px]" defaultValue={inspection.scheduledDate || ""}
                onBlur={(e) => { if (e.target.value && e.target.value !== inspection.scheduledDate) act({ action: "set_schedule", id: inspection.id, scheduledDate: e.target.value }); }} />
              {inspection.status === "scheduled" && (
                <Button disabled={busy} onClick={() => act({ action: "start_inspection", id: inspection.id })}><PlayCircle />{t.start}</Button>
              )}
              {inspection.templateType === "shop_closing" && (
                <Input className="w-56" placeholder={t.signatureName} value={signature} onChange={(e) => setSignature(e.target.value)} />
              )}
              <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={busy}
                onClick={() => act({ action: "complete_inspection", id: inspection.id, signatureName: signature || undefined })}>
                <ShieldCheck />{t.complete}
              </Button>
            </div>
          )}
          {completed && (
            <Button variant="outline" disabled={busy} onClick={() => act({ action: "reopen_inspection", id: inspection.id })}>{t.reopen}</Button>
          )}
          <p className="text-xs text-slate-400">{t.completeHint}</p>

          <div>
            <p className="mb-1 font-bold">{t.generalNotes}</p>
            <Textarea value={generalNotes} onChange={(e) => setGeneralNotes(e.target.value)} rows={2} disabled={completed} />
            {!completed && (
              <Button variant="outline" size="sm" className="mt-2" disabled={busy}
                onClick={() => act({ action: "update_inspection", id: inspection.id, generalNotes })}>{t.saveNote}</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {results.map((result: Result) => {
        const isFinding = !!result.status && FINDING_STATUSES.includes(result.status);
        const noteDraft = notesDraft[result.id] ?? result.note ?? "";
        return (
          <Card key={result.id} className="rounded-3xl border-0 shadow-sm">
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-block size-3 rounded-full ${resultClass(result.status)}`} />
                <p className="font-bold">{result.position}. {result.prompt}</p>
                {result.required && <Badge variant="outline">{t.requiredItem}</Badge>}
                {isFinding && <Badge className="bg-amber-500">{t.finding}</Badge>}
              </div>
              {result.answeredByName && (
                <p className="text-xs text-slate-400">{result.answeredByName} · {fmtDateTime(result.answeredAt, lang)}</p>
              )}
              {!completed && (
                <div className="flex flex-wrap items-center gap-2">
                  {result.responseType === "yes_no" && (
                    <>
                      <Button size="sm" variant={result.answer === "yes" ? "default" : "outline"}
                        onClick={() => act({ action: "record_result", inspectionId: inspection.id, resultId: result.id, answer: "yes" })}>{t.answers.yes}</Button>
                      <Button size="sm" variant={result.answer === "no" ? "destructive" : "outline"}
                        onClick={() => act({ action: "record_result", inspectionId: inspection.id, resultId: result.id, answer: "no" })}>{t.answers.no}</Button>
                    </>
                  )}
                  <Select value={result.status || "unanswered"}
                    onValueChange={(v) => act({ action: "record_result", inspectionId: inspection.id, resultId: result.id, status: v === "unanswered" ? null : v })}>
                    <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unanswered">{t.unanswered}</SelectItem>
                      {RESULT_STATUSES.map((s) => <SelectItem key={s} value={s}>{t.resultStatuses[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {completed && (
                <p className="text-sm font-semibold text-slate-600">
                  {result.answer ? `${t.answers[result.answer] || result.answer} · ` : ""}{result.status ? t.resultStatuses[result.status] : t.unanswered}
                </p>
              )}
              <div className="flex gap-2">
                <Input placeholder={t.itemNote} value={noteDraft} disabled={completed}
                  onChange={(e) => setNotesDraft({ ...notesDraft, [result.id]: e.target.value })} />
                {!completed && (
                  <Button variant="outline" size="sm" disabled={busy}
                    onClick={() => act({ action: "record_result", inspectionId: inspection.id, resultId: result.id, note: noteDraft })}>{t.saveNote}</Button>
                )}
              </div>
              {(result.attachments.length > 0 || (result.allowsPhoto && !completed)) && (
                <div className="flex flex-wrap items-center gap-2">
                  <Paperclip className="size-4 text-slate-400" />
                  {result.attachments.map((file) => (
                    <a key={file.id} href={`/api/inspections/download?attachmentId=${file.id}`}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      <Download className="size-3" />{file.fileName}
                    </a>
                  ))}
                  {result.allowsPhoto && !completed && (
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[#007a9f] px-3 py-1 text-xs font-semibold text-white">
                      <Upload className="size-3" />{t.attach}
                      <input type="file" className="hidden" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(inspection.id, file, { resultId: String(result.id) });
                        e.target.value = "";
                      }} />
                    </label>
                  )}
                </div>
              )}
              {isFinding && (
                <Button variant="outline" size="sm" onClick={() => { setCorrectiveFor(result); setCorrForm({ description: "", responsible: "", dueDate: "", workOrderId: "", logEventId: "" }); }}>
                  <Wrench />{t.newCorrective}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="size-5 text-[#007a9f]" />{t.correctiveTitle}</CardTitle>
          <p className="text-sm text-slate-500">{t.correctiveHint}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {correctives.length === 0 && <p className="text-slate-500">—</p>}
          {correctives.map((action: Corrective) => {
            const files = actionAttachments.filter((file) => file.correctiveActionId === action.id);
            return (
              <div key={action.id} className="space-y-2 rounded-2xl bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={action.status === "verified" ? "bg-emerald-600" : action.status === "completed" ? "bg-sky-600" : "bg-amber-500"}>
                    {t.correctiveStatuses[action.status]}
                  </Badge>
                  {action.overdue && <Badge className="bg-red-600">{t.overdueBadge}</Badge>}
                  {action.resultPrompt && <span className="text-sm text-slate-500">{action.resultPrompt}</span>}
                </div>
                <p className="font-bold">{action.description}</p>
                <p className="text-sm text-slate-500">
                  {[action.workOrderLabel ? `${t.linkWo}: ${action.workOrderLabel}` : null,
                    action.logEventFolio ? `${t.linkEvent}: ${action.logEventFolio}` : null,
                    action.completedAt ? `${t.correctiveStatuses.completed}: ${action.completedByName || ""} · ${fmtDateTime(action.completedAt, lang)}` : null,
                    action.verifiedAt ? `${t.verified}: ${action.verifiedByName || ""} · ${fmtDateTime(action.verifiedAt, lang)}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                {action.status !== "verified" && action.status !== "completed" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={action.responsibleMemberId ? String(action.responsibleMemberId) : "none"}
                      onValueChange={(v) => act({ action: "update_corrective_action", id: action.id, responsibleMemberId: v === "none" ? null : Number(v) })}>
                      <SelectTrigger className="w-[190px]"><SelectValue placeholder={t.responsible} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t.unassigned}</SelectItem>
                        {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input type="date" className="w-[160px]" defaultValue={action.dueDate || ""}
                      onBlur={(e) => { if (e.target.value !== (action.dueDate || "")) act({ action: "update_corrective_action", id: action.id, dueDate: e.target.value || null }); }} />
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy}
                      onClick={() => act({ action: "complete_corrective_action", id: action.id })}>{t.completeAction}</Button>
                  </div>
                )}
                {action.status === "completed" && !action.verifiedAt && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy}
                    onClick={() => act({ action: "verify_corrective_action", id: action.id })}><ShieldCheck />{t.verifyAction}</Button>
                )}
                {action.status !== "verified" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select defaultValue={action.workOrderId ? String(action.workOrderId) : "none"}
                      onValueChange={(v) => act({ action: "link_corrective_action", id: action.id, workOrderId: v === "none" ? null : Number(v) })}>
                      <SelectTrigger className="w-[240px]"><SelectValue placeholder={t.linkWo} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t.noLink} — {t.linkWo}</SelectItem>
                        {linkOptions.workOrders.map((row: LinkOption) => <SelectItem key={row.id} value={String(row.id)}>{row.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select defaultValue={action.logEventId ? String(action.logEventId) : "none"}
                      onValueChange={(v) => act({ action: "link_corrective_action", id: action.id, logEventId: v === "none" ? null : Number(v) })}>
                      <SelectTrigger className="w-[240px]"><SelectValue placeholder={t.linkEvent} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t.noLink} — {t.linkEvent}</SelectItem>
                        {linkOptions.logEvents.map((row: LinkOption) => <SelectItem key={row.id} value={String(row.id)}>{row.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {files.map((file) => (
                    <a key={file.id} href={`/api/inspections/download?attachmentId=${file.id}`}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                      <Download className="size-3" />{file.fileName}
                    </a>
                  ))}
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                    <Upload className="size-3" />{t.attach}
                    <input type="file" className="hidden" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(inspection.id, file, { correctiveActionId: String(action.id) });
                      e.target.value = "";
                    }} />
                  </label>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><Paperclip className="size-5 text-[#007a9f]" />{t.photos}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {generalAttachments.map((file) => (
            <a key={file.id} href={`/api/inspections/download?attachmentId=${file.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              <Download className="size-3" />{file.fileName}
            </a>
          ))}
          {!completed && (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[#007a9f] px-3 py-1 text-xs font-semibold text-white">
              <Upload className="size-3" />{t.attach}
              <input type="file" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(inspection.id, file, {});
                e.target.value = "";
              }} />
            </label>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-5 text-[#007a9f]" />{t.historyTitle}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {history.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2 text-sm">
              <span><strong>{t.historyActions[entry.action] || entry.action}</strong> · {entry.actorName || entry.actorEmail}</span>
              <span className="text-slate-400">{fmtDateTime(entry.createdAt, lang)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!correctiveFor} onOpenChange={(open) => { if (!open) setCorrectiveFor(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.newCorrective}</DialogTitle>
            <DialogDescription>{correctiveFor?.prompt}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Textarea placeholder={t.correctiveDescription} value={corrForm.description}
              onChange={(e) => setCorrForm({ ...corrForm, description: e.target.value })} rows={3} />
            <div className="grid grid-cols-2 gap-3">
              <Select value={corrForm.responsible} onValueChange={(v) => setCorrForm({ ...corrForm, responsible: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t.responsible} /></SelectTrigger>
                <SelectContent>{team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="date" value={corrForm.dueDate} onChange={(e) => setCorrForm({ ...corrForm, dueDate: e.target.value })} />
            </div>
            <Select value={corrForm.workOrderId} onValueChange={(v) => setCorrForm({ ...corrForm, workOrderId: v === "none" ? "" : v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t.linkWo} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.noLink}</SelectItem>
                {linkOptions.workOrders.map((row: LinkOption) => <SelectItem key={row.id} value={String(row.id)}>{row.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={corrForm.logEventId} onValueChange={(v) => setCorrForm({ ...corrForm, logEventId: v === "none" ? "" : v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t.linkEvent} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.noLink}</SelectItem>
                {linkOptions.logEvents.map((row: LinkOption) => <SelectItem key={row.id} value={String(row.id)}>{row.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter><Button onClick={createCorrective} disabled={busy || !corrForm.description.trim()}>{t.addCorrective}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
