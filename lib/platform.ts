"use client";

import { useSyncExternalStore } from "react";

/** iPhone / iPad (iPadOS reports itself as a Mac, so also check for touch). */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Safari or any iOS browser (all iOS browsers use Safari's WebKit engine). */
export function isWebKitBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isIOS()) return true;
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg\/|OPR\//.test(ua);
}

export interface Platform {
  ios: boolean;
  webkit: boolean;
}

const SERVER: Platform = { ios: false, webkit: false };
let cached: Platform | null = null;
const noop = () => () => {};

/** Platform flags for rendering: false on the server and during hydration, real values after. */
export function usePlatform(): Platform {
  return useSyncExternalStore(
    noop,
    () => (cached ??= { ios: isIOS(), webkit: isWebKitBrowser() }),
    () => SERVER,
  );
}
