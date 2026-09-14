"use client";

import { useThreadStore } from "@/store/thread-store";
import { useShallow } from "zustand/react/shallow";
import type { ThreadState } from "@/lib/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Circle, CheckCircle2, AlertCircle, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThreadTabsProps {
  className?: string;
  onNewThread?: () => void;
}

export function ThreadTabs({ className, onNewThread }: ThreadTabsProps) {
  // ⚡ Bolt: Granularly subscribe to thread statuses using useShallow
  // to prevent ThreadTabs from re-rendering whenever events/todos update within the thread.
  const threadStatuses = useThreadStore(
    useShallow((state) => {
      const statuses: Record<string, ThreadState["status"]> = {};
      for (const [id, thread] of Object.entries(state.threads)) {
        statuses[id] = thread.status;
      }
      return statuses;
    })
  );
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const setActiveThread = useThreadStore((state) => state.setActiveThread);
  const removeThread = useThreadStore((state) => state.removeThread);

  const threadEntries = Object.entries(threadStatuses);

  const getStatusIcon = (status: ThreadState["status"]) => {
    switch (status) {
      case "running":
        return <Circle className="h-3 w-3 text-blue-500 fill-blue-500 animate-pulse" />;
      case "completed":
        return <CheckCircle2 className="h-3 w-3 text-green-500" />;
      case "error":
        return <AlertCircle className="h-3 w-3 text-red-500" />;
      case "idle":
        return <Circle className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const getShortThreadId = (threadId: string) => {
    return threadId.slice(0, 8);
  };

  const handleTabChange = (threadId: string) => {
    setActiveThread(threadId);
  };

  const handleClose = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    removeThread(threadId);
  };

  const handleNewThread = () => {
    onNewThread?.();
  };

  // ⚡ Bolt: Only status is needed, so use `threadStatuses[threadId]` instead of `thread.status`
  if (threadEntries.length === 0) {
    return (
      <div className={cn("flex items-center justify-between px-4 py-2.5 border-b bg-muted/30 backdrop-blur-sm", className)}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
          <p className="text-sm text-muted-foreground font-medium">No active threads</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewThread}
              className="h-7 gap-1.5 hover:bg-primary/10 hover:text-primary transition-colors"
              aria-label="New Run"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Run</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>New Run</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 px-4 py-2.5 border-b bg-muted/30 backdrop-blur-sm", className)}>
      <Tabs
        value={activeThreadId || undefined}
        onValueChange={handleTabChange}
        className="flex-1"
      >
        <TabsList variant="line" className="h-8 bg-transparent">
          {threadEntries.map(([threadId, status]) => (
            <TabsTrigger
              key={threadId}
              value={threadId}
              aria-label={`Thread ${getShortThreadId(threadId)}, ${status}`}
              className="gap-2 pr-8 data-[icon=inline-end] transition-all hover:bg-background/50 relative group"
            >
              <div className="flex items-center gap-2" aria-hidden="true">
                {getStatusIcon(status)}
                <span className="text-xs font-mono font-medium">{getShortThreadId(threadId)}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Close thread ${getShortThreadId(threadId)}`}
                    onClick={(e) => handleClose(e, threadId)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none transition-all rounded-md flex items-center justify-center"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Close thread</TooltipContent>
              </Tooltip>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewThread}
            className="h-7 gap-1.5 shrink-0 hover:bg-primary/10 hover:text-primary transition-colors"
            aria-label="New Run"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Run</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>New Run</TooltipContent>
      </Tooltip>
    </div>
  );
}
