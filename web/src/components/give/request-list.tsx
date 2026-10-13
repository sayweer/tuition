"use client";

import { useId, useState, type FormEvent, type MouseEvent } from "react";
import { isAddress, type Address } from "@solana/kit";
import { mintSymbol } from "@/lib/constants";
import {
  Status,
  fetchInvoice,
  fetchPayeeName,
  formatAmount,
  formatTerm,
  isFundingOpen,
  remainingOf,
  shortAddress,
  type Invoice,
  type InvoiceRow,
} from "@/lib/escrow";
import { useApp, usePayeeName } from "@/lib/hooks";
import { useLang, useT } from "@/lib/i18n";
import { T } from "./copy";
import { FundingClock, Progress, STEP_HEADING, nowSecs } from "./shared";

type Props = {
  rows: InvoiceRow[] | undefined;
  failed: boolean;
  now: number;
  me: Address | null;
  picked: Set<Address>;
  cartCount: number;
  onToggle: (row: InvoiceRow) => void;
  onAddAll: (rows: InvoiceRow[]) => void;
  onRemoveAll: () => void;
  onAddLink: (row: InvoiceRow) => void;
  onGoPool: () => void;
};

export function RequestList(p: Props) {
  const t = useT(T);
  const rows = p.rows ?? [];
  // The connected wallet can't give to a request it receives or pays out, so those rows aren't offered.
  const isMine = (r: InvoiceRow) => !!p.me && (p.me === r.data.payee || p.me === r.data.office);
  const addable = rows.filter((r) => !isMine(r));
  const allPicked = addable.length > 0 && addable.every((r) => p.picked.has(r.address));
  return (
    <section className="give-list" aria-labelledby={STEP_HEADING}>
      <div className="give-list-head">
        <h2 id={STEP_HEADING} tabIndex={-1} className="give-h2">
          {t.openRequests}
        </h2>
        {addable.length > 1 && (
          <div className="desk-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={allPicked ? p.onRemoveAll : () => p.onAddAll(addable.filter((r) => !p.picked.has(r.address)))}
            >
              {allPicked ? t.removeAll : t.selectAll(addable.length)}
            </button>
          </div>
        )}
      </div>
      <LinkAdder me={p.me} picked={p.picked} onAdd={p.onAddLink} />
      {p.rows === undefined ? (
        <p className="desk-muted" role="status">
          {p.failed ? t.loadError : t.loading}
        </p>
      ) : rows.length === 0 ? (
        <div className="paper sheet tilt-r give-empty">
          <i className="clip" aria-hidden />
          <p className="label">{t.poolLabel}</p>
          <h3 className="sheet-title">{t.emptyTitle}</h3>
          <p className="sheet-text">{t.emptyText}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={p.onGoPool}>
              {t.toPool} <span className="arr" aria-hidden>→</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="slips give-cards">
          {rows.map((r) => (
            <RequestCard
              key={r.address}
              row={r}
              now={p.now}
              picked={p.picked.has(r.address)}
              mine={isMine(r)}
              onToggle={() => p.onToggle(r)}
            />
          ))}
        </div>
      )}
      {p.cartCount > 0 && (
        <a className="give-jump" href="#give-cart">
          {t.jump(p.cartCount)} <span aria-hidden>↓</span>
        </a>
      )}
    </section>
  );
}

function RequestCard({
  row,
  now,
  picked,
  mine,
  onToggle,
}: {
  row: InvoiceRow;
  now: number;
  picked: boolean;
  mine: boolean;
  onToggle: () => void;
}) {
  const lang = useLang();
  const t = T[lang];
  const inv = row.data;
  const name = usePayeeName(inv.payee).data ?? t.university;
  const symbol = mintSymbol(inv.mint);
  const raisedText = t.raisedOf(formatAmount(inv.raised, lang), formatAmount(inv.amount, lang), symbol);

  // The whole card toggles, except its own controls (they handle themselves).
  function onCardClick(e: MouseEvent<HTMLElement>) {
    if (mine || (e.target as HTMLElement).closest("button, a, input")) return;
    onToggle();
  }

  return (
    <article className={`paper sheet slip give-card${picked ? " is-picked" : ""}${mine ? " is-own" : ""}`} onClick={onCardClick}>
      <i className={picked ? "clip brass" : "clip"} aria-hidden />
      <div className="slip-top">
        <p className="label">
          {formatTerm(inv.term, lang)} · {t.request} {shortAddress(row.address)}
        </p>
        {picked && <span className="ink-chip ink-ok">✓ {t.inList}</span>}
      </div>
      <h3 className="give-uni">{name}</h3>
      <Progress raised={inv.raised} amount={inv.amount} label={raisedText} />
      <p className="give-raised">{raisedText}</p>
      <div className="give-card-facts">
        <p>
          <span className="label">{t.missing}</span>
          <b className="give-missing">
            {formatAmount(remainingOf(inv), lang)}
            <small>{symbol}</small>
          </b>
        </p>
        <FundingClock deadline={inv.fundingDeadline} now={now} />
      </div>
      <div className="actions">
        {mine && !picked ? (
          <span className="ink-chip">{t.ownChip}</span>
        ) : (
          <button type="button" className={picked ? "btn paperbtn" : "btn"} onClick={onToggle}>
            {picked ? t.remove : t.add}
          </button>
        )}
      </div>
    </article>
  );
}

/** "…/pay/<invoice>#k=…", "/pay/<invoice>", or the bare address. */
function addressFromLink(text: string): Address | null {
  const s = text.trim();
  const candidate = /\/pay\/([^/?#\s]+)/.exec(s)?.[1] ?? s;
  return isAddress(candidate) ? candidate : null;
}

type Msg = { tone: "busy" | "ok" | "err"; text: string } | null;

function LinkAdder({ me, picked, onAdd }: { me: Address | null; picked: Set<Address>; onAdd: (row: InvoiceRow) => void }) {
  const { rpc } = useApp();
  const lang = useLang();
  const t = T[lang];
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const hintId = useId();
  const msgId = useId();

  function problemOf(inv: Invoice): string | null {
    if (inv.status === Status.Funded || inv.status === Status.Paid || inv.status === Status.Released) return t.linkFunded;
    if (inv.status !== Status.Open) return t.linkClosed;
    if (!isFundingOpen(inv, nowSecs())) return t.linkExpired;
    if (remainingOf(inv) === 0n) return t.linkFunded;
    if (me && (me === inv.payee || me === inv.office)) return t.own;
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const address = addressFromLink(text);
    if (!address) return setMsg({ tone: "err", text: t.linkBad });
    if (picked.has(address)) return setMsg({ tone: "err", text: t.linkDup });
    setMsg({ tone: "busy", text: t.linkChecking });
    try {
      const inv = await fetchInvoice(rpc, address);
      if (!inv) return setMsg({ tone: "err", text: t.linkNotFound });
      const problem = problemOf(inv);
      if (problem) return setMsg({ tone: "err", text: problem });
      const name = (await fetchPayeeName(rpc, inv.payee).catch(() => null)) ?? t.university;
      onAdd({ address, data: inv });
      setText("");
      setMsg({ tone: "ok", text: t.linkAdded(name) });
    } catch (err) {
      console.error(err);
      setMsg({ tone: "err", text: t.linkError });
    }
  }

  return (
    <form className="paper give-link" onSubmit={submit}>
      <label className="label" htmlFor={`${hintId}-input`}>
        {t.linkLabel}
      </label>
      <div className="give-link-row">
        <input
          id={`${hintId}-input`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (msg?.tone !== "busy") setMsg(null);
          }}
          placeholder={t.linkPlaceholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={msg?.tone === "err" || undefined}
          aria-describedby={`${msgId} ${hintId}`}
        />
        <button type="submit" className="btn paperbtn" disabled={!text.trim() || msg?.tone === "busy"}>
          {t.linkAdd}
        </button>
      </div>
      <p id={msgId} className={msg ? `give-link-msg ${msg.tone}` : "give-link-msg"} role="status">
        {msg?.text}
      </p>
      <p id={hintId} className="give-fine">
        {t.linkHint}
      </p>
    </form>
  );
}
