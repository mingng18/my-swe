import { useEffect } from "react";

interface KeyboardShortcutOptions {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  callback: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcut({
  key,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
  altKey = false,
  callback,
  enabled = true,
}: KeyboardShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const matchesKey = e.key.toLowerCase() === key.toLowerCase();
      const matchesCtrl = e.ctrlKey === ctrlKey;
      const matchesMeta = e.metaKey === metaKey;
      const matchesShift = e.shiftKey === shiftKey;
      const matchesAlt = e.altKey === altKey;

      if (matchesKey && matchesCtrl && matchesMeta && matchesShift && matchesAlt) {
        e.preventDefault();
        callback();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [key, ctrlKey, metaKey, shiftKey, altKey, callback, enabled]);
}
