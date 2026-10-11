"use client";

import { loadPaper, saveAppearance } from "../lib/appearance";
import { MoonIcon, SunIcon } from "./icons";

/**
 * One tap between light and dark, on every screen. The icon follows the page's actual mode through CSS,
 * so it is right from the first paint.
 */
export function ThemeToggle() {
  function toggle() {
    const dark = document.documentElement.dataset.theme === "dark";
    saveAppearance(dark ? "light" : "dark", loadPaper());
  }

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Switch between light and dark mode" title="Light or dark mode">
      <span className="when-light">
        <MoonIcon size={20} />
      </span>
      <span className="when-dark">
        <SunIcon size={20} />
      </span>
    </button>
  );
}
