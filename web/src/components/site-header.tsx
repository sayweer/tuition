"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/constants";
import { WalletButton } from "./wallet-button";

const ROLES = [
  { href: "/school", label: "University" },
  { href: "/office", label: "Payout partner" },
  { href: "/arbiter", label: "Arbiter" },
];

export function SiteHeader() {
  const path = usePathname();
  const landing = path === "/";
  return (
    <header className={landing ? "strip over" : "strip"}>
      <Link href="/" className="brand">
        <i className="tape" aria-hidden />
        <b>{APP_NAME}</b>
        <span>tuition from abroad, signed on Solana</span>
      </Link>
      <nav className="navcard" aria-label="Main">
        {landing ? (
          <>
            <a className="hide-sm" href="#but">Why</a>
            <a className="hide-sm" href="#so">How</a>
            <a className="hide-sm" href="#rules">Rules</a>
            <Link className="cta" href="/school">Open the desk</Link>
          </>
        ) : (
          <>
            {ROLES.map((r) => (
              <Link key={r.href} className="hide-sm" href={r.href} aria-current={path.startsWith(r.href) ? "page" : undefined}>
                {r.label}
              </Link>
            ))}
            <WalletButton />
          </>
        )}
      </nav>
    </header>
  );
}
