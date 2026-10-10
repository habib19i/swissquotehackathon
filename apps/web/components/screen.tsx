import Link from "next/link";
import { BackIcon, ShieldIcon } from "./icons";

/** Every screen: brand bar, optional back link, content, and the main action at the bottom. */
export function Screen({
  back,
  actions,
  children,
}: {
  back?: { href: string; label?: string };
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="screen">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Swissquote Wallet, home">
          <span className="brand-mark" aria-hidden="true" />
          Swissquote Wallet
        </Link>
        <span className="prototype-tag">Hackathon prototype</span>
      </header>
      {back && (
        <Link href={back.href} className="back">
          <BackIcon size={20} />
          {back.label ?? "Back"}
        </Link>
      )}
      <main className="screen-body">{children}</main>
      {actions && <div className="actions">{actions}</div>}
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
