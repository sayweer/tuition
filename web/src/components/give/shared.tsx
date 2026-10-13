"use client";

import type { Address } from "@solana/kit";
import useSWR from "swr";
import { MINTS, explorerTx, mintSymbol } from "@/lib/constants";
import { formatAmount, tokenBalance, type Invoice } from "@/lib/escrow";
import { useApp } from "@/lib/hooks";
import { useLang, useT, type Lang } from "@/lib/i18n";
import { T } from "./copy";

export type Step = 1 | 2 | 3;

/** A request in the "To give" list. `amountText` null means "the full missing amount", which
 *  follows the request live if someone else gives meanwhile. */
export type CartItem = { address: Address; inv: Invoice; amountText: string | null };

/** A frozen line of the gift summary. */
export type Gift = { address: Address; inv: Invoice; amount: bigint };

export type SendState = { status: "waiting" | "signing" | "done" | "error"; signature?: string; error?: string };

/** Id of the heading each step opens with; the page moves focus there when the step changes. */
export const STEP_HEADING = "give-step-heading";

const UNIT = 1_000_000n;

/** Unix seconds right now, for event handlers (render code uses the ticking `useNow`). */
export const nowSecs = () => Math.floor(Date.now() / 1000);

/** Base units to a plain, editable decimal ("300", "300.5", or "300,5" in Turkish). */
export function toInput(base: bigint, lang: Lang): string {
  const frac = (base % UNIT).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${base / UNIT}${lang === "tr" ? "," : "."}${frac}` : `${base / UNIT}`;
}

/** Sums per currency, in the order of MINTS. */
export function totalsByMint(lines: { mint: Address; amount: bigint }[]): [Address, bigint][] {
  const sums = new Map<Address, bigint>();
  for (const l of lines) sums.set(l.mint, (sums.get(l.mint) ?? 0n) + l.amount);
  const order = (m: Address) => {
    const i = MINTS.findIndex((x) => x.address === m);
    return i < 0 ? MINTS.length : i;
  };
  return [...sums.entries()].sort((a, b) => order(a[0]) - order(b[0]));
}

export function Steps({ step }: { step: Step }) {
  const t = useT(T);
  return (
    <ol className="give-steps" aria-label={t.stepsLabel}>
      {t.steps.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "now" : "todo";
        return (
          <li key={label} className={state} aria-current={n === step ? "step" : undefined}>
            <span className="give-step-n" aria-hidden>
              {n < step ? "✓" : n}
            </span>
            {label}
            {n < step && <span className="give-sr"> {t.stepDone}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Time left to give, from the request's funding deadline. `now` comes from the parent's clock. */
export function FundingClock({ deadline, now }: { deadline: bigint; now: number }) {
  const t = useT(T);
  const left = Number(deadline) - now;
  if (left <= 0) return <span className="countdown expired">{t.closed}</span>;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const text =
    d > 0 ? `${d}${t.d} ${h}${t.h}` : h > 0 ? `${h}${t.h} ${m}${t.m}` : `${m}:${String(s).padStart(2, "0")}`;
  return <span className={left < 3600 ? "countdown give-soon" : "countdown"}>{t.closesIn(text)}</span>;
}

export function Progress({ raised, amount, label }: { raised: bigint; amount: bigint; label: string }) {
  const pct = amount > 0n ? Math.min(100, Number((raised * 1000n) / amount) / 10) : 0;
  return (
    <div
      className="give-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={label}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Totals({ lines, label }: { lines: { mint: Address; amount: bigint }[]; label: string }) {
  const lang = useLang();
  const totals = totalsByMint(lines);
  if (!totals.length) return null;
  return (
    <dl className="give-totals">
      {totals.map(([mint, sum]) => (
        <div key={mint}>
          <dt className="label">{label}</dt>
          <dd>
            {formatAmount(sum, lang)} <small>{mintSymbol(mint)}</small>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One transaction's live state on a summary line. */
export function LineStatus({ state, onRetry, canRetry }: { state?: SendState; onRetry?: () => void; canRetry?: boolean }) {
  const t = useT(T);
  if (!state) return null;
  if (state.status === "waiting") return <p className="give-st give-st-wait">{t.stWaiting}</p>;
  if (state.status === "signing") return <p className="give-st give-st-sign">{t.stSigning}</p>;
  if (state.status === "done")
    return (
      <p className="give-st give-st-ok">
        <span className="ink-chip ink-ok">✓ {t.stDone}</span>
        {state.signature && (
          <a href={explorerTx(state.signature)} target="_blank" rel="noreferrer">
            {t.viewTx}
          </a>
        )}
      </p>
    );
  return (
    <div className="give-st give-st-err">
      <p role="alert">{state.error}</p>
      {onRetry && (
        <button type="button" className="btn paperbtn give-small" onClick={onRetry} disabled={!canRetry}>
          {t.retry}
        </button>
      )}
    </div>
  );
}

/** The donor's balance in one currency against what the summary needs. */
export function BalanceCheck({ owner, mint, need }: { owner: Address; mint: Address; need: bigint }) {
  const { rpc } = useApp();
  const lang = useLang();
  const t = T[lang];
  const symbol = mintSymbol(mint);
  const bal = useSWR(["give-balance", owner, mint], () => tokenBalance(rpc, owner, mint));
  if (bal.data === undefined) return <p className="give-fine">{t.balanceLoading}</p>;
  const have = formatAmount(bal.data, lang);
  return bal.data >= need ? (
    <p className="notice notice-ok">{t.balanceOk(have, symbol)}</p>
  ) : (
    <p className="notice notice-error">{t.balanceShort(have, formatAmount(need, lang), symbol)}</p>
  );
}
