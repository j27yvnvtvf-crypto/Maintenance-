"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Bot, CheckCircle2, ClipboardList, Languages,
  LayoutDashboard, LogOut, Plus, RefreshCw, Sparkles, UserRoundPlus, Users, Waves, Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Language = "en" | "es";
type Role = "manager" | "service_supervisor" | "technician";
type ApprovalStatus = "unregistered" | "pending" | "approved";
type Member = {
  id: number; name: string; email: string; role: Role; requestedRole?: Role | null;
  approvalStatus: ApprovalStatus; active: boolean; language: Language; userId?: string | null;
};
type Job = {
  id: number; title: string; description: string; area: string; category: string;
  priority: string; status: string; assignedTo: number | null; assignedName: string | null;
  dueDate: string | null; completionComment: string | null; residentNote: string | null;
  updatedAt: string;
};
type Data = { me: Member; team: Member[]; jobs: Job[]; registrationRequired: boolean };

const copy = {
  en: {
    overview: "Overview", work: "Work Orders", team: "Team", ai: "AI Assistant",
    supervisor: "Supervisor Control", subtitle: "Assign, track, and close maintenance work",
    newJob: "Assign Work", active: "Active", completed: "Completed", urgent: "Urgent",
    technicians: "Technicians", today: "Today", noJobs: "No work orders yet.",
    assigned: "Assigned to", unassigned: "Unassigned", status: "Status", priority: "Priority",
    summary: "Generate daily summary", addMember: "Add technician", title: "Work title",
    details: "Instructions / details", area: "Apartment or area", category: "Category",
    technician: "Technician", due: "Due date", create: "Create work order",
    recommend: "AI recommend", name: "Name", email: "Email", language: "Language",
    add: "Add member", aiTitle: "AI maintenance assistant",
    aiHint: "Create a professional maintenance closure and resident note.",
    whatDone: "What was done?", result: "Result / current condition",
    generate: "Generate comments", translate: "Translate", save: "Save & complete",
    all: "All", myWork: "My Work", managerView: "Manager view", dailyWork: "Daily work",
    selectRole: "Select your role", roleIntro: "Choose the role you need. A Service Supervisor will approve the request.",
    requestAccess: "Request access", pendingTitle: "Access request pending",
    pendingText: "A Service Supervisor must approve your role before you can enter.",
    managerRole: "Manager", managerRoleInfo: "Read-only access to all work, team, and performance data.",
    supervisorRole: "Service Supervisor", supervisorRoleInfo: "Full administrative access to work orders, assignments, and team settings.",
    technicianRole: "Technician", technicianRoleInfo: "View daily work, update status, close work orders, and add comments.",
    approve: "Approve", requested: "Requested",
  },
  es: {
    overview: "Resumen", work: "Órdenes", team: "Equipo", ai: "Asistente IA",
    supervisor: "Control del supervisor", subtitle: "Asigna, controla y completa trabajos de mantenimiento",
    newJob: "Asignar trabajo", active: "Activos", completed: "Completados", urgent: "Urgentes",
    technicians: "Técnicos", today: "Hoy", noJobs: "Todavía no hay órdenes de trabajo.",
    assigned: "Asignado a", unassigned: "Sin asignar", status: "Estado", priority: "Prioridad",
    summary: "Crear resumen diario", addMember: "Agregar técnico", title: "Título del trabajo",
    details: "Instrucciones / detalles", area: "Apartamento o área", category: "Categoría",
    technician: "Técnico", due: "Fecha límite", create: "Crear orden",
    recommend: "Recomendar con IA", name: "Nombre", email: "Correo", language: "Idioma",
    add: "Agregar miembro", aiTitle: "Asistente de mantenimiento con IA",
    aiHint: "Crea un cierre profesional de mantenimiento y una nota para el residente.",
    whatDone: "¿Qué se hizo?", result: "Resultado / condición actual",
    generate: "Crear comentarios", translate: "Traducir", save: "Guardar y completar",
    all: "Todos", myWork: "Mis trabajos", managerView: "Vista del manager", dailyWork: "Trabajo diario",
    selectRole: "Selecciona tu rol", roleIntro: "Elige el rol que necesitas. Un Service Supervisor aprobará la solicitud.",
    requestAccess: "Solicitar acceso", pendingTitle: "Solicitud pendiente",
    pendingText: "Un Service Supervisor debe aprobar tu rol antes de que puedas entrar.",
    managerRole: "Manager", managerRoleInfo: "Acceso de solo lectura a todos los trabajos, el equipo y los datos.",
    supervisorRole: "Service Supervisor", supervisorRoleInfo: "Acceso administrativo completo a órdenes, asignaciones y equipo.",
    technicianRole: "Técnico", technicianRoleInfo: "Puede ver el trabajo diario, cambiar estados, cerrar órdenes y dejar comentarios.",
    approve: "Aprobar", requested: "Solicitado",
  },
};

const statusLabels: Record<Language, Record<string, string>> = {
  en: { open: "Open", assigned: "Assigned", in_progress: "In progress", on_hold: "On hold", completed: "Completed" },
  es: { open: "Abierta", assigned: "Asignada", in_progress: "En progreso", on_hold: "En espera", completed: "Completada" },
};

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const payload: any = await res.json();
  if (!res.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

export function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState("overview");
  const [jobOpen, setJobOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState("");
  const [form, setForm] = useState({
    title: "", description: "", area: "", category: "General Maintenance",
    priority: "medium", assignedTo: "", dueDate: "",
  });
  const [member, setMember] = useState({ name: "", email: "", language: "en", role: "technician" });
  const [closure, setClosure] = useState({
    jobId: "", whatDone: "", result: "", maintenanceComment: "", residentNote: "",
  });
  const lang: Language = data?.me.language || "en";
  const t = copy[lang];
  const supervisor = data?.me.role === "service_supervisor";
  const manager = data?.me.role === "manager";

  const load = useCallback(async () => {
    try { setData(await api("/api/dashboard")); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const technicians = useMemo(
    () => data?.team.filter((m) => m.role === "technician") || [],
    [data],
  );
  const jobs = data?.jobs || [];
  const stats = {
    active: jobs.filter((j) => j.status !== "completed").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    urgent: jobs.filter((j) => ["high", "emergency"].includes(j.priority) && j.status !== "completed").length,
  };
  const completion = jobs.length ? Math.round((stats.completed / jobs.length) * 100) : 0;

  async function changeLanguage(language: Language) {
    if (!data) return;
    setData({ ...data, me: { ...data.me, language } });
    await api("/api/dashboard", { action: "set_language", language });
  }
  async function createJob() {
    setBusy(true);
    try {
      await api("/api/dashboard", { action: "create_job", ...form });
      setForm({ title: "", description: "", area: "", category: "General Maintenance", priority: "medium", assignedTo: "", dueDate: "" });
      setJobOpen(false);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function addMember() {
    setBusy(true);
    try {
      await api("/api/dashboard", { action: "add_member", ...member });
      setMember({ name: "", email: "", language: "en", role: "technician" });
      setMemberOpen(false);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function updateJob(id: number, status: string) {
    await api("/api/dashboard", { action: "update_job", id, status });
    await load();
  }
  async function requestRole(role: Role) {
    setBusy(true);
    try {
      await api("/api/dashboard", { action: "request_role", role });
      await load();
    } finally { setBusy(false); }
  }
  async function approveMember(id: number, role: Role) {
    setBusy(true);
    try {
      await api("/api/dashboard", { action: "approve_member", id, role });
      await load();
    } finally { setBusy(false); }
  }
  async function changeMemberRole(id: number, role: Role) {
    setBusy(true);
    try {
      await api("/api/dashboard", { action: "change_member_role", id, role });
      await load();
    } finally { setBusy(false); }
  }
  async function recommend() {
    setBusy(true);
    try {
      const response = await api("/api/ai", { action: "recommend", title: form.title, description: form.description });
      setForm((current) => ({
        ...current,
        priority: response.result.priority,
        assignedTo: response.result.technicianId ? String(response.result.technicianId) : current.assignedTo,
      }));
      setMessage(response.result.reason);
    } finally { setBusy(false); }
  }
  async function dailySummary() {
    setBusy(true);
    try {
      const response = await api("/api/ai", { action: "daily_summary", language: lang });
      setSummary(response.result);
    } finally { setBusy(false); }
  }
  async function generateClosure() {
    setBusy(true);
    try {
      const response = await api("/api/ai", {
        action: "professional_comment", language: lang,
        whatDone: closure.whatDone, result: closure.result,
      });
      setClosure((current) => ({ ...current, ...response.result }));
    } finally { setBusy(false); }
  }
  async function translateClosure() {
    setBusy(true);
    try {
      const target = lang === "en" ? "es" : "en";
      const [first, second] = await Promise.all([
        api("/api/ai", { action: "translate", target, text: closure.maintenanceComment }),
        api("/api/ai", { action: "translate", target, text: closure.residentNote }),
      ]);
      setClosure((current) => ({
        ...current, maintenanceComment: first.result, residentNote: second.result,
      }));
    } finally { setBusy(false); }
  }
  async function completeJob() {
    await api("/api/dashboard", {
      action: "update_job", id: Number(closure.jobId), status: "completed",
      completionComment: closure.maintenanceComment, residentNote: closure.residentNote,
    });
    setAiOpen(false);
    await load();
  }

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50">
        <div className="text-center">
          <Wrench className="mx-auto mb-4 size-10 animate-pulse text-[#006b8f]" />
          <p>{message || "Loading maintenance system…"}</p>
        </div>
      </main>
    );
  }

  if (data.me.approvalStatus !== "approved" || !data.me.active) {
    return (
      <RoleAccess
        member={data.me}
        lang={lang}
        t={t}
        busy={busy}
        requestRole={requestRole}
        setLanguage={changeLanguage}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f1f6f9] pb-24 text-slate-900 lg:pb-8">
      <Header data={data} lang={lang} setLanguage={changeLanguage} t={t} />
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[230px_1fr] lg:px-8">
        <SideNav tab={tab} setTab={setTab} t={t} name={data.me.name} role={data.me.role} />
        <section className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[.12em] text-[#007a9f]">
                {supervisor ? t.supervisor : manager ? t.managerView : t.dailyWork}
              </p>
              <h2 className="text-2xl font-black">{tab === "overview" ? t.overview : tab === "work" ? t.work : tab === "team" ? t.team : t.ai}</h2>
            </div>
            {supervisor && (
              <NewJobDialog
                open={jobOpen} setOpen={setJobOpen} t={t} form={form}
                setForm={setForm} technicians={technicians} busy={busy}
                createJob={createJob} recommend={recommend}
              />
            )}
          </div>

          {(tab === "overview" || tab === "work") && (
            <>
              <Stats t={t} stats={stats} technicians={technicians.length} />
              <Card className="mt-4 rounded-3xl border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{t.today}</CardTitle>
                    <span className="font-bold text-slate-500">{completion}%</span>
                  </div>
                  <Progress value={completion} className="mt-3" />
                </CardHeader>
              </Card>
              <JobList
                jobs={jobs} lang={lang} t={t} updateJob={updateJob}
                canUpdate={!manager}
                openAI={(id: number) => {
                  setClosure({ jobId: String(id), whatDone: "", result: "", maintenanceComment: "", residentNote: "" });
                  setAiOpen(true);
                }}
              />
            </>
          )}

          {tab === "team" && (
            <TeamPanel
              data={data} t={t} lang={lang} supervisor={supervisor}
              open={memberOpen} setOpen={setMemberOpen} member={member}
              setMember={setMember} addMember={addMember} busy={busy}
              approveMember={approveMember} changeMemberRole={changeMemberRole}
            />
          )}

          {tab === "ai" && !manager && (
            <AIPanel t={t} summary={summary} busy={busy} openAI={() => setAiOpen(true)} dailySummary={dailySummary} canSummarize={supervisor} />
          )}
        </section>
      </div>

      <MobileNav tab={tab} setTab={setTab} t={t} role={data.me.role} />
      <AIClosureDialog
        open={aiOpen} setOpen={setAiOpen} t={t} jobs={jobs}
        closure={closure} setClosure={setClosure} busy={busy}
        generate={generateClosure} translate={translateClosure} complete={completeJob}
      />
      {message && (
        <button onClick={() => setMessage("")} className="fixed bottom-24 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl lg:bottom-8">
          {message}
        </button>
      )}
    </main>
  );
}

function RoleAccess({ member, lang, t, busy, requestRole, setLanguage }: any) {
  const options: Array<[Role, string, string]> = [
    ["manager", t.managerRole, t.managerRoleInfo],
    ["service_supervisor", t.supervisorRole, t.supervisorRoleInfo],
    ["technician", t.technicianRole, t.technicianRoleInfo],
  ];
  return (
    <main className="min-h-screen bg-[#f1f6f9] text-slate-900">
      <header className="bg-gradient-to-r from-[#003a5d] to-[#007a9f] px-5 py-5 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div className="flex items-center gap-3"><Waves /><span className="text-lg font-extrabold">Ink Wave Maintenance</span></div>
          <Select value={lang} onValueChange={setLanguage}>
            <SelectTrigger className="w-[112px] border-white/25 bg-white/10 text-white"><Languages /><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="es">Español</SelectItem></SelectContent>
          </Select>
        </div>
      </header>
      <section className="mx-auto max-w-4xl px-4 py-10">
        {member.approvalStatus === "unregistered" ? (
          <>
            <div className="mb-6 text-center"><h1 className="text-3xl font-black">{t.selectRole}</h1><p className="mt-2 text-slate-600">{t.roleIntro}</p></div>
            <div className="grid gap-4 md:grid-cols-3">
              {options.map(([role, label, description]) => (
                <Card key={role} className="rounded-3xl border-0 shadow-sm">
                  <CardContent className="flex h-full flex-col p-6">
                    <Badge className="mb-4 w-fit bg-[#d0aa5b] text-[#143449]">{label}</Badge>
                    <p className="mb-6 flex-1 leading-7 text-slate-600">{description}</p>
                    <Button onClick={() => requestRole(role)} disabled={busy}>{t.requestAccess}</Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : (
          <Card className="mx-auto max-w-xl rounded-3xl border-0 text-center shadow-sm">
            <CardContent className="p-10"><RefreshCw className="mx-auto mb-5 size-10 text-[#007a9f]" /><h1 className="text-2xl font-black">{t.pendingTitle}</h1><p className="mt-3 text-slate-600">{t.pendingText}</p><Badge className="mt-5">{roleLabel(member.requestedRole, lang)}</Badge></CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}

function roleLabel(role: Role | null | undefined, lang: Language) {
  if (role === "manager") return "Manager";
  if (role === "service_supervisor") return "Service Supervisor";
  return lang === "es" ? "Técnico" : "Technician";
}

function Header({ data, lang, setLanguage, t }: any) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/15 bg-gradient-to-r from-[#003a5d] to-[#007a9f] text-white shadow-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15"><Waves /></div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-extrabold tracking-tight">Ink Wave Maintenance</h1>
            <p className="truncate text-sm text-cyan-50/80">{t.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={lang} onValueChange={setLanguage}>
            <SelectTrigger className="w-[112px] border-white/25 bg-white/10 text-white">
              <Languages /><SelectValue />
            </SelectTrigger>
            <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="es">Español</SelectItem></SelectContent>
          </Select>
          <Badge className="hidden bg-[#d0aa5b] text-[#092f46] sm:inline-flex">
            {roleLabel(data.me.role, lang)}
          </Badge>
          <form action="/api/auth/signout" method="post">
            <Button type="submit" size="icon" variant="ghost" title={lang === "es" ? "Salir" : "Sign out"} className="text-white hover:bg-white/15 hover:text-white">
              <LogOut className="size-5" />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}

function SideNav({ tab, setTab, t, name, role }: any) {
  const items = [["overview", LayoutDashboard, t.overview], ["work", ClipboardList, t.work], ["team", Users, t.team], ...(role === "manager" ? [] : [["ai", Bot, t.ai]])];
  return (
    <aside className="hidden h-fit rounded-3xl bg-[#052f49] p-3 text-white shadow-xl lg:block">
      <div className="px-3 pb-4 pt-2"><p className="text-xs uppercase tracking-[.18em] text-cyan-100/60">{t.today}</p><p className="mt-1 font-bold">{name}</p></div>
      {items.map(([id, Icon, label]: any) => (
        <button key={id} onClick={() => setTab(id)} className={`mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left font-semibold transition ${tab === id ? "bg-white text-[#05324d]" : "text-cyan-50/80 hover:bg-white/10"}`}>
          <Icon className="size-5" />{label}
        </button>
      ))}
    </aside>
  );
}

function Stats({ t, stats, technicians }: any) {
  const values = [
    [t.active, stats.active, ClipboardList, "text-sky-700"],
    [t.completed, stats.completed, CheckCircle2, "text-emerald-600"],
    [t.urgent, stats.urgent, AlertTriangle, "text-red-600"],
    [t.technicians, technicians, Users, "text-[#9a742d]"],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {values.map(([label, value, Icon, color]: any) => (
        <Card key={label} className="rounded-3xl border-0 shadow-sm">
          <CardContent className="flex items-center justify-between p-5">
            <div><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-1 text-3xl font-black">{value}</p></div>
            <div className={`grid size-11 place-items-center rounded-2xl bg-slate-100 ${color}`}><Icon /></div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NewJobDialog({ open, setOpen, t, form, setForm, technicians, busy, createJob, recommend }: any) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="h-11 rounded-xl bg-[#caa75d] px-4 text-[#143449] hover:bg-[#bb984e]"><Plus />{t.newJob}</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{t.newJob}</DialogTitle><DialogDescription>{t.subtitle}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Input placeholder={t.title} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea placeholder={t.details} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder={t.area} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            <Input placeholder={t.category} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value })}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t.priority} /></SelectTrigger>
              <SelectContent>{["low", "medium", "high", "emergency"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.assignedTo} onValueChange={(value) => setForm({ ...form, assignedTo: value })}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t.technician} /></SelectTrigger>
              <SelectContent>{technicians.map((person: Member) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          <Button variant="outline" onClick={recommend} disabled={busy || !form.title}><Sparkles />{t.recommend}</Button>
        </div>
        <DialogFooter><Button onClick={createJob} disabled={busy || !form.title || !form.description}>{t.create}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobList({ jobs, lang, t, updateJob, openAI, canUpdate }: any) {
  return (
    <div className="mt-5 space-y-3">
      {jobs.length === 0 ? (
        <Card className="rounded-3xl border-dashed bg-white/60"><CardContent className="p-10 text-center text-slate-500">{t.noJobs}</CardContent></Card>
      ) : jobs.map((job: Job) => (
        <Card key={job.id} className="overflow-hidden rounded-3xl border-0 shadow-sm">
          <div className={`h-1.5 ${job.priority === "emergency" ? "bg-red-600" : job.priority === "high" ? "bg-orange-500" : job.priority === "medium" ? "bg-sky-600" : "bg-slate-300"}`} />
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap gap-2">
                  <Badge variant="outline">#{job.id}</Badge><Badge className="bg-slate-100 text-slate-700">{job.category}</Badge>
                  <Badge className={job.priority === "emergency" ? "bg-red-600" : job.priority === "high" ? "bg-orange-500" : "bg-[#007a9f]"}>{job.priority}</Badge>
                </div>
                <h3 className="text-lg font-extrabold">{job.title}</h3>
                <p className="mt-1 text-slate-600">{job.description}</p>
                <p className="mt-3 text-sm font-semibold text-slate-500">{job.area} · {t.assigned}: {job.assignedName || t.unassigned}</p>
              </div>
              <Select value={job.status} onValueChange={(value) => updateJob(job.id, value)} disabled={!canUpdate}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>{["open", "assigned", "in_progress", "on_hold", "completed"].map((status) => <SelectItem key={status} value={status}>{statusLabels[lang as Language][status]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {canUpdate && job.status !== "completed" && <div className="mt-4 flex justify-end"><Button variant="outline" onClick={() => openAI(job.id)}><Bot />{t.ai}</Button></div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TeamPanel({ data, t, lang, supervisor, open, setOpen, member, setMember, addMember, busy, approveMember, changeMemberRole }: any) {
  const pending = data.team.filter((person: Member) => person.approvalStatus === "pending");
  const approved = data.team.filter((person: Member) => person.approvalStatus === "approved" && person.active);
  return (
    <div className="space-y-4">
      {supervisor && pending.length > 0 && (
        <Card className="rounded-3xl border border-amber-200 bg-amber-50 shadow-sm">
          <CardHeader><CardTitle>{t.pendingTitle}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {pending.map((person: Member) => (
              <div key={person.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
                <div><p className="font-bold">{person.name}</p><p className="text-sm text-slate-500">{person.email}</p><p className="mt-1 text-sm font-semibold">{t.requested}: {roleLabel(person.requestedRole, lang)}</p></div>
                <Button onClick={() => approveMember(person.id, person.requestedRole || "technician")} disabled={busy}><CheckCircle2 />{t.approve}</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t.team}</CardTitle>
          {supervisor && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><UserRoundPlus />{t.addMember}</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t.addMember}</DialogTitle>
                  <DialogDescription>{lang === "es" ? "La persona recibirá su rol cuando entre con este correo." : "The person receives this role when they sign in with this email."}</DialogDescription>
                </DialogHeader>
                <Input placeholder={t.name} value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} />
                <Input type="email" placeholder={t.email} value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} />
                <Select value={member.role} onValueChange={(value) => setMember({ ...member, role: value })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="manager">Manager</SelectItem><SelectItem value="service_supervisor">Service Supervisor</SelectItem><SelectItem value="technician">{t.technicianRole}</SelectItem></SelectContent>
                </Select>
                <Select value={member.language} onValueChange={(value) => setMember({ ...member, language: value })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="es">Español</SelectItem></SelectContent>
                </Select>
                <DialogFooter><Button onClick={addMember} disabled={busy || !member.name || !member.email}>{t.add}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {approved.map((person: Member) => (
            <div key={person.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
              <div><p className="font-bold">{person.name}</p><p className="text-sm text-slate-500">{person.email}</p></div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{person.language.toUpperCase()}</Badge>
                {supervisor && person.id !== data.me.id ? (
                  <Select value={person.role} onValueChange={(role) => changeMemberRole(person.id, role)}>
                    <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="manager">Manager</SelectItem><SelectItem value="service_supervisor">Service Supervisor</SelectItem><SelectItem value="technician">{t.technicianRole}</SelectItem></SelectContent>
                  </Select>
                ) : <Badge>{roleLabel(person.role, lang)}</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AIPanel({ t, summary, busy, openAI, dailySummary, canSummarize }: any) {
  return (
    <div className={`grid gap-4 ${canSummarize ? "lg:grid-cols-2" : ""}`}>
      <Card className="rounded-3xl border-0 bg-gradient-to-br from-[#052f49] to-[#007a9f] text-white shadow-lg">
        <CardHeader><Bot className="size-10 text-[#e3c477]" /><CardTitle>{t.aiTitle}</CardTitle></CardHeader>
        <CardContent><p className="text-cyan-50/80">{t.aiHint}</p><Button className="mt-5 bg-[#d0aa5b] text-[#143449] hover:bg-[#c09a4d]" onClick={openAI}><Sparkles />{t.generate}</Button></CardContent>
      </Card>
      {canSummarize && <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader><CardTitle>{t.summary}</CardTitle></CardHeader>
        <CardContent>
          <Button variant="outline" onClick={dailySummary} disabled={busy}><RefreshCw className={busy ? "animate-spin" : ""} />{t.summary}</Button>
          {summary && <p className="mt-4 rounded-2xl bg-slate-50 p-4 leading-7">{summary}</p>}
        </CardContent>
      </Card>}
    </div>
  );
}

function MobileNav({ tab, setTab, t, role }: any) {
  const items = [["overview", LayoutDashboard, t.overview], ["work", ClipboardList, t.work], ["team", Users, t.team], ...(role === "manager" ? [] : [["ai", Bot, t.ai]])];
  return (
    <nav className={`fixed inset-x-0 bottom-0 z-40 grid ${role === "manager" ? "grid-cols-3" : "grid-cols-4"} border-t bg-white px-2 py-2 shadow-[0_-8px_25px_rgba(15,23,42,.08)] lg:hidden`}>
      {items.map(([id, Icon, label]: any) => (
        <button key={id} onClick={() => setTab(id)} className={`grid justify-items-center gap-1 rounded-xl py-2 text-xs font-bold ${tab === id ? "bg-sky-50 text-[#005f82]" : "text-slate-500"}`}>
          <Icon className="size-5" />{label}
        </button>
      ))}
    </nav>
  );
}

function AIClosureDialog({ open, setOpen, t, jobs, closure, setClosure, busy, generate, translate, complete }: any) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t.aiTitle}</DialogTitle><DialogDescription>{t.aiHint}</DialogDescription></DialogHeader>
        {jobs.length > 0 && !closure.jobId && (
          <Select value={closure.jobId} onValueChange={(value) => setClosure({ ...closure, jobId: value })}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t.work} /></SelectTrigger>
            <SelectContent>{jobs.filter((job: Job) => job.status !== "completed").map((job: Job) => <SelectItem key={job.id} value={String(job.id)}>#{job.id} {job.title}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Textarea placeholder={t.whatDone} value={closure.whatDone} onChange={(e) => setClosure({ ...closure, whatDone: e.target.value })} />
        <Textarea placeholder={t.result} value={closure.result} onChange={(e) => setClosure({ ...closure, result: e.target.value })} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={generate} disabled={busy || !closure.whatDone}><Sparkles />{t.generate}</Button>
          <Button variant="outline" onClick={translate} disabled={busy || !closure.maintenanceComment}><Languages />{t.translate}</Button>
        </div>
        {closure.maintenanceComment && (
          <>
            <label className="font-bold">🔧 Maintenance Comment</label>
            <Textarea className="min-h-32" value={closure.maintenanceComment} onChange={(e) => setClosure({ ...closure, maintenanceComment: e.target.value })} />
            <label className="font-bold">🏠 Resident Note</label>
            <Textarea value={closure.residentNote} onChange={(e) => setClosure({ ...closure, residentNote: e.target.value })} />
          </>
        )}
        <DialogFooter><Button onClick={complete} disabled={!closure.jobId || !closure.maintenanceComment}><CheckCircle2 />{t.save}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
