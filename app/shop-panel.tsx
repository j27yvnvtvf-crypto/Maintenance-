"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Boxes, GraduationCap, History, Package, Plus, Printer,
  Search, Snowflake, Wrench,
} from "lucide-react";
import { SOP_COLOR_CATEGORIES, sopColorLabel } from "@/lib/inventory-vendors-rules";
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

type Item = {
  id: number; name: string; colorCategory: string; quantityOnHand: number; minQuantity: number;
  unit: string | null; supplier: string | null; locationZone: string | null;
  locationShelf: string | null; locationBin: string | null; location: string;
  notes: string | null; status: string; belowMinimum: boolean; hasOpenReorder: boolean;
};
type Reorder = {
  id: number; itemId: number; itemName: string | null; quantityRequested: number;
  status: string; source: string; responsibleMemberId: number | null; responsibleName: string | null;
  notes: string | null; createdByName: string | null; orderedByName: string | null;
  orderedAt: string | null; receivedByName: string | null; receivedAt: string | null; createdAt: string;
};
type Tool = {
  id: number; name: string; description: string | null; serialNumber: string | null;
  status: string; holderMemberId: number | null; holderName: string | null;
  loanedAt: string | null; notes: string | null;
};
type Asset = {
  id: number; name: string; assetType: string | null; building: string | null; unit: string | null;
  area: string | null; location: string; brand: string | null; model: string | null;
  serialNumber: string | null; installedDate: string | null; purchaseDate: string | null;
  warrantyEndDate: string | null; warranty: string | null; manualDocumentId: number | null;
  manualTitle: string | null; status: string; notes: string | null;
};
type Refrigerant = {
  id: number; logDate: string; assetId: number | null; assetName: string | null;
  equipmentText: string | null; refrigerantType: string; amountAdded: number; amountRecovered: number;
  amountUnit: string; technicianName: string | null; reason: string | null;
  workOrderId: number | null; logEventId: number | null; createdByName: string | null;
};
type TrainingAction = {
  id: number; description: string; responsibleMemberId: number | null; responsibleName: string | null;
  dueDate: string | null; status: string; completedByName: string | null; completedAt: string | null;
};
type TrainingSession = {
  id: number; sessionDate: string; startTime: string | null; endTime: string | null;
  topic: string; presenterName: string | null; presenterMemberId: number | null;
  presenterMemberName: string | null; location: string | null; keyPoints: string | null;
  attendees: { memberId: number; name: string | null }[];
  documents: { documentId: number; versionId: number; title: string | null; versionNumber: number | null }[];
  actions: TrainingAction[]; createdByName: string | null;
};
type LibraryDoc = { id: number; title: string; versions: { id: number; versionNumber: number }[] };
type Lists = {
  items: Item[]; reorders: Reorder[]; tools: Tool[]; assets: Asset[];
  refrigerant: Refrigerant[]; training: TrainingSession[]; libraryDocs: LibraryDoc[];
};

const copy = {
  en: {
    title: "Shop", subtitle: "Inventory with the SOP 5025 color code, tools, assets, refrigerant records and training logs. Stock only changes through recorded movements.",
    sections: { inventory: "Inventory", tools: "Tools", assets: "Assets", refrigerant: "Refrigerant", training: "Training" } as Record<string, string>,
    search: "Search name, location, supplier…",
    saved: "Saved.", loadError: "Unable to load the shop data.",
    lowStock: "Below minimum", openReorder: "Reorder open", onHand: "On hand", min: "Min",
    newItem: "New item", itemName: "Item name", colorCategory: "Color category (SOP 5025)",
    initialStock: "Initial stock", unit: "Unit (ea, box, gal…)", supplier: "Supplier",
    zone: "Zone / area", shelf: "Shelf / rack", bin: "Bin", notes: "Notes",
    create: "Create", save: "Save changes", cancel: "Cancel", edit: "Edit", archive: "Archive", reactivate: "Reactivate",
    archived: "Archived", active: "Active",
    movements: "Movements", movementIn: "In", movementOut: "Out", movementAdjustment: "Adjustment",
    quantity: "Quantity", reason: "Reason / where it went", recordMovement: "Record movement",
    movementHint: "Every entry is kept in the ledger with author and date. Stock is never edited directly.",
    reorder: "Reorder requests", requestReorder: "Request reorder", toOrder: "Qty to order",
    responsible: "Responsible", sourceAuto: "Automatic (hit minimum)", sourceManual: "Manual",
    markOrdered: "Mark ordered", markReceived: "Mark received", qtyReceived: "Qty received",
    cancelRequest: "Cancel request",
    reorderStatuses: { pending: "Pending", ordered: "Ordered", received: "Received", cancelled: "Cancelled" } as Record<string, string>,
    history: "History", back: "Back", noItems: "No items yet. Create the first one — the shop starts empty on purpose; the team loads its real inventory.",
    noMovements: "No movements recorded yet.",
    printReorder: "Reorder list", printBlank: "Blank form",
    toolsTitle: "Tools", newTool: "New tool", toolName: "Tool name", description: "Description",
    serial: "Serial #", holder: "With", since: "since", loan: "Loan", returnTool: "Return",
    loanTo: "Loan to", loanHistory: "Loan history", noTools: "No tools registered yet.",
    toolStatuses: { available: "Available", loaned: "Loaned", maintenance: "Maintenance", retired: "Retired" } as Record<string, string>,
    assetsTitle: "Assets & equipment", newAsset: "New asset", assetName: "Name", assetType: "Type (free text)",
    building: "Building", aptUnit: "Unit", area: "Area", brand: "Brand", model: "Model",
    installed: "Installed", purchased: "Purchased", warrantyUntil: "Warranty until",
    warrantyActive: "In warranty", warrantyExpired: "Warranty expired",
    manual: "Manual (Library document)", noManual: "No manual linked",
    assetStatuses: { active: "Active", inactive: "Inactive", retired: "Retired" } as Record<string, string>,
    noAssets: "No assets registered yet.",
    assetHistory: "Asset history", linkedEvents: "Linked logbook events", bornHere: "Recorded from this asset",
    linkEvent: "Link a logbook event", linkWo: "Link a work order", link: "Link", alreadyLinked: "Already linked",
    refrTitle: "Refrigerant records", newRefrigerant: "New record", refrDate: "Date",
    equipment: "Equipment / asset", equipmentText: "Equipment (free text)", refrType: "Refrigerant type",
    added: "Added", recovered: "Recovered", amountUnit: "Unit", technician: "Technician",
    refrReason: "Reason / work performed",
    refrDisclaimer: "Generic usage record. The official refrigerant form has not been provided yet — the exact fields will be adjusted when Jose shares it. This record does not claim to be or replace any official form.",
    noRefrigerant: "No refrigerant records yet.",
    trainingTitle: "Training & safety meetings", newSession: "New session", sessionDate: "Date",
    startTime: "Start", endTime: "End", topic: "Topic", presenter: "Presenter", presenterName: "Presenter (name if not a member)",
    location: "Location", keyPoints: "Key points covered", attendees: "Attendees",
    docsReviewed: "Documents / SOP versions reviewed", noDocs: "No document pinned",
    actions: "Action items", addAction: "Add action", actionDescription: "Action…", dueDate: "Due",
    complete: "Complete", completedBy: "Completed by", printSession: "Print log", printLatest: "Print latest session",
    noSessions: "No sessions recorded yet.",
    trainingNote: "Read confirmations live in the Library (per document version) and are not duplicated here — this log pins the exact version reviewed in the meeting.",
    none: "—", viewLibrary: "Open in Library",
  },
  es: {
    title: "Shop", subtitle: "Inventario con el código de colores SOP 5025, herramientas, activos, registros de refrigerante y capacitación. La existencia solo cambia con movimientos registrados.",
    sections: { inventory: "Inventario", tools: "Herramientas", assets: "Activos", refrigerant: "Refrigerantes", training: "Capacitación" } as Record<string, string>,
    search: "Buscar nombre, ubicación, proveedor…",
    saved: "Guardado.", loadError: "No se pudieron cargar los datos del shop.",
    lowStock: "Bajo el mínimo", openReorder: "Reposición abierta", onHand: "Existencia", min: "Mín",
    newItem: "Artículo nuevo", itemName: "Nombre del artículo", colorCategory: "Categoría de color (SOP 5025)",
    initialStock: "Existencia inicial", unit: "Unidad (pza, caja, gal…)", supplier: "Proveedor",
    zone: "Zona / área", shelf: "Estante / rack", bin: "Bin", notes: "Notas",
    create: "Crear", save: "Guardar cambios", cancel: "Cancelar", edit: "Editar", archive: "Archivar", reactivate: "Reactivar",
    archived: "Archivado", active: "Activo",
    movements: "Movimientos", movementIn: "Entrada", movementOut: "Salida", movementAdjustment: "Ajuste",
    quantity: "Cantidad", reason: "Motivo / destino", recordMovement: "Registrar movimiento",
    movementHint: "Cada movimiento queda en el registro con autor y fecha. La existencia nunca se edita directamente.",
    reorder: "Solicitudes de reposición", requestReorder: "Solicitar reposición", toOrder: "Cant. a pedir",
    responsible: "Responsable", sourceAuto: "Automática (llegó al mínimo)", sourceManual: "Manual",
    markOrdered: "Marcar ordenada", markReceived: "Marcar recibida", qtyReceived: "Cant. recibida",
    cancelRequest: "Cancelar solicitud",
    reorderStatuses: { pending: "Pendiente", ordered: "Ordenada", received: "Recibida", cancelled: "Cancelada" } as Record<string, string>,
    history: "Historial", back: "Volver", noItems: "Sin artículos todavía. Crea el primero — el shop nace vacío a propósito; el equipo carga su inventario real.",
    noMovements: "Sin movimientos registrados todavía.",
    printReorder: "Lista de reposición", printBlank: "Formato en blanco",
    toolsTitle: "Herramientas", newTool: "Herramienta nueva", toolName: "Nombre", description: "Descripción",
    serial: "Serie #", holder: "La tiene", since: "desde", loan: "Prestar", returnTool: "Devolver",
    loanTo: "Prestar a", loanHistory: "Historial de préstamos", noTools: "Sin herramientas registradas todavía.",
    toolStatuses: { available: "Disponible", loaned: "Prestada", maintenance: "Mantenimiento", retired: "Retirada" } as Record<string, string>,
    assetsTitle: "Activos y equipos", newAsset: "Activo nuevo", assetName: "Nombre", assetType: "Tipo (texto libre)",
    building: "Edificio", aptUnit: "Apartamento", area: "Área", brand: "Marca", model: "Modelo",
    installed: "Instalado", purchased: "Comprado", warrantyUntil: "Garantía hasta",
    warrantyActive: "En garantía", warrantyExpired: "Garantía vencida",
    manual: "Manual (documento de la Biblioteca)", noManual: "Sin manual vinculado",
    assetStatuses: { active: "Activo", inactive: "Inactivo", retired: "Retirado" } as Record<string, string>,
    noAssets: "Sin activos registrados todavía.",
    assetHistory: "Historial del activo", linkedEvents: "Eventos de bitácora vinculados", bornHere: "Registrados desde este activo",
    linkEvent: "Vincular un evento de bitácora", linkWo: "Vincular una orden de trabajo", link: "Vincular", alreadyLinked: "Ya vinculado",
    refrTitle: "Registros de refrigerante", newRefrigerant: "Registro nuevo", refrDate: "Fecha",
    equipment: "Equipo / activo", equipmentText: "Equipo (texto libre)", refrType: "Tipo de refrigerante",
    added: "Agregado", recovered: "Recuperado", amountUnit: "Unidad", technician: "Técnico",
    refrReason: "Motivo / trabajo realizado",
    refrDisclaimer: "Registro genérico de uso. El formulario oficial de refrigerantes aún no se ha proporcionado — los campos exactos se ajustarán cuando Jose lo comparta. Este registro no afirma ser ni reemplazar ningún formulario oficial.",
    noRefrigerant: "Sin registros de refrigerante todavía.",
    trainingTitle: "Reuniones de capacitación y seguridad", newSession: "Sesión nueva", sessionDate: "Fecha",
    startTime: "Inicio", endTime: "Fin", topic: "Tema", presenter: "Presentador", presenterName: "Presentador (nombre si no es miembro)",
    location: "Lugar", keyPoints: "Puntos clave tratados", attendees: "Participantes",
    docsReviewed: "Documentos / versiones de SOP revisados", noDocs: "Sin documento fijado",
    actions: "Acciones pendientes", addAction: "Agregar acción", actionDescription: "Acción…", dueDate: "Vence",
    complete: "Completar", completedBy: "Completada por", printSession: "Imprimir registro", printLatest: "Imprimir última sesión",
    noSessions: "Sin sesiones registradas todavía.",
    trainingNote: "Las confirmaciones de lectura viven en la Biblioteca (por versión del documento) y no se duplican aquí — este registro fija la versión exacta revisada en la reunión.",
    none: "—", viewLibrary: "Abrir en la Biblioteca",
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

/** Attention card for the Hoy / Overview tab (light integration). */
export function ShopTodayCard({ lang, onOpen }: { lang: Language; onOpen: () => void }) {
  const t = copy[lang];
  const [summary, setSummary] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/api/shop?summary=1");
        if (!cancelled) setSummary(data);
      } catch { /* the card simply stays hidden if the shop cannot load */ }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!summary) return null;
  const quiet = summary.lowStockCount === 0 && summary.openReorders === 0
    && summary.toolsOut === 0 && summary.openVendorPendings === 0;
  return (
    <Card className="mt-4 rounded-3xl border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Boxes className="size-5 text-[#007a9f]" />{lang === "es" ? "Shop e inventario" : "Shop & inventory"}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onOpen}>{t.title}</Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-slate-600">
          {quiet ? (lang === "es" ? "Sin pendientes en el shop. " : "Nothing pending in the shop. ") : null}
          <strong>{summary.lowStockCount}</strong> {t.lowStock.toLowerCase()} ·{" "}
          <strong>{summary.openReorders}</strong> {t.reorder.toLowerCase()} ·{" "}
          <strong>{summary.toolsOut}</strong> {t.sections.tools.toLowerCase()} {lang === "es" ? "prestadas" : "out"} ·{" "}
          <strong>{summary.openVendorPendings}</strong> {lang === "es" ? "pendientes de vendor" : "vendor pendings"}
        </p>
        {(summary.lowStock || []).map((row: any) => (
          <div key={row.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-amber-50 p-3">
            <span className="font-semibold">{row.name}</span>
            <span className="flex items-center gap-2 text-sm text-slate-600">
              {sopColorLabel(row.colorCategory, lang)} · {row.quantityOnHand}/{row.minQuantity} {row.unit || ""}
              <Badge className="bg-amber-500">{t.lowStock}</Badge>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ShopPanel({ lang, team, meId }: { lang: Language; team: TeamLite[]; meId: number }) {
  const t = copy[lang];
  const [section, setSection] = useState("inventory");
  const [data, setData] = useState<Lists | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      setData(await api(`/api/shop?${params.toString()}`));
    } catch (error) { setMessage(error instanceof Error ? error.message : t.loadError); }
  }, [q, t.loadError]);

  useEffect(() => { void load(); }, [load]);

  async function act(body: unknown) {
    setBusy(true);
    try {
      const result = await api("/api/shop", body);
      setMessage(t.saved);
      await load();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally { setBusy(false); }
  }

  const sectionButtons: [string, React.ReactNode][] = [
    ["inventory", <Package key="i" className="size-4" />],
    ["tools", <Wrench key="t" className="size-4" />],
    ["assets", <Boxes key="a" className="size-4" />],
    ["refrigerant", <Snowflake key="r" className="size-4" />],
    ["training", <GraduationCap key="tr" className="size-4" />],
  ];

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Boxes className="size-5 text-[#007a9f]" />{t.title}</CardTitle>
          <p className="text-sm text-slate-500">{t.subtitle}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {sectionButtons.map(([key, icon]) => (
              <Button key={key} size="sm" variant={section === key ? "default" : "outline"}
                onClick={() => setSection(key)} className="gap-1.5">
                {icon}{t.sections[key]}
              </Button>
            ))}
          </div>
          {message && <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">{message}</p>}
        </CardContent>
      </Card>

      {section === "inventory" && (
        <InventorySection t={t} lang={lang} team={team} data={data} busy={busy} act={act}
          q={q} setQ={setQ} reload={load} setMessage={setMessage} />
      )}
      {section === "tools" && (
        <ToolsSection t={t} lang={lang} team={team} meId={meId} data={data} busy={busy} act={act} setMessage={setMessage} />
      )}
      {section === "assets" && (
        <AssetsSection t={t} lang={lang} team={team} data={data} busy={busy} act={act} setMessage={setMessage} />
      )}
      {section === "refrigerant" && (
        <RefrigerantSection t={t} lang={lang} team={team} meId={meId} data={data} busy={busy} act={act} />
      )}
      {section === "training" && (
        <TrainingSection t={t} lang={lang} team={team} data={data} busy={busy} act={act} />
      )}
    </div>
  );
}

/* ------------------------------ Inventory ------------------------------ */

function emptyItemForm() {
  return {
    name: "", colorCategory: "plumbing", quantityOnHand: "0", minQuantity: "0", unit: "",
    supplier: "", locationZone: "", locationShelf: "", locationBin: "", notes: "",
  };
}

function InventorySection({ t, lang, team, data, busy, act, q, setQ, reload, setMessage }: any) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyItemForm());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (selectedId) {
    return (
      <ItemDetail t={t} lang={lang} team={team} itemId={selectedId} busy={busy} act={act}
        setMessage={setMessage}
        onBack={() => { setSelectedId(null); void reload(); }} />
    );
  }

  const items: Item[] = (data?.items || []).filter((row: Item) => showArchived || row.status === "active");
  const openReorders: Reorder[] = (data?.reorders || [])
    .filter((row: Reorder) => row.status === "pending" || row.status === "ordered");

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder={t.search} value={q} onChange={(e: any) => setQ(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => setShowNew(!showNew)} className="gap-1.5"><Plus className="size-4" />{t.newItem}</Button>
            <a href="/print/inventory-reorder" target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5"><Printer className="size-4" />{t.printReorder}</Button>
            </a>
            <a href="/print/inventory-reorder?blank=1" target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">{t.printBlank}</Button>
            </a>
            <Button size="sm" variant="ghost" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? t.active : t.archived}
            </Button>
          </div>

          {showNew && (
            <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await act({
                  action: "create_item", name: form.name, colorCategory: form.colorCategory,
                  quantityOnHand: Number(form.quantityOnHand) || 0, minQuantity: Number(form.minQuantity) || 0,
                  unit: form.unit, supplier: form.supplier, locationZone: form.locationZone,
                  locationShelf: form.locationShelf, locationBin: form.locationBin, notes: form.notes,
                });
                if (result) { setForm(emptyItemForm()); setShowNew(false); }
              }}>
              <Field label={t.itemName}><Input required value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label={t.colorCategory}>
                <Select value={form.colorCategory} onValueChange={(v: string) => setForm({ ...form, colorCategory: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOP_COLOR_CATEGORIES.map((row) => (
                      <SelectItem key={row.key} value={row.key}>{sopColorLabel(row.key, lang)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t.initialStock}><Input type="number" min="0" step="0.01" value={form.quantityOnHand} onChange={(e: any) => setForm({ ...form, quantityOnHand: e.target.value })} /></Field>
              <Field label={t.min}><Input type="number" min="0" step="0.01" value={form.minQuantity} onChange={(e: any) => setForm({ ...form, minQuantity: e.target.value })} /></Field>
              <Field label={t.unit}><Input value={form.unit} onChange={(e: any) => setForm({ ...form, unit: e.target.value })} /></Field>
              <Field label={t.supplier}><Input value={form.supplier} onChange={(e: any) => setForm({ ...form, supplier: e.target.value })} /></Field>
              <Field label={t.zone}><Input value={form.locationZone} onChange={(e: any) => setForm({ ...form, locationZone: e.target.value })} /></Field>
              <Field label={t.shelf}><Input value={form.locationShelf} onChange={(e: any) => setForm({ ...form, locationShelf: e.target.value })} /></Field>
              <Field label={t.bin}><Input value={form.locationBin} onChange={(e: any) => setForm({ ...form, locationBin: e.target.value })} /></Field>
              <Field label={t.notes}><Input value={form.notes} onChange={(e: any) => setForm({ ...form, notes: e.target.value })} /></Field>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" size="sm" disabled={busy}>{t.create}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowNew(false)}>{t.cancel}</Button>
              </div>
            </form>
          )}

          {items.length === 0 && <p className="text-sm text-slate-500">{t.noItems}</p>}
          <div className="grid gap-2">
            {items.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3 text-left hover:bg-slate-100">
                <span>
                  <span className="font-bold">{item.name}</span>
                  <span className="block text-sm text-slate-500">
                    {sopColorLabel(item.colorCategory, lang)}{item.location ? ` · ${item.location}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{t.onHand}: {item.quantityOnHand} {item.unit || ""} · {t.min}: {item.minQuantity}</span>
                  {item.belowMinimum && <Badge className="bg-amber-500">{t.lowStock}</Badge>}
                  {item.hasOpenReorder && <Badge className="bg-sky-600">{t.openReorder}</Badge>}
                  {item.status === "archived" && <Badge className="bg-slate-400">{t.archived}</Badge>}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle className="text-lg">{t.reorder}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {openReorders.length === 0 && <p className="text-sm text-slate-500">{t.none}</p>}
          {openReorders.map((row: Reorder) => (
            <ReorderRow key={row.id} t={t} lang={lang} row={row} busy={busy} act={act} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ReorderRow({ t, lang, row, busy, act }: any) {
  const [qtyReceived, setQtyReceived] = useState(String(row.quantityRequested));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3">
      <span className="text-sm">
        <strong>{row.itemName || `#${row.itemId}`}</strong> · {t.toOrder}: {row.quantityRequested}
        <span className="block text-slate-500">
          {row.source === "auto" ? t.sourceAuto : t.sourceManual}
          {row.responsibleName ? ` · ${t.responsible}: ${row.responsibleName}` : ""}
          {row.createdByName ? ` · ${row.createdByName}` : ""} · {fmtDateTime(row.createdAt, lang)}
          {row.notes ? ` · ${row.notes}` : ""}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Badge className={row.status === "ordered" ? "bg-sky-600" : "bg-amber-500"}>{t.reorderStatuses[row.status] || row.status}</Badge>
        {row.status === "pending" && (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => act({ action: "set_reorder_status", id: row.id, status: "ordered" })}>{t.markOrdered}</Button>
        )}
        {row.status === "ordered" && (
          <>
            <Input type="number" min="0" step="0.01" className="w-24" value={qtyReceived}
              onChange={(e: any) => setQtyReceived(e.target.value)} aria-label={t.qtyReceived} />
            <Button size="sm" disabled={busy}
              onClick={() => act({ action: "set_reorder_status", id: row.id, status: "received", quantityReceived: Number(qtyReceived) || 0 })}>
              {t.markReceived}
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" disabled={busy}
          onClick={() => act({ action: "set_reorder_status", id: row.id, status: "cancelled" })}>{t.cancelRequest}</Button>
      </span>
    </div>
  );
}

function ItemDetail({ t, lang, team, itemId, busy, act, onBack, setMessage }: any) {
  const [detail, setDetail] = useState<any>(null);
  const [movement, setMovement] = useState({ type: "out", quantity: "", reason: "" });
  const [reorderForm, setReorderForm] = useState({ quantityRequested: "", responsibleMemberId: "" });
  const [edit, setEdit] = useState<any>(null);

  const loadDetail = useCallback(async () => {
    try { setDetail(await api(`/api/shop?itemId=${itemId}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, [itemId, setMessage]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function actAndReload(body: unknown) {
    const result = await act(body);
    if (result) await loadDetail();
    return result;
  }

  if (!detail?.item) {
    return (
      <Card className="rounded-3xl border-0 shadow-sm"><CardContent className="pt-5">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1.5"><ArrowLeft className="size-4" />{t.back}</Button>
      </CardContent></Card>
    );
  }
  const item: Item = detail.item;

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">{item.name}</CardTitle>
            <Button size="sm" variant="ghost" onClick={onBack} className="gap-1.5"><ArrowLeft className="size-4" />{t.back}</Button>
          </div>
          <p className="text-sm text-slate-500">
            {sopColorLabel(item.colorCategory, lang)}{item.location ? ` · ${item.location}` : ""}
            {item.supplier ? ` · ${t.supplier}: ${item.supplier}` : ""}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-slate-700">{t.onHand}: {item.quantityOnHand} {item.unit || ""}</Badge>
            <Badge variant="outline">{t.min}: {item.minQuantity}</Badge>
            {item.belowMinimum && <Badge className="bg-amber-500">{t.lowStock}</Badge>}
            {item.hasOpenReorder && <Badge className="bg-sky-600">{t.openReorder}</Badge>}
            {item.status === "archived"
              ? <Button size="sm" variant="outline" disabled={busy} onClick={() => actAndReload({ action: "set_item_status", id: item.id, status: "active" })}>{t.reactivate}</Button>
              : <Button size="sm" variant="outline" disabled={busy} onClick={() => actAndReload({ action: "set_item_status", id: item.id, status: "archived" })}>{t.archive}</Button>}
            <Button size="sm" variant="outline" onClick={() => setEdit(edit ? null : {
              name: item.name, colorCategory: item.colorCategory, minQuantity: String(item.minQuantity),
              unit: item.unit || "", supplier: item.supplier || "", locationZone: item.locationZone || "",
              locationShelf: item.locationShelf || "", locationBin: item.locationBin || "", notes: item.notes || "",
            })}>{t.edit}</Button>
          </div>
          {item.notes && <p className="text-sm text-slate-600">{item.notes}</p>}

          {edit && (
            <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await actAndReload({
                  action: "update_item", id: item.id, name: edit.name, colorCategory: edit.colorCategory,
                  minQuantity: Number(edit.minQuantity) || 0, unit: edit.unit, supplier: edit.supplier,
                  locationZone: edit.locationZone, locationShelf: edit.locationShelf,
                  locationBin: edit.locationBin, notes: edit.notes,
                });
                if (result) setEdit(null);
              }}>
              <Field label={t.itemName}><Input required value={edit.name} onChange={(e: any) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label={t.colorCategory}>
                <Select value={edit.colorCategory} onValueChange={(v: string) => setEdit({ ...edit, colorCategory: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOP_COLOR_CATEGORIES.map((row) => (
                      <SelectItem key={row.key} value={row.key}>{sopColorLabel(row.key, lang)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t.min}><Input type="number" min="0" step="0.01" value={edit.minQuantity} onChange={(e: any) => setEdit({ ...edit, minQuantity: e.target.value })} /></Field>
              <Field label={t.unit}><Input value={edit.unit} onChange={(e: any) => setEdit({ ...edit, unit: e.target.value })} /></Field>
              <Field label={t.supplier}><Input value={edit.supplier} onChange={(e: any) => setEdit({ ...edit, supplier: e.target.value })} /></Field>
              <Field label={t.zone}><Input value={edit.locationZone} onChange={(e: any) => setEdit({ ...edit, locationZone: e.target.value })} /></Field>
              <Field label={t.shelf}><Input value={edit.locationShelf} onChange={(e: any) => setEdit({ ...edit, locationShelf: e.target.value })} /></Field>
              <Field label={t.bin}><Input value={edit.locationBin} onChange={(e: any) => setEdit({ ...edit, locationBin: e.target.value })} /></Field>
              <Field label={t.notes}><Input value={edit.notes} onChange={(e: any) => setEdit({ ...edit, notes: e.target.value })} /></Field>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" size="sm" disabled={busy}>{t.save}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>{t.cancel}</Button>
              </div>
            </form>
          )}

          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="mb-2 flex items-center gap-2 font-bold"><History className="size-4" />{t.movements}</p>
            <p className="mb-3 text-xs text-slate-500">{t.movementHint}</p>
            <form className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await actAndReload({
                  action: "record_movement", itemId: item.id, type: movement.type,
                  quantity: Number(movement.quantity) || 0, reason: movement.reason,
                });
                if (result) setMovement({ type: "out", quantity: "", reason: "" });
              }}>
              <Field label={t.movements}>
                <Select value={movement.type} onValueChange={(v: string) => setMovement({ ...movement, type: v })}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">{t.movementIn}</SelectItem>
                    <SelectItem value="out">{t.movementOut}</SelectItem>
                    <SelectItem value="adjustment">{t.movementAdjustment}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t.quantity}>
                <Input type="number" step="0.01" required className="w-28" value={movement.quantity}
                  onChange={(e: any) => setMovement({ ...movement, quantity: e.target.value })} />
              </Field>
              <Field label={t.reason}>
                <Input className="min-w-44" value={movement.reason}
                  onChange={(e: any) => setMovement({ ...movement, reason: e.target.value })} />
              </Field>
              <Button type="submit" size="sm" disabled={busy}>{t.recordMovement}</Button>
            </form>
            <div className="mt-3 space-y-1.5">
              {(detail.movements || []).length === 0 && <p className="text-sm text-slate-500">{t.noMovements}</p>}
              {(detail.movements || []).map((row: any) => (
                <p key={row.id} className="text-sm text-slate-600">
                  <strong>{row.type === "in" ? t.movementIn : row.type === "out" ? t.movementOut : t.movementAdjustment}</strong>
                  {" "}{row.quantity} {item.unit || ""}{row.reason ? ` — ${row.reason}` : ""}
                  {row.workOrderLabel ? ` · ${row.workOrderLabel}` : ""}
                  <span className="text-slate-400"> · {row.actorName || row.actorEmail} · {fmtDateTime(row.createdAt, lang)}</span>
                </p>
              ))}
            </div>
          </div>

          {!item.hasOpenReorder && (
            <form className="flex flex-wrap items-end gap-2 rounded-2xl bg-slate-50 p-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await actAndReload({
                  action: "create_reorder", itemId: item.id,
                  quantityRequested: reorderForm.quantityRequested ? Number(reorderForm.quantityRequested) : undefined,
                  responsibleMemberId: reorderForm.responsibleMemberId ? Number(reorderForm.responsibleMemberId) : undefined,
                });
                if (result) setReorderForm({ quantityRequested: "", responsibleMemberId: "" });
              }}>
              <Field label={t.toOrder}>
                <Input type="number" min="0" step="0.01" className="w-28" value={reorderForm.quantityRequested}
                  onChange={(e: any) => setReorderForm({ ...reorderForm, quantityRequested: e.target.value })} />
              </Field>
              <Field label={t.responsible}>
                <Select value={reorderForm.responsibleMemberId || "none"}
                  onValueChange={(v: string) => setReorderForm({ ...reorderForm, responsibleMemberId: v === "none" ? "" : v })}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.none}</SelectItem>
                    {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" size="sm" disabled={busy}>{t.requestReorder}</Button>
            </form>
          )}

          <div>
            <p className="mb-2 font-bold">{t.history}</p>
            <div className="space-y-1.5">
              {(detail.history || []).map((row: any) => (
                <p key={row.id} className="text-sm text-slate-600">
                  {row.action}<span className="text-slate-400"> · {row.actorName || row.actorEmail} · {fmtDateTime(row.createdAt, lang)}</span>
                </p>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------- Tools -------------------------------- */

function ToolsSection({ t, lang, team, meId, data, busy, act, setMessage }: any) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", serialNumber: "", notes: "" });
  const [loanHolder, setLoanHolder] = useState<Record<number, string>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loans, setLoans] = useState<any[]>([]);

  async function toggleLoans(toolId: number) {
    if (expandedId === toolId) { setExpandedId(null); return; }
    setExpandedId(toolId);
    try {
      const detail = await api(`/api/shop?toolId=${toolId}`);
      setLoans(detail.loans || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  const tools: Tool[] = data?.tools || [];
  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{t.toolsTitle}</CardTitle>
          <Button size="sm" onClick={() => setShowNew(!showNew)} className="gap-1.5"><Plus className="size-4" />{t.newTool}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showNew && (
          <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await act({ action: "create_tool", ...form });
              if (result) { setForm({ name: "", description: "", serialNumber: "", notes: "" }); setShowNew(false); }
            }}>
            <Field label={t.toolName}><Input required value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t.serial}><Input value={form.serialNumber} onChange={(e: any) => setForm({ ...form, serialNumber: e.target.value })} /></Field>
            <Field label={t.description}><Input value={form.description} onChange={(e: any) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label={t.notes}><Input value={form.notes} onChange={(e: any) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy}>{t.create}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNew(false)}>{t.cancel}</Button>
            </div>
          </form>
        )}
        {tools.length === 0 && <p className="text-sm text-slate-500">{t.noTools}</p>}
        {tools.map((tool) => (
          <div key={tool.id} className="rounded-2xl bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                <strong>{tool.name}</strong>
                {tool.serialNumber ? <span className="text-slate-500"> · {t.serial}: {tool.serialNumber}</span> : null}
                {tool.description ? <span className="block text-slate-500">{tool.description}</span> : null}
                {tool.status === "loaned" && tool.holderName
                  ? <span className="block text-slate-500">{t.holder}: {tool.holderName} · {t.since} {fmtDateTime(tool.loanedAt, lang)}</span> : null}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge className={tool.status === "available" ? "bg-emerald-600" : tool.status === "loaned" ? "bg-sky-600" : "bg-slate-400"}>
                  {t.toolStatuses[tool.status] || tool.status}
                </Badge>
                {tool.status === "available" && (
                  <>
                    <Select value={loanHolder[tool.id] || String(meId)}
                      onValueChange={(v: string) => setLoanHolder({ ...loanHolder, [tool.id]: v })}>
                      <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" disabled={busy}
                      onClick={() => act({ action: "loan_tool", toolId: tool.id, holderMemberId: Number(loanHolder[tool.id] || meId) })}>{t.loan}</Button>
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => act({ action: "set_tool_status", id: tool.id, status: "maintenance" })}>{t.toolStatuses.maintenance}</Button>
                  </>
                )}
                {tool.status === "loaned" && (
                  <Button size="sm" disabled={busy} onClick={() => act({ action: "return_tool", toolId: tool.id })}>{t.returnTool}</Button>
                )}
                {tool.status === "maintenance" && (
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => act({ action: "set_tool_status", id: tool.id, status: "available" })}>{t.toolStatuses.available}</Button>
                )}
                {tool.status !== "retired" && tool.status !== "loaned" && (
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => act({ action: "set_tool_status", id: tool.id, status: "retired" })}>{t.toolStatuses.retired}</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => toggleLoans(tool.id)}>{t.loanHistory}</Button>
              </span>
            </div>
            {expandedId === tool.id && (
              <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                {loans.length === 0 && <p className="text-sm text-slate-500">{t.none}</p>}
                {loans.map((row) => (
                  <p key={row.id} className="text-sm text-slate-600">
                    {row.action === "loan" ? t.loan : t.returnTool} — {row.holderName || t.none}
                    <span className="text-slate-400"> · {row.actorName || ""} · {fmtDateTime(row.createdAt, lang)}{row.note ? ` · ${row.note}` : ""}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Assets ------------------------------- */

function emptyAssetForm() {
  return {
    name: "", assetType: "", building: "", unit: "", area: "", brand: "", model: "",
    serialNumber: "", installedDate: "", purchaseDate: "", warrantyEndDate: "",
    manualDocumentId: "", notes: "",
  };
}

function AssetFormFields({ t, form, setForm, libraryDocs }: any) {
  return (
    <>
      <Field label={t.assetName}><Input required value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label={t.assetType}><Input value={form.assetType} onChange={(e: any) => setForm({ ...form, assetType: e.target.value })} /></Field>
      <Field label={t.building}><Input value={form.building} onChange={(e: any) => setForm({ ...form, building: e.target.value })} /></Field>
      <Field label={t.aptUnit}><Input value={form.unit} onChange={(e: any) => setForm({ ...form, unit: e.target.value })} /></Field>
      <Field label={t.area}><Input value={form.area} onChange={(e: any) => setForm({ ...form, area: e.target.value })} /></Field>
      <Field label={t.brand}><Input value={form.brand} onChange={(e: any) => setForm({ ...form, brand: e.target.value })} /></Field>
      <Field label={t.model}><Input value={form.model} onChange={(e: any) => setForm({ ...form, model: e.target.value })} /></Field>
      <Field label={t.serial}><Input value={form.serialNumber} onChange={(e: any) => setForm({ ...form, serialNumber: e.target.value })} /></Field>
      <Field label={t.installed}><Input type="date" value={form.installedDate} onChange={(e: any) => setForm({ ...form, installedDate: e.target.value })} /></Field>
      <Field label={t.purchased}><Input type="date" value={form.purchaseDate} onChange={(e: any) => setForm({ ...form, purchaseDate: e.target.value })} /></Field>
      <Field label={t.warrantyUntil}><Input type="date" value={form.warrantyEndDate} onChange={(e: any) => setForm({ ...form, warrantyEndDate: e.target.value })} /></Field>
      <Field label={t.manual}>
        <Select value={form.manualDocumentId || "none"}
          onValueChange={(v: string) => setForm({ ...form, manualDocumentId: v === "none" ? "" : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t.noManual}</SelectItem>
            {(libraryDocs || []).map((doc: LibraryDoc) => <SelectItem key={doc.id} value={String(doc.id)}>{doc.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t.notes}><Input value={form.notes} onChange={(e: any) => setForm({ ...form, notes: e.target.value })} /></Field>
    </>
  );
}

function AssetsSection({ t, lang, data, busy, act, setMessage }: any) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyAssetForm());
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (selectedId) {
    return (
      <AssetDetail t={t} lang={lang} assetId={selectedId} data={data} busy={busy} act={act}
        setMessage={setMessage} onBack={() => setSelectedId(null)} />
    );
  }

  const assets: Asset[] = data?.assets || [];
  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{t.assetsTitle}</CardTitle>
          <Button size="sm" onClick={() => setShowNew(!showNew)} className="gap-1.5"><Plus className="size-4" />{t.newAsset}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showNew && (
          <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await act({
                action: "create_asset", ...form,
                manualDocumentId: form.manualDocumentId ? Number(form.manualDocumentId) : undefined,
              });
              if (result) { setForm(emptyAssetForm()); setShowNew(false); }
            }}>
            <AssetFormFields t={t} form={form} setForm={setForm} libraryDocs={data?.libraryDocs || []} />
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy}>{t.create}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNew(false)}>{t.cancel}</Button>
            </div>
          </form>
        )}
        {assets.length === 0 && <p className="text-sm text-slate-500">{t.noAssets}</p>}
        <div className="grid gap-2">
          {assets.map((asset) => (
            <button key={asset.id} type="button" onClick={() => setSelectedId(asset.id)}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3 text-left hover:bg-slate-100">
              <span>
                <span className="font-bold">{asset.name}</span>
                <span className="block text-sm text-slate-500">
                  {[asset.assetType, asset.location, asset.brand, asset.model].filter(Boolean).join(" · ") || t.none}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {asset.warranty === "active" && <Badge className="bg-emerald-600">{t.warrantyActive}</Badge>}
                {asset.warranty === "expired" && <Badge className="bg-red-600">{t.warrantyExpired}</Badge>}
                <Badge className={asset.status === "active" ? "bg-slate-700" : "bg-slate-400"}>
                  {t.assetStatuses[asset.status] || asset.status}
                </Badge>
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AssetDetail({ t, lang, assetId, data, busy, act, onBack, setMessage }: any) {
  const [detail, setDetail] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [linkEventId, setLinkEventId] = useState("");
  const [linkWoId, setLinkWoId] = useState("");
  const [eventForm, setEventForm] = useState({ eventType: "equipment_failure", description: "", priority: "medium" });

  const loadDetail = useCallback(async () => {
    try { setDetail(await api(`/api/shop?assetId=${assetId}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, [assetId, setMessage]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function actAndReload(body: unknown) {
    const result = await act(body);
    if (result) await loadDetail();
    return result;
  }

  if (!detail?.asset) {
    return (
      <Card className="rounded-3xl border-0 shadow-sm"><CardContent className="pt-5">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1.5"><ArrowLeft className="size-4" />{t.back}</Button>
      </CardContent></Card>
    );
  }
  const asset: Asset = detail.asset;

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">{asset.name}</CardTitle>
            <Button size="sm" variant="ghost" onClick={onBack} className="gap-1.5"><ArrowLeft className="size-4" />{t.back}</Button>
          </div>
          <p className="text-sm text-slate-500">
            {[asset.assetType, asset.location, asset.brand, asset.model, asset.serialNumber ? `${t.serial}: ${asset.serialNumber}` : ""]
              .filter(Boolean).join(" · ") || t.none}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {asset.installedDate && <span>{t.installed}: {asset.installedDate}</span>}
            {asset.purchaseDate && <span>{t.purchased}: {asset.purchaseDate}</span>}
            {asset.warrantyEndDate && (
              <span className="flex items-center gap-2">{t.warrantyUntil}: {asset.warrantyEndDate}
                {asset.warranty === "active" && <Badge className="bg-emerald-600">{t.warrantyActive}</Badge>}
                {asset.warranty === "expired" && <Badge className="bg-red-600">{t.warrantyExpired}</Badge>}
              </span>
            )}
            <span>{t.manual}: {asset.manualTitle || t.noManual}</span>
          </div>
          {asset.notes && <p className="text-sm text-slate-600">{asset.notes}</p>}
          <div className="flex flex-wrap gap-2">
            {(["active", "inactive", "retired"] as const).filter((s) => s !== asset.status).map((s) => (
              <Button key={s} size="sm" variant="outline" disabled={busy}
                onClick={() => actAndReload({ action: "set_asset_status", id: asset.id, status: s })}>
                {t.assetStatuses[s]}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => setEdit(edit ? null : {
              name: asset.name, assetType: asset.assetType || "", building: asset.building || "",
              unit: asset.unit || "", area: asset.area || "", brand: asset.brand || "", model: asset.model || "",
              serialNumber: asset.serialNumber || "", installedDate: asset.installedDate || "",
              purchaseDate: asset.purchaseDate || "", warrantyEndDate: asset.warrantyEndDate || "",
              manualDocumentId: asset.manualDocumentId ? String(asset.manualDocumentId) : "", notes: asset.notes || "",
            })}>{t.edit}</Button>
          </div>

          {edit && (
            <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await actAndReload({
                  action: "update_asset", id: asset.id, ...edit,
                  manualDocumentId: edit.manualDocumentId ? Number(edit.manualDocumentId) : null,
                });
                if (result) setEdit(null);
              }}>
              <AssetFormFields t={t} form={edit} setForm={setEdit} libraryDocs={data?.libraryDocs || []} />
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" size="sm" disabled={busy}>{t.save}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>{t.cancel}</Button>
              </div>
            </form>
          )}

          <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
            <form className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!linkEventId) return;
                const result = await actAndReload({ action: "link_asset_event", assetId: asset.id, logEventId: Number(linkEventId) });
                if (result) setLinkEventId("");
              }}>
              <Field label={t.linkEvent}>
                <Select value={linkEventId || "none"} onValueChange={(v: string) => setLinkEventId(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.none}</SelectItem>
                    {(detail.linkOptions?.logEvents || []).map((row: any) => (
                      <SelectItem key={row.id} value={String(row.id)}>{row.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" size="sm" disabled={busy || !linkEventId}>{t.link}</Button>
            </form>
            <form className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!linkWoId) return;
                const result = await actAndReload({ action: "link_asset_work_order", assetId: asset.id, workOrderId: Number(linkWoId) });
                if (result) setLinkWoId("");
              }}>
              <Field label={t.linkWo}>
                <Select value={linkWoId || "none"} onValueChange={(v: string) => setLinkWoId(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.none}</SelectItem>
                    {(detail.linkOptions?.workOrders || []).map((row: any) => (
                      <SelectItem key={row.id} value={String(row.id)}>{row.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" size="sm" disabled={busy || !linkWoId}>{t.link}</Button>
            </form>
          </div>

          <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/api/logbook", {
                  action: "create_event", eventType: eventForm.eventType,
                  description: eventForm.description, priority: eventForm.priority,
                  building: asset.building || undefined, unit: asset.unit || undefined,
                  area: asset.area || undefined, equipment: asset.name, assetId: asset.id,
                });
                setEventForm({ eventType: "equipment_failure", description: "", priority: "medium" });
                await loadDetail();
              } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
            }}>
            <p className="font-bold sm:col-span-3">{lang === "es" ? "Nuevo evento de bitácora para este activo" : "New logbook event for this asset"}</p>
            <Field label={lang === "es" ? "Tipo" : "Type"}>
              <Select value={eventForm.eventType} onValueChange={(v: string) => setEventForm({ ...eventForm, eventType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["leak", "equipment_failure", "emergency_call", "damage", "vendor_visit", "inspection", "repair", "other"].map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={lang === "es" ? "Prioridad" : "Priority"}>
              <Select value={eventForm.priority} onValueChange={(v: string) => setEventForm({ ...eventForm, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["low", "medium", "high", "emergency"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={lang === "es" ? "Descripción" : "Description"}>
              <Input required value={eventForm.description} onChange={(e: any) => setEventForm({ ...eventForm, description: e.target.value })} />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">{lang === "es" ? "Registrar evento" : "Register event"}</Button>
            </div>
          </form>

          <div>
            <p className="mb-2 font-bold">{t.linkedEvents}</p>
            <div className="space-y-1.5">
              {(detail.bornEvents || []).map((row: any) => (
                <p key={`born-${row.id}`} className="text-sm text-slate-600">
                  {row.label} <Badge variant="outline">{t.bornHere}</Badge>
                  <span className="text-slate-400"> · {row.status} · {fmtDateTime(row.occurredAt, lang)}</span>
                </p>
              ))}
              {(detail.links || []).map((row: any) => (
                <p key={`link-${row.id}`} className="text-sm text-slate-600">
                  {row.logEventLabel || row.workOrderLabel || t.none}
                  <span className="text-slate-400"> · {fmtDateTime(row.createdAt, lang)}</span>
                </p>
              ))}
              {(detail.bornEvents || []).length === 0 && (detail.links || []).length === 0
                && <p className="text-sm text-slate-500">{t.none}</p>}
            </div>
          </div>

          <div>
            <p className="mb-2 font-bold">{t.assetHistory}</p>
            <div className="space-y-1.5">
              {(detail.history || []).map((row: any) => (
                <p key={row.id} className="text-sm text-slate-600">
                  {row.action}<span className="text-slate-400"> · {row.actorName || row.actorEmail} · {fmtDateTime(row.createdAt, lang)}</span>
                </p>
              ))}
            </div>
          </div>

          {(detail.refrigerant || []).length > 0 && (
            <div>
              <p className="mb-2 font-bold">{t.refrTitle}</p>
              <div className="space-y-1.5">
                {(detail.refrigerant || []).map((row: any) => (
                  <p key={row.id} className="text-sm text-slate-600">
                    {row.logDate} · {row.refrigerantType} · +{row.amountAdded} / −{row.amountRecovered} {row.amountUnit}
                    {row.reason ? ` — ${row.reason}` : ""}
                    <span className="text-slate-400"> · {row.technicianName || ""}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------- Refrigerant ----------------------------- */

function RefrigerantSection({ t, team, meId, data, busy, act }: any) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    logDate: "", assetId: "", equipmentText: "", refrigerantType: "", amountAdded: "0",
    amountRecovered: "0", amountUnit: "lb", technicianMemberId: "", reason: "",
  });
  const rows: Refrigerant[] = data?.refrigerant || [];
  const assets: Asset[] = data?.assets || [];
  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{t.refrTitle}</CardTitle>
          <Button size="sm" onClick={() => setShowNew(!showNew)} className="gap-1.5"><Plus className="size-4" />{t.newRefrigerant}</Button>
        </div>
        <p className="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{t.refrDisclaimer}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {showNew && (
          <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await act({
                action: "log_refrigerant", logDate: form.logDate || undefined,
                assetId: form.assetId ? Number(form.assetId) : undefined,
                equipmentText: form.equipmentText, refrigerantType: form.refrigerantType,
                amountAdded: Number(form.amountAdded) || 0, amountRecovered: Number(form.amountRecovered) || 0,
                amountUnit: form.amountUnit,
                technicianMemberId: form.technicianMemberId ? Number(form.technicianMemberId) : undefined,
                reason: form.reason,
              });
              if (result) {
                setForm({ logDate: "", assetId: "", equipmentText: "", refrigerantType: "", amountAdded: "0", amountRecovered: "0", amountUnit: "lb", technicianMemberId: "", reason: "" });
                setShowNew(false);
              }
            }}>
            <Field label={t.refrDate}><Input type="date" value={form.logDate} onChange={(e: any) => setForm({ ...form, logDate: e.target.value })} /></Field>
            <Field label={t.equipment}>
              <Select value={form.assetId || "none"} onValueChange={(v: string) => setForm({ ...form, assetId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.none}</SelectItem>
                  {assets.map((asset) => <SelectItem key={asset.id} value={String(asset.id)}>{asset.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.equipmentText}><Input value={form.equipmentText} onChange={(e: any) => setForm({ ...form, equipmentText: e.target.value })} /></Field>
            <Field label={t.refrType}><Input required placeholder="R-410A, R-22…" value={form.refrigerantType} onChange={(e: any) => setForm({ ...form, refrigerantType: e.target.value })} /></Field>
            <Field label={t.added}><Input type="number" min="0" step="0.01" value={form.amountAdded} onChange={(e: any) => setForm({ ...form, amountAdded: e.target.value })} /></Field>
            <Field label={t.recovered}><Input type="number" min="0" step="0.01" value={form.amountRecovered} onChange={(e: any) => setForm({ ...form, amountRecovered: e.target.value })} /></Field>
            <Field label={t.amountUnit}><Input value={form.amountUnit} onChange={(e: any) => setForm({ ...form, amountUnit: e.target.value })} /></Field>
            <Field label={t.technician}>
              <Select value={form.technicianMemberId || String(meId)}
                onValueChange={(v: string) => setForm({ ...form, technicianMemberId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.refrReason}><Input value={form.reason} onChange={(e: any) => setForm({ ...form, reason: e.target.value })} /></Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy}>{t.create}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNew(false)}>{t.cancel}</Button>
            </div>
          </form>
        )}
        {rows.length === 0 && <p className="text-sm text-slate-500">{t.noRefrigerant}</p>}
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3 text-sm">
            <span>
              <strong>{row.logDate}</strong> · {row.refrigerantType} · {row.assetName || row.equipmentText || t.none}
              {row.reason ? <span className="block text-slate-500">{row.reason}</span> : null}
            </span>
            <span className="text-slate-600">
              +{row.amountAdded} / −{row.amountRecovered} {row.amountUnit}
              {row.technicianName ? ` · ${row.technicianName}` : ""}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Training ------------------------------- */

function TrainingSection({ t, team, data, busy, act }: any) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    sessionDate: "", startTime: "", endTime: "", topic: "", presenterMemberId: "",
    presenterName: "", location: "", keyPoints: "",
    attendeeIds: [] as number[], documentVersionIds: [] as number[],
  });
  const [actionForms, setActionForms] = useState<Record<number, { description: string; responsibleMemberId: string; dueDate: string }>>({});
  const sessions: TrainingSession[] = data?.training || [];
  const libraryDocs: LibraryDoc[] = data?.libraryDocs || [];

  function toggle(list: number[], value: number) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{t.trainingTitle}</CardTitle>
          <span className="flex gap-2">
            <a href="/print/training-log" target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5"><Printer className="size-4" />{t.printLatest}</Button>
            </a>
            <a href="/print/training-log?blank=1" target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">{t.printBlank}</Button>
            </a>
            <Button size="sm" onClick={() => setShowNew(!showNew)} className="gap-1.5"><Plus className="size-4" />{t.newSession}</Button>
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">{t.trainingNote}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {showNew && (
          <form className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await act({
                action: "create_training_session", sessionDate: form.sessionDate,
                startTime: form.startTime, endTime: form.endTime, topic: form.topic,
                presenterMemberId: form.presenterMemberId ? Number(form.presenterMemberId) : undefined,
                presenterName: form.presenterName, location: form.location, keyPoints: form.keyPoints,
                attendeeIds: form.attendeeIds, documentVersionIds: form.documentVersionIds,
              });
              if (result) {
                setForm({ sessionDate: "", startTime: "", endTime: "", topic: "", presenterMemberId: "", presenterName: "", location: "", keyPoints: "", attendeeIds: [], documentVersionIds: [] });
                setShowNew(false);
              }
            }}>
            <Field label={t.sessionDate}><Input type="date" required value={form.sessionDate} onChange={(e: any) => setForm({ ...form, sessionDate: e.target.value })} /></Field>
            <Field label={t.topic}><Input required value={form.topic} onChange={(e: any) => setForm({ ...form, topic: e.target.value })} /></Field>
            <Field label={t.startTime}><Input type="time" value={form.startTime} onChange={(e: any) => setForm({ ...form, startTime: e.target.value })} /></Field>
            <Field label={t.endTime}><Input type="time" value={form.endTime} onChange={(e: any) => setForm({ ...form, endTime: e.target.value })} /></Field>
            <Field label={t.presenter}>
              <Select value={form.presenterMemberId || "none"}
                onValueChange={(v: string) => setForm({ ...form, presenterMemberId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.none}</SelectItem>
                  {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.presenterName}><Input value={form.presenterName} onChange={(e: any) => setForm({ ...form, presenterName: e.target.value })} /></Field>
            <Field label={t.location}><Input value={form.location} onChange={(e: any) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label={t.keyPoints}><Textarea value={form.keyPoints} onChange={(e: any) => setForm({ ...form, keyPoints: e.target.value })} /></Field>
            <div className="sm:col-span-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.attendees}</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {team.map((person: TeamLite) => (
                  <Button key={person.id} type="button" size="sm"
                    variant={form.attendeeIds.includes(person.id) ? "default" : "outline"}
                    onClick={() => setForm({ ...form, attendeeIds: toggle(form.attendeeIds, person.id) })}>
                    {person.name}
                  </Button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.docsReviewed}</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {libraryDocs.length === 0 && <span className="text-sm text-slate-500">{t.noDocs}</span>}
                {libraryDocs.flatMap((doc) => doc.versions.map((version) => (
                  <Button key={version.id} type="button" size="sm"
                    variant={form.documentVersionIds.includes(version.id) ? "default" : "outline"}
                    onClick={() => setForm({ ...form, documentVersionIds: toggle(form.documentVersionIds, version.id) })}>
                    {doc.title} — v{version.versionNumber}
                  </Button>
                )))}
              </div>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy}>{t.create}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNew(false)}>{t.cancel}</Button>
            </div>
          </form>
        )}

        {sessions.length === 0 && <p className="text-sm text-slate-500">{t.noSessions}</p>}
        {sessions.map((session) => {
          const actionForm = actionForms[session.id] || { description: "", responsibleMemberId: "", dueDate: "" };
          return (
            <div key={session.id} className="rounded-2xl bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{session.sessionDate} — {session.topic}</p>
                <a href={`/print/training-log?session=${session.id}`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5"><Printer className="size-4" />{t.printSession}</Button>
                </a>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {[session.presenterName || session.presenterMemberName, session.location,
                  session.startTime ? `${session.startTime}–${session.endTime || ""}` : ""].filter(Boolean).join(" · ")}
              </p>
              {session.keyPoints && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{session.keyPoints}</p>}
              <p className="mt-2 text-sm">
                <strong>{t.docsReviewed}:</strong>{" "}
                {session.documents.length
                  ? session.documents.map((doc) => `${doc.title || ""} — v${doc.versionNumber ?? "?"}`).join(" · ")
                  : t.noDocs}
              </p>
              <p className="mt-1 text-sm">
                <strong>{t.attendees}:</strong>{" "}
                {session.attendees.map((a) => a.name).filter(Boolean).join(", ") || t.none}
              </p>
              <div className="mt-3 space-y-2">
                <p className="font-bold">{t.actions}</p>
                {session.actions.map((action) => (
                  <div key={action.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-2.5 text-sm">
                    <span>
                      {action.status === "completed" ? "✓ " : ""}{action.description}
                      <span className="block text-slate-500">
                        {action.responsibleName || t.none}{action.dueDate ? ` · ${t.dueDate}: ${action.dueDate}` : ""}
                        {action.status === "completed" && action.completedByName ? ` · ${t.completedBy}: ${action.completedByName}` : ""}
                      </span>
                    </span>
                    {action.status !== "completed" && (
                      <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => act({ action: "complete_training_action", id: action.id })}>{t.complete}</Button>
                    )}
                  </div>
                ))}
                <form className="flex flex-wrap items-end gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const result = await act({
                      action: "create_training_action", sessionId: session.id,
                      description: actionForm.description,
                      responsibleMemberId: actionForm.responsibleMemberId ? Number(actionForm.responsibleMemberId) : undefined,
                      dueDate: actionForm.dueDate || undefined,
                    });
                    if (result) setActionForms({ ...actionForms, [session.id]: { description: "", responsibleMemberId: "", dueDate: "" } });
                  }}>
                  <Input className="min-w-44 flex-1" placeholder={t.actionDescription} required value={actionForm.description}
                    onChange={(e: any) => setActionForms({ ...actionForms, [session.id]: { ...actionForm, description: e.target.value } })} />
                  <Select value={actionForm.responsibleMemberId || "none"}
                    onValueChange={(v: string) => setActionForms({ ...actionForms, [session.id]: { ...actionForm, responsibleMemberId: v === "none" ? "" : v } })}>
                    <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t.none}</SelectItem>
                      {team.map((person: TeamLite) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="date" className="w-[150px]" value={actionForm.dueDate}
                    onChange={(e: any) => setActionForms({ ...actionForms, [session.id]: { ...actionForm, dueDate: e.target.value } })} />
                  <Button type="submit" size="sm" disabled={busy}>{t.addAction}</Button>
                </form>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
