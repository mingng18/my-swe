"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useThreadStore } from "@/store/thread-store";
import { useBullhorseStream } from "@/hooks/useBullhorseStream";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { ThreadTabs } from "@/components/ThreadTabs";
import { TodoSidebar } from "@/components/TodoSidebar";
import { adaptEventsToMessages, groupLLMChunks } from "@/lib/event-adapter";
import { cn } from "@/lib/utils";

import { ThreadHeader } from "./thread-monitor/ThreadHeader";
import { ThreadInput } from "./thread-monitor/ThreadInput";
import { ThreadBanners } from "./thread-monitor/ThreadBanners";
import { ThreadTimeline } from "./thread-monitor/ThreadTimeline";
import { ThreadEmptyState } from "./thread-monitor/ThreadEmptyState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ThreadMonitorProps {
  threadId?: string;
  className?: string;
}

const API_URL =
  process.env.NEXT_PUBLIC_BULLHORSE_API_URL || "http://localhost:3000";

export function ThreadMonitor({
  threadId: propThreadId,
  className,
}: ThreadMonitorProps) {
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const threadId = propThreadId || activeThreadId;
  // OPTIMIZATION: Select only the active thread to prevent re-renders when other threads update, and memoize the expensive message derivation.
  const thread = useThreadStore((state) =>
    threadId ? state.threads[threadId] : null,
  );
  const addThread = useThreadStore((state) => state.addThread);
  const updateThread = useThreadStore((state) => state.updateThread);
  const setActiveThread = useThreadStore((state) => state.setActiveThread);

  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNewRunModalOpen, setIsNewRunModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track connection state in a ref that handleStartAgent can read
  const connectionStateRef = useRef<
    "connecting" | "connected" | "disconnected" | "error"
  >("disconnected");

  // Keyboard shortcut to focus input
  useKeyboardShortcut({
    key: "k",
    metaKey: true,
    ctrlKey: true,
    callback: () => {
      inputRef.current?.focus();
    },
  });

  // Connect to SSE stream for active thread
  const {
    isConnected,
    connectionState,
    reconnectAttempt,
    showReconnectingBanner,
    sseError,
    manualReconnect,
    clearError,
  } = useBullhorseStream({
    threadId: threadId || "",
    enabled: !!threadId,
  });

  // Sync connection state to ref for handleStartAgent to read
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  const handleStartAgent = async () => {
    if (!userInput.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      // Generate threadId on client first before connecting
      const clientThreadId = crypto.randomUUID();

      console.log(
        `[ThreadMonitor] Creating thread ${clientThreadId} and connecting SSE first...`,
      );

      // Add thread to store and set it as active so SSE hook can start connecting
      addThread(clientThreadId);
      setActiveThread(clientThreadId);

      // Wait for React to re-render and useBullhorseStream to start connecting
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Wait for SSE connection to be established before starting the agent
      // This prevents the race condition where events are emitted before the client is listening
      const maxWaitTime = 5000; // 5 seconds max wait for connection
      const startTime = Date.now();

      console.log(
        `[ThreadMonitor] Waiting for SSE connection... (current: ${connectionStateRef.current})`,
      );

      // Use the ref to check connection state instead of the captured state variable
      while (
        connectionStateRef.current !== "connected" &&
        Date.now() - startTime < maxWaitTime
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (connectionStateRef.current !== "connected") {
        throw new Error(
          "Failed to establish SSE connection. Please check your network.",
        );
      }

      console.log(
        `[ThreadMonitor] SSE connected! Starting agent for thread ${clientThreadId}`,
      );

      // Now that we're connected, start the agent with the existing threadId
      const response = await fetch(`${API_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: userInput, threadId: clientThreadId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start agent: ${response.statusText}`);
      }

      const data = await response.json();

      // Verify the server returned the same threadId we used
      if (data.threadId !== clientThreadId) {
        console.warn(
          `Server returned different threadId: ${data.threadId} vs ${clientThreadId}`,
        );
      }

      console.log(
        `[ThreadMonitor] Agent started successfully for thread ${data.threadId}`,
      );

      // Clear input
      setUserInput("");
      // Close modal on success
      setIsNewRunModalOpen(false);
    } catch (err) {
      console.error(`[ThreadMonitor] Error starting agent:`, err);
      setError(err instanceof Error ? err.message : "Failed to start agent");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    if (threadId) {
      setError(null);
      updateThread(threadId, { status: "running", error: undefined });
    }
  };

  // Convert events to messages for display
  const messages = useMemo(
    () => (thread ? groupLLMChunks(adaptEventsToMessages(thread.events)) : []),
    [thread],
  );

  return (
    <div className={cn("flex flex-col h-screen bg-background", className)}>
      <ThreadHeader threadId={threadId} connectionState={connectionState} />

      <ThreadTabs onNewThread={() => setIsNewRunModalOpen(true)} />

      {!threadId && (
        <ThreadInput
          ref={inputRef}
          userInput={userInput}
          setUserInput={setUserInput}
          isLoading={isLoading}
          onStartAgent={handleStartAgent}
          className="bg-muted/30 backdrop-blur-sm"
        />
      )}

      <ThreadBanners
        error={error}
        sseError={sseError}
        showReconnectingBanner={showReconnectingBanner}
        reconnectAttempt={reconnectAttempt}
        thread={thread}
        clearError={clearError}
        manualReconnect={manualReconnect}
        handleRetry={handleRetry}
      />

      {threadId && thread ? (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[280px] border-r bg-muted/20 flex-shrink-0">
            <TodoSidebar threadId={threadId} />
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
              <ThreadInput
                ref={inputRef}
                userInput={userInput}
                setUserInput={setUserInput}
                isLoading={isLoading}
                onStartAgent={handleStartAgent}
                placeholder="Start a new agent run... (⌘K)"
              />
            </div>

            <ThreadTimeline
              messages={messages}
              thread={thread}
              connectionState={connectionState}
            />
          </div>
        </div>
      ) : (
        <ThreadEmptyState
          onSuggestionClick={(suggestion) => {
            setUserInput(suggestion);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        />
      )}

      <Dialog open={isNewRunModalOpen} onOpenChange={setIsNewRunModalOpen}>
        <DialogContent className="max-w-3xl border-0 p-0 overflow-hidden bg-transparent shadow-none" showCloseButton={false}>
          <div className="bg-background border rounded-xl overflow-hidden shadow-2xl">
            <DialogHeader className="p-4 border-b bg-muted/30">
              <DialogTitle>Start New Agent Run</DialogTitle>
            </DialogHeader>
            <ThreadInput
              userInput={userInput}
              setUserInput={setUserInput}
              isLoading={isLoading}
              onStartAgent={handleStartAgent}
              className="border-0 bg-transparent"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
