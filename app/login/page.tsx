"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Languages, LockKeyhole, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [language, setLanguage] = useState<"en" | "es">("es");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  ), []);
  const es = language === "es";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        if (data.session) router.replace("/");
        else setMessage(es ? "Revisa tu correo para confirmar la cuenta." : "Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (es ? "No se pudo continuar." : "Unable to continue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#edf4f7] p-4 text-slate-900">
      <Card className="w-full max-w-md rounded-[2rem] border-0 shadow-xl">
        <CardHeader className="rounded-t-[2rem] bg-gradient-to-r from-[#003a5d] to-[#007a9f] p-7 text-white">
          <div className="mb-4 flex items-center justify-between">
            <div className="grid size-12 place-items-center rounded-2xl bg-white/15"><Waves /></div>
            <button type="button" onClick={() => setLanguage(es ? "en" : "es")} className="flex items-center gap-2 rounded-xl border border-white/25 px-3 py-2 text-sm font-bold">
              <Languages className="size-4" />{es ? "English" : "Español"}
            </button>
          </div>
          <CardTitle className="text-2xl">Ink Wave Maintenance</CardTitle>
          <p className="text-sm text-cyan-50/80">{es ? "Trabajo de mantenimiento, conectado y seguro." : "Connected, secure maintenance work."}</p>
        </CardHeader>
        <CardContent className="p-7">
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setMode("login")} className={`rounded-lg px-3 py-2 font-bold ${mode === "login" ? "bg-white shadow" : "text-slate-500"}`}>{es ? "Entrar" : "Sign in"}</button>
            <button type="button" onClick={() => setMode("signup")} className={`rounded-lg px-3 py-2 font-bold ${mode === "signup" ? "bg-white shadow" : "text-slate-500"}`}>{es ? "Registrarse" : "Register"}</button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && <Input required placeholder={es ? "Nombre completo" : "Full name"} value={name} onChange={(event) => setName(event.target.value)} />}
            <Input required type="email" autoComplete="email" placeholder={es ? "Correo electrónico" : "Email address"} value={email} onChange={(event) => setEmail(event.target.value)} />
            <Input required type="password" minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={es ? "Contraseña (mínimo 8 caracteres)" : "Password (8 characters minimum)"} value={password} onChange={(event) => setPassword(event.target.value)} />
            <Button disabled={busy} className="h-12 w-full rounded-xl bg-[#006b8f] text-base">
              <LockKeyhole />{busy ? (es ? "Procesando…" : "Working…") : mode === "signup" ? (es ? "Crear cuenta" : "Create account") : (es ? "Entrar" : "Sign in")}
            </Button>
          </form>
          {message && <p className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
          <p className="mt-6 text-center text-xs leading-5 text-slate-500">{es ? "Después de registrarte, selecciona tu rol. El supervisor aprobará el acceso." : "After registering, select your role. The supervisor will approve access."}</p>
        </CardContent>
      </Card>
    </main>
  );
}
