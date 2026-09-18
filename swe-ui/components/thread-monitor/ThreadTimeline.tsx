import { useEffect, useRef, memo, useState, useCallback, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Zap, ChevronRight, User, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useThreadStore } from "@/store/thread-store";
import { adaptEventsToMessages, groupLLMChunks } from "@/lib/event-adapter";

interface ThreadTimelineProps {
  threadId: string;
  connectionState: "connecting" | "connected" | "disconnected" | "error";
}

function CopyArgsButton({ args }: { args: Record<string, unknown> }) {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(args, null, 2));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy args:", error);
    }
  }, [args]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={copyToClipboard}
          aria-label={isCopied ? "Copied tool arguments" : "Copy tool arguments"}
          className="absolute top-2 right-2 h-6 w-6 opacity-50 hover:opacity-100 transition-opacity"
        >
          {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isCopied ? "Copied" : "Copy args"}</TooltipContent>
    </Tooltip>
  );
}

function CopyMessageButton({ content }: { content: string }) {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy message:", error);
    }
  }, [content]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={copyToClipboard}
          aria-label={isCopied ? "Copied message" : "Copy message"}
          className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover/message:opacity-50 hover:!opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isCopied ? "Copied" : "Copy message"}</TooltipContent>
    </Tooltip>
  );
}

export const ThreadTimeline = memo(function ThreadTimeline({ threadId, connectionState }: ThreadTimelineProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const thread = useThreadStore((state) => state.threads[threadId]);
  const messages = useMemo(
    () => (thread ? groupLLMChunks(adaptEventsToMessages(thread.events)) : []),
    [thread],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thread?.status]);

  if (!thread) return null;

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
        <div
          className="space-y-4 max-w-4xl mx-auto"
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-label="Agent messages timeline"
        >
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
                    <Card className="flex-1 p-3 max-w-2xl shadow-sm relative group/message pr-10">
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
                          <div className="pl-4 mt-1 relative group/args">
                            <pre
                              className="text-xs bg-muted/50 p-2 pr-12 rounded border overflow-x-auto text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                              tabIndex={0}
                              aria-label="Tool arguments"
                            >
                              {JSON.stringify(message.metadata.args, null, 2)}
                            </pre>
                            <CopyArgsButton args={message.metadata.args} />
                          </div>
                        </details>
                      )}
                      {message.metadata?.duration && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Duration: {message.metadata.duration}ms
                        </p>
                      )}
                      {message.content && (
                        <CopyMessageButton content={message.content} />
                      )}
                    </Card>
                  </>
                ) : message.role === "user" ? (
                  <>
                    <Card className="flex-1 p-3 max-w-2xl bg-primary text-primary-foreground shadow-sm">
                      <div className="flex items-center gap-2 mb-1 opacity-90">
                        <span className="text-xs font-medium">You</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    </Card>
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                      <User className="h-4 w-4" />
                    </div>
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
});
