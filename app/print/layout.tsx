import type { ReactNode } from "react";

/**
 * Print formats live outside the dashboard shell on purpose: the route
 * renders a clean Letter sheet (see .print-sheet in globals.css) with no
 * app navigation, so what prints is exactly the paper form.
 */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="print-area">{children}</div>;
}
