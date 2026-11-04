"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-xl bg-[#005f82] px-4 py-2 font-bold text-white"
    >
      <Printer className="size-4" />
      {label}
    </button>
  );
}
