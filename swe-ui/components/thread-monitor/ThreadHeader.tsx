import { Bot, Loader2, AlertCircle } from "lucide-react";

interface ThreadHeaderProps {
  threadId?: string | null;
  connectionState: "connecting" | "connected" | "disconnected" | "error";
}

export function ThreadHeader({ threadId, connectionState }: ThreadHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b bg-card shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            Bullhorse Agent Monitor
          </h1>
        </div>
        {threadId && (
          <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite" aria-atomic="true">
            {connectionState === "connected" ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 font-medium transition-all hover:bg-green-500/15">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Connected
              </span>
            ) : connectionState === "connecting" ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 font-medium">
                <Loader2 className="h-3 w-3 animate-spin" />
                Connecting...
              </span>
            ) : connectionState === "error" ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 font-medium">
                <AlertCircle className="h-3 w-3" />
                Connection Error
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                Disconnected
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground bg-muted rounded-md border">
          <span>⌘</span>K
          <span className="text-[10px] opacity-60">New Run</span>
        </kbd>
      </div>
    </div>
  );
}
