import { forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThreadInputProps {
  userInput: string;
  setUserInput: (val: string) => void;
  isLoading: boolean;
  onStartAgent: () => void;
  className?: string;
  placeholder?: string;
}

export const ThreadInput = forwardRef<HTMLInputElement, ThreadInputProps>(
  ({ userInput, setUserInput, isLoading, onStartAgent, className, placeholder = "Enter your task for the agent... (⌘K)" }, ref) => {
    return (
      <div className={cn("p-4 border-b", className)}>
        <form
          className="flex gap-2 max-w-4xl mx-auto"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isLoading && userInput.trim()) {
              onStartAgent();
            }
          }}
        >
          <div className="relative flex-1">
            <Input
              ref={ref}
              placeholder={placeholder}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              disabled={isLoading}
              className="flex-1 pr-12 transition-all focus:ring-2 focus:ring-primary/20"
              aria-label="Agent task input"
            />
            {userInput && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Clear input"
                    title="Clear input"
                    onClick={() => {
                      setUserInput("");
                      setTimeout(() => {
                        if (ref && 'current' in ref) {
                          ref.current?.focus();
                        }
                      }, 0);
                    }}
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
            type="submit"
            disabled={isLoading || !userInput.trim()}
            className="gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
            size="default"
            aria-label={isLoading ? "Starting..." : "Run"}
            title={isLoading ? "Starting..." : "Run"}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">Starting...</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">Run</span>
              </>
            )}
          </Button>
        </form>
      </div>
    );
  }
);
ThreadInput.displayName = "ThreadInput";
