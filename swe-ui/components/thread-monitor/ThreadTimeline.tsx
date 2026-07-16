import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Loader2, Zap, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThreadState } from "@/lib/types";

// Properly typed interface to avoid 'any'
interface MessageContent {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: {
    tool?: string;
    isToolCall?: boolean;
    isToolResult?: boolean;
    args?: Record<string, unknown>;
    duration?: number;
  };
}

interface ThreadTimelineProps {
  messages: MessageContent[];
  thread: ThreadState;
  connectionState: "connecting" | "connected" | "disconnected" | "error";
}

export function ThreadTimeline({ messages, thread, connectionState }: ThreadTimelineProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thread.status]);

  return (
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
          {messages.map((message, index: number) => {
            return (
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
                        <span className="text-sm" role="img" aria-label="Agent">🤖</span>
                      ) : (
                        <span className="text-sm" role="img" aria-label="System">⚙️</span>
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
                        <details className="mt-2 group/details">
                          <summary className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded-sm select-none list-none [&::-webkit-details-marker]:hidden">
                            <ChevronRight className="h-3 w-3 transition-transform duration-200 group-open/details:rotate-90" />
                            Arguments
                          </summary>
                          <div className="pl-4 mt-1">
                            <pre className="text-xs bg-muted/50 p-2 rounded border overflow-x-auto text-muted-foreground">
                              {JSON.stringify(message.metadata.args, null, 2)}
                            </pre>
                          </div>
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
            );
          })}
          {thread.status === "running" && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm" role="img" aria-label="Agent">🤖</span>
              </div>
              <Card className="flex-1 p-3 max-w-2xl">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Agent is working...</span>
                </div>
              </Card>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}
    </ScrollArea>
  );
}
