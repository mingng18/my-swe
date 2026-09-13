import { Card } from "@/components/ui/card";
import { Bot, Search, FileCode, Zap } from "lucide-react";

interface ThreadEmptyStateProps {
  onSuggestionClick?: (suggestion: string) => void;
}

export function ThreadEmptyState({
  onSuggestionClick,
}: ThreadEmptyStateProps = {}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <Card className="max-w-lg w-full p-8 text-center shadow-lg border-2">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mx-auto mb-6">
          <Bot className="h-10 w-10 text-primary" />
        </div>
        <h3 className="text-xl font-bold mb-2">Start Your First Agent Run</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Enter a task above to start the Bullhorse agent. Watch as it processes
          your request in real-time with full transparency.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          <button
            type="button"
            onClick={() => onSuggestionClick?.("Find auth implementations")}
            className="flex w-full text-left items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-all active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            <Search className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Code Search</p>
              <p className="text-xs text-muted-foreground">
                &quot;Find auth implementations&quot;
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => onSuggestionClick?.("Fix login flow error")}
            className="flex w-full text-left items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-all active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            <FileCode className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Bug Fixes</p>
              <p className="text-xs text-muted-foreground">
                &quot;Fix login flow error&quot;
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => onSuggestionClick?.("Test user service")}
            className="flex w-full text-left items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-all active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            <Zap className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Add Tests</p>
              <p className="text-xs text-muted-foreground">
                &quot;Test user service&quot;
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => onSuggestionClick?.("Review PR #123")}
            className="flex w-full text-left items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-all active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Code Review</p>
              <p className="text-xs text-muted-foreground">
                &quot;Review PR #123&quot;
              </p>
            </div>
          </button>
        </div>
        <div className="mt-6 pt-6 border-t">
          <p className="text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] font-mono">
              ⌘K
            </kbd>{" "}
            to focus input
          </p>
        </div>
      </Card>
    </div>
  );
}
