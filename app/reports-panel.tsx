"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Download, FileSearch, FolderOpen, Printer, Search, ShieldCheck, ShieldAlert, FileQuestion,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * Reports & audit dossiers (Phase 4).
 *
 * A read-only consultation surface over the modules the earlier phases
 * built: filtered search with counts, case and apartment dossiers, CSV
 * export and printable sheets. All permission decisions happen on the
 * server (app/api/reports); this panel only mirrors them. The evidence
 * badges implement Jose's honesty rule: an attachment is "evidence
 * available", never "verified" — verification requires a recorded
 * verifier and date.
 */

type Language = "en" | "es";
type TeamLite = { id: number; name: string };

type ResultItem = {
  module: string; id: number; ref: string; title: string; date: string;
  status: string | null; location: string | null; memberName: string | null;
  unit: string | null; building: string | null;
  evidence: "verified" | "evidence_unverified" | "no_evidence" | null;
  attachmentCount: number; verifiedByName: string | null; verifiedAt: string | null;
};

type TimelineEntry = ResultItem & { kind: string; detail: string | null };

type Dossier = {
  kind: "case" | "unit"; title: string;
  seedEvent: { id: number; folio: string; occurredAt: string; type: string; status: string; description: string; officialWoRef: string | null } | null;
  unit: string | null; building: string | null; officialRefs: string[];
  entries: TimelineEntry[];
  summary: { total: number; withEvidenceSemantics: number; verified: number; evidenceUnverified: number; noEvidence: number };
  unverified: TimelineEntry[];
};

type AuditEntry = {
  id: number; action: string; actorEmail: string; targetEmail: string | null;
  detail: Record<string, unknown>; createdAt: string;
};

const MODULES = [
  "all", "logbook", "inspections", "corrective", "work_orders", "inventory",
  "movements", "reorders", "tools", "assets", "refrigerant", "vendors",
] as const;

const STATUSES: Record<string, string[]> = {
  logbook: ["open", "in_progress", "pending", "closed"],
  inspections: ["scheduled", "in_progress", "completed"],
  corrective: ["open", "in_progress", "completed", "verified"],
  work_orders: ["open", "assigned", "in_progress", "on_hold", "completed"],
  inventory: ["active", "archived"],
  reorders: ["pending", "ordered", "received", "cancelled"],
  tools: ["available", "loaned", "maintenance", "retired"],
  assets: ["active", "inactive", "retired"],
  vendors: ["open", "scheduled", "in_progress", "completed", "verified", "cancelled"],
};

const copy = {
  en: {
    title: "Reports & Audit",
    subtitle: "Search every module, build case or apartment dossiers, and export for Jose, Epi, the RPM or an audit. Evidence available is not the same as verified — the badges keep them apart.",
    module: "Module", from: "From", to: "To", person: "Person", status: "Status",
    building: "Building", unit: "Unit", searchText: "Text search",
    searchPlaceholder: "Folio, description, equipment, serial…",
    lowStock: "Below minimum only", search: "Search", all: "All modules",
    everyone: "Everyone", anyStatus: "Any status",
    modules: {
      all: "All modules", logbook: "Logbook", inspections: "Inspections",
      corrective: "Corrective actions", work_orders: "Work orders",
      inventory: "Inventory", movements: "Stock movements", reorders: "Reorders",
      tools: "Tools (on loan)", assets: "Assets", refrigerant: "Refrigerant",
      vendors: "Vendor work",
    } as Record<string, string>,
    total: "results", noResults: "No records match these filters.",
    loadError: "Unable to load reports.",
    verified: "Verified", evidenceOnly: "Evidence available — not verified",
    noEvidence: "No evidence", files: "files",
    caseDossier: "Case dossier", unitDossier: "Unit dossier",
    back: "Back to search",
    dossierCase: "Case dossier", dossierUnit: "Apartment dossier",
    officialRefs: "Official WO references (external system)",
    summary: "Evidence summary", sumTotal: "Records", sumVerified: "Verified",
    sumUnverified: "With evidence, not verified", sumNoEvidence: "No evidence",
    unverifiedTitle: "Not verified — evidence available, verification pending",
    unverifiedText: "These records have evidence files but nobody has recorded a verification. They must not be presented as verified.",
    timeline: "Chronology",
    exportCsv: "Download CSV", printReport: "Print report", printDossier: "Print dossier",
    exportModule: "Export module",
    adminTitle: "Administrative activity",
    adminText: "Administrator only. This is the same administrative history (access approvals, suspensions, document publishing) shown in the Team tab — read from the same log, not a copy.",
    adminLoad: "Load administrative activity",
    locationHint: "Building / unit filters apply to logbook, inspections and assets (the modules with structured locations).",
  },
  es: {
    title: "Reportes y Auditoría",
    subtitle: "Busca en todos los módulos, arma expedientes por caso o apartamento y exporta para Jose, Epi, el RPM o una auditoría. Evidencia disponible no es lo mismo que verificado — las etiquetas los mantienen separados.",
    module: "Módulo", from: "Desde", to: "Hasta", person: "Persona", status: "Estado",
    building: "Edificio", unit: "Apartamento", searchText: "Búsqueda de texto",
    searchPlaceholder: "Folio, descripción, equipo, serie…",
    lowStock: "Solo bajo mínimo", search: "Buscar", all: "Todos los módulos",
    everyone: "Todas las personas", anyStatus: "Cualquier estado",
    modules: {
      all: "Todos los módulos", logbook: "Bitácora", inspections: "Inspecciones",
      corrective: "Acciones correctivas", work_orders: "Órdenes de trabajo",
      inventory: "Inventario", movements: "Movimientos de stock", reorders: "Reposiciones",
      tools: "Herramientas (prestadas)", assets: "Activos", refrigerant: "Refrigerantes",
      vendors: "Trabajo de vendors",
    } as Record<string, string>,
    total: "resultados", noResults: "Ningún registro coincide con estos filtros.",
    loadError: "No se pudieron cargar los reportes.",
    verified: "Verificado", evidenceOnly: "Evidencia disponible — sin verificar",
    noEvidence: "Sin evidencia", files: "archivos",
    caseDossier: "Expediente del caso", unitDossier: "Expediente del apartamento",
    back: "Volver a la búsqueda",
    dossierCase: "Expediente del caso", dossierUnit: "Expediente del apartamento",
    officialRefs: "Referencias a la WO oficial (sistema externo)",
    summary: "Resumen de evidencia", sumTotal: "Registros", sumVerified: "Verificados",
    sumUnverified: "Con evidencia, sin verificar", sumNoEvidence: "Sin evidencia",
    unverifiedTitle: "Sin verificar — evidencia disponible, verificación pendiente",
    unverifiedText: "Estos registros tienen archivos de evidencia pero nadie ha registrado una verificación. No deben presentarse como verificados.",
    timeline: "Cronología",
    exportCsv: "Descargar CSV", printReport: "Imprimir reporte", printDossier: "Imprimir expediente",
    exportModule: "Módulo a exportar",
    adminTitle: "Actividad administrativa",
    adminText: "Solo el administrador. Es el mismo historial administrativo (aprobaciones de acceso, suspensiones, publicación de documentos) que se muestra en la pestaña Equipo — se lee del mismo registro, no es una copia.",
    adminLoad: "Cargar actividad administrativa",
    locationHint: "Los filtros de edificio / apartamento aplican a bitácora, inspecciones y activos (los módulos con ubicación estructurada).",
  },
} as const;

const EMPTY_FILTERS = {
  module: "all", from: "", to: "", memberId: "", status: "",
  building: "", unit: "", q: "", lowStock: false,
};

function fmtDate(value: string | null, lang: Language) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    timeZone: "America/New_York", dateStyle: "medium",
    ...(value.includes("T") ? { timeStyle: "short" } : {}),
  }).format(date);
}

function EvidenceBadge({ item, t, lang }: { item: ResultItem; t: (typeof copy)["en"] | (typeof copy)["es"]; lang: Language }) {
  if (item.evidence === null) return <span className="text-xs text-slate-400">—</span>;
  if (item.evidence === "verified") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        <ShieldCheck className="mr-1 size-3" />
        {t.verified} · {item.verifiedByName} · {fmtDate(item.verifiedAt, lang)}
      </Badge>
    );
  }
  if (item.evidence === "evidence_unverified") {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
        <ShieldAlert className="mr-1 size-3" />
        {t.evidenceOnly} ({item.attachmentCount} {t.files})
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-slate-500">
      <FileQuestion className="mr-1 size-3" />
      {t.noEvidence}
    </Badge>
  );
}

export function ReportsPanel({ lang, team, isAdmin }: {
  lang: Language; team: TeamLite[]; meId: number; isAdmin: boolean;
}) {
  const t = copy[lang];
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [data, setData] = useState<{ counts: Record<string, number>; total: number; groups: { module: string; items: ResultItem[] }[] } | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [adminLog, setAdminLog] = useState<AuditEntry[] | null>(null);
  const [csvModule, setCsvModule] = useState("logbook");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const queryString = useCallback((f: typeof filters, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    if (f.module !== "all") params.set("module", f.module);
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
    if (f.memberId) params.set("memberId", f.memberId);
    if (f.status) params.set("status", f.status);
    if (f.building) params.set("building", f.building);
    if (f.unit) params.set("unit", f.unit);
    if (f.q) params.set("q", f.q);
    if (f.lowStock) params.set("lowStock", "1");
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return params.toString();
  }, []);

  const runSearch = useCallback(async (f: typeof filters) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/reports?${queryString(f)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "error");
      setData({ counts: json.counts, total: json.total, groups: json.groups });
    } catch {
      setError(t.loadError);
    } finally {
      setBusy(false);
    }
  }, [queryString, t]);

  const loadedOnce = useRef(false);
  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    void runSearch(EMPTY_FILTERS);
  }, [runSearch]);

  const openCase = async (eventId: number) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/reports?case=${eventId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "error");
      setDossier(json.dossier);
    } catch {
      setError(t.loadError);
    } finally {
      setBusy(false);
    }
  };

  const openUnit = async (unit: string, building: string | null) => {
    setBusy(true);
    setError("");
    try {
      const qs = new URLSearchParams({ unit });
      if (building) qs.set("building", building);
      const res = await fetch(`/api/reports?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "error");
      setDossier(json.dossier);
    } catch {
      setError(t.loadError);
    } finally {
      setBusy(false);
    }
  };

  const loadAdmin = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/reports?adminActivity=1`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "error");
      setAdminLog(json.adminActivity);
    } catch {
      setError(t.loadError);
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<typeof filters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const statusOptions = STATUSES[filters.module] || [];
  const printReportUrl = `/print/audit-report?${queryString(filters)}`;
  const exportUrl = `/api/reports/export?${queryString({ ...filters, module: csvModule }, { lang })}`;
  const printDossierUrl = dossier
    ? dossier.kind === "case" && dossier.seedEvent
      ? `/print/case-dossier?case=${dossier.seedEvent.id}`
      : `/print/case-dossier?unit=${encodeURIComponent(dossier.unit || "")}${dossier.building ? `&building=${encodeURIComponent(dossier.building)}` : ""}`
    : "";

  if (dossier) {
    return (
      <div className="grid gap-4">
        <Card className="rounded-3xl border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FolderOpen className="size-5 text-[#005f82]" />
                {dossier.kind === "case" ? t.dossierCase : t.dossierUnit} · {dossier.title}
              </CardTitle>
              <div className="flex gap-2">
                <a href={printDossierUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm"><Printer className="mr-1 size-4" />{t.printDossier}</Button>
                </a>
                <Button variant="outline" size="sm" onClick={() => setDossier(null)}>
                  <ArrowLeft className="mr-1 size-4" />{t.back}
                </Button>
              </div>
            </div>
            {dossier.seedEvent && (
              <p className="text-sm text-slate-600">
                {dossier.seedEvent.folio} · {fmtDate(dossier.seedEvent.occurredAt, lang)} · {dossier.seedEvent.description}
              </p>
            )}
            {dossier.officialRefs.length > 0 && (
              <p className="text-sm text-slate-600">
                <strong>{t.officialRefs}:</strong> {dossier.officialRefs.join(", ")}
              </p>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [t.sumTotal, dossier.summary.total],
                [t.sumVerified, dossier.summary.verified],
                [t.sumUnverified, dossier.summary.evidenceUnverified],
                [t.sumNoEvidence, dossier.summary.noEvidence],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500">{label}</p>
                  <p className="text-2xl font-black">{value}</p>
                </div>
              ))}
            </div>

            {dossier.unverified.length > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                <p className="font-bold text-amber-900">{t.unverifiedTitle}</p>
                <p className="text-sm text-amber-800">{t.unverifiedText}</p>
                <ul className="mt-2 grid gap-1">
                  {dossier.unverified.map((entry) => (
                    <li key={`${entry.kind}-${entry.id}`} className="text-sm text-amber-900">
                      <strong>{entry.ref}</strong> — {entry.title} ({entry.attachmentCount} {t.files})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-2 font-bold">{t.timeline}</h3>
              <div className="grid gap-2">
                {dossier.entries.map((entry) => (
                  <div key={`${entry.kind}-${entry.id}`} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-slate-100 bg-white p-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wide text-[#007a9f]">
                        {t.modules[entry.module] || entry.kind} · {entry.ref}
                      </p>
                      <p className="font-semibold">{entry.title}</p>
                      {entry.detail && <p className="text-sm text-slate-600">{entry.detail}</p>}
                      <p className="text-xs text-slate-500">
                        {fmtDate(entry.date, lang)}{entry.status ? ` · ${entry.status}` : ""}{entry.location ? ` · ${entry.location}` : ""}
                      </p>
                    </div>
                    <EvidenceBadge item={entry} t={t} lang={lang} />
                  </div>
                ))}
                {dossier.entries.length === 0 && <p className="text-sm text-slate-500">{t.noResults}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSearch className="size-5 text-[#005f82]" />{t.title}
          </CardTitle>
          <p className="text-sm text-slate-600">{t.subtitle}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1 text-sm font-semibold">
              {t.module}
              <Select value={filters.module} onValueChange={(value) => set({ module: value, status: "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODULES.map((module) => (
                    <SelectItem key={module} value={module}>{t.modules[module]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              {t.person}
              <Select value={filters.memberId || "all"} onValueChange={(value) => set({ memberId: value === "all" ? "" : value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.everyone}</SelectItem>
                  {team.map((person) => (
                    <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              {t.from}
              <Input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              {t.to}
              <Input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              {t.status}
              <Select value={filters.status || "any"} onValueChange={(value) => set({ status: value === "any" ? "" : value })} disabled={!statusOptions.length}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t.anyStatus}</SelectItem>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              {t.building}
              <Input value={filters.building} onChange={(e) => set({ building: e.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              {t.unit}
              <Input value={filters.unit} onChange={(e) => set({ unit: e.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              {t.searchText}
              <Input value={filters.q} placeholder={t.searchPlaceholder} onChange={(e) => set({ q: e.target.value })} />
            </label>
          </div>
          <p className="text-xs text-slate-500">{t.locationHint}</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={filters.lowStock} onChange={(e) => set({ lowStock: e.target.checked })} />
              {t.lowStock}
            </label>
            <Button onClick={() => runSearch(filters)} disabled={busy}>
              <Search className="mr-1 size-4" />{t.search}
            </Button>
            {data && <span className="text-sm font-bold text-slate-600">{data.total} {t.total}</span>}
          </div>
          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <label className="grid gap-1 text-sm font-semibold">
              {t.exportModule}
              <Select value={csvModule} onValueChange={setCsvModule}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODULES.filter((module) => module !== "all").map((module) => (
                    <SelectItem key={module} value={module}>{t.modules[module]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <a href={exportUrl}>
              <Button variant="outline"><Download className="mr-1 size-4" />{t.exportCsv}</Button>
            </a>
            <a href={printReportUrl} target="_blank" rel="noreferrer">
              <Button variant="outline"><Printer className="mr-1 size-4" />{t.printReport}</Button>
            </a>
          </div>
        </CardContent>
      </Card>

      {data && data.groups.length === 0 && (
        <p className="text-sm text-slate-500">{t.noResults}</p>
      )}
      {data?.groups.map((group) => (
        <Card key={group.module} className="rounded-3xl border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {t.modules[group.module]} · {group.items.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {group.items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-slate-100 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#007a9f]">{item.ref}</p>
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(item.date, lang)}
                    {item.status ? ` · ${item.status}` : ""}
                    {item.location ? ` · ${item.location}` : ""}
                    {item.memberName ? ` · ${item.memberName}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <EvidenceBadge item={item} t={t} lang={lang} />
                  <div className="flex gap-2">
                    {item.module === "logbook" && (
                      <Button size="sm" variant="outline" onClick={() => openCase(item.id)} disabled={busy}>{t.caseDossier}</Button>
                    )}
                    {item.unit && (
                      <Button size="sm" variant="outline" onClick={() => openUnit(item.unit as string, item.building)} disabled={busy}>{t.unitDossier}</Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {isAdmin && (
        <Card className="rounded-3xl border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-5 text-[#005f82]" />{t.adminTitle}
            </CardTitle>
            <p className="text-sm text-slate-600">{t.adminText}</p>
          </CardHeader>
          <CardContent className="grid gap-2">
            {!adminLog && (
              <Button variant="outline" onClick={loadAdmin} disabled={busy} className="w-fit">{t.adminLoad}</Button>
            )}
            {adminLog?.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-100 p-3 text-sm">
                <p><strong>{entry.action}</strong> · {entry.actorEmail}{entry.targetEmail ? ` → ${entry.targetEmail}` : ""}</p>
                <p className="text-xs text-slate-500">{fmtDate(entry.createdAt, lang)}</p>
              </div>
            ))}
            {adminLog && adminLog.length === 0 && <p className="text-sm text-slate-500">{t.noResults}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
