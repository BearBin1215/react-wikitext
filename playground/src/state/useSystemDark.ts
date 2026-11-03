import { useSyncExternalStore } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

let mediaQuery: MediaQueryList | undefined;

function getMediaQuery(): MediaQueryList {
  mediaQuery ??= window.matchMedia(DARK_QUERY);
  return mediaQuery;
}

function subscribe(callback: () => void): () => void {
  const query = getMediaQuery();
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return getMediaQuery().matches;
}

export function useSystemDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
