"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen, CheckCircle2, Download, FileText, History,
  Printer, Search, Upload,
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

type LibVersion = {
  id: number; versionNumber: number; effectiveDate: string | null;
  changeNote: string | null; fileName: string; fileSize: number | null;
  createdAt: string; myReadAt: string | null;
  reads?: { memberId: number; memberName: string | null; readAt: string }[];
  notRead?: { memberId: number; memberName: string }[];
};

type LibDocument = {
  id: number; category: string; docType: string; title: string;
  sopNumber: string | null; status: string; ownerMemberId: number | null;
  ownerName: string | null;
  currentVersion: Omit<LibVersion, "myReadAt"> | null;
  versionCount: number; myReadAt: string | null;
  createdAt: string; updatedAt: string;
};

type TeamLite = { id: number; name: string };

const copy = {
  en: {
    title: "Document library",
    subtitle: "Procedures, SOPs, manuals, SDS and forms — always the current published version.",
    search: "Search by title or SOP number…",
    allCategories: "All categories",
    allStatuses: "All statuses",
    empty: "No documents yet. Published documents will appear here.",
    noFile: "No file uploaded yet",
    version: "Version",
    effective: "Effective / revised",
    owner: "Owner",
    sop: "SOP",
    readConfirmed: "You confirmed reading this version",
    confirmRead: "I confirm I read this version",
    download: "Download",
    history: "Version history",
    changeNote: "Change note",
    readBy: "Confirmed reading",
    notRead: "Not yet confirmed",
    nobody: "Nobody yet",
    newDocument: "New document",
    newVersion: "New version",
    publish: "Publish",
    archive: "Archive",
    edit: "Edit",
    save: "Save",
    create: "Create document",
    uploadVersion: "Upload version",
    docTitle: "Title",
    category: "Category",
    docType: "Document type",
    sopNumber: "SOP number (optional)",
    effectiveDate: "Effective / revision date",
    file: "File (PDF, image or Office document, max 25 MB)",
    publishNow: "Publish immediately (visible to the whole team)",
    categories: {
      sop_greystar: "Greystar SOP", procedimiento_interno: "Internal procedure",
      manual_fabricante: "Manufacturer manual", sds: "SDS",
      emergencia: "Emergency", formulario: "Form", otro: "Other",
    },
    types: { official: "Official", internal_guide: "Internal guide", draft: "Draft" },
    statuses: { draft: "Draft", published: "Current", archived: "Archived" },
    formsTitle: "Print formats (Letter)",
    formsHint: "Data formats generate from real work orders; the rest are ready-to-print templates.",
    forms: {
      "daily-assignments": "Daily Assignment Sheet",
      "weekly-plan": "Weekly Maintenance Plan",
      "pending-parts-vendors": "Pending Parts & Vendor Log",
      "inventory-reorder": "Inventory Reorder List",
      "shop-closing": "Shop Closing Checklist",
      "training-log": "Training & Safety Meeting Log",
    },
    open: "Open",
  },
  es: {
    title: "Biblioteca de documentos",
    subtitle: "Procedimientos, SOP, manuales, SDS y formularios — siempre la versión vigente publicada.",
    search: "Buscar por título o número de SOP…",
    allCategories: "Todas las categorías",
    allStatuses: "Todos los estados",
    empty: "Todavía no hay documentos. Los documentos publicados aparecerán aquí.",
    noFile: "Aún no se subió ningún archivo",
    version: "Versión",
    effective: "Vigencia / revisión",
    owner: "Responsable",
    sop: "SOP",
    readConfirmed: "Confirmaste la lectura de esta versión",
    confirmRead: "Confirmo que leí esta versión",
    download: "Descargar",
    history: "Historial de versiones",
    changeNote: "Nota de cambio",
    readBy: "Confirmaron la lectura",
    notRead: "Sin confirmar todavía",
    nobody: "Nadie todavía",
    newDocument: "Nuevo documento",
    newVersion: "Nueva versión",
    publish: "Publicar",
    archive: "Archivar",
    edit: "Editar",
    save: "Guardar",
    create: "Crear documento",
    uploadVersion: "Subir versión",
    docTitle: "Título",
    category: "Categoría",
    docType: "Tipo de documento",
    sopNumber: "Número de SOP (opcional)",
    effectiveDate: "Fecha de vigencia / revisión",
    file: "Archivo (PDF, imagen o documento Office, máx. 25 MB)",
    publishNow: "Publicar de inmediato (visible para todo el equipo)",
    categories: {
      sop_greystar: "SOP de Greystar", procedimiento_interno: "Procedimiento interno",
      manual_fabricante: "Manual del fabricante", sds: "SDS",
      emergencia: "Emergencia", formulario: "Formulario", otro: "Otro",
    },
    types: { official: "Oficial", internal_guide: "Guía interna", draft: "Borrador" },
    statuses: { draft: "Borrador", published: "Vigente", archived: "Archivado" },
    formsTitle: "Formatos imprimibles (Letter)",
    formsHint: "Los formatos con datos se generan desde las órdenes reales; los demás son plantillas listas para imprimir.",
    forms: {
      "daily-assignments": "Daily Assignment Sheet",
      "weekly-plan": "Weekly Maintenance Plan",
      "pending-parts-vendors": "Pending Parts & Vendor Log",
      "inventory-reorder": "Inventory Reorder List",
      "shop-closing": "Shop Closing Checklist",
      "training-log": "Training & Safety Meeting Log",
    },
    open: "Abrir",
  },
} as const;

const CATEGORIES = ["sop_greystar", "procedimiento_interno", "manual_fabricante", "sds", "emergencia", "formulario", "otro"];
const DOC_TYPES = ["official", "internal_guide", "draft"];
const STATUSES = ["draft", "published", "archived"];
const PRINT_FORMATS = ["daily-assignments", "weekly-plan", "pending-parts-vendors", "inventory-reorder", "shop-closing", "training-log"];

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function apiUpload(form: FormData) {
  const res = await fetch("/api/library", { method: "POST", body: form });
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function typeBadgeClass(docType: string) {
  if (docType === "official") return "bg-[#005f82] text-white";
  if (docType === "draft") return "bg-amber-400 text-amber-950";
  return "bg-slate-200 text-slate-700";
}

function statusBadgeClass(status: string) {
  if (status === "published") return "bg-emerald-600 text-white";
  if (status === "archived") return "bg-slate-500 text-white";
  return "bg-amber-500 text-white";
}

export function LibraryPanel({ lang, team }: { lang: Language; team: TeamLite[] }) {
  const t = copy[lang];
  const [isAdmin, setIsAdmin] = useState(false);
  const [documents, setDocuments] = useState<LibDocument[]>([]);
  const [detail, setDetail] = useState<{ document: LibDocument; versions: LibVersion[] } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [versionDoc, setVersionDoc] = useState<LibDocument | null>(null);
  const [editDoc, setEditDoc] = useState<LibDocument | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [dailyDate, setDailyDate] = useState(today);
  const [weekDate, setWeekDate] = useState(today);

  const load = useCallback(async () => {
    try {
      const data = await api("/api/library");
      setIsAdmin(data.isAdmin === true);
      setDocuments(data.documents || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const data = await api(`/api/library?id=${id}`);
      setDetail(data);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, []);

  async function toggleDetail(doc: LibDocument) {
    if (expandedId === doc.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(doc.id);
    await loadDetail(doc.id);
  }

  async function confirmRead(versionId: number) {
    setBusy(true);
    try {
      await api("/api/library", { action: "confirm_read", versionId });
      await load();
      if (expandedId) await loadDetail(expandedId);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function docAction(action: string, id: number) {
    setBusy(true);
    try {
      await api("/api/library", { action, id });
      await load();
      if (expandedId === id) await loadDetail(id);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const visible = documents.filter((doc) => {
    if (category !== "all" && doc.category !== category) return false;
    if (status !== "all" && doc.status !== status) return false;
    const query = search.trim().toLowerCase();
    if (query && !`${doc.title} ${doc.sopNumber || ""}`.toLowerCase().includes(query)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><BookOpen className="size-5" />{t.title}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">{t.subtitle}</p>
          </div>
          {isAdmin && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild><Button><Upload />{t.newDocument}</Button></DialogTrigger>
              <CreateDocumentDialog
                t={t} team={team} busy={busy} setBusy={setBusy}
                onDone={async () => { setCreateOpen(false); await load(); }}
                onError={setMessage}
              />
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder={t.search} value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allCategories}</SelectItem>
                {CATEGORIES.map((value) => <SelectItem key={value} value={value}>{t.categories[value as keyof typeof t.categories]}</SelectItem>)}
              </SelectContent>
            </Select>
            {isAdmin && (
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.allStatuses}</SelectItem>
                  {STATUSES.map((value) => <SelectItem key={value} value={value}>{t.statuses[value as keyof typeof t.statuses]}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {visible.length === 0 && (
            <div className="rounded-2xl border border-dashed p-8 text-center text-slate-500">{t.empty}</div>
          )}
          {visible.map((doc) => (
            <div key={doc.id} className="rounded-2xl bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Badge className={typeBadgeClass(doc.docType)}>{t.types[doc.docType as keyof typeof t.types]}</Badge>
                    <Badge className={statusBadgeClass(doc.status)}>{t.statuses[doc.status as keyof typeof t.statuses]}</Badge>
                    <Badge variant="outline">{t.categories[doc.category as keyof typeof t.categories]}</Badge>
                    {doc.sopNumber && <Badge variant="outline">{t.sop} {doc.sopNumber}</Badge>}
                  </div>
                  <p className="text-base font-extrabold">{doc.title}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {doc.currentVersion
                      ? `${t.version} ${doc.currentVersion.versionNumber}${doc.currentVersion.effectiveDate ? ` · ${t.effective}: ${doc.currentVersion.effectiveDate}` : ""}`
                      : t.noFile}
                    {doc.ownerName ? ` · ${t.owner}: ${doc.ownerName}` : ""}
                  </p>
                  {doc.currentVersion && (
                    doc.myReadAt
                      ? <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-4" />{t.readConfirmed} · {new Date(doc.myReadAt).toLocaleDateString(lang === "es" ? "es-US" : "en-US")}</p>
                      : doc.status === "published" && (
                        <div className="mt-2">
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => confirmRead(doc.currentVersion!.id)}>
                            <CheckCircle2 />{t.confirmRead}
                          </Button>
                        </div>
                      )
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {doc.currentVersion && (
                    <a href={`/api/library/download?versionId=${doc.currentVersion.id}`}>
                      <Button size="sm"><Download />{t.download}</Button>
                    </a>
                  )}
                  <Button size="sm" variant="outline" onClick={() => toggleDetail(doc)}>
                    <History />{t.history} ({doc.versionCount})
                  </Button>
                  {isAdmin && doc.status !== "published" && doc.currentVersion && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => docAction("publish_document", doc.id)}>{t.publish}</Button>
                  )}
                  {isAdmin && doc.status !== "archived" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => docAction("archive_document", doc.id)}>{t.archive}</Button>
                  )}
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => setEditDoc(doc)}>{t.edit}</Button>
                  )}
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => setVersionDoc(doc)}><Upload />{t.newVersion}</Button>
                  )}
                </div>
              </div>
              {expandedId === doc.id && detail && detail.document.id === doc.id && (
                <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
                  {detail.versions.map((version) => (
                    <div key={version.id} className="rounded-xl bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold">
                          {t.version} {version.versionNumber} · {version.fileName}
                          {version.effectiveDate ? ` · ${t.effective}: ${version.effectiveDate}` : ""}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {version.myReadAt
                            ? <Badge className="bg-emerald-600 text-white">{t.readConfirmed}</Badge>
                            : doc.status === "published" && (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => confirmRead(version.id)}>
                                <CheckCircle2 />{t.confirmRead}
                              </Button>
                            )}
                          <a href={`/api/library/download?versionId=${version.id}`}>
                            <Button size="sm" variant="outline"><Download />{t.download}</Button>
                          </a>
                        </div>
                      </div>
                      {version.changeNote && <p className="mt-1 text-sm text-slate-500">{t.changeNote}: {version.changeNote}</p>}
                      {isAdmin && version.reads && (
                        <div className="mt-2 text-sm text-slate-600">
                          <p><strong>{t.readBy}:</strong> {version.reads.length
                            ? version.reads.map((read) => `${read.memberName || "—"} (${new Date(read.readAt).toLocaleDateString(lang === "es" ? "es-US" : "en-US")})`).join(", ")
                            : t.nobody}</p>
                          {version.notRead && version.notRead.length > 0 && (
                            <p><strong>{t.notRead}:</strong> {version.notRead.map((person) => person.memberName).join(", ")}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {detail.versions.length === 0 && <p className="text-sm text-slate-500">{t.noFile}</p>}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Printer className="size-5" />{t.formsTitle}</CardTitle>
          <p className="mt-1 text-sm text-slate-500">{t.formsHint}</p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {PRINT_FORMATS.map((format) => (
            <div key={format} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-4">
              <p className="flex items-center gap-2 font-bold"><FileText className="size-4" />{t.forms[format as keyof typeof t.forms]}</p>
              <div className="flex items-center gap-2">
                {format === "daily-assignments" && (
                  <Input type="date" className="w-[150px]" value={dailyDate} onChange={(event) => setDailyDate(event.target.value)} />
                )}
                {format === "weekly-plan" && (
                  <Input type="date" className="w-[150px]" value={weekDate} onChange={(event) => setWeekDate(event.target.value)} />
                )}
                <a
                  href={format === "daily-assignments" ? `/print/daily-assignments?date=${dailyDate}`
                    : format === "weekly-plan" ? `/print/weekly-plan?week=${weekDate}`
                      : `/print/${format}`}
                  target="_blank" rel="noreferrer"
                >
                  <Button size="sm" variant="outline"><Printer />{t.open}</Button>
                </a>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {versionDoc && (
        <Dialog open onOpenChange={() => setVersionDoc(null)}>
          <VersionDialog
            t={t} doc={versionDoc} busy={busy} setBusy={setBusy}
            onDone={async () => { setVersionDoc(null); await load(); if (expandedId) await loadDetail(expandedId); }}
            onError={setMessage}
          />
        </Dialog>
      )}
      {editDoc && (
        <Dialog open onOpenChange={() => setEditDoc(null)}>
          <EditDocumentDialog
            t={t} doc={editDoc} team={team} busy={busy} setBusy={setBusy}
            onDone={async () => { setEditDoc(null); await load(); }}
            onError={setMessage}
          />
        </Dialog>
      )}
      {message && (
        <button aria-live="polite" onClick={() => setMessage("")} className="fixed bottom-24 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl lg:bottom-8">
          {message}
        </button>
      )}
    </div>
  );
}

function DocumentFields({ t, form, setForm, team, withFile }: any) {
  return (
    <div className="grid gap-3">
      <Input placeholder={t.docTitle} value={form.title} onChange={(event: any) => setForm({ ...form, title: event.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <Select value={form.category} onValueChange={(value: string) => setForm({ ...form, category: value })}>
          <SelectTrigger className="w-full"><SelectValue placeholder={t.category} /></SelectTrigger>
          <SelectContent>{CATEGORIES.map((value) => <SelectItem key={value} value={value}>{t.categories[value]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={form.docType} onValueChange={(value: string) => setForm({ ...form, docType: value })}>
          <SelectTrigger className="w-full"><SelectValue placeholder={t.docType} /></SelectTrigger>
          <SelectContent>{DOC_TYPES.map((value) => <SelectItem key={value} value={value}>{t.types[value]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder={t.sopNumber} value={form.sopNumber} onChange={(event: any) => setForm({ ...form, sopNumber: event.target.value })} />
        <Select value={form.ownerMemberId || "none"} onValueChange={(value: string) => setForm({ ...form, ownerMemberId: value === "none" ? "" : value })}>
          <SelectTrigger className="w-full"><SelectValue placeholder={t.owner} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {withFile && (
        <>
          <label className="text-sm font-semibold">{t.effectiveDate}</label>
          <Input type="date" value={form.effectiveDate} onChange={(event: any) => setForm({ ...form, effectiveDate: event.target.value })} />
          <Textarea placeholder={t.changeNote} value={form.changeNote} onChange={(event: any) => setForm({ ...form, changeNote: event.target.value })} />
          <label className="text-sm font-semibold">{t.file}</label>
          <Input type="file" onChange={(event: any) => setForm({ ...form, file: event.target.files?.[0] || null })} />
        </>
      )}
    </div>
  );
}

function CreateDocumentDialog({ t, team, busy, setBusy, onDone, onError }: any) {
  const [form, setForm] = useState({
    title: "", category: "procedimiento_interno", docType: "internal_guide",
    sopNumber: "", ownerMemberId: "", effectiveDate: "", changeNote: "",
    publish: false, file: null as File | null,
  });
  async function submit() {
    if (!form.file) { onError(t.file); return; }
    setBusy(true);
    try {
      const data = new FormData();
      data.set("action", "create_document");
      data.set("title", form.title);
      data.set("category", form.category);
      data.set("docType", form.docType);
      data.set("sopNumber", form.sopNumber);
      data.set("ownerMemberId", form.ownerMemberId);
      data.set("effectiveDate", form.effectiveDate);
      data.set("changeNote", form.changeNote);
      data.set("publish", form.publish ? "true" : "false");
      data.set("file", form.file);
      await apiUpload(data);
      await onDone();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t.newDocument}</DialogTitle>
        <DialogDescription>{t.subtitle}</DialogDescription>
      </DialogHeader>
      <DocumentFields t={t} form={form} setForm={setForm} team={team} withFile />
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={form.publish} onChange={(event) => setForm({ ...form, publish: event.target.checked })} />
        {t.publishNow}
      </label>
      <DialogFooter>
        <Button onClick={submit} disabled={busy || !form.title || !form.file}>{t.create}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function VersionDialog({ t, doc, busy, setBusy, onDone, onError }: any) {
  const [form, setForm] = useState({ effectiveDate: "", changeNote: "", file: null as File | null });
  async function submit() {
    if (!form.file) { onError(t.file); return; }
    setBusy(true);
    try {
      const data = new FormData();
      data.set("action", "add_version");
      data.set("documentId", String(doc.id));
      data.set("effectiveDate", form.effectiveDate);
      data.set("changeNote", form.changeNote);
      data.set("file", form.file);
      await apiUpload(data);
      await onDone();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t.newVersion} — {doc.title}</DialogTitle>
        <DialogDescription>{t.history}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <label className="text-sm font-semibold">{t.effectiveDate}</label>
        <Input type="date" value={form.effectiveDate} onChange={(event: any) => setForm({ ...form, effectiveDate: event.target.value })} />
        <Textarea placeholder={t.changeNote} value={form.changeNote} onChange={(event: any) => setForm({ ...form, changeNote: event.target.value })} />
        <label className="text-sm font-semibold">{t.file}</label>
        <Input type="file" onChange={(event: any) => setForm({ ...form, file: event.target.files?.[0] || null })} />
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy || !form.file}>{t.uploadVersion}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EditDocumentDialog({ t, doc, team, busy, setBusy, onDone, onError }: any) {
  const [form, setForm] = useState({
    title: doc.title, category: doc.category, docType: doc.docType,
    sopNumber: doc.sopNumber || "", ownerMemberId: doc.ownerMemberId ? String(doc.ownerMemberId) : "",
  });
  async function submit() {
    setBusy(true);
    try {
      await api("/api/library", {
        action: "update_document", id: doc.id,
        title: form.title, category: form.category, docType: form.docType,
        sopNumber: form.sopNumber, ownerMemberId: form.ownerMemberId ? Number(form.ownerMemberId) : null,
      });
      await onDone();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t.edit} — {doc.title}</DialogTitle>
        <DialogDescription>{t.subtitle}</DialogDescription>
      </DialogHeader>
      <DocumentFields t={t} form={form} setForm={setForm} team={team} withFile={false} />
      <DialogFooter>
        <Button onClick={submit} disabled={busy || !form.title}>{t.save}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
