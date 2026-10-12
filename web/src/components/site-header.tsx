"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/constants";
import { LangSwitch, useT, type Dict } from "@/lib/i18n";
import { WalletButton } from "./wallet-button";

const T = {
  en: {
    tagline: "tuition from abroad, signed on Solana",
    why: "Why",
    how: "How",
    rules: "Rules",
    open: "Open the desk",
    university: "University",
    partner: "Payout partner",
    arbiter: "Arbiter",
    nav: "Main",
  },
  tr: {
    tagline: "yurt dışından harç, Solana'da imzalı",
    why: "Neden",
    how: "Nasıl",
    rules: "Kurallar",
    open: "Masayı aç",
    university: "Üniversite",
    partner: "Ödeme ortağı",
    arbiter: "Hakem",
    nav: "Ana menü",
  },
} satisfies Dict<Record<string, string>>;

export function SiteHeader() {
  const path = usePathname();
  const t = useT(T);
  const landing = path === "/";
  const roles = [
    { href: "/school", label: t.university },
    { href: "/office", label: t.partner },
    { href: "/arbiter", label: t.arbiter },
  ];
  return (
    <header className={landing ? "strip over" : "strip"}>
      <Link href="/" className="brand">
        <i className="tape" aria-hidden />
        <b>{APP_NAME}</b>
        <span>{t.tagline}</span>
      </Link>
      <nav className="navcard" aria-label={t.nav}>
        {landing ? (
          <>
            <a className="hide-sm" href="#but">{t.why}</a>
            <a className="hide-sm" href="#so">{t.how}</a>
            <a className="hide-sm" href="#rules">{t.rules}</a>
            <Link className="cta" href="/school">{t.open}</Link>
          </>
        ) : (
          <>
            {roles.map((r) => (
              <Link key={r.href} className="hide-sm" href={r.href} aria-current={path.startsWith(r.href) ? "page" : undefined}>
                {r.label}
              </Link>
            ))}
            <WalletButton />
          </>
        )}
        <LangSwitch />
      </nav>
    </header>
  );
}

const F = {
  en: { note: "Solana devnet · test tokens only · no real lira moves on-chain" },
  tr: { note: "Solana devnet · yalnızca test token'ları · zincirde gerçek lira hareket etmez" },
} satisfies Dict<Record<string, string>>;

export function SiteFooter() {
  const t = useT(F);
  return (
    <footer className="site-foot">
      <span>{t.note}</span>
      <span>{APP_NAME}</span>
    </footer>
  );
}
