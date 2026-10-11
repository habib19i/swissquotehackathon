"use client";

import { useEffect } from "react";
import { applyAppearance, loadTheme } from "../lib/appearance";

/** Keeps "system" in step with the phone when it switches between light and dark. */
export function AppearanceSync() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => loadTheme() === "system" && applyAppearance();
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  return null;
}
