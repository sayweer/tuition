"use client";

import { useId } from "react";
import type { Address } from "@solana/kit";
import { ConnectPrompt } from "@/components/ui";
import { mintSymbol } from "@/lib/constants";
import {
  Status,
  formatAmount,
  formatTerm,
  isFundingOpen,
  parseAmount,
  remainingOf,
  type Invoice,
} from "@/lib/escrow";
import { usePayeeName } from "@/lib/hooks";
import { useLang, useT, type Lang } from "@/lib/i18n";
import { T, type GiveCopy } from "./copy";
import { Totals, toInput, type CartItem } from "./shared";

/** What one list item would give: an amount, a problem to fix, or a deliberate 0 (skipped). */
export type ItemCheck = { amount: bigint; error: string | null; blocked: boolean };

export function checkItem(item: CartItem, inv: Invoice, now: number, me: Address | null, t: GiveCopy, lang: Lang): ItemCheck {
  const missing = remainingOf(inv);
  const stop = (error: string) => ({ amount: 0n, error, blocked: true });
  if (me && (me === inv.payee || me === inv.office)) return stop(t.own);
  if (inv.status !== Status.Open || missing === 0n) {
    const funded = inv.status === Status.Funded || inv.status === Status.Paid || inv.status === Status.Released;
    return stop(funded || missing === 0n ? t.itemFunded : t.itemClosed);
  }
  if (!isFundingOpen(inv, now)) return stop(t.itemClosed);
  if (item.amountText === null) return { amount: missing, error: null, blocked: false };
  const raw = item.amountText.trim();
  if (!raw) return { amount: 0n, error: t.errEmpty, blocked: false };
  const amount = parseAmount(raw, lang);
  if (amount === null) return { amount: 0n, error: t.errFormat, blocked: false };
  if (amount > missing) return { amount: 0n, error: t.errOver(formatAmount(missing, lang), mintSymbol(inv.mint)), blocked: false };
  return { amount, error: null, blocked: false };
}

type Props = {
  items: CartItem[];
  invOf: (item: CartItem) => Invoice;
  checks: Map<Address, ItemCheck>;
  me: Address | null;
  toPool: boolean;
  justAdded: Address | null;
  onAmount: (address: Address, text: string | null) => void;
  onRemove: (address: Address) => void;
  onToPool: (on: boolean) => void;
  onReview: () => void;
};

export function Cart(p: Props) {
  const t = useT(T);
  const checks = [...p.checks.values()];
  const hasErrors = checks.some((c) => c.error);
  const lines = p.items.flatMap((item) => {
    const c = p.checks.get(item.address);
    return c && c.amount > 0n ? [{ mint: p.invOf(item).mint, amount: c.amount }] : [];
  });
  const choiceId = useId();

  return (
    <aside id="give-cart" className="give-cart-wrap" aria-labelledby={`${choiceId}-title`}>
      <section className="paper sheet give-cart">
        <i className="clip" aria-hidden />
        <p className="label">{t.cartLabel}</p>
        <h2 id={`${choiceId}-title`} className="sheet-title">
          {t.cartTitle}
          {p.items.length > 0 && <span className="give-count"> ({p.items.length})</span>}
        </h2>
        {p.items.length === 0 ? (
          <p className="give-cart-empty">{t.cartEmpty}</p>
        ) : (
          <ul className="give-cart-items">
            {p.items.map((item) => (
              <CartRow
                key={item.address}
                item={item}
                inv={p.invOf(item)}
                check={p.checks.get(item.address)}
                fresh={p.justAdded === item.address}
                onAmount={(text) => p.onAmount(item.address, text)}
                onRemove={() => p.onRemove(item.address)}
              />
            ))}
          </ul>
        )}

        {p.items.length > 0 && (
          <>
            <Totals lines={lines} label={t.total} />
            <div className="give-choice">
              <label className="give-check">
                <input
                  type="checkbox"
                  checked={p.toPool}
                  onChange={(e) => p.onToPool(e.target.checked)}
                  aria-describedby={`${choiceId}-why`}
                />
                <span>{t.poolChoice}</span>
              </label>
              <p id={`${choiceId}-why`} className="give-fine">
                {p.toPool ? t.poolChoiceOn : t.poolChoiceOff}
              </p>
            </div>
            {!p.me ? (
              <ConnectPrompt>{t.connectToReview}</ConnectPrompt>
            ) : (
              <div className="actions">
                <button type="button" className="btn give-wide" disabled={hasErrors || lines.length === 0} onClick={p.onReview}>
                  {t.review} <span className="arr" aria-hidden>→</span>
                </button>
                {hasErrors && <p className="give-fine give-warn">{t.fixFirst}</p>}
              </div>
            )}
          </>
        )}
      </section>
    </aside>
  );
}

function CartRow({
  item,
  inv,
  check,
  fresh,
  onAmount,
  onRemove,
}: {
  item: CartItem;
  inv: Invoice;
  check: ItemCheck | undefined;
  fresh: boolean;
  onAmount: (text: string | null) => void;
  onRemove: () => void;
}) {
  const lang = useLang();
  const t = T[lang];
  const name = usePayeeName(inv.payee).data ?? t.university;
  const symbol = mintSymbol(inv.mint);
  const missing = remainingOf(inv);
  const id = useId();
  const error = check?.error ?? null;
  const skipped = !error && check?.amount === 0n;

  return (
    <li className={fresh ? "give-item give-in" : "give-item"}>
      <div className="give-item-head">
        <div>
          <p className="give-item-name">{name}</p>
          <p className="give-item-meta">{formatTerm(inv.term, lang)}</p>
        </div>
        <button type="button" className="give-x" onClick={onRemove} aria-label={t.removeItem(name)}>
          ×
        </button>
      </div>
      {check?.blocked ? (
        <p className="give-item-msg give-warn" role="alert">
          {error}
        </p>
      ) : (
        <>
          <label className="give-amount-field" htmlFor={`${id}-amt`}>
            <span className="label">{t.yourGift}</span>
            <span className="give-amount-input">
              <input
                id={`${id}-amt`}
                inputMode="decimal"
                autoComplete="off"
                value={item.amountText ?? toInput(missing, lang)}
                onChange={(e) => onAmount(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${id}-msg`}
              />
              <span className="give-unit" aria-hidden>
                {symbol}
              </span>
            </span>
          </label>
          <p id={`${id}-msg`} className={error ? "give-item-msg give-warn" : "give-item-msg"}>
            {error ?? (skipped ? t.zeroSkip : t.upTo(formatAmount(missing, lang), symbol))}
          </p>
          {item.amountText !== null && (
            <button type="button" className="give-link-btn" onClick={() => onAmount(null)}>
              {t.useFull}
            </button>
          )}
        </>
      )}
    </li>
  );
}
