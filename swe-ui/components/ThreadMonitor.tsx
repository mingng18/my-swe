"use client";

import { useEffect, useState } from "react";
import { useThreadStore } from "@/store/thread-store";
import { useBullhorseStream } from "@/hooks/useBullhorseStream";
import { ThreadTabs } from "@/components/ThreadTabs";
import { TodoSidebar } from "@/components/TodoSidebar";
import { adaptEventsToMessages, groupLLMChunks } from "@/lib/event-adapter";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToastProvider } from "@/components/ui/toast";
import { AlertCircle, Loader2, Send, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThreadMonitorProps {
  threadId?: string;
  className?: string;
}

const API_URL = process.env.NEXT_PUBLIC_BULLHORSE_API_URL || "http://localhost:7860";

export function ThreadMonitor({ threadId: propThreadId, className }: ThreadMonitorProps) {
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const threads = useThreadStore((state) => state.threads);
  const addThread = useThreadStore((state) => state.addThread);
  const updateThread = useThreadStore((state) => state.updateThread);

  const threadId = propThreadId || activeThreadId;
  const thread = threadId ? threads[threadId] : null;

  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleStartAgent = async () => {
    if (!userInput.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: userInput }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start agent: ${response.statusText}`);
      }

      const data = await response.json();

      // Add thread to store
      addThread(data.threadId);

      // Clear input
      setUserInput("");
    } catch (err) {
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
    <ToastProvider>
      <div className={cn("flex flex-col h-screen bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-card">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Bullhorse Agent Monitor</h1>
          {threadId && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {connectionState === "connected" ? (
                <span className="flex items-center gap-1 text-green-500">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Connected
                </span>
              ) : connectionState === "connecting" ? (
                <span className="flex items-center gap-1 text-yellow-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Connecting...
                </span>
              ) : connectionState === "error" ? (
                <span className="flex items-center gap-1 text-red-500">
                  <AlertCircle className="h-3 w-3" />
                  Connection Error
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                  Disconnected
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Thread Tabs */}
      <ThreadTabs />

      {/* New Agent Input (shown when no threads or explicitly requested) */}
      {!threadId && (
        <div className="p-4 border-b bg-muted/30">
          <div className="flex gap-2">
            <Input
              placeholder="Enter your task for the agent..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              onClick={handleStartAgent}
              disabled={isLoading || !userInput.trim()}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Start Agent
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
            <div className="p-4 border-b bg-background">
              <div className="flex gap-2">
                <Input
                  placeholder="Start a new agent run..."
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={isLoading}
                  className="flex-1"
                />
                <Button
                  onClick={handleStartAgent}
                  disabled={isLoading || !userInput.trim()}
                  size="sm"
                  className="gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting...
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
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    {thread.status === "running" ? (
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    ) : (
                      <AlertCircle className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">
                    {thread.status === "running" ? "Waiting for events..." : "No events yet"}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    {thread.status === "running"
                      ? "The agent is processing. Events will appear here as they happen."
                      : "Start an agent run to see the timeline of events."}
                  </p>
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
          <Card className="max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🚀</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Start Your First Agent Run</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Enter a task above to start the Bullhorse agent. Watch as it processes your request
              in real-time.
            </p>
            <div className="space-y-2 text-left text-xs text-muted-foreground">
              <p className="font-medium">Example tasks:</p>
              <ul className="space-y-1 ml-4">
                <li>• "Search for authentication code in the repo"</li>
                <li>• "Fix the bug in the login flow"</li>
                <li>• "Add unit tests for the user service"</li>
                <li>• "Review the pull request for security issues"</li>
              </ul>
            </div>
          </Card>
        </div>
      )}
    </div>
    </ToastProvider>
  );
}
