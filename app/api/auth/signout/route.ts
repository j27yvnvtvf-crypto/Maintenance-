import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createUserClient();
    await supabase.auth.signOut();
  } catch {
    // Sign-out must always land on /login, even when the session was
    // already gone or Supabase could not be reached.
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
