"use client";

import { useThreadStore } from "@/store/thread-store";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TodoSidebarProps {
  threadId: string;
  className?: string;
}

export function TodoSidebar({ threadId, className }: TodoSidebarProps) {
  const thread = useThreadStore((state) => state.threads[threadId]);

  if (!thread) {
    return (
      <Card className={cn("p-4", className)}>
        <p className="text-sm text-muted-foreground">No thread selected</p>
      </Card>
    );
  }

  const { todos } = thread;

  const getStatusIcon = (status: Todo["status"]) => {
    switch (status) {
      case "pending":
        return <Circle className="h-4 w-4 text-muted-foreground" />;
      case "in_progress":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
  };

  const getStatusBadgeVariant = (status: Todo["status"]): "default" | "secondary" | "outline" => {
    switch (status) {
      case "pending":
        return "secondary";
      case "in_progress":
        return "default";
      case "completed":
        return "outline";
    }
  };

  return (
    <Card className={cn("flex flex-col h-full", className)}>
      <div className="p-4 border-b">
        <h2 className="font-semibold text-sm">Tasks</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {todos.filter((t) => t.status === "completed").length} / {todos.length} completed
        </p>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {todos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet</p>
          ) : (
            todos.map((todo) => (
              <div
                key={todo.id}
                className={cn(
                  "flex items-start gap-3 p-2 rounded-lg transition-colors",
                  todo.status === "in_progress" && "bg-blue-50 dark:bg-blue-950/20",
                )}
              >
                <Checkbox
                  checked={todo.status === "completed"}
                  disabled
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(todo.status)}
                    <p
                      className={cn(
                        "text-sm font-medium",
                        todo.status === "completed" && "line-through text-muted-foreground",
                      )}
                    >
                      {todo.subject}
                    </p>
                  </div>
                  {todo.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {todo.description}
                    </p>
                  )}
                </div>
                <Badge variant={getStatusBadgeVariant(todo.status)} className="text-xs">
                  {todo.status}
                </Badge>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
