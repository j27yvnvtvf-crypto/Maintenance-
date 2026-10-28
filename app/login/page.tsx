"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Eye, EyeOff, Languages, LockKeyhole, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(supabaseUrl && supabaseKey);

function friendlyError(error: unknown, es: boolean): string {
  const raw = error instanceof Error ? error.message : "";
  if (/invalid login credentials/i.test(raw)) {
    return es ? "Correo o contraseña incorrectos. Verifica los datos e inténtalo de nuevo." : "Incorrect email or password. Check your details and try again.";
  }
  if (/email not confirmed/i.test(raw)) {
    return es ? "Tu correo aún no está confirmado. Revisa tu bandeja de entrada y confirma la cuenta." : "Your email is not confirmed yet. Check your inbox and confirm your account.";
  }
  if (/user already registered/i.test(raw)) {
    return es ? "Ya existe una cuenta con este correo. Usa la pestaña Entrar." : "An account with this email already exists. Use the Sign in tab.";
  }
  if (/password should be at least/i.test(raw)) {
    return es ? "La contraseña es muy corta. Usa al menos 8 caracteres." : "The password is too short. Use at least 8 characters.";
  }
  if (/failed to fetch|fetch failed|network|load failed/i.test(raw)) {
    return es ? "No se pudo contactar el servidor. Revisa tu conexión e inténtalo de nuevo." : "The server could not be reached. Check your connection and try again.";
  }
  if (/supabase|api key|project.*url/i.test(raw)) {
    return es ? "La aplicación aún no está configurada en el servidor. Avisa al supervisor." : "The app is not configured on the server yet. Let the supervisor know.";
  }
  return es ? "No se pudo continuar. Inténtalo de nuevo." : (raw || "Unable to continue.");
}

export default function LoginPage() {
  const [language, setLanguage] = useState<"en" | "es">("es");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const supabase = useMemo(
    () => (configured ? createBrowserClient(supabaseUrl!, supabaseKey!) : null),
    [],
  );
  const es = language === "es";

  function switchMode(next: "login" | "signup") {
    setMode(next);
    setMessage("");
    setPassword("");
    setShowPassword(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setMessage(es
        ? "La aplicación aún no está configurada en el servidor. Avisa al supervisor."
        : "The app is not configured on the server yet. Let the supervisor know.");
      return;
    }
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
      setMessage(friendlyError(error, es));
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
          <CardTitle className="text-2xl">Maintenance</CardTitle>
          <p className="text-sm text-cyan-50/80">{es ? "Trabajo de mantenimiento, conectado y seguro." : "Connected, secure maintenance work."}</p>
        </CardHeader>
        <CardContent className="p-7">
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => switchMode("login")} className={`rounded-lg px-3 py-2 font-bold ${mode === "login" ? "bg-white shadow" : "text-slate-500"}`}>{es ? "Entrar" : "Sign in"}</button>
            <button type="button" onClick={() => switchMode("signup")} className={`rounded-lg px-3 py-2 font-bold ${mode === "signup" ? "bg-white shadow" : "text-slate-500"}`}>{es ? "Registrarse" : "Register"}</button>
          </div>
          {!configured && (
            <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
              {es
                ? "La aplicación aún no está configurada en el servidor. Avisa al supervisor."
                : "The app is not configured on the server yet. Let the supervisor know."}
            </p>
          )}
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="full-name">{es ? "Nombre completo" : "Full name"}</Label>
                <Input id="full-name" required autoComplete="name" placeholder={es ? "Nombre completo" : "Full name"} value={name} onChange={(event) => setName(event.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{es ? "Correo electrónico" : "Email address"}</Label>
              <Input id="email" required type="email" autoComplete="email" placeholder={es ? "Correo electrónico" : "Email address"} value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{es ? "Contraseña" : "Password"}</Label>
              <div className="relative">
                <Input
                  id="password"
                  required
                  type={showPassword ? "text" : "password"}
                  minLength={8}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={es ? "Contraseña (mínimo 8 caracteres)" : "Password (8 characters minimum)"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? (es ? "Ocultar contraseña" : "Hide password") : (es ? "Mostrar contraseña" : "Show password")}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500"
                >
                  {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
            </div>
            <Button disabled={busy || !configured} className="h-12 w-full rounded-xl bg-[#006b8f] text-base">
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
