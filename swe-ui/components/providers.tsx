"use client";

import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <ToastProvider>{children}</ToastProvider>
    </TooltipProvider>
  );
}
