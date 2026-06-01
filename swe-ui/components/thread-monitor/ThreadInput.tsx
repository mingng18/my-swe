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
        <div className="flex gap-2 max-w-4xl mx-auto">
          <div className="relative flex-1">
            <Input
              ref={ref}
              placeholder={placeholder}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onStartAgent();
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
            aria-label={isLoading ? "Starting" : "Run"}
            onClick={onStartAgent}
            disabled={isLoading || !userInput.trim()}
            className="gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
            size="default"
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
        </div>
      </div>
    );
  }
);
ThreadInput.displayName = "ThreadInput";
