"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/constants";
import { WalletButton } from "./wallet-button";

const NAV = [
  { href: "/school", label: "University" },
  { href: "/office", label: "Payout partner" },
  { href: "/arbiter", label: "Arbiter" },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="site-header">
      <div className="shell header-row">
        <Link href="/" className="brand">
          {APP_NAME}
        </Link>
        <nav aria-label="Roles" className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
