"use client";

import { CheckCircle2, Circle, ListTodo, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useThreadStore } from "@/store/thread-store";

interface TodoSidebarProps {
	threadId: string;
	className?: string;
}

export function TodoSidebar({ threadId, className }: TodoSidebarProps) {
	// ⚡ Bolt Optimization: Only subscribe to the `todos` array instead of the full thread object.
	// This prevents the Sidebar from re-rendering on every LLM stream event (which updates the parent thread reference).
	const todos = useThreadStore((state) => state.threads[threadId]?.todos);

	if (!todos) {
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

	const getStatusBadgeVariant = (
		status: Todo["status"],
	): "default" | "secondary" | "outline" => {
		switch (status) {
			case "pending":
				return "secondary";
			case "in_progress":
				return "default";
			case "completed":
				return "outline";
		}
	};

	// ⚡ Bolt: Replaced multiple .filter().length passes with a single O(N) loop
	// to avoid intermediate array allocations and reduce garbage collection pressure.
	let completedTasks = 0;
	let inProgressTasks = 0;
	for (let i = 0; i < todos.length; i++) {
		if (todos[i].status === "completed") {
			completedTasks++;
		} else if (todos[i].status === "in_progress") {
			inProgressTasks++;
		}
	}
	const progressPercentage =
		todos.length > 0 ? (completedTasks / todos.length) * 100 : 0;

	return (
		<Card className={cn("flex flex-col h-full", className)}>
			<div className="p-4 border-b bg-muted/30">
				<div className="flex items-center justify-between mb-3">
					<h2 className="font-semibold text-sm flex items-center gap-2">
						<ListTodo className="h-4 w-4 text-primary" />
						Tasks
					</h2>
					<Badge variant="secondary" className="text-xs font-medium">
						{completedTasks} / {todos.length}
					</Badge>
				</div>

				<Progress
					value={progressPercentage}
					className="h-1.5 mb-2"
					aria-label={`Task progress: ${Math.round(progressPercentage)}% completed`}
				/>

				<p className="text-xs text-muted-foreground">
					{inProgressTasks} in progress
				</p>
			</div>
			<ScrollArea className="flex-1 p-4">
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
					<ul className="space-y-2">
						{todos.map((todo) => (
							<li
								key={todo.id}
								className={cn(
									"group flex items-start gap-3 p-3 rounded-lg border transition-all hover:shadow-sm",
									todo.status === "in_progress" &&
										"bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
									todo.status === "completed" &&
										"bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 opacity-75",
									todo.status === "pending" &&
										"bg-background hover:bg-muted/50",
								)}
							>
								<div className="mt-0.5 shrink-0">
									<span className="sr-only">Status: {todo.status.replace("_", " ")}</span>
									<div aria-hidden="true">
										{getStatusIcon(todo.status)}
									</div>
								</div>
								<div className="flex-1 min-w-0">
									<p
										className={cn(
											"text-sm font-medium truncate mb-1",
											todo.status === "completed" &&
												"line-through text-muted-foreground",
										)}
									>
										{todo.subject}
									</p>
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
							</li>
						))}
					</ul>
				)}
			</ScrollArea>
		</Card>
	);
}
