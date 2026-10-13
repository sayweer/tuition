"use client";

import { useId, useState } from "react";
import type { Address } from "@solana/kit";
import { ConnectPrompt } from "@/components/ui";
import { donateIxs } from "@/lib/actions";
import { MINTS, explorerTx, mintSymbol } from "@/lib/constants";
import { formatAmount, parseAmount } from "@/lib/escrow";
import { useApp, usePool, useSendTx } from "@/lib/hooks";
import { useLang } from "@/lib/i18n";
import { T } from "./copy";
import { BalanceCheck, LineStatus, STEP_HEADING, type Step } from "./shared";

export function PoolFlow({ step, setStep, me }: { step: Step; setStep: (s: Step) => void; me: Address | null }) {
  const client = useApp();
  const lang = useLang();
  const t = T[lang];
  const [mint, setMint] = useState<Address>(MINTS[0].address);
  const [amountText, setAmountText] = useState("");
  const pool = usePool(mint);
  const tx = useSendTx();
  const id = useId();

  const symbol = mintSymbol(mint);
  const amount = parseAmount(amountText);
  const error = !amountText.trim() ? null : amount === null ? t.errFormat : amount === 0n ? t.poolErrZero : null;
  const poolMissing = pool.data === null;
  const canReview = !!amount && amount > 0n && !poolMissing && pool.data !== undefined;

  async function give() {
    const sig = await tx.send(() => donateIxs(client, mint, amount as bigint));
    if (sig) {
      pool.mutate();
      setStep(3);
    }
  }

  function again() {
    tx.reset();
    setAmountText("");
    setStep(1);
  }

  if (step === 3)
    return (
      <section className="paper sheet give-doc give-done" aria-labelledby={STEP_HEADING}>
        <i className="clip brass" aria-hidden />
        <p className="label">{t.doneLabel}</p>
        <h2 id={STEP_HEADING} tabIndex={-1} className="sheet-title give-done-title">
          {t.poolDoneTitle}
        </h2>
        <p className="sheet-text">{t.poolDoneText}</p>
        <p className="give-done-amount">
          {formatAmount(amount ?? 0n, lang)}
          <small>{symbol}</small>
        </p>
        {tx.signature && (
          <p className="give-st give-st-ok">
            <a href={explorerTx(tx.signature)} target="_blank" rel="noreferrer">
              {t.viewTx}
            </a>
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={again}>
            {t.giveAgain}
          </button>
        </div>
      </section>
    );

  if (step === 2)
    return (
      <section className="paper sheet give-doc" aria-labelledby={STEP_HEADING}>
        <i className="clip" aria-hidden />
        <header className="give-doc-head">
          <p className="label">{t.docLabel}</p>
          <h2 id={STEP_HEADING} tabIndex={-1} className="sheet-title">
            {t.docTitle}
          </h2>
        </header>
        <ul className="give-lines">
          <li className="give-line">
            <div className="give-line-main">
              <div>
                <p className="give-item-name">{t.poolLine}</p>
                <p className="give-item-meta">{MINTS.find((m) => m.address === mint)?.label[lang]}</p>
              </div>
              <p className="give-line-amount">
                {formatAmount(amount ?? 0n, lang)}
                <small>{symbol}</small>
              </p>
            </div>
            <LineStatus
              state={
                tx.status === "pending"
                  ? { status: "signing" }
                  : tx.status === "error"
                    ? { status: "error", error: tx.error }
                    : undefined
              }
            />
          </li>
        </ul>
        <div className="give-doc-notes">
          <div>
            <p className="label">{t.poolLabel}</p>
            <p className="give-doc-strong">{t.poolFinal}</p>
          </div>
          {me && (
            <div>
              <p className="label">{t.walletTitle}</p>
              <BalanceCheck owner={me} mint={mint} need={amount ?? 0n} />
              <p className="give-fine">{t.fee}</p>
            </div>
          )}
        </div>
        {!me ? (
          <ConnectPrompt>{t.connectToGive}</ConnectPrompt>
        ) : (
          <>
            <p className="give-fine give-prompts">{t.prompts(1)}</p>
            <div className="actions">
              <button type="button" className="btn paperbtn" onClick={() => setStep(1)} disabled={tx.status === "pending"}>
                <span className="arr" aria-hidden>←</span> {t.edit}
              </button>
              <button type="button" className="btn" onClick={give} disabled={tx.status === "pending"}>
                {tx.status === "pending" ? t.giving : tx.status === "error" ? t.retry : t.giveNow}
                {tx.status !== "pending" && (
                  <span className="arr" aria-hidden>
                    →
                  </span>
                )}
              </button>
            </div>
          </>
        )}
      </section>
    );

  const stats = pool.data
    ? [
        [t.poolDonated, pool.data.data.donated],
        [t.poolAllocated, pool.data.data.allocated],
        [t.poolReturned, pool.data.data.returned],
      ] as const
    : [];

  return (
    <section className="paper sheet tilt-l give-pool" aria-labelledby={STEP_HEADING}>
      <i className="clip" aria-hidden />
      <p className="label">{t.poolLabel}</p>
      <h2 id={STEP_HEADING} tabIndex={-1} className="sheet-title">
        {t.poolTitle}
      </h2>
      <p className="sheet-text">{t.poolText}</p>

      <div className="fields">
        <label className="field" htmlFor={`${id}-mint`}>
          <span className="label">{t.currency}</span>
          <select
            id={`${id}-mint`}
            value={mint}
            onChange={(e) => {
              setMint(e.target.value as Address);
              tx.reset();
            }}
          >
            {MINTS.map((m) => (
              <option key={m.address} value={m.address}>
                {m.label[lang]}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={`${id}-amt`}>
          <span className="label">{t.yourGift}</span>
          <span className="give-amount-input">
            <input
              id={`${id}-amt`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="100"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-msg`}
            />
            <span className="give-unit" aria-hidden>
              {symbol}
            </span>
          </span>
          <span id={`${id}-msg`} className={error ? "hint give-warn" : "hint"}>
            {error ?? t.poolAmountHint(symbol)}
          </span>
        </label>
      </div>

      <div className="give-pool-stats" aria-live="polite">
        {pool.data === undefined ? (
          <p className="give-fine">{t.poolLoading}</p>
        ) : pool.data === null ? (
          <p className="notice notice-error">{t.poolMissing}</p>
        ) : (
          <>
            <p className="give-pool-now">
              <span className="label">{t.poolNow}</span>
              <b>
                {formatAmount(pool.data.balance, lang)}
                <small>{symbol}</small>
              </b>
            </p>
            <dl className="give-pool-facts">
              {stats.map(([label, value]) => (
                <div key={label}>
                  <dt className="label">{label}</dt>
                  <dd>
                    {formatAmount(value, lang)} <small>{symbol}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>

      {!me ? (
        <ConnectPrompt>{t.connectToReview}</ConnectPrompt>
      ) : (
        <div className="actions">
          <button type="button" className="btn" disabled={!canReview} onClick={() => setStep(2)}>
            {t.reviewOne} <span className="arr" aria-hidden>→</span>
          </button>
        </div>
      )}
    </section>
  );
}
