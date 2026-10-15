"use client";
import { useEffect } from "react";

/** Registers the service worker once, in production only (dev reloads would fight the cache). */
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* not on a secure origin: skip */ });
  }, []);
  return null;
}
