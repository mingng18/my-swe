"use client";

import { useThreadStore } from "@/store/thread-store";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Loader2, ListTodo } from "lucide-react";
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
      <Card className={cn("flex flex-col h-full", className)}>
        <div className="p-4 border-b">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-muted-foreground" />
            Tasks
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
              <ListTodo className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No thread selected</p>
          </div>
        </div>
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
      <div className="p-4 border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary" />
            Tasks
          </h2>
          <Badge variant="secondary" className="text-xs font-medium">
            {todos.filter((t) => t.status === "completed").length} / {todos.length}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {todos.filter((t) => t.status === "in_progress").length} in progress
        </p>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-2">
          {todos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <ListTodo className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium mb-1">No tasks yet</p>
              <p className="text-xs text-muted-foreground">
                Tasks will appear here as the agent works
              </p>
            </div>
          ) : (
            todos.map((todo) => (
              <div
                key={todo.id}
                className={cn(
                  "group flex items-start gap-3 p-3 rounded-lg border transition-all hover:shadow-sm",
                  todo.status === "in_progress" && "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
                  todo.status === "completed" && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 opacity-75",
                  todo.status === "pending" && "bg-background hover:bg-muted/50",
                )}
              >
                <Checkbox
                  checked={todo.status === "completed"}
                  disabled
                  className="mt-0.5"
                  aria-label={`Task: ${todo.subject}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {getStatusIcon(todo.status)}
                    <p
                      className={cn(
                        "text-sm font-medium truncate",
                        todo.status === "completed" && "line-through text-muted-foreground",
                      )}
                    >
                      {todo.subject}
                    </p>
                  </div>
                  {todo.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {todo.description}
                    </p>
                  )}
                </div>
                <Badge
                  variant={getStatusBadgeVariant(todo.status)}
                  className="text-xs shrink-0 capitalize"
                >
                  {todo.status.replace("_", " ")}
                </Badge>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
