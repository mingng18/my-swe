"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useThreadStore } from "@/store/thread-store";
import type { ThreadState } from "@/lib/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Circle, CheckCircle2, AlertCircle, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThreadTabsProps {
  onNewRun?: (input: string) => void;
  className?: string;
}

export function ThreadTabs({ className, onNewRun }: ThreadTabsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRunInput, setNewRunInput] = useState("");
  const threads = useThreadStore((state) => state.threads);
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const setActiveThread = useThreadStore((state) => state.setActiveThread);
  const removeThread = useThreadStore((state) => state.removeThread);

  const threadEntries = Object.entries(threads);
  const activeThread = activeThreadId ? threads[activeThreadId] : null;

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
    setIsModalOpen(true);
  };

  const submitNewRun = () => {
    if (newRunInput.trim() && onNewRun) {
      onNewRun(newRunInput);
      setNewRunInput("");
      setIsModalOpen(false);
    } else {
      setActiveThread(null);
      setIsModalOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      submitNewRun();
    }
  };

  if (threadEntries.length === 0) {
    return (
    <>
      <div className={cn("flex items-center justify-between px-4 py-2.5 border-b bg-muted/30 backdrop-blur-sm", className)}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
          <p className="text-sm text-muted-foreground font-medium">No active threads</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewThread}
          className="h-7 gap-1.5 hover:bg-primary/10 hover:text-primary transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Run</span>
        </Button>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Start New Agent Run</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter your task for the agent..."
              value={newRunInput}
              onChange={(e) => setNewRunInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button onClick={submitNewRun}>Start Run</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
    );
  }

  return (
    <>
    <div className={cn("flex items-center gap-2 px-4 py-2.5 border-b bg-muted/30 backdrop-blur-sm", className)}>
      <Tabs
        value={activeThreadId || undefined}
        onValueChange={handleTabChange}
        className="flex-1"
      >
        <TabsList variant="line" className="h-8 bg-transparent">
          {threadEntries.map(([threadId, thread]) => (
            <TabsTrigger
              key={threadId}
              value={threadId}
              className="gap-2 pr-8 data-[icon=inline-end] transition-all hover:bg-background/50 relative group"
            >
              <div className="flex items-center gap-2">
                {getStatusIcon(thread.status)}
                <span className="text-xs font-mono font-medium">{getShortThreadId(threadId)}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Close thread"
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
      <Button
        variant="ghost"
        size="sm"
        onClick={handleNewThread}
        className="h-7 gap-1.5 shrink-0 hover:bg-primary/10 hover:text-primary transition-colors"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">New Run</span>
      </Button>
    </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Start New Agent Run</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter your task for the agent..."
              value={newRunInput}
              onChange={(e) => setNewRunInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button onClick={submitNewRun}>Start Run</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
