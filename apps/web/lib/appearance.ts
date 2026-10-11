/**
 * Appearance: light or dark (or the phone's setting), and a background colour from a few presets. Every
 * preset has a light and a dark version, all checked for contrast (replica/design). A per-phone preference,
 * kept in this browser only.
 */
export type Theme = "system" | "light" | "dark";

export const PAPERS = {
  swissquote: { label: "Swissquote", light: "#eff3fa", dark: "#121417" },
  sand: { label: "Sand", light: "#f5efe6", dark: "#17140f" },
  mint: { label: "Mint", light: "#e9f4ee", dark: "#0f1714" },
  rose: { label: "Rose", light: "#fbeeee", dark: "#181012" },
  lavender: { label: "Lavender", light: "#f0eefa", dark: "#13121a" },
  white: { label: "Pure", light: "#ffffff", dark: "#050505" },
} as const;
export type Paper = keyof typeof PAPERS;

const THEME_KEY = "sqw.theme";
const PAPER_KEY = "sqw.paper";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice simply lasts until the page closes.
  }
}

export const loadTheme = (): Theme => (["light", "dark", "system"].includes(read(THEME_KEY) ?? "") ? (read(THEME_KEY) as Theme) : "system");
export const loadPaper = (): Paper => ((read(PAPER_KEY) ?? "") in PAPERS ? (read(PAPER_KEY) as Paper) : "swissquote");

/** Sets data-theme (always "light" or "dark") and data-paper on <html>. */
export function applyAppearance(theme = loadTheme(), paper = loadPaper()) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.paper = paper;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", PAPERS[paper][dark ? "dark" : "light"]);
}

export function saveAppearance(theme: Theme, paper: Paper) {
  write(THEME_KEY, theme);
  write(PAPER_KEY, paper);
  applyAppearance(theme, paper);
}

/** Runs before the first paint (layout.tsx), so the page never flashes the wrong colours. */
export const APPEARANCE_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}")||"system",p=localStorage.getItem("${PAPER_KEY}")||"swissquote",d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches),r=document.documentElement;r.dataset.theme=d?"dark":"light";r.dataset.paper=p}catch(e){}`;
