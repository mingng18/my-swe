"use client";
import { TooltipProvider } from "@/components/ui/tooltip";

import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>
      <ToastProvider>{children}</ToastProvider>
    </TooltipProvider>;
}
