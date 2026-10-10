import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import { WalletProvider } from "../components/wallet-context";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"] });

export const metadata: Metadata = {
  title: "Swissquote Wallet — hackathon prototype",
  description: "Self-custody wallet prototype for the Swissquote Wallet Challenge (EPFL, Oct 2026).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f1f3f2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
