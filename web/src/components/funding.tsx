"use client";

import { useState } from "react";
import type { Address } from "@solana/kit";
import { ConnectPrompt, TxNotice } from "@/components/ui";
import { explorerTx, mintSymbol } from "@/lib/constants";
import { expireIxs, refundIxs, settleIxs } from "@/lib/actions";
import {
  Status,
  describeError,
  formatAmount,
  isExpired,
  isSettleable,
  remainingOf,
  shortAddress,
  type ContributionRow,
  type Invoice,
} from "@/lib/escrow";
import { useApp, useContributions, useNow, usePool, useSendTx, useWalletAddress } from "@/lib/hooks";
import { useLang, useT, type Dict } from "@/lib/i18n";

type Copy = {
  raisedOf: (raised: string, amount: string, symbol: string) => string;
  missing: (amount: string, symbol: string) => string;
  complete: string;
  closesIn: string;
  closed: string;
  d: string;
  h: string;
  m: string;
  givers: string;
  noGivers: string;
  you: string;
  pool: string;
  someone: string;
  ifFails: string;
  backToGiver: string;
  toPool: string;
  returned: string;
  waiting: string;
  sentToPool: string;
  waitingPool: string;
  sendBack: string;
  sendToPool: string;
  settleAll: string;
  sending: string;
  connectSettle: string;
  settleText: string;
  closeTitle: string;
  closeText: string;
  closeBtn: string;
  refundTitle: string;
  refundText: string;
  refundBtn: string;
  closing: string;
  closedOk: string;
  connectClose: string;
};

const T: Dict<Copy> = {
  en: {
    raisedOf: (r, a, s) => `${r} of ${a} ${s} raised`,
    missing: (a, s) => `${a} ${s} still missing`,
    complete: "Fully funded",
    closesIn: "Collecting closes in",
    closed: "Collecting has closed",
    d: "d",
    h: "h",
    m: "m",
    givers: "Contributions",
    noGivers: "No contributions yet.",
    you: "You",
    pool: "Scholarship pool",
    someone: "Supporter",
    ifFails: "If it fails",
    backToGiver: "back to the giver",
    toPool: "to the scholarship pool",
    returned: "Sent back",
    waiting: "Waiting to be sent back",
    sentToPool: "Sent to the pool",
    waitingPool: "Waiting to go to the pool",
    sendBack: "Send back",
    sendToPool: "Send to the pool",
    settleAll: "Send each to its place",
    sending: "Sending…",
    connectSettle: "Connect any wallet to send each contribution where it belongs.",
    settleText:
      "This request did not go through. Each contribution goes back where its giver chose: their own wallet, or the scholarship pool. Anyone can press the button; the money can only go to that place.",
    closeTitle: "Collecting closed before the full amount was raised",
    closeText:
      "Close the request so each contribution can go back to its giver or the pool. Anyone can do this; it moves no money by itself.",
    closeBtn: "Close the request",
    refundTitle: "The payout partner did not report in time",
    refundText:
      "The deadline passed without the lira being sent. Cancel the request so each contribution can go back to its giver or the pool. Anyone can do this.",
    refundBtn: "Cancel the request",
    closing: "Closing…",
    closedOk: "Request closed. Now send each contribution where it belongs below.",
    connectClose: "Connect any wallet to close the request.",
  },
  tr: {
    raisedOf: (r, a, s) => `${r} / ${a} ${s} toplandı`,
    missing: (a, s) => `Eksik kalan ${a} ${s}`,
    complete: "Tamamı toplandı",
    closesIn: "Kalan toplama süresi:",
    closed: "Toplama süresi doldu",
    d: "g",
    h: "sa",
    m: "dk",
    givers: "Katkılar",
    noGivers: "Henüz katkı yok.",
    you: "Siz",
    pool: "Burs havuzu",
    someone: "Destekçi",
    ifFails: "Olmazsa",
    backToGiver: "sahibine geri",
    toPool: "burs havuzuna",
    returned: "Geri gönderildi",
    waiting: "Geri gönderilmeyi bekliyor",
    sentToPool: "Havuza gönderildi",
    waitingPool: "Havuza gönderilmeyi bekliyor",
    sendBack: "Geri gönder",
    sendToPool: "Havuza gönder",
    settleAll: "Hepsini yerine gönder",
    sending: "Gönderiliyor…",
    connectSettle: "Her katkıyı gideceği yere göndermek için herhangi bir cüzdanı bağlayın.",
    settleText:
      "Bu talep gerçekleşmedi. Her katkı, sahibinin seçtiği yere döner: kendi cüzdanına ya da burs havuzuna. Düğmeye herkes basabilir; para yalnızca o yere gidebilir.",
    closeTitle: "Toplama süresi, tutarın tamamı toplanmadan doldu",
    closeText:
      "Her katkının sahibine ya da burs havuzuna dönebilmesi için talebi kapatın. Bunu herkes yapabilir; tek başına para hareket ettirmez.",
    closeBtn: "Talebi kapat",
    refundTitle: "Ödeme ortağı süresinde bildirim yapmadı",
    refundText:
      "Lira gönderilmeden süre doldu. Her katkının sahibine ya da burs havuzuna dönebilmesi için talebi iptal edin. Bunu herkes yapabilir.",
    refundBtn: "Talebi iptal et",
    closing: "Kapatılıyor…",
    closedOk: "Talep kapatıldı. Şimdi aşağıdan her katkıyı gideceği yere gönderin.",
    connectClose: "Talebi kapatmak için herhangi bir cüzdanı bağlayın.",
  },
};

function useLeft(until: bigint): number {
  return Number(until) - useNow();
}

function formatLeft(left: number, t: Copy): string {
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return d > 0 ? `${d}${t.d} ${h}${t.h}` : h > 0 ? `${h}${t.h} ${m}${t.m}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Raised against the target, what is missing, and how long collecting stays open. */
export function FundingBar({ inv }: { inv: Invoice }) {
  const lang = useLang();
  const t = T[lang];
  const left = useLeft(inv.fundingDeadline);
  const symbol = mintSymbol(inv.mint);
  const pct = inv.amount > 0n ? Number((inv.raised * 1000n) / inv.amount) / 10 : 0;
  const missing = remainingOf(inv);
  return (
    <div className="funding">
      <div
        className="funding-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={t.raisedOf(formatAmount(inv.raised, lang), formatAmount(inv.amount, lang), symbol)}
      >
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="funding-text">
        <b>{t.raisedOf(formatAmount(inv.raised, lang), formatAmount(inv.amount, lang), symbol)}</b>
        <span>{missing > 0n ? t.missing(formatAmount(missing, lang), symbol) : t.complete}</span>
      </p>
      {inv.status === Status.Open && (
        <p className="funding-time">
          {left > 0 ? (
            <>
              {t.closesIn} <b className="countdown">{formatLeft(left, t)}</b>
            </>
          ) : (
            <b className="countdown expired">{t.closed}</b>
          )}
        </p>
      )}
    </div>
  );
}

/** A request that missed a deadline still says Open/Funded on-chain until someone closes it. */
export function CloseFailed({ id, inv, onDone }: { id: Address; inv: Invoice; onDone: () => void }) {
  const client = useApp();
  const me = useWalletAddress();
  const now = useNow();
  const tx = useSendTx();
  const t = useT(T);
  const fundingMissed = inv.status === Status.Open && BigInt(now) >= inv.fundingDeadline;
  const payoutMissed = inv.status === Status.Funded && isExpired(inv, now);
  if (tx.status === "done") return <TxNotice tx={tx} doneText={t.closedOk} />;
  if (!fundingMissed && !payoutMissed) return null;

  async function close() {
    const sig = await tx.send(async () => (fundingMissed ? expireIxs(client, id) : refundIxs(client, id)));
    if (sig) onDone();
  }

  return (
    <section className="paper sheet tilt-r">
      <i className="clip" aria-hidden />
      <h2 className="sheet-title">{fundingMissed ? t.closeTitle : t.refundTitle}</h2>
      <p className="sheet-text">{fundingMissed ? t.closeText : t.refundText}</p>
      <TxNotice tx={tx} doneText={t.closedOk} />
      {me ? (
        <div className="actions">
          <button className="btn danger" onClick={close} disabled={tx.status === "pending"}>
            {tx.status === "pending" ? t.closing : fundingMissed ? t.closeBtn : t.refundBtn}
          </button>
        </div>
      ) : (
        <ConnectPrompt>{t.connectClose}</ConnectPrompt>
      )}
    </section>
  );
}

type RowState = { status: "pending" | "done" | "error"; signature?: string; error?: string };

/** Who put money in, where each part goes if the request fails, and (after a failure) the
 *  buttons that send each part there. */
export function Contributions({ id, inv, actions = true }: { id: Address; inv: Invoice; actions?: boolean }) {
  const client = useApp();
  const me = useWalletAddress();
  const lang = useLang();
  const t = T[lang];
  const list = useContributions(id, `${inv.raised}-${inv.status}`);
  const pool = usePool(inv.mint);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const symbol = mintSymbol(inv.mint);
  const settleable = isSettleable(inv);
  const items = list.data ?? [];
  const open = items.filter((c) => !c.data.settled && rows[c.address]?.status !== "done");
  const busy = Object.values(rows).some((r) => r.status === "pending");

  async function settle(c: ContributionRow) {
    setRows((r) => ({ ...r, [c.address]: { status: "pending" } }));
    try {
      const result = await client.sendTransaction(await settleIxs(client, id, inv, c));
      setRows((r) => ({ ...r, [c.address]: { status: "done", signature: result.context.signature } }));
    } catch (e) {
      console.error(e);
      setRows((r) => ({ ...r, [c.address]: { status: "error", error: describeError(e, lang) } }));
      // someone else may have settled it meanwhile; the fresh row then shows it as sent
      list.mutate();
    }
  }

  async function settleAll() {
    const fresh = (await list.mutate()) ?? items;
    for (const c of fresh.filter((x) => !x.data.settled && rows[x.address]?.status !== "done")) await settle(c);
    list.mutate();
  }

  const who = (c: ContributionRow) =>
    c.data.contributor === pool.data?.address ? t.pool : c.data.contributor === me ? t.you : t.someone;

  return (
    <section className="paper sheet">
      <i className="clip" aria-hidden />
      <h2 className="sheet-title">{t.givers}</h2>
      {settleable && actions && <p className="sheet-text">{t.settleText}</p>}
      {items.length === 0 ? (
        <p className="muted">{list.isLoading ? "…" : t.noGivers}</p>
      ) : (
        <ul className="givers">
          {items.map((c) => {
            const row = rows[c.address];
            const settled = c.data.settled || row?.status === "done";
            const toPool = c.data.toPoolOnFail;
            return (
              <li key={c.address}>
                <div className="giver-main">
                  <span className="giver-who">
                    {who(c)} <span className="hash">{shortAddress(c.data.contributor)}</span>
                  </span>
                  <span className="giver-amount">
                    {formatAmount(c.data.amount, lang)} <small>{symbol}</small>
                  </span>
                </div>
                <p className="giver-meta">
                  {t.ifFails}: {toPool ? t.toPool : t.backToGiver}
                  {settleable && <> · {settled ? (toPool ? t.sentToPool : t.returned) : toPool ? t.waitingPool : t.waiting}</>}
                  {row?.signature && (
                    <>
                      {" "}
                      <a href={explorerTx(row.signature)} target="_blank" rel="noreferrer">
                        {lang === "tr" ? "İşlem" : "Transaction"}
                      </a>
                    </>
                  )}
                </p>
                {row?.status === "error" && (
                  <p className="notice notice-error" role="alert">
                    {row.error}
                  </p>
                )}
                {settleable && actions && !settled && me && (
                  <button className="btn paperbtn small" onClick={() => settle(c)} disabled={busy}>
                    {row?.status === "pending" ? t.sending : toPool ? t.sendToPool : t.sendBack}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {settleable && actions && open.length > 0 &&
        (me ? (
          open.length > 1 && (
            <div className="actions">
              <button className="btn" onClick={settleAll} disabled={busy}>
                {busy ? t.sending : t.settleAll}
              </button>
            </div>
          )
        ) : (
          <ConnectPrompt>{t.connectSettle}</ConnectPrompt>
        ))}
    </section>
  );
}
