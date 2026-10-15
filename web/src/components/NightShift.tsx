"use client";
import { useEffect } from "react";

/** From 23:00 to 06:00 local time the palette turns a little warmer (html[data-night], see globals.css). */
export default function NightShift() {
  useEffect(() => {
    const apply = () => {
      const h = new Date().getHours();
      if (h >= 23 || h < 6) document.documentElement.dataset.night = "";
      else delete document.documentElement.dataset.night;
    };
    apply();
    const id = setInterval(apply, 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  return null;
}
