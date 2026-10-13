"use client";

import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import type { Address } from "@solana/kit";
import useSWR from "swr";
import { ConnectPrompt } from "@/components/ui";
import { contributeIxs, newNonce } from "@/lib/actions";
import { explorerTx, mintSymbol } from "@/lib/constants";
import {
  Status,
  describeError,
  fetchInvoice,
  formatAmount,
  formatTerm,
  isFundingOpen,
  listContributions,
  listInvoices,
  remainingOf,
  shortAddress,
  type Invoice,
  type InvoiceRow,
} from "@/lib/escrow";
import { useApp, useNow, usePayeeName } from "@/lib/hooks";
import { useLang, useT } from "@/lib/i18n";
import { Cart, checkItem } from "./cart";
import { T } from "./copy";
import { RequestList } from "./request-list";
import { BalanceCheck, LineStatus, STEP_HEADING, Totals, nowSecs, totalsByMint, type CartItem, type Gift, type SendState, type Step } from "./shared";

type Props = {
  step: Step;
  setStep: (s: Step) => void;
  me: Address | null;
  cart: CartItem[];
  setCart: (update: (prev: CartItem[]) => CartItem[]) => void;
  toPool: boolean;
  setToPool: (on: boolean) => void;
  onGoPool: () => void;
};

type Results = Record<string, SendState>;
/** Per request: the paying wallet and the lowest nonce its first unconfirmed attempt could carry. */
type Attempts = Map<Address, { payer: Address; since: bigint }>;

export function FundFlow(p: Props) {
  const { rpc } = useApp();
  const lang = useLang();
  const t = T[lang];
  const now = useNow();
  const [justAdded, setJustAdded] = useState<Address | null>(null);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [results, setResults] = useState<Results>({});
  // Lives here, not in FundReview, so a gift re-sent after "Give again" is still checked for an earlier landing.
  const attempts = useRef<Attempts>(new Map());

  const open = useSWR("give-open", () => listInvoices(rpc, { status: Status.Open }), { refreshInterval: 8000 });
  const rows = open.data?.filter((r) => isFundingOpen(r.data, now) && remainingOf(r.data) > 0n);

  // Items stay in the list even after their request leaves the open list, so each is re-read on its own.
  const cartKey = p.cart.map((c) => c.address).join(",");
  const fresh = useSWR(cartKey ? ["give-cart", cartKey] : null, async () => {
    const addrs = cartKey.split(",") as Address[];
    const invs = await Promise.all(addrs.map((a) => fetchInvoice(rpc, a)));
    return new Map(addrs.flatMap((a, i) => (invs[i] ? [[a, invs[i]] as const] : [])));
  }, { refreshInterval: 8000 });
  const invOf = (item: CartItem): Invoice => fresh.data?.get(item.address) ?? item.inv;

  const checks = new Map(p.cart.map((item) => [item.address, checkItem(item, invOf(item), now, p.me, t, lang)]));
  const picked = new Set(p.cart.map((c) => c.address));

  function add(row: InvoiceRow) {
    p.setCart((prev) => (prev.some((c) => c.address === row.address) ? prev : [...prev, { address: row.address, inv: row.data, amountText: null }]));
    setJustAdded(row.address);
  }
  const remove = (address: Address) => p.setCart((prev) => prev.filter((c) => c.address !== address));

  function review() {
    setGifts(
      p.cart.flatMap((item) => {
        const amount = checks.get(item.address)?.amount ?? 0n;
        return amount > 0n ? [{ address: item.address, inv: invOf(item), amount, full: item.amountText === null }] : [];
      }),
    );
    setResults({});
    setJustAdded(null);
    p.setStep(2);
  }

  function restart() {
    // Keep the gifts that didn't go through, so the donor can change or remove them instead of finding them again.
    const failed = new Set(gifts.filter((g) => results[g.address]?.status !== "done").map((g) => g.address));
    p.setCart((prev) => prev.filter((c) => failed.has(c.address)));
    setGifts([]);
    setResults({});
    open.mutate();
    p.setStep(1);
  }

  if (p.step === 2)
    return (
      <FundReview
        gifts={gifts}
        setGifts={setGifts}
        results={results}
        setResults={setResults}
        attempts={attempts}
        me={p.me}
        toPool={p.toPool}
        onEdit={() => p.setStep(1)}
        onDone={() => p.setStep(3)}
      />
    );
  if (p.step === 3) return <FundDone gifts={gifts} results={results} onAgain={restart} />;

  return (
    <div className="give-fund">
      <RequestList
        rows={rows}
        failed={!!open.error}
        now={now}
        me={p.me}
        picked={picked}
        cartCount={p.cart.length}
        onToggle={(row) => (picked.has(row.address) ? remove(row.address) : add(row))}
        onAddAll={(rs) => rs.forEach(add)}
        // Also drops items that left the open list (closed or completed): they can only block the review.
        onRemoveAll={() =>
          p.setCart((prev) => prev.filter((c) => !rows?.some((r) => r.address === c.address) && !checks.get(c.address)?.blocked))
        }
        onAddLink={add}
        onGoPool={p.onGoPool}
      />
      <Cart
        items={p.cart}
        invOf={invOf}
        checks={checks}
        me={p.me}
        toPool={p.toPool}
        justAdded={justAdded}
        onAmount={(address, text) =>
          p.setCart((prev) => prev.map((c) => (c.address === address ? { ...c, amountText: text } : c)))
        }
        onRemove={remove}
        onToPool={p.setToPool}
        onReview={review}
      />
    </div>
  );
}

/** Thrown for problems we caught before asking the wallet, so nothing was sent. `final` when a
 *  retry would hit the same problem. */
class Caught extends Error {
  constructor(message: string, readonly final = true) {
    super(message);
  }
}

function FundReview({
  gifts,
  setGifts,
  results,
  setResults,
  attempts,
  me,
  toPool,
  onEdit,
  onDone,
}: {
  gifts: Gift[];
  setGifts: (update: (prev: Gift[]) => Gift[]) => void;
  results: Results;
  setResults: (update: (prev: Results) => Results) => void;
  attempts: RefObject<Attempts>;
  me: Address | null;
  toPool: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const client = useApp();
  const lang = useLang();
  const t = T[lang];
  const [running, setRunning] = useState(false);
  const started = Object.keys(results).length > 0;
  const doneCount = gifts.filter((g) => results[g.address]?.status === "done").length;
  const settled = started && !running && gifts.every((g) => ["done", "error"].includes(results[g.address]?.status ?? ""));
  const totals = useMemo(() => totalsByMint(gifts.map((g) => ({ mint: g.inv.mint, amount: g.amount }))), [gifts]);
  const set = (address: Address, s: SendState) => setResults((prev) => ({ ...prev, [address]: s }));
  const setAmount = (address: Address, amount: bigint) =>
    setGifts((prev) => prev.map((x) => (x.address === address ? { ...x, amount } : x)));

  // Each gift's hand-offs to the wallet: the paying wallet and the lowest nonce its first unconfirmed
  // attempt could carry (contributeIxs derives the nonce from the clock, so newNonce() just before is a
  // floor). An error can still follow a gift that landed (e.g. the confirmation dropped), and each
  // attempt makes a new contribution, so before calling a gift failed or re-sending it we look for any
  // contribution from that wallet since the first attempt. Cleared once the gift is confirmed.
  async function landedAmount(g: Gift): Promise<bigint | null> {
    const a = attempts.current.get(g.address);
    if (!a) return null;
    const rows = await listContributions(client.rpc, g.address);
    return rows.find((r) => r.data.contributor === a.payer && r.data.nonce >= a.since)?.data.amount ?? null;
  }
  function markLanded(g: Gift, amount: bigint) {
    attempts.current.delete(g.address);
    if (amount !== g.amount) setAmount(g.address, amount);
    set(g.address, { status: "done" });
  }

  async function sendOne(g: Gift, index: number): Promise<boolean> {
    set(g.address, { status: "signing" });
    try {
      const landed = await landedAmount(g);
      if (landed !== null) {
        markLanded(g, landed);
        return true;
      }
      // Re-read right before signing: someone may have given, or the deadline passed, since review.
      const inv = await fetchInvoice(client.rpc, g.address);
      if (!inv || !isFundingOpen(inv, nowSecs())) throw new Caught(t.errClosedNow);
      const left = remainingOf(inv);
      if (left === 0n) throw new Caught(t.errFundedNow);
      if (left < g.amount && !g.full) throw new Caught(t.errLessNow(formatAmount(left, lang), mintSymbol(inv.mint)));
      // The wallet can be switched, so this one may pass on a retry.
      if (client.payer.address === inv.payee || client.payer.address === inv.office) throw new Caught(t.own, false);
      const amount = left < g.amount ? left : g.amount;
      if (amount !== g.amount) setAmount(g.address, amount);
      // Keep the first attempt's floor: a late landing from any earlier attempt must still be found.
      const prev = attempts.current.get(g.address);
      attempts.current.set(g.address, { payer: client.payer.address, since: prev?.payer === client.payer.address ? prev.since : newNonce() });
      const ixs = await contributeIxs(client, g.address, inv, amount, toPool, index % 100);
      const result = await client.sendTransaction(ixs);
      attempts.current.delete(g.address);
      set(g.address, { status: "done", signature: result.context.signature });
      return true;
    } catch (e) {
      if (e instanceof Caught) {
        set(g.address, { status: "error", error: e.message, final: e.final });
        return false;
      }
      console.error(e);
      const landed = await landedAmount(g).catch(() => null);
      if (landed !== null) {
        markLanded(g, landed);
        return true;
      }
      set(g.address, { status: "error", error: describeError(e, lang) });
      return false;
    }
  }

  async function giveAll() {
    setRunning(true);
    setResults(() => Object.fromEntries(gifts.map((g) => [g.address, { status: "waiting" } as SendState])));
    let allOk = true;
    // One transaction per gift, in order; a failure never stops the rest.
    for (const [i, g] of gifts.entries()) allOk = (await sendOne(g, i)) && allOk;
    setRunning(false);
    if (allOk) onDone();
  }

  async function retry(g: Gift, i: number) {
    setRunning(true);
    const ok = await sendOne(g, i);
    setRunning(false);
    if (ok && gifts.every((x) => x.address === g.address || results[x.address]?.status === "done")) onDone();
  }

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
        {gifts.map((g, i) => (
          <GiftLine key={g.address} gift={g}>
            <LineStatus
              state={results[g.address]}
              canRetry={!running}
              onRetry={results[g.address]?.final ? undefined : () => retry(g, i)}
            />
          </GiftLine>
        ))}
      </ul>
      <Totals lines={gifts.map((g) => ({ mint: g.inv.mint, amount: g.amount }))} label={t.total} />

      <div className="give-doc-notes">
        <div>
          <p className="label">{t.failTitle}</p>
          <p className="give-doc-strong">{toPool ? t.failPool : t.failWallet}</p>
          <p className="give-fine">{t.failWhy}</p>
        </div>
        {me && !started && (
          <div>
            <p className="label">{t.walletTitle}</p>
            {totals.map(([mint]) => (
              <BalanceCheck
                key={mint}
                owner={me}
                mint={mint}
                gifts={gifts.filter((g) => g.inv.mint === mint).map((g) => g.amount)}
              />
            ))}
            <p className="give-fine">{t.deposit}</p>
          </div>
        )}
      </div>

      {started && (
        <p className="give-progress-text" role="status">
          {t.progress(doneCount, gifts.length)}
        </p>
      )}

      {!me && !settled ? (
        <ConnectPrompt>{t.connectToGive}</ConnectPrompt>
      ) : !started ? (
        <>
          <p className="give-fine give-prompts">{t.prompts(gifts.length)}</p>
          <div className="actions">
            <button type="button" className="btn paperbtn" onClick={onEdit}>
              <span className="arr" aria-hidden>←</span> {t.edit}
            </button>
            <button type="button" className="btn" onClick={giveAll}>
              {t.giveNow} <span className="arr" aria-hidden>→</span>
            </button>
          </div>
        </>
      ) : running ? (
        <div className="actions">
          <button type="button" className="btn" disabled>
            {t.giving}
          </button>
        </div>
      ) : settled ? (
        <div className="actions">
          <button type="button" className="btn" onClick={onDone}>
            {doneCount === gifts.length ? t.finish : t.finishSkip} <span className="arr" aria-hidden>→</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

function GiftLine({ gift, children }: { gift: Gift; children?: ReactNode }) {
  const lang = useLang();
  const t = T[lang];
  const name = usePayeeName(gift.inv.payee).data ?? t.university;
  return (
    <li className="give-line">
      <div className="give-line-main">
        <div>
          <p className="give-item-name">{name}</p>
          <p className="give-item-meta">
            {formatTerm(gift.inv.term, lang)} · {t.request} <span className="give-mono">{shortAddress(gift.address)}</span>
          </p>
        </div>
        <p className="give-line-amount">
          {formatAmount(gift.amount, lang)}
          <small>{mintSymbol(gift.inv.mint)}</small>
        </p>
      </div>
      {children}
    </li>
  );
}

function FundDone({ gifts, results, onAgain }: { gifts: Gift[]; results: Results; onAgain: () => void }) {
  const t = useT(T);
  const landed = gifts.filter((g) => results[g.address]?.status === "done");
  const failed = gifts.length - landed.length;
  return (
    <section className="paper sheet give-doc give-done" aria-labelledby={STEP_HEADING}>
      <i className="clip brass" aria-hidden />
      <p className="label">{t.doneLabel}</p>
      <h2 id={STEP_HEADING} tabIndex={-1} className="sheet-title give-done-title">
        {landed.length ? t.doneTitle(landed.length) : t.doneNone}
      </h2>
      {landed.length > 0 && (
        <>
          <p className="sheet-text">{t.doneText}</p>
          <Totals lines={landed.map((g) => ({ mint: g.inv.mint, amount: g.amount }))} label={t.totalGiven} />
          <ul className="give-lines">
            {landed.map((g) => {
              const sig = results[g.address]?.signature;
              return (
                <GiftLine key={g.address} gift={g}>
                  <p className="give-st give-st-ok">
                    <Link href={`/receipt/${g.address}`}>{t.followReceipt} →</Link>
                    {sig && (
                      <a href={explorerTx(sig)} target="_blank" rel="noreferrer">
                        {t.viewTx}
                      </a>
                    )}
                  </p>
                </GiftLine>
              );
            })}
          </ul>
        </>
      )}
      {failed > 0 && <p className="notice">{t.failedNote(failed)}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={onAgain}>
          {t.giveAgain}
        </button>
      </div>
    </section>
  );
}
