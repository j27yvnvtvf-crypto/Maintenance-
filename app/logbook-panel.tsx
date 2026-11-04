"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Bell, CalendarClock, Download,
  Flag, History, Link2, MessageSquare, NotebookPen, Paperclip, Pencil,
  Plus, Search, Upload, UserCheck,
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

type LogEvent = {
  id: number; folio: string; eventType: string; occurredAt: string;
  registeredAt: string; updatedAt: string;
  reportedByMemberId: number | null; reportedByName: string | null;
  building: string | null; unit: string | null; area: string | null;
  equipment: string | null; location: string; description: string;
  findings: string | null; actionsTaken: string | null;
  responsibleMemberId: number | null; responsibleName: string | null;
  priority: string; followUpDate: string | null; status: string;
  finalResult: string | null;
  verifiedByMemberId: number | null; verifiedByName: string | null; verifiedAt: string | null;
  officialWoRef: string | null;
  closedByMemberId: number | null; closedByName: string | null; closedAt: string | null;
  overdue: boolean; commentCount: number | null; attachmentCount: number | null;
};

type ChainEvent = LogEvent & { relation: string | null; isSelf: boolean };
type LogComment = { id: number; body: string; authorMemberId: number | null; authorName: string | null; createdAt: string };
type LogAttachment = { id: number; fileName: string; contentType: string | null; fileSize: number | null; uploadedByName: string | null; createdAt: string };
type HistoryEntry = { id: number; action: string; detail: Record<string, any>; actorName: string | null; actorEmail: string; createdAt: string };
type LogNotification = { id: number; type: string; eventId: number | null; eventFolio: string | null; actorName: string | null; readAt: string | null; createdAt: string };
type TeamLite = { id: number; name: string };

const copy = {
  en: {
    title: "Property logbook",
    subtitle: "Leaks, failures, vendor visits, inspections and repairs — every case with its evidence and history.",
    search: "Search folio, building, unit, area, equipment…",
    allStatuses: "All statuses", allPriorities: "All priorities", allTypes: "All types", allResponsible: "All responsible",
    empty: "No logbook events match. Register the first one with the button above.",
    newEvent: "New event",
    createTitle: "Register an event",
    createHint: "The essentials first; details can be added as the case moves.",
    moreDetails: "More details (findings, actions, follow-up…)",
    occurredAt: "Date & time of the event", registeredAt: "Registered",
    reportedBy: "Reported by", responsible: "Responsible",
    building: "Building", unit: "Apartment / unit", area: "Area", equipment: "Equipment",
    description: "Description", findings: "Findings", actionsTaken: "Actions taken",
    priority: "Priority", followUp: "Follow-up date", status: "Status",
    officialWo: "Official WO reference", finalResult: "Final result",
    verifiedBy: "Verified by", closedBy: "Closed by",
    create: "Register event", save: "Save", cancel: "Cancel",
    linkToExisting: "Link to an existing case (optional)", noLink: "No link",
    relation: "Relationship",
    types: {
      leak: "Leak", equipment_failure: "Equipment failure", emergency_call: "Emergency call",
      damage: "Damage", vendor_visit: "Vendor visit", inspection: "Inspection",
      repair: "Repair", other: "Other",
    } as Record<string, string>,
    statuses: { open: "Open", in_progress: "In progress", pending: "Pending", closed: "Closed" } as Record<string, string>,
    priorities: { low: "Low", medium: "Medium", high: "High", emergency: "Emergency" } as Record<string, string>,
    relations: {
      related: "Related", inspection: "Inspection", vendor_visit: "Vendor visit",
      report: "Report", repair: "Repair", verification: "Verification", follow_up: "Follow-up",
    } as Record<string, string>,
    back: "Back to the logbook",
    caseChain: "Case timeline",
    comments: "Comments", addComment: "Add a comment…", comment: "Comment",
    attachments: "Photos & files", attach: "Attach",
    download: "Download",
    historyTitle: "Full history",
    historyActions: {
      created: "Event registered", details_updated: "Details updated", status_changed: "Status changed",
      assigned: "Responsible changed", priority_changed: "Priority changed", follow_up_changed: "Follow-up changed",
      closed: "Event closed", reopened: "Event reopened", verified: "Verified",
      comment_added: "Comment added", attachment_added: "File attached", linked: "Case linked",
    } as Record<string, string>,
    closeEvent: "Close event", closeHint: "Closing keeps the record, evidence and history. A final result is required.",
    reopen: "Reopen", verify: "Mark as verified", verified: "Verified",
    editDetails: "Edit details",
    assignTo: "Assign to", unassigned: "Unassigned",
    linkEvent: "Link to another event", link: "Link",
    notifications: "Notifications", markRead: "Mark all as read",
    overdueTitle: "Overdue follow-ups (yours)",
    notifAssigned: "assigned you an event", notifComment: "commented on an event",
    overdueBadge: "Follow-up overdue",
    todayTitle: "Logbook — needs attention",
    openEvents: "open events",
    viewLogbook: "Open the logbook",
    noAttention: "No overdue follow-ups. ",
    commentsCount: "comments", filesCount: "files",
  },
  es: {
    title: "Bitácora de la propiedad",
    subtitle: "Fugas, fallas, visitas de vendors, inspecciones y reparaciones — cada caso con su evidencia e historial.",
    search: "Buscar folio, edificio, apartamento, área, equipo…",
    allStatuses: "Todos los estados", allPriorities: "Todas las prioridades", allTypes: "Todos los tipos", allResponsible: "Todos los responsables",
    empty: "Ningún evento coincide. Registra el primero con el botón de arriba.",
    newEvent: "Nuevo evento",
    createTitle: "Registrar un evento",
    createHint: "Primero lo esencial; los detalles se agregan según avanza el caso.",
    moreDetails: "Más detalles (hallazgos, acciones, seguimiento…)",
    occurredAt: "Fecha y hora del evento", registeredAt: "Registrado",
    reportedBy: "Reportado por", responsible: "Responsable",
    building: "Edificio", unit: "Apartamento / unidad", area: "Área", equipment: "Equipo",
    description: "Descripción", findings: "Hallazgos", actionsTaken: "Acciones realizadas",
    priority: "Prioridad", followUp: "Fecha de seguimiento", status: "Estado",
    officialWo: "Referencia de la WO oficial", finalResult: "Resultado final",
    verifiedBy: "Verificado por", closedBy: "Cerrado por",
    create: "Registrar evento", save: "Guardar", cancel: "Cancelar",
    linkToExisting: "Vincular a un caso existente (opcional)", noLink: "Sin vínculo",
    relation: "Relación",
    types: {
      leak: "Fuga", equipment_failure: "Falla de equipo", emergency_call: "Llamada de emergencia",
      damage: "Daño", vendor_visit: "Visita de vendor", inspection: "Inspección",
      repair: "Reparación", other: "Otro",
    } as Record<string, string>,
    statuses: { open: "Abierto", in_progress: "En proceso", pending: "Pendiente", closed: "Cerrado" } as Record<string, string>,
    priorities: { low: "Baja", medium: "Media", high: "Alta", emergency: "Emergencia" } as Record<string, string>,
    relations: {
      related: "Relacionado", inspection: "Inspección", vendor_visit: "Visita de vendor",
      report: "Informe", repair: "Reparación", verification: "Verificación", follow_up: "Seguimiento",
    } as Record<string, string>,
    back: "Volver a la bitácora",
    caseChain: "Línea de tiempo del caso",
    comments: "Comentarios", addComment: "Agregar un comentario…", comment: "Comentar",
    attachments: "Fotos y archivos", attach: "Adjuntar",
    download: "Descargar",
    historyTitle: "Historial completo",
    historyActions: {
      created: "Evento registrado", details_updated: "Detalles actualizados", status_changed: "Estado cambiado",
      assigned: "Responsable cambiado", priority_changed: "Prioridad cambiada", follow_up_changed: "Seguimiento cambiado",
      closed: "Evento cerrado", reopened: "Evento reabierto", verified: "Verificado",
      comment_added: "Comentario agregado", attachment_added: "Archivo adjunto", linked: "Caso vinculado",
    } as Record<string, string>,
    closeEvent: "Cerrar evento", closeHint: "Cerrar conserva el registro, la evidencia y el historial. Se requiere el resultado final.",
    reopen: "Reabrir", verify: "Marcar verificado", verified: "Verificado",
    editDetails: "Editar detalles",
    assignTo: "Asignar a", unassigned: "Sin asignar",
    linkEvent: "Vincular a otro evento", link: "Vincular",
    notifications: "Notificaciones", markRead: "Marcar todo como leído",
    overdueTitle: "Seguimientos vencidos (tuyos)",
    notifAssigned: "te asignó un evento", notifComment: "comentó en un evento",
    overdueBadge: "Seguimiento vencido",
    todayTitle: "Bitácora — requiere atención",
    openEvents: "eventos abiertos",
    viewLogbook: "Abrir la bitácora",
    noAttention: "Sin seguimientos vencidos. ",
    commentsCount: "comentarios", filesCount: "archivos",
  },
};

const EVENT_TYPES = ["leak", "equipment_failure", "emergency_call", "damage", "vendor_visit", "inspection", "repair", "other"];
const EVENT_STATUSES = ["open", "in_progress", "pending", "closed"];
const PRIORITIES = ["low", "medium", "high", "emergency"];
const RELATIONS = ["related", "inspection", "vendor_visit", "report", "repair", "verification", "follow_up"];

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function fmtDateTime(value: string | null | undefined, lang: Language) {
  if (!value) return "—";
  return new Date(value).toLocaleString(lang === "es" ? "es-US" : "en-US", {
    dateStyle: "medium", timeStyle: "short",
  });
}

function priorityClass(priority: string) {
  return priority === "emergency" ? "bg-red-600" : priority === "high" ? "bg-orange-500" : priority === "medium" ? "bg-sky-600" : "bg-slate-400";
}

function localNowInput() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

/** Attention card for the Hoy / Overview tab (light integration). */
export function LogbookTodayCard({ lang, onOpen }: { lang: Language; onOpen: () => void }) {
  const t = copy[lang];
  const [summary, setSummary] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/api/logbook?summary=1");
        if (!cancelled) setSummary(data);
      } catch { /* the card simply stays hidden if the logbook cannot load */ }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!summary) return null;
  return (
    <Card className="mt-4 rounded-3xl border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <NotebookPen className="size-5 text-[#007a9f]" />{t.todayTitle}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onOpen}>{t.viewLogbook}</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-slate-100 text-slate-700">{summary.openTotal} {t.openEvents}</Badge>
          {summary.openByPriority.emergency > 0 && <Badge className="bg-red-600">{t.priorities.emergency}: {summary.openByPriority.emergency}</Badge>}
          {summary.openByPriority.high > 0 && <Badge className="bg-orange-500">{t.priorities.high}: {summary.openByPriority.high}</Badge>}
          <Badge className={summary.overdueTotal > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}>
            <CalendarClock className="mr-1 size-3.5" />{t.overdueTitle}: {summary.overdueTotal}
          </Badge>
        </div>
        {summary.overdue.length > 0 && (
          <div className="mt-3 space-y-2">
            {summary.overdue.map((event: LogEvent) => (
              <button key={event.id} onClick={onOpen} className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-red-50 p-3 text-left text-sm">
                <Badge variant="outline">{event.folio}</Badge>
                <span className="font-bold">{t.types[event.eventType]}</span>
                <span className="text-slate-600">{event.location || event.description}</span>
                <span className="ml-auto font-semibold text-red-700">{t.followUp}: {event.followUpDate}</span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LogbookPanel({ lang, team, meId }: { lang: Language; team: TeamLite[]; meId: number }) {
  const t = copy[lang];
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [notifications, setNotifications] = useState<LogNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [attention, setAttention] = useState<LogEvent[]>([]);
  const [filters, setFilters] = useState({ q: "", status: "all", priority: "all", type: "all", responsible: "all" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    eventType: "leak", occurredAt: localNowInput(), description: "",
    building: "", unit: "", area: "", equipment: "",
    findings: "", actionsTaken: "", priority: "medium", responsibleMemberId: "",
    followUpDate: "", officialWoRef: "", linkToEventId: "", linkRelation: "related",
  });

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.priority !== "all") params.set("priority", filters.priority);
      if (filters.type !== "all") params.set("type", filters.type);
      if (filters.responsible !== "all") params.set("responsible", filters.responsible);
      const data = await api(`/api/logbook?${params.toString()}`);
      setEvents(data.events || []);
      setNotifications(data.notifications || []);
      setUnread(data.unreadNotifications || 0);
      setAttention(data.attention || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load"); }
  }, [filters]);

  const loadDetail = useCallback(async (id: number) => {
    try { setDetail(await api(`/api/logbook?id=${id}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load"); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  async function createEvent() {
    setBusy(true);
    try {
      const result = await api("/api/logbook", {
        action: "create_event",
        eventType: form.eventType,
        occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : undefined,
        description: form.description,
        building: form.building, unit: form.unit, area: form.area, equipment: form.equipment,
        findings: form.findings, actionsTaken: form.actionsTaken,
        priority: form.priority,
        responsibleMemberId: form.responsibleMemberId ? Number(form.responsibleMemberId) : undefined,
        followUpDate: form.followUpDate || undefined,
        officialWoRef: form.officialWoRef,
        linkToEventId: form.linkToEventId && form.linkToEventId !== "none" ? Number(form.linkToEventId) : undefined,
        linkRelation: form.linkRelation,
      });
      setCreateOpen(false);
      setForm({
        eventType: "leak", occurredAt: localNowInput(), description: "",
        building: "", unit: "", area: "", equipment: "",
        findings: "", actionsTaken: "", priority: "medium", responsibleMemberId: "",
        followUpDate: "", officialWoRef: "", linkToEventId: "", linkRelation: "related",
      });
      await load();
      if (result.eventId) setSelectedId(result.eventId);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function markRead() {
    try {
      await api("/api/logbook", { action: "mark_notifications_read" });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  function openEvent(id: number) {
    setDetail(null);
    setSelectedId(id);
  }

  if (selectedId) {
    return (
      <div>
        <Button variant="outline" className="mb-4" onClick={() => { setSelectedId(null); setDetail(null); void load(); }}>
          <ArrowLeft />{t.back}
        </Button>
        {!detail ? (
          <Card className="rounded-3xl border-0 shadow-sm"><CardContent className="p-10 text-center text-slate-500">…</CardContent></Card>
        ) : (
          <EventDetail
            detail={detail} t={t} lang={lang} team={team} meId={meId}
            allEvents={events}
            setMessage={setMessage}
            reload={async () => { await loadDetail(selectedId); await load(); }}
            openEvent={openEvent}
          />
        )}
        {message && <Toast message={message} clear={() => setMessage("")} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(unread > 0 || attention.length > 0) && (
        <Card className="rounded-3xl border border-sky-200 bg-sky-50 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="size-5 text-[#007a9f]" />{t.notifications}
                {unread > 0 && <Badge className="bg-red-600">{unread}</Badge>}
              </CardTitle>
              {unread > 0 && <Button variant="outline" size="sm" onClick={markRead}>{t.markRead}</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.map((event) => (
              <button key={`att-${event.id}`} onClick={() => openEvent(event.id)} className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-white p-3 text-left text-sm">
                <AlertTriangle className="size-4 text-red-600" />
                <Badge variant="outline">{event.folio}</Badge>
                <span className="font-semibold">{t.overdueTitle}</span>
                <span className="text-slate-600">{t.types[event.eventType]}{event.location ? ` · ${event.location}` : ""}</span>
                <span className="ml-auto font-semibold text-red-700">{event.followUpDate}</span>
              </button>
            ))}
            {notifications.slice(0, 8).map((n) => (
              <button key={n.id} onClick={() => n.eventId && openEvent(n.eventId)} className={`flex w-full flex-wrap items-center gap-2 rounded-2xl p-3 text-left text-sm ${n.readAt ? "bg-white/60 text-slate-500" : "bg-white"}`}>
                <Badge variant="outline">{n.eventFolio || "—"}</Badge>
                <span><strong>{n.actorName || ""}</strong> {n.type === "log_assigned" ? t.notifAssigned : t.notifComment}</span>
                <span className="ml-auto text-xs">{fmtDateTime(n.createdAt, lang)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{t.title}</CardTitle>
              <p className="mt-1 text-sm text-slate-500">{t.subtitle}</p>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="h-11 rounded-xl bg-[#caa75d] px-4 text-[#143449] hover:bg-[#bb984e]"><Plus />{t.newEvent}</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>{t.createTitle}</DialogTitle>
                  <DialogDescription>{t.createHint}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Select value={form.eventType} onValueChange={(value) => setForm({ ...form, eventType: value })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{EVENT_TYPES.map((value) => <SelectItem key={value} value={value}>{t.types[value]}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} />
                  </div>
                  <Textarea placeholder={t.description} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder={t.building} value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} />
                    <Input placeholder={t.unit} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                    <Input placeholder={t.area} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
                    <Input placeholder={t.equipment} value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} />
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm font-bold text-[#007a9f]">{t.moreDetails}</summary>
                    <div className="mt-3 grid gap-3">
                      <Textarea placeholder={t.findings} value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} />
                      <Textarea placeholder={t.actionsTaken} value={form.actionsTaken} onChange={(e) => setForm({ ...form, actionsTaken: e.target.value })} />
                      <div className="grid grid-cols-2 gap-3">
                        <Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value })}>
                          <SelectTrigger className="w-full"><SelectValue placeholder={t.priority} /></SelectTrigger>
                          <SelectContent>{PRIORITIES.map((value) => <SelectItem key={value} value={value}>{t.priorities[value]}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={form.responsibleMemberId} onValueChange={(value) => setForm({ ...form, responsibleMemberId: value })}>
                          <SelectTrigger className="w-full"><SelectValue placeholder={t.responsible} /></SelectTrigger>
                          <SelectContent>{team.map((person) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="grid gap-1 text-sm font-semibold text-slate-600">{t.followUp}
                          <Input type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
                        </label>
                        <label className="grid gap-1 text-sm font-semibold text-slate-600">{t.officialWo}
                          <Input value={form.officialWoRef} onChange={(e) => setForm({ ...form, officialWoRef: e.target.value })} />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Select value={form.linkToEventId} onValueChange={(value) => setForm({ ...form, linkToEventId: value })}>
                          <SelectTrigger className="w-full"><SelectValue placeholder={t.linkToExisting} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t.noLink}</SelectItem>
                            {events.map((event) => <SelectItem key={event.id} value={String(event.id)}>{event.folio} — {t.types[event.eventType]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={form.linkRelation} onValueChange={(value) => setForm({ ...form, linkRelation: value })}>
                          <SelectTrigger className="w-full"><SelectValue placeholder={t.relation} /></SelectTrigger>
                          <SelectContent>{RELATIONS.map((value) => <SelectItem key={value} value={value}>{t.relations[value]}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  </details>
                </div>
                <DialogFooter>
                  <Button onClick={createEvent} disabled={busy || !form.description.trim()}>{t.create}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder={t.search} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Select value={filters.status} onValueChange={(value) => setFilters({ ...filters, status: value })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allStatuses}</SelectItem>
                {EVENT_STATUSES.map((value) => <SelectItem key={value} value={value}>{t.statuses[value]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.priority} onValueChange={(value) => setFilters({ ...filters, priority: value })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allPriorities}</SelectItem>
                {PRIORITIES.map((value) => <SelectItem key={value} value={value}>{t.priorities[value]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.type} onValueChange={(value) => setFilters({ ...filters, type: value })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allTypes}</SelectItem>
                {EVENT_TYPES.map((value) => <SelectItem key={value} value={value}>{t.types[value]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.responsible} onValueChange={(value) => setFilters({ ...filters, responsible: value })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allResponsible}</SelectItem>
                {team.map((person) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {events.length === 0 ? (
            <p className="p-6 text-center text-slate-500">{t.empty}</p>
          ) : events.map((event) => (
            <button key={event.id} onClick={() => openEvent(event.id)} className="block w-full text-left">
              <Card className="overflow-hidden rounded-3xl border-0 shadow-sm transition hover:shadow">
                <div className={`h-1.5 ${priorityClass(event.priority)}`} />
                <CardContent className="p-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{event.folio}</Badge>
                    <Badge className="bg-slate-100 text-slate-700">{t.types[event.eventType]}</Badge>
                    <Badge className={priorityClass(event.priority)}>{t.priorities[event.priority]}</Badge>
                    <Badge variant="outline">{t.statuses[event.status]}</Badge>
                    {event.overdue && <Badge className="bg-red-600">{t.overdueBadge}</Badge>}
                    {event.verifiedAt && <Badge className="bg-emerald-600"><UserCheck className="mr-1 size-3" />{t.verified}</Badge>}
                  </div>
                  <p className="font-semibold leading-6">{event.description}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    {event.location || "—"} · {t.responsible}: {event.responsibleName || t.unassigned} · {fmtDateTime(event.occurredAt, lang)}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-3 text-xs font-semibold text-slate-400">
                    <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5" />{event.commentCount ?? 0} {t.commentsCount}</span>
                    <span className="inline-flex items-center gap-1"><Paperclip className="size-3.5" />{event.attachmentCount ?? 0} {t.filesCount}</span>
                    {event.followUpDate && <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{t.followUp}: {event.followUpDate}</span>}
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

function Toast({ message, clear }: { message: string; clear: () => void }) {
  return (
    <button aria-live="polite" onClick={clear} className="fixed bottom-24 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl lg:bottom-8">
      {message}
    </button>
  );
}

function EventDetail({ detail, t, lang, team, allEvents, setMessage, reload, openEvent }: any) {
  const event: LogEvent = detail.event;
  const chain: ChainEvent[] = detail.chain || [];
  const [busy, setBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [finalResult, setFinalResult] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [followUp, setFollowUp] = useState(event.followUpDate || "");
  const [linkTarget, setLinkTarget] = useState("");
  const [linkRelation, setLinkRelation] = useState("related");
  const [editForm, setEditForm] = useState({
    occurredAt: event.occurredAt ? event.occurredAt.slice(0, 16) : "",
    building: event.building || "", unit: event.unit || "", area: event.area || "",
    equipment: event.equipment || "", description: event.description || "",
    findings: event.findings || "", actionsTaken: event.actionsTaken || "",
    officialWoRef: event.officialWoRef || "",
  });

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); await reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const post = (body: Record<string, unknown>) => api("/api/logbook", body);

  async function uploadFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.set("action", "upload_attachment");
        formData.set("eventId", String(event.id));
        formData.set("file", file);
        const res = await fetch("/api/logbook", { method: "POST", body: formData });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || "Upload failed");
      }
      await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const chainIds = new Set(chain.map((item) => item.id));
  const linkCandidates = (allEvents as LogEvent[]).filter((item) => !chainIds.has(item.id));
  const closed = event.status === "closed";

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden rounded-3xl border-0 shadow-sm">
        <div className={`h-1.5 ${priorityClass(event.priority)}`} />
        <CardContent className="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-sm">{event.folio}</Badge>
            <Badge className="bg-slate-100 text-slate-700">{t.types[event.eventType]}</Badge>
            <Badge className={priorityClass(event.priority)}>{t.priorities[event.priority]}</Badge>
            <Badge variant="outline">{t.statuses[event.status]}</Badge>
            {event.overdue && <Badge className="bg-red-600">{t.overdueBadge}</Badge>}
            {event.verifiedAt && <Badge className="bg-emerald-600"><UserCheck className="mr-1 size-3" />{t.verified}</Badge>}
          </div>
          <p className="text-lg font-bold leading-7">{event.description}</p>
          <div className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <p><span className="font-bold text-slate-500">{t.occurredAt}:</span> {fmtDateTime(event.occurredAt, lang)}</p>
            <p><span className="font-bold text-slate-500">{t.registeredAt}:</span> {fmtDateTime(event.registeredAt, lang)}</p>
            <p><span className="font-bold text-slate-500">{t.reportedBy}:</span> {event.reportedByName || "—"}</p>
            <p><span className="font-bold text-slate-500">{t.responsible}:</span> {event.responsibleName || t.unassigned}</p>
            {event.building && <p><span className="font-bold text-slate-500">{t.building}:</span> {event.building}</p>}
            {event.unit && <p><span className="font-bold text-slate-500">{t.unit}:</span> {event.unit}</p>}
            {event.area && <p><span className="font-bold text-slate-500">{t.area}:</span> {event.area}</p>}
            {event.equipment && <p><span className="font-bold text-slate-500">{t.equipment}:</span> {event.equipment}</p>}
            {event.officialWoRef && <p><span className="font-bold text-slate-500">{t.officialWo}:</span> {event.officialWoRef}</p>}
            {event.followUpDate && <p><span className="font-bold text-slate-500">{t.followUp}:</span> {event.followUpDate}</p>}
          </div>
          {event.findings && (
            <div className="mt-4 rounded-2xl bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-500">{t.findings}</p>
              <p className="mt-1 whitespace-pre-wrap leading-6">{event.findings}</p>
            </div>
          )}
          {event.actionsTaken && (
            <div className="mt-3 rounded-2xl bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-500">{t.actionsTaken}</p>
              <p className="mt-1 whitespace-pre-wrap leading-6">{event.actionsTaken}</p>
            </div>
          )}
          {closed && (
            <div className="mt-3 rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm font-bold text-emerald-700">{t.finalResult}</p>
              <p className="mt-1 whitespace-pre-wrap leading-6">{event.finalResult || "—"}</p>
              <p className="mt-2 text-sm text-slate-500">{t.closedBy}: {event.closedByName || "—"} · {fmtDateTime(event.closedAt, lang)}</p>
              {event.verifiedAt && <p className="text-sm text-slate-500">{t.verifiedBy}: {event.verifiedByName || "—"} · {fmtDateTime(event.verifiedAt, lang)}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {!closed ? (
            <>
              <label className="grid gap-1 text-sm font-semibold text-slate-600">{t.status}
                <Select value={event.status} onValueChange={(value) => run(() => post({ action: "set_status", id: event.id, status: value }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{EVENT_STATUSES.filter((s) => s !== "closed").map((value) => <SelectItem key={value} value={value}>{t.statuses[value]}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-600">{t.priority}
                <Select value={event.priority} onValueChange={(value) => run(() => post({ action: "set_priority", id: event.id, priority: value }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((value) => <SelectItem key={value} value={value}>{t.priorities[value]}</SelectItem>)}</SelectContent>
                </Select>
              </label>
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => run(() => post({ action: "reopen_event", id: event.id }))}>{t.reopen}</Button>
              {!event.verifiedAt && (
                <Button disabled={busy} onClick={() => run(() => post({ action: "verify_event", id: event.id }))}>
                  <UserCheck />{t.verify}
                </Button>
              )}
            </div>
          )}
          <label className="grid gap-1 text-sm font-semibold text-slate-600">{t.assignTo}
            <Select value={event.responsibleMemberId ? String(event.responsibleMemberId) : "none"} onValueChange={(value) => run(() => post({ action: "assign", id: event.id, responsibleMemberId: value === "none" ? null : Number(value) }))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.unassigned}</SelectItem>
                {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-600">{t.followUp}
            <span className="flex gap-2">
              <Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
              <Button variant="outline" disabled={busy} onClick={() => run(() => post({ action: "set_follow_up", id: event.id, followUpDate: followUp || null }))}>{t.save}</Button>
            </span>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild><Button variant="outline"><Pencil />{t.editDetails}</Button></DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader><DialogTitle>{t.editDetails}</DialogTitle><DialogDescription>{event.folio}</DialogDescription></DialogHeader>
                <div className="grid gap-3">
                  <Input type="datetime-local" value={editForm.occurredAt} onChange={(e) => setEditForm({ ...editForm, occurredAt: e.target.value })} />
                  <Textarea placeholder={t.description} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder={t.building} value={editForm.building} onChange={(e) => setEditForm({ ...editForm, building: e.target.value })} />
                    <Input placeholder={t.unit} value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} />
                    <Input placeholder={t.area} value={editForm.area} onChange={(e) => setEditForm({ ...editForm, area: e.target.value })} />
                    <Input placeholder={t.equipment} value={editForm.equipment} onChange={(e) => setEditForm({ ...editForm, equipment: e.target.value })} />
                  </div>
                  <Textarea placeholder={t.findings} value={editForm.findings} onChange={(e) => setEditForm({ ...editForm, findings: e.target.value })} />
                  <Textarea placeholder={t.actionsTaken} value={editForm.actionsTaken} onChange={(e) => setEditForm({ ...editForm, actionsTaken: e.target.value })} />
                  <Input placeholder={t.officialWo} value={editForm.officialWoRef} onChange={(e) => setEditForm({ ...editForm, officialWoRef: e.target.value })} />
                </div>
                <DialogFooter>
                  <Button disabled={busy || !editForm.description.trim()} onClick={() => run(async () => {
                    await post({
                      action: "update_event", id: event.id,
                      occurredAt: editForm.occurredAt ? new Date(editForm.occurredAt).toISOString() : undefined,
                      description: editForm.description, building: editForm.building, unit: editForm.unit,
                      area: editForm.area, equipment: editForm.equipment, findings: editForm.findings,
                      actionsTaken: editForm.actionsTaken, officialWoRef: editForm.officialWoRef,
                    });
                    setEditOpen(false);
                  })}>{t.save}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {!closed && (
              <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
                <DialogTrigger asChild><Button className="bg-emerald-600 hover:bg-emerald-500"><Flag />{t.closeEvent}</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t.closeEvent}</DialogTitle><DialogDescription>{t.closeHint}</DialogDescription></DialogHeader>
                  <Textarea placeholder={t.finalResult} value={finalResult} onChange={(e) => setFinalResult(e.target.value)} />
                  <DialogFooter>
                    <Button disabled={busy || !finalResult.trim()} onClick={() => run(async () => {
                      await post({ action: "close_event", id: event.id, finalResult });
                      setCloseOpen(false); setFinalResult("");
                    })}>{t.closeEvent}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardContent>
      </Card>

      {chain.length > 1 && (
        <Card className="rounded-3xl border-0 shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Link2 className="size-5 text-[#007a9f]" />{t.caseChain}</CardTitle></CardHeader>
          <CardContent>
            <ol className="relative space-y-3 border-l-2 border-slate-200 pl-5">
              {chain.map((item) => (
                <li key={item.id} className="relative">
                  <span className={`absolute -left-[27px] top-3 size-3 rounded-full ${item.isSelf ? "bg-[#007a9f]" : "bg-slate-300"}`} />
                  <button disabled={item.isSelf} onClick={() => openEvent(item.id)} className={`block w-full rounded-2xl p-3 text-left ${item.isSelf ? "bg-sky-50" : "bg-slate-50 hover:bg-slate-100"}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.folio}</Badge>
                      <span className="font-bold">{t.types[item.eventType]}</span>
                      {item.relation && <Badge className="bg-slate-100 text-slate-600">{t.relations[item.relation]}</Badge>}
                      <Badge variant="outline">{t.statuses[item.status]}</Badge>
                      <span className="ml-auto text-xs font-semibold text-slate-400">{fmtDateTime(item.occurredAt, lang)}</span>
                    </span>
                    <span className="mt-1 block truncate text-sm text-slate-600">{item.description}</span>
                  </button>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Link2 className="size-5 text-[#007a9f]" />{t.linkEvent}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <Select value={linkTarget} onValueChange={setLinkTarget}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t.linkEvent} /></SelectTrigger>
              <SelectContent>{linkCandidates.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.folio} — {t.types[item.eventType]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={linkRelation} onValueChange={setLinkRelation}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{RELATIONS.map((value) => <SelectItem key={value} value={value}>{t.relations[value]}</SelectItem>)}</SelectContent>
            </Select>
            <Button disabled={busy || !linkTarget} onClick={() => run(async () => {
              await post({ action: "link_event", id: event.id, relatedEventId: Number(linkTarget), relation: linkRelation });
              setLinkTarget("");
            })}>{t.link}</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Paperclip className="size-5 text-[#007a9f]" />{t.attachments}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(detail.attachments || []).map((file: LogAttachment) => (
            <div key={file.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 p-3">
              <span className="min-w-0 flex-1 truncate font-semibold">{file.fileName}</span>
              <span className="text-xs font-semibold text-slate-400">{file.uploadedByName || ""} · {fmtDateTime(file.createdAt, lang)}</span>
              <a href={`/api/logbook/download?attachmentId=${file.id}`} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm"><Download />{t.download}</Button>
              </a>
            </div>
          ))}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-4 font-bold text-[#007a9f]">
            <Upload />{t.attach}
            <input
              type="file" multiple className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.md"
              onChange={(e) => { void uploadFiles(e.target.files); e.target.value = ""; }}
            />
          </label>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><MessageSquare className="size-5 text-[#007a9f]" />{t.comments}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(detail.comments || []).map((comment: LogComment) => (
            <div key={comment.id} className="rounded-2xl bg-slate-50 p-4">
              <p className="whitespace-pre-wrap leading-6">{comment.body}</p>
              <p className="mt-2 text-xs font-semibold text-slate-400">{comment.authorName || ""} · {fmtDateTime(comment.createdAt, lang)}</p>
            </div>
          ))}
          <Textarea placeholder={t.addComment} value={commentText} onChange={(e) => setCommentText(e.target.value)} />
          <div className="flex justify-end">
            <Button disabled={busy || !commentText.trim()} onClick={() => run(async () => {
              await post({ action: "add_comment", id: event.id, body: commentText });
              setCommentText("");
            })}>{t.comment}</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><History className="size-5 text-[#007a9f]" />{t.historyTitle}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(detail.history || []).map((entry: HistoryEntry) => (
            <div key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl bg-slate-50 p-3 text-sm">
              <span className="font-bold">{t.historyActions[entry.action] || entry.action}</span>
              <span className="text-slate-500">{entry.actorName || entry.actorEmail}</span>
              {entry.action === "status_changed" && <span className="text-slate-500">{t.statuses[String(entry.detail.from)] || entry.detail.from} → {t.statuses[String(entry.detail.to)] || entry.detail.to}</span>}
              {entry.action === "linked" && <span className="text-slate-500">{String(entry.detail.relatedFolio || "")}</span>}
              {entry.action === "attachment_added" && <span className="text-slate-500">{String(entry.detail.fileName || "")}</span>}
              {entry.action === "details_updated" && <span className="text-slate-500">{(entry.detail.changed as string[] || []).join(", ")}</span>}
              <span className="ml-auto text-xs font-semibold text-slate-400">{fmtDateTime(entry.createdAt, lang)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
