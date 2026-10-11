import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { WalletProvider } from "../components/wallet-context";
import { APPEARANCE_BOOT_SCRIPT } from "../lib/appearance";
import { AppearanceSync } from "../components/appearance-sync";
import { ConnectOverlay } from "../components/connect-overlay";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Swissquote Wallet — hackathon prototype",
  description: "Self-custody wallet prototype for the Swissquote Wallet Challenge (EPFL, Oct 2026).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} data-theme="light" data-paper="swissquote" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
      </head>
      <body>
        <AppearanceSync />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <WalletProvider>
          {children}
          <ConnectOverlay />
        </WalletProvider>
      </body>
    </html>
  );
}
