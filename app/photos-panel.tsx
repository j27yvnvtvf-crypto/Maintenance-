"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ImageIcon, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Language = "en" | "es";

export type PhotoRecord = {
  id: number | string; module: string; recordId: number | string | null;
  fileName: string; description: string | null; phase: string | null;
  createdAt: string; uploadedByName: string | null; signedUrl: string | null;
  workOrderId?: number | null;
};

const MODULE_VIEW: Record<string, string> = {
  jobs: "work", logbook: "logbook",
  inspections: "inspections", vendors: "visits", shop: "shop",
};
const MODULE_LABELS: Record<string, { es: string; en: string }> = {
  jobs: { es: "Trabajos", en: "Jobs" },
  logbook: { es: "Bitácora", en: "Logbook" }, inspections: { es: "Inspecciones", en: "Inspections" },
  vendors: { es: "Vendors", en: "Vendors" },
};

async function api(path: string): Promise<any> {
  const res = await fetch(path);
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function phaseLabel(phase: string | null, es: boolean) {
  if (phase === "before") return es ? "Antes" : "Before";
  if (phase === "during") return es ? "Durante" : "During";
  if (phase === "after") return es ? "Después" : "After";
  return phase || "—";
}

export function PhotosPanel({ lang, onNavigate }: {
  lang: Language;
  onNavigate: (view: string, preset?: { q?: string }) => void;
}) {
  const es = lang === "es";
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [filters, setFilters] = useState({ module: "all", phase: "all", from: "", to: "", q: "" });
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.module !== "all") params.set("module", filters.module);
      if (filters.phase !== "all") params.set("phase", filters.phase);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.q) params.set("q", filters.q);
      const data = await api(`/api/photos?${params.toString()}`);
      setPhotos(data.photos || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error"); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ImageIcon className="size-5 text-emerald-700" />{es ? "Registro fotográfico" : "Photo log"}</CardTitle>
          <p className="mt-1 text-sm text-slate-500">{es ? "Fotos de trabajos, bitácora, inspecciones y vendors, con su fase y enlace al registro." : "Photos from jobs, logbook, inspections and vendors, with phase and a link to the record."}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="min-h-11 pl-9" placeholder={es ? "Buscar descripción o archivo…" : "Search description or file…"} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Select value={filters.module} onValueChange={(v) => setFilters({ ...filters, module: v })}>
              <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{es ? "Todos los módulos" : "All modules"}</SelectItem>
                {Object.keys(MODULE_LABELS).filter((m, i, arr) => arr.indexOf(m) === i).map((m) => <SelectItem key={m} value={m}>{es ? MODULE_LABELS[m].es : MODULE_LABELS[m].en}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.phase} onValueChange={(v) => setFilters({ ...filters, phase: v })}>
              <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{es ? "Todas las fases" : "All phases"}</SelectItem>
                <SelectItem value="before">{phaseLabel("before", es)}</SelectItem>
                <SelectItem value="during">{phaseLabel("during", es)}</SelectItem>
                <SelectItem value="after">{phaseLabel("after", es)}</SelectItem>
              </SelectContent>
            </Select>
            <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Desde" : "From"}<Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
            <label className="grid gap-1 text-xs font-bold text-slate-500">{es ? "Hasta" : "To"}<Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
          </div>

          {photos.length === 0 ? (
            <p className="p-6 text-center text-slate-500">{message || (es ? "Sin fotos que coincidan." : "No photos match.")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {photos.map((photo) => {
                const view = MODULE_VIEW[photo.module] || "work";
                const recordRef = photo.workOrderId ?? photo.recordId;
                return (
                  <figure key={`${photo.module}-${photo.id}`} className="overflow-hidden rounded-3xl bg-slate-50 shadow-sm">
                    {photo.signedUrl
                      ? <img src={photo.signedUrl} alt={photo.description || photo.fileName} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                      : <div className="grid aspect-[4/3] w-full place-items-center text-slate-300"><ImageIcon className="size-10" /></div>}
                    <figcaption className="space-y-2 p-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge className={photo.phase === "before" ? "bg-slate-500" : photo.phase === "during" ? "bg-amber-500" : "bg-emerald-600"}>{phaseLabel(photo.phase, es)}</Badge>
                        <Badge variant="outline">{MODULE_LABELS[photo.module] ? (es ? MODULE_LABELS[photo.module].es : MODULE_LABELS[photo.module].en) : photo.module}</Badge>
                      </div>
                      <p className="text-sm font-semibold leading-5">{photo.description || photo.fileName}</p>
                      <p className="text-xs font-semibold text-slate-400">
                        {photo.uploadedByName || ""} · {photo.createdAt ? new Date(photo.createdAt).toLocaleString(es ? "es-US" : "en-US") : ""}
                      </p>
                      <Button variant="outline" size="sm" className="min-h-11 w-full" onClick={() => onNavigate(view, recordRef != null ? { q: String(recordRef) } : undefined)}>
                        <ExternalLink />{es ? "Ir al registro" : "Open record"}
                      </Button>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}
          <div className="flex justify-end"><Button variant="outline" onClick={() => void load()}>{es ? "Actualizar" : "Refresh"}</Button></div>
        </CardContent>
      </Card>
      {message && photos.length > 0 && <p className="text-sm text-red-600">{message}</p>}
    </div>
  );
}
