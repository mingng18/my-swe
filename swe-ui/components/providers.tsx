"use client";

import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <TooltipProvider delayDuration={300}>
        {children}
      </TooltipProvider>
    </ToastProvider>
  );
}
