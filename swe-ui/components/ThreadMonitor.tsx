"use client";

import { useEffect, useState, useRef } from "react";
import { useThreadStore } from "@/store/thread-store";
import { useBullhorseStream } from "@/hooks/useBullhorseStream";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { ThreadTabs } from "@/components/ThreadTabs";
import { TodoSidebar } from "@/components/TodoSidebar";
import { adaptEventsToMessages, groupLLMChunks } from "@/lib/event-adapter";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Loader2, Send, RefreshCw, X, Bot, Zap, FileCode, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThreadMonitorProps {
  threadId?: string;
  className?: string;
}

const API_URL = process.env.NEXT_PUBLIC_BULLHORSE_API_URL || "http://localhost:3000";

export function ThreadMonitor({ threadId: propThreadId, className }: ThreadMonitorProps) {
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const threads = useThreadStore((state) => state.threads);
  const addThread = useThreadStore((state) => state.addThread);
  const updateThread = useThreadStore((state) => state.updateThread);
  const setActiveThread = useThreadStore((state) => state.setActiveThread);

  const threadId = propThreadId || activeThreadId;
  const thread = threadId ? threads[threadId] : null;

  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track connection state in a ref that handleStartAgent can read
  const connectionStateRef = useRef<"connecting" | "connected" | "disconnected" | "error">("disconnected");

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

      console.log(`[ThreadMonitor] Creating thread ${clientThreadId} and connecting SSE first...`);

      // Add thread to store and set it as active so SSE hook can start connecting
      addThread(clientThreadId);
      setActiveThread(clientThreadId);

      // Wait for React to re-render and useBullhorseStream to start connecting
      await new Promise(resolve => setTimeout(resolve, 100));

      // Wait for SSE connection to be established before starting the agent
      // This prevents the race condition where events are emitted before the client is listening
      const maxWaitTime = 5000; // 5 seconds max wait for connection
      const startTime = Date.now();

      console.log(`[ThreadMonitor] Waiting for SSE connection... (current: ${connectionStateRef.current})`);

      // Use the ref to check connection state instead of the captured state variable
      while (connectionStateRef.current !== "connected" && Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (connectionStateRef.current !== "connected") {
        throw new Error("Failed to establish SSE connection. Please check your network.");
      }

      console.log(`[ThreadMonitor] SSE connected! Starting agent for thread ${clientThreadId}`);

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
        console.warn(`Server returned different threadId: ${data.threadId} vs ${clientThreadId}`);
      }

      console.log(`[ThreadMonitor] Agent started successfully for thread ${data.threadId}`);

      // Clear input
      setUserInput("");
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleStartAgent();
    }
  };

  // Convert events to messages for display
  const messages = thread ? groupLLMChunks(adaptEventsToMessages(thread.events)) : [];

  return (
    <div className={cn("flex flex-col h-screen bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-card shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              Bullhorse Agent Monitor
            </h1>
          </div>
          {threadId && (
            <div className="flex items-center gap-2 text-sm">
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

      {/* Thread Tabs */}
      <ThreadTabs />

      {/* New Agent Input (shown when no threads or explicitly requested) */}
      {!threadId && (
        <div className="p-4 border-b bg-muted/30 backdrop-blur-sm">
          <div className="flex gap-2 max-w-4xl mx-auto">
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                placeholder="Enter your task for the agent... (⌘K)"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleStartAgent();
                  }
                }}
                disabled={isLoading}
                className="flex-1 pr-12 transition-all focus:ring-2 focus:ring-primary/20"
              />
              {userInput && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Clear input"
                      onClick={() => setUserInput("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 opacity-50 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear input</TooltipContent>
                </Tooltip>
              )}
            </div>
            <Button
              onClick={handleStartAgent}
              disabled={isLoading || !userInput.trim()}
              className="gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              size="default"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  <span className="hidden sm:inline">Start Agent</span>
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* SSE Error Banner */}
      {sseError && (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Server Error</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span className="flex-1">{sseError}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearError}
              className="ml-4 gap-1 h-8"
            >
              <X className="h-3 w-3" />
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Reconnecting Banner */}
      {showReconnectingBanner && (
        <Alert className="m-4 border-yellow-500/50 bg-yellow-500/10">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>Connection Lost</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              Reconnecting{reconnectAttempt > 0 ? ` (attempt ${reconnectAttempt})` : ""}...
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={manualReconnect}
              className="ml-4 gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect Now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {thread && thread.status === "error" && thread.error && (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Thread Error</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{thread.error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="ml-4 gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Content Area */}
      {threadId && thread ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar - Todo Panel */}
          <div className="w-[280px] border-r bg-muted/20 flex-shrink-0">
            <TodoSidebar threadId={threadId} />
          </div>

          {/* Right Content - Timeline */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* New Agent Input (shown when thread is active) */}
            <div className="p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="flex gap-2 max-w-4xl mx-auto">
                <div className="relative flex-1">
                  <Input
                    ref={inputRef}
                    placeholder="Start a new agent run... (⌘K)"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleStartAgent();
                      }
                    }}
                    disabled={isLoading}
                    className="flex-1 pr-12 transition-all focus:ring-2 focus:ring-primary/20"
                  />
                  {userInput && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Clear input"
                          onClick={() => setUserInput("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 opacity-50 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Clear input</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <Button
                  onClick={handleStartAgent}
                  disabled={isLoading || !userInput.trim()}
                  size="sm"
                  className="gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="hidden sm:inline">Starting...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Run
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Timeline */}
            <ScrollArea className="flex-1 p-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-6 shadow-sm">
                    {thread.status === "running" ? (
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    ) : connectionState === "connecting" ? (
                      <div className="space-y-1">
                        <Skeleton className="h-8 w-8 rounded-full" />
                      </div>
                    ) : (
                      <Zap className="h-10 w-10 text-primary/50" />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">
                    {thread.status === "running"
                      ? "Agent is processing..."
                      : connectionState === "connecting"
                      ? "Connecting to stream..."
                      : "Waiting for events"}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    {thread.status === "running"
                      ? "The agent is working on your task. Events will appear here as they happen."
                      : connectionState === "connecting"
                      ? "Establishing connection to the agent stream..."
                      : "Start an agent run to see the timeline of events."}
                  </p>
                  {connectionState === "connecting" && (
                    <div className="mt-6 space-y-2 w-full max-w-sm">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 max-w-4xl mx-auto">
                  {messages.map((message, index) => (
                    <div
                      key={`${message.id}-${index}`}
                      className={cn(
                        "flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300",
                        message.role === "user" && "justify-end",
                      )}
                    >
                      {message.role === "assistant" || message.role === "system" ? (
                        <>
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            {message.role === "assistant" ? (
                              <span className="text-sm">🤖</span>
                            ) : (
                              <span className="text-sm">⚙️</span>
                            )}
                          </div>
                          <Card className="flex-1 p-3 max-w-2xl">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-muted-foreground">
                                {message.role === "assistant" ? "Agent" : "System"}
                              </span>
                              {message.metadata?.tool && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                  {message.metadata.tool}
                                </span>
                              )}
                              {message.metadata?.isToolCall && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500">
                                  Calling
                                </span>
                              )}
                              {message.metadata?.isToolResult && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">
                                  Result
                                </span>
                              )}
                            </div>
                            <p className="text-sm whitespace-pre-wrap break-words">
                              {message.content}
                            </p>
                            {message.metadata?.args && (
                              <details className="mt-2">
                                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                  Arguments
                                </summary>
                                <pre className="text-xs bg-muted/50 p-2 rounded mt-1 overflow-x-auto">
                                  {JSON.stringify(message.metadata.args, null, 2)}
                                </pre>
                              </details>
                            )}
                            {message.metadata?.duration && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Duration: {message.metadata.duration}ms
                              </p>
                            )}
                          </Card>
                        </>
                      ) : null}
                    </div>
                  ))}
                  {thread.status === "running" && (
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm">🤖</span>
                      </div>
                      <Card className="flex-1 p-3 max-w-2xl">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <span className="text-sm text-muted-foreground">Agent is working...</span>
                        </div>
                      </Card>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="max-w-lg w-full p-8 text-center shadow-lg border-2">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mx-auto mb-6">
              <Bot className="h-10 w-10 text-primary" />
            </div>
            <h3 className="text-xl font-bold mb-2">Start Your First Agent Run</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Enter a task above to start the Bullhorse agent. Watch as it processes your request
              in real-time with full transparency.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-default">
                <Search className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Code Search</p>
                  <p className="text-xs text-muted-foreground">"Find auth implementations"</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-default">
                <FileCode className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Bug Fixes</p>
                  <p className="text-xs text-muted-foreground">"Fix login flow error"</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-default">
                <Zap className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Add Tests</p>
                  <p className="text-xs text-muted-foreground">"Test user service"</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-default">
                <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Code Review</p>
                  <p className="text-xs text-muted-foreground">"Review PR #123"</p>
                </div>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t">
              <p className="text-xs text-muted-foreground">
                <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] font-mono">⌘K</kbd> to focus input
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
