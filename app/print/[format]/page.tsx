import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient, createUserClient } from "@/lib/supabase/server";
import { getCurrentMember, isApproved, type MemberRow } from "@/lib/access";
import { localDate } from "@/lib/time";
import { PrintButton } from "../print-button";

export const dynamic = "force-dynamic";

/**
 * Printable operating formats (Phase 1) — clean Letter sheets.
 *
 * Data-connected formats (real work orders and team data, approved
 * accounts only):
 *   daily-assignments — Daily Assignment Sheet for one day
 *   weekly-plan       — Weekly Maintenance Plan for one Mon–Sun week
 *   shop-closing      — Shop Closing Checklist: prints the real daily
 *                       closing record (Phase 3A inspections module)
 *                       when one exists for the date; otherwise the
 *                       published template's items or the blank form.
 *
 * Structured paper templates (their data modules arrive in later
 * phases; they are complete printable forms with every field and row,
 * intentionally WITHOUT any data-capture form, so nothing is typed
 * twice):
 *   pending-parts-vendors — Pending Parts & Vendor Log
 *   inventory-reorder     — Inventory Reorder List
 *   training-log          — Training & Safety Meeting Log
 *
 * Access rule (same as every property datum): an unapproved account sees
 * only a notice — never the data formats — and an unauthenticated visitor
 * is sent to sign in.
 */

const FORMATS = [
  "daily-assignments", "weekly-plan", "pending-parts-vendors",
  "inventory-reorder", "shop-closing", "training-log",
] as const;
type Format = (typeof FORMATS)[number];

type Lang = "en" | "es";

const copy = {
  en: {
    department: "Maintenance Department",
    generated: "Generated",
    folio: "Folio",
    back: "Back to the app",
    print: "Print / Save PDF",
    preparedBy: "Prepared by",
    date: "Date",
    weekOf: "Week of",
    signature: "Signature",
    notes: "Notes",
    noAccessTitle: "Access pending",
    noAccessText: "These forms contain property data and are available only for approved accounts. The administrator must approve your access first.",
    unassigned: "Unassigned",
    dueToday: "Assignments due (incl. overdue)",
    completedToday: "Completed today",
    noJobs: "No work orders in this section.",
    weeklyLoad: "Work load by team member (due this week)",
    member: "Team member",
    count: "Work orders",
    priorities: "Priorities of the week",
    dailyTitle: "Daily Assignment Sheet",
    weeklyTitle: "Weekly Maintenance Plan",
    pendingTitle: "Pending Parts & Vendor Log",
    reorderTitle: "Inventory Reorder List",
    closingTitle: "Shop Closing Checklist",
    trainingTitle: "Training & Safety Meeting Log",
    cols: {
      wo: "WO #", area: "Unit / Area", work: "Work", priority: "Priority",
      status: "Status", due: "Due", day: "Day",
      pDate: "Date", partService: "Part / service needed", vendor: "Vendor",
      ordered: "Ordered / visit scheduled", expected: "Expected",
      receivedBy: "Received / verified by",
      item: "Item", location: "Shop location", color: "Color (SOP 5025)",
      onHand: "On hand", min: "Min", toOrder: "To order", supplier: "Supplier",
      orderedBox: "Ord.", check: "Done", itemCheck: "Check", initials: "Init.",
      name: "Name (print)", jobTitle: "Position / Job Title",
      action: "Action item", owner: "Owner",
    },
    closingItems: [
      "All tools returned to their place and tool log updated",
      "Equipment and machines turned off",
      "Paints and chemicals closed and stored in their area",
      "Flammables stored in the safety cabinet",
      "Refrigerant log updated (if any cylinder was used)",
      "Work areas and benches clean and clear",
      "Trash removed from the shop",
      "Golf cart / vehicles parked and charging (if applies)",
      "Keys returned to the key box",
      "Doors, gates and shop access locked",
      "Lights off",
      "Pending issues noted below for the next shift",
    ],
    closingIssues: "Issues or pending work to report",
    completedBy: "Completed by",
    time: "Time",
    sopColors: "SOP 5025 color code — Yellow: paints & chemicals · Dark green: cleaning · Brown: construction materials · Orange: hardware · Maroon: lighting · White: appliances · Green: electrical · Blue: plumbing · Red: HVAC · Yellow (safety wall): safety",
    topic: "Topic / SOP reviewed",
    presentedBy: "Presented by",
    location: "Location",
    startEnd: "Start / end time",
    duration: "Duration",
    attendees: "Attendees",
    keyPoints: "Key points covered",
    actionItems: "Action items",
    docsReviewed: "Documents / SOP versions reviewed",
  },
  es: {
    department: "Departamento de Mantenimiento",
    generated: "Generado",
    folio: "Folio",
    back: "Volver a la app",
    print: "Imprimir / Guardar PDF",
    preparedBy: "Preparado por",
    date: "Fecha",
    weekOf: "Semana del",
    signature: "Firma",
    notes: "Notas",
    noAccessTitle: "Acceso pendiente",
    noAccessText: "Estos formatos contienen datos de la propiedad y solo están disponibles para cuentas aprobadas. El administrador debe aprobar tu acceso primero.",
    unassigned: "Sin asignar",
    dueToday: "Asignaciones vencidas y del día",
    completedToday: "Completado hoy",
    noJobs: "No hay órdenes en esta sección.",
    weeklyLoad: "Carga de trabajo por miembro (vence esta semana)",
    member: "Miembro del equipo",
    count: "Órdenes",
    priorities: "Prioridades de la semana",
    dailyTitle: "Hoja de Asignaciones del Día",
    weeklyTitle: "Plan Semanal de Mantenimiento",
    pendingTitle: "Registro de Partes y Vendors Pendientes",
    reorderTitle: "Lista de Reposición de Inventario",
    closingTitle: "Checklist de Cierre del Shop",
    trainingTitle: "Registro de Reunión de Capacitación y Seguridad",
    cols: {
      wo: "WO #", area: "Unidad / Área", work: "Trabajo", priority: "Prioridad",
      status: "Estado", due: "Vence", day: "Día",
      pDate: "Fecha", partService: "Parte / servicio necesario", vendor: "Vendor",
      ordered: "Pedido / visita programada", expected: "Esperado",
      receivedBy: "Recibido / verificado por",
      item: "Artículo", location: "Ubicación en el shop", color: "Color (SOP 5025)",
      onHand: "Existencia", min: "Mín", toOrder: "A pedir", supplier: "Proveedor",
      orderedBox: "Ped.", check: "Hecho", itemCheck: "Revisión", initials: "Inic.",
      name: "Nombre (letra de molde)", jobTitle: "Posición / Job Title",
      action: "Acción pendiente", owner: "Responsable",
    },
    closingItems: [
      "Todas las herramientas devueltas a su lugar y registro actualizado",
      "Equipos y máquinas apagados",
      "Pinturas y químicos cerrados y guardados en su área",
      "Inflamables guardados en el gabinete de seguridad",
      "Registro de refrigerantes actualizado (si se usó algún cilindro)",
      "Áreas de trabajo y mesas limpias y despejadas",
      "Basura retirada del shop",
      "Carrito de golf / vehículos estacionados y cargando (si aplica)",
      "Llaves devueltas a la caja de llaves",
      "Puertas, portones y accesos del shop cerrados con llave",
      "Luces apagadas",
      "Pendientes anotados abajo para el próximo turno",
    ],
    closingIssues: "Problemas o trabajo pendiente por reportar",
    completedBy: "Completado por",
    time: "Hora",
    sopColors: "Código de colores SOP 5025 — Amarillo: pinturas y químicos · Verde oscuro: limpieza · Marrón: materiales de construcción · Naranja: herrajes · Granate: iluminación · Blanco: electrodomésticos · Verde: electricidad · Azul: plomería · Rojo: HVAC · Amarillo (muro de seguridad): seguridad",
    topic: "Tema / SOP revisado",
    presentedBy: "Presentado por",
    location: "Lugar",
    startEnd: "Hora de inicio / fin",
    duration: "Duración",
    attendees: "Participantes",
    keyPoints: "Puntos clave tratados",
    actionItems: "Acciones pendientes",
    docsReviewed: "Documentos / versiones de SOP revisados",
  },
} as const;

type WorkOrderRow = {
  id: number; title: string; description: string; area: string; category: string;
  priority: string; status: string; assigned_to: number | null; due_date: string | null;
  completion_comment: string | null; resident_note: string | null;
  created_at: string; updated_at: string;
};

function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function mondayOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

function prettyDate(ymd: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric",
  }).format(new Date(`${ymd}T12:00:00Z`));
}

function shortDate(ymd: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
  }).format(new Date(`${ymd}T12:00:00Z`));
}

function validYmd(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function priorityRank(priority: string) {
  return { emergency: 0, high: 1, medium: 2, low: 3 }[priority] ?? 4;
}

function JobRows({ jobs, names, t, showAssignee }: {
  jobs: WorkOrderRow[]; names: Map<number, string>;
  t: (typeof copy)["en"] | (typeof copy)["es"]; showAssignee?: boolean;
}) {
  if (!jobs.length) return <p className="print-empty">{t.noJobs}</p>;
  return (
    <table className="print-table">
      <thead>
        <tr>
          <th style={{ width: "7%" }}>{t.cols.wo}</th>
          <th style={{ width: "13%" }}>{t.cols.area}</th>
          <th>{t.cols.work}</th>
          {showAssignee && <th style={{ width: "15%" }}>{t.member}</th>}
          <th style={{ width: "11%" }}>{t.cols.priority}</th>
          <th style={{ width: "11%" }}>{t.cols.status}</th>
          <th style={{ width: "10%" }}>{t.cols.due}</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.id}>
            <td>{job.id}</td>
            <td>{job.area}</td>
            <td><strong>{job.title}</strong>{job.description ? ` — ${job.description}` : ""}</td>
            {showAssignee && <td>{job.assigned_to ? names.get(job.assigned_to) || "—" : t.unassigned}</td>}
            <td>{job.priority}</td>
            <td>{job.status}</td>
            <td>{job.due_date || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BlankRows({ count, cols }: { count: number; cols: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, row) => (
        <tr key={row} className="print-blank-row">
          {Array.from({ length: cols }, (_, col) => <td key={col}>&nbsp;</td>)}
        </tr>
      ))}
    </>
  );
}

function SheetHeader({ title, t, folio, meta }: {
  title: string; t: (typeof copy)["en"] | (typeof copy)["es"];
  folio: string; meta: string;
}) {
  const generated = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short",
  }).format(new Date());
  return (
    <header className="print-header">
      <div className="print-header-main">
        <div>
          <p className="print-property">The Darley</p>
          <p className="print-department">{t.department}</p>
        </div>
        <div className="print-header-meta">
          <p>{t.folio}: <strong>{folio}</strong></p>
          <p>{t.generated}: {generated}</p>
        </div>
      </div>
      <h1 className="print-title">{title}</h1>
      <p className="print-meta">{meta}</p>
    </header>
  );
}

function SignOff({ fields }: { fields: string[] }) {
  return (
    <div className="print-signoff">
      {fields.map((field) => (
        <div key={field} className="print-signoff-field">
          <span className="print-line" />
          <span>{field}</span>
        </div>
      ))}
    </div>
  );
}

function NotesLines({ t, count = 3 }: { t: (typeof copy)["en"] | (typeof copy)["es"]; count?: number }) {
  return (
    <section className="print-section">
      <h2>{t.notes}</h2>
      {Array.from({ length: count }, (_, i) => <div key={i} className="print-write-line" />)}
    </section>
  );
}

export default async function PrintFormatPage({
  params, searchParams,
}: {
  params: Promise<{ format: string }>;
  searchParams: Promise<{ date?: string; week?: string }>;
}) {
  const { format } = await params;
  if (!FORMATS.includes(format as Format)) notFound();
  const query = await searchParams;

  const userClient = await createUserClient();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const member: MemberRow = await getCurrentMember();
  const lang: Lang = member.language === "es" ? "es" : "en";
  const t = copy[lang];

  const toolbar = (
    <div className="print-toolbar">
      <Link href="/" className="print-back">← {t.back}</Link>
      <PrintButton label={t.print} />
    </div>
  );

  if (!isApproved(member)) {
    return (
      <main className="print-page">
        {toolbar}
        <div className="print-sheet">
          <SheetHeader title={t.noAccessTitle} t={t} folio="—" meta="The Darley" />
          <p className="print-empty">{t.noAccessText}</p>
        </div>
      </main>
    );
  }

  let jobs: WorkOrderRow[] = [];
  let names = new Map<number, string>();
  if (format === "daily-assignments" || format === "weekly-plan") {
    const admin = createAdminClient();
    const [{ data: jobRows }, { data: memberRows }] = await Promise.all([
      admin.from("work_orders").select("*").order("due_date", { ascending: true, nullsFirst: false }),
      admin.from("members").select("id, name"),
    ]);
    jobs = (jobRows || []) as WorkOrderRow[];
    names = new Map(((memberRows || []) as { id: number; name: string }[]).map((person) => [person.id, person.name]));
  }

  if (format === "daily-assignments") {
    const date = validYmd(query.date, localDate());
    const open = jobs.filter((job) => job.status !== "completed" && (!job.due_date || job.due_date <= date));
    const completed = jobs.filter((job) => job.status === "completed" && localDate(job.updated_at) === date);
    const groups = new Map<string, WorkOrderRow[]>();
    for (const job of open) {
      const key = job.assigned_to ? names.get(job.assigned_to) || `#${job.assigned_to}` : t.unassigned;
      groups.set(key, [...(groups.get(key) || []), job]);
    }
    const sortedGroups = [...groups.entries()].sort(([a], [b]) =>
      a === t.unassigned ? 1 : b === t.unassigned ? -1 : a.localeCompare(b));
    for (const [, list] of sortedGroups) list.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
    return (
      <main className="print-page">
        {toolbar}
        <div className="print-sheet">
          <SheetHeader title={t.dailyTitle} t={t} folio={`DAS-${date.replaceAll("-", "")}`} meta={`${t.date}: ${prettyDate(date, lang)}`} />
          <section className="print-section">
            <h2>{t.dueToday}</h2>
            {sortedGroups.length === 0 && <p className="print-empty">{t.noJobs}</p>}
            {sortedGroups.map(([name, list]) => (
              <div key={name} className="print-subsection">
                <h3>{name} — {list.length}</h3>
                <JobRows jobs={list} names={names} t={t} />
              </div>
            ))}
          </section>
          <section className="print-section">
            <h2>{t.completedToday}</h2>
            <JobRows jobs={completed} names={names} t={t} showAssignee />
          </section>
          <NotesLines t={t} count={2} />
          <SignOff fields={[t.preparedBy, t.signature]} />
        </div>
      </main>
    );
  }

  if (format === "weekly-plan") {
    const monday = mondayOf(validYmd(query.week, localDate()));
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const weekJobs = jobs.filter((job) => job.due_date && days.includes(job.due_date));
    const load = new Map<string, number>();
    for (const job of weekJobs) {
      const key = job.assigned_to ? names.get(job.assigned_to) || `#${job.assigned_to}` : t.unassigned;
      load.set(key, (load.get(key) || 0) + 1);
    }
    return (
      <main className="print-page">
        {toolbar}
        <div className="print-sheet">
          <SheetHeader
            title={t.weeklyTitle} t={t}
            folio={`WMP-${monday.replaceAll("-", "")}`}
            meta={`${t.weekOf}: ${prettyDate(monday, lang)} — ${prettyDate(days[6], lang)}`}
          />
          <section className="print-section">
            <h2>{t.priorities}</h2>
            <div className="print-write-line" /><div className="print-write-line" /><div className="print-write-line" />
          </section>
          {days.map((day) => {
            const dayJobs = weekJobs
              .filter((job) => job.due_date === day)
              .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
            return (
              <section key={day} className="print-section">
                <h2>{shortDate(day, lang)}</h2>
                <JobRows jobs={dayJobs} names={names} t={t} showAssignee />
              </section>
            );
          })}
          <section className="print-section">
            <h2>{t.weeklyLoad}</h2>
            <table className="print-table">
              <thead><tr><th>{t.member}</th><th style={{ width: "20%" }}>{t.count}</th></tr></thead>
              <tbody>
                {[...load.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                  <tr key={name}><td>{name}</td><td>{count}</td></tr>
                ))}
                {load.size === 0 && <tr><td colSpan={2}>{t.noJobs}</td></tr>}
              </tbody>
            </table>
          </section>
          <SignOff fields={[t.preparedBy, t.signature]} />
        </div>
      </main>
    );
  }

  if (format === "pending-parts-vendors") {
    return (
      <main className="print-page">
        {toolbar}
        <div className="print-sheet">
          <SheetHeader title={t.pendingTitle} t={t} folio={`PPV-${localDate().replaceAll("-", "")}`} meta={`The Darley · ${t.department}`} />
          <div className="print-fields">
            <span>{t.weekOf}: <i className="print-inline-line" /></span>
            <span>{t.preparedBy}: <i className="print-inline-line" /></span>
          </div>
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: "9%" }}>{t.cols.pDate}</th>
                <th style={{ width: "7%" }}>{t.cols.wo}</th>
                <th style={{ width: "11%" }}>{t.cols.area}</th>
                <th>{t.cols.partService}</th>
                <th style={{ width: "13%" }}>{t.cols.vendor}</th>
                <th style={{ width: "13%" }}>{t.cols.ordered}</th>
                <th style={{ width: "10%" }}>{t.cols.expected}</th>
                <th style={{ width: "10%" }}>{t.cols.status}</th>
                <th style={{ width: "12%" }}>{t.cols.receivedBy}</th>
              </tr>
            </thead>
            <tbody><BlankRows count={14} cols={9} /></tbody>
          </table>
          <NotesLines t={t} count={2} />
        </div>
      </main>
    );
  }

  if (format === "inventory-reorder") {
    return (
      <main className="print-page">
        {toolbar}
        <div className="print-sheet">
          <SheetHeader title={t.reorderTitle} t={t} folio={`IRL-${localDate().replaceAll("-", "")}`} meta={`The Darley · ${t.department}`} />
          <p className="print-note">{t.sopColors}</p>
          <div className="print-fields">
            <span>{t.date}: <i className="print-inline-line" /></span>
            <span>{t.preparedBy}: <i className="print-inline-line" /></span>
          </div>
          <table className="print-table">
            <thead>
              <tr>
                <th>{t.cols.item}</th>
                <th style={{ width: "14%" }}>{t.cols.location}</th>
                <th style={{ width: "12%" }}>{t.cols.color}</th>
                <th style={{ width: "8%" }}>{t.cols.onHand}</th>
                <th style={{ width: "7%" }}>{t.cols.min}</th>
                <th style={{ width: "8%" }}>{t.cols.toOrder}</th>
                <th style={{ width: "13%" }}>{t.cols.supplier}</th>
                <th style={{ width: "6%" }}>{t.cols.orderedBox}</th>
                <th style={{ width: "14%" }}>{t.notes}</th>
              </tr>
            </thead>
            <tbody><BlankRows count={16} cols={9} /></tbody>
          </table>
          <SignOff fields={[t.preparedBy, t.signature]} />
        </div>
      </main>
    );
  }

  if (format === "shop-closing") {
    // Phase 3A: when a real shop closing RECORD exists for the date
    // (?date=YYYY-MM-DD, default today), this sheet prints the record —
    // the checklist as executed, the recorded observations, and the
    // signature with the server-recorded completion time. Without a
    // record it falls back to the published shop_closing template's
    // items, then to the built-in blank form, so the paper template
    // always works.
    const date = validYmd(query.date, localDate());
    const admin = createAdminClient();
    const { data: record } = await admin.from("inspections")
      .select("id, folio, status, general_notes, signature_name, completed_at, completed_by_member_id, created_by_member_id")
      .eq("template_type", "shop_closing").eq("scheduled_date", date)
      .order("created_at", { ascending: false }).limit(1)
      .maybeSingle<{
        id: number; folio: string; status: string; general_notes: string | null;
        signature_name: string | null; completed_at: string | null;
        completed_by_member_id: number | null; created_by_member_id: number;
      }>();
    type ClosingItem = { label: string; checked: boolean; mark: string };
    let items: ClosingItem[] = t.closingItems.map((label) => ({ label, checked: false, mark: "" }));
    let performedBy = "";
    let closingTime = "";
    if (record) {
      const { data: results } = await admin.from("inspection_results")
        .select("prompt, status").eq("inspection_id", record.id).order("position", { ascending: true });
      items = ((results || []) as { prompt: string; status: string | null }[]).map((row) => ({
        label: row.prompt,
        checked: row.status === "completed" || row.status === "no_issue",
        mark: row.status === "na" ? "N/A"
          : row.status && row.status !== "completed" && row.status !== "no_issue" ? "!" : "",
      }));
      const performerId = record.completed_by_member_id ?? record.created_by_member_id;
      const { data: performer } = await admin.from("members")
        .select("name").eq("id", performerId).maybeSingle<{ name: string }>();
      performedBy = performer?.name || "";
      if (record.completed_at) {
        closingTime = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
          timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
        }).format(new Date(record.completed_at));
      }
    } else {
      const { data: template } = await admin.from("inspection_templates")
        .select("id").eq("template_type", "shop_closing").eq("status", "published")
        .order("created_at", { ascending: true }).limit(1)
        .maybeSingle<{ id: number }>();
      if (template) {
        const { data: templateItems } = await admin.from("inspection_template_items")
          .select("prompt").eq("template_id", template.id).order("position", { ascending: true });
        if (templateItems && templateItems.length) {
          items = (templateItems as { prompt: string }[]).map((row) => ({ label: row.prompt, checked: false, mark: "" }));
        }
      }
    }
    return (
      <main className="print-page">
        {toolbar}
        <div className="print-sheet">
          <SheetHeader title={t.closingTitle} t={t} folio={record ? record.folio : `SCC-${date.replaceAll("-", "")}`} meta={`The Darley · ${t.department} · ${prettyDate(date, lang)}`} />
          <div className="print-fields">
            <span>{t.date}: {record ? <strong>{prettyDate(date, lang)}</strong> : <i className="print-inline-line" />}</span>
            <span>{t.completedBy}: {record ? <strong>{performedBy}</strong> : <i className="print-inline-line" />}</span>
            {record && closingTime && <span>{t.time}: <strong>{closingTime}</strong></span>}
          </div>
          {record && record.status !== "completed" && (
            <p className="print-meta">{lang === "es" ? "Registro en proceso — aún no firmado." : "Record in progress — not signed yet."}</p>
          )}
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: "8%" }}>{t.cols.check}</th>
                <th>{t.cols.itemCheck}</th>
                <th style={{ width: "12%" }}>{t.cols.initials}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.label}>
                  <td className="print-checkbox-cell">{item.checked ? "☑" : "☐"}</td>
                  <td>{item.label}</td>
                  <td>{item.mark || "\u00A0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <section className="print-section">
            <h2>{t.closingIssues}</h2>
            {record?.general_notes
              ? <p style={{ whiteSpace: "pre-wrap" }}>{record.general_notes}</p>
              : <><div className="print-write-line" /><div className="print-write-line" /><div className="print-write-line" /></>}
          </section>
          {record
            ? <SignOff fields={[
                `${t.completedBy}: ${performedBy}`,
                `${t.time}: ${closingTime}`,
                `${t.signature}: ${record.signature_name || performedBy}`,
              ]} />
            : <SignOff fields={[t.completedBy, t.time, t.signature]} />}
        </div>
      </main>
    );
  }

  // training-log
  return (
    <main className="print-page">
      {toolbar}
      <div className="print-sheet">
        <SheetHeader title={t.trainingTitle} t={t} folio={`TSL-${localDate().replaceAll("-", "")}`} meta={`The Darley · ${t.department}`} />
        <div className="print-fields print-fields-grid">
          <span>{t.date}: <i className="print-inline-line" /></span>
          <span>{t.startEnd}: <i className="print-inline-line" /></span>
          <span>{t.location}: <i className="print-inline-line" /></span>
          <span>{t.duration}: <i className="print-inline-line" /></span>
          <span>{t.topic}: <i className="print-inline-line" /></span>
          <span>{t.presentedBy}: <i className="print-inline-line" /></span>
        </div>
        <section className="print-section">
          <h2>{t.docsReviewed}</h2>
          <div className="print-write-line" />
        </section>
        <section className="print-section">
          <h2>{t.attendees}</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: "5%" }}>#</th>
                <th style={{ width: "34%" }}>{t.cols.name}</th>
                <th style={{ width: "34%" }}>{t.signature}</th>
                <th>{t.cols.jobTitle}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 12 }, (_, i) => (
                <tr key={i} className="print-blank-row"><td>{i + 1}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="print-section">
          <h2>{t.keyPoints}</h2>
          <div className="print-write-line" /><div className="print-write-line" /><div className="print-write-line" />
        </section>
        <section className="print-section">
          <h2>{t.actionItems}</h2>
          <table className="print-table">
            <thead>
              <tr><th>{t.cols.action}</th><th style={{ width: "22%" }}>{t.cols.owner}</th><th style={{ width: "16%" }}>{t.cols.due}</th></tr>
            </thead>
            <tbody><BlankRows count={4} cols={3} /></tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
