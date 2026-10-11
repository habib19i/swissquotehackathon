import Link from "next/link";
import { BackIcon, ShieldIcon } from "./icons";
import { TabBar } from "./tab-bar";
import { ThemeToggle } from "./theme-toggle";

/**
 * Every screen: brand bar, optional back link, content, the main action at the bottom, and, on the main
 * sections, the tab bar.
 */
export function Screen({
  back,
  actions,
  tabs = false,
  children,
}: {
  back?: { href: string; label?: string };
  actions?: React.ReactNode;
  tabs?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`screen${tabs ? " with-tabs" : ""}`}>
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Swissquote Wallet, home">
          <span className="brand-mark" aria-hidden="true">
            <img src="/swissquote-logo.png" alt="" width={40} height={40} />
          </span>
          <span className="brand-name">
            Swissquote
            <span className="brand-sub">My Wallet</span>
          </span>
        </Link>
        <ThemeToggle />
        <Link href="/demo" className="prototype-tag" title="Open the demo panel">
          Hackathon prototype
        </Link>
      </header>
      {back && (
        <Link href={back.href} className="back">
          <BackIcon size={20} />
          {back.label ?? "Back"}
        </Link>
      )}
      <main id="main" className="screen-body">{children}</main>
      {actions && <div className="actions">{actions}</div>}
      {tabs && <TabBar />}
    </div>
  );
}

export function ProtectedBySwissquote() {
  return (
    <span className="protected">
      <ShieldIcon size={22} />
      Protected by Swissquote
    </span>
  );
}

export function Mock({ children = "Mock" }: { children?: React.ReactNode }) {
  return <span className="mock">{children}</span>;
}
