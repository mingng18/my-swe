import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, RefreshCw, X } from "lucide-react";
import { useThreadStore } from "@/store/thread-store";
import { useShallow } from "zustand/react/shallow";

interface ThreadBannersProps {
  error: string | null;
  sseError: string | null;
  showReconnectingBanner: boolean;
  reconnectAttempt: number;
  threadId: string | null | undefined;
  clearError: () => void;
  manualReconnect: () => void;
  handleRetry: () => void;
}

export function ThreadBanners({
  error,
  sseError,
  showReconnectingBanner,
  reconnectAttempt,
  threadId,
  clearError,
  manualReconnect,
  handleRetry,
}: ThreadBannersProps) {
  const threadStatusError = useThreadStore(
    useShallow((state) => {
      const t = threadId ? state.threads[threadId] : null;
      return t ? { status: t.status, error: t.error } : null;
    })
  );

  return (
    <>
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

      {/* Thread Error Banner */}
      {threadStatusError && threadStatusError.status === "error" && threadStatusError.error && (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Thread Error</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{threadStatusError.error}</span>
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
    </>
  );
}
