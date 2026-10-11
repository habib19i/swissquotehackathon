"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatIcon, CompassIcon, HomeIcon, RulesIcon, SendIcon } from "./icons";

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/explore", label: "Explore", Icon: CompassIcon },
  { href: "/assistant", label: "Assistant", Icon: ChatIcon, raised: true },
  { href: "/send", label: "Send", Icon: SendIcon },
  { href: "/rules", label: "Rules", Icon: RulesIcon },
];

/** The app's main sections, at thumb height; the assistant sits in the middle, raised. */
export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tab-bar" aria-label="Main">
      {TABS.map(({ href, label, Icon, raised }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} className={`tab${raised ? " raised" : ""}`} aria-current={active ? "page" : undefined}>
            <span className="tab-icon">
              <Icon size={raised ? 26 : 24} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
