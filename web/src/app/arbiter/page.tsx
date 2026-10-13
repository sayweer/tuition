"use client";

import { useState } from "react";
import Link from "next/link";
import type { Address } from "@solana/kit";
import useSWR from "swr";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token-2022";
import { getResolveInstructionAsync } from "@/generated/tuition-escrow";
import { FundingBar } from "@/components/funding";
import { ConnectPrompt, Field, TxNotice } from "@/components/ui";
import { allocateIxs } from "@/lib/actions";
import { MINTS, REVIEW_SECS, mintSymbol } from "@/lib/constants";
import {
  Status,
  ataOf,
  formatAmount,
  formatTerm,
  formatTry,
  isFundingOpen,
  listInvoices,
  parseAmount,
  remainingOf,
  shortAddress,
  toHex,
  tokenProgramOf,
  type InvoiceRow,
} from "@/lib/escrow";
import { useApp, useConfig, useFee, useNow, usePayeeName, usePool, useSendTx, useWalletAddress } from "@/lib/hooks";
import { useLang, useT, type Dict } from "@/lib/i18n";

type Copy = Record<
  | "tag"
  | "title"
  | "titleEm"
  | "lede"
  | "connect"
  | "loading"
  | "rpcDown"
  | "noConfig"
  | "loadingDisputes"
  | "ruled"
  | "noDisputes"
  | "dispute"
  | "ready"
  | "claimedTo"
  | "escrow"
  | "receiptHash"
  | "fullRecord"
  | "release"
  | "returnFamily"
  | "sendBack"
  | "poolTag"
  | "poolLede"
  | "notSetUp"
  | "inPool"
  | "donated"
  | "directed"
  | "returnedToPool"
  | "waitingTag"
  | "noWaiting"
  | "loadingWaiting"
  | "cover"
  | "covering"
  | "covered"
  | "amount"
  | "disputesTag"
  | "d"
  | "h"
  | "m",
  string
> & {
  coverHint: (max: string, symbol: string) => string;
  notArbiter: (addr: string) => string;
  rulingOpensIn: (left: string) => string;
};

const T: Dict<Copy> = {
  en: {
    tag: "Arbiter · scholarship committee",
    title: "Fill the gaps, ",
    titleEm: "settle disputes.",
    lede: "Two jobs. Direct the scholarship pool to students who are short. Settle disputes: the payout partner reported sending lira, the university has not confirmed, and the deadline has passed. Check the bank evidence off-chain, then pick a side. Funds can only go to the partner or back to the people who gave them.",
    connect: "Connect the arbiter wallet.",
    loading: "Loading…",
    rpcDown: "Could not reach devnet. Retrying…",
    noConfig: "The escrow is not initialised on this cluster yet. The admin runs `pnpm admin init` once.",
    notArbiter: (addr) => `This wallet (${addr}) is not the arbiter.`,
    loadingDisputes: "Loading disputes…",
    ruled: "Ruling recorded.",
    noDisputes: "No open disputes.",
    dispute: "Dispute",
    ready: "Ready for a ruling",
    rulingOpensIn: (left) => `Ruling opens in ${left}`,
    claimedTo: "claimed paid to",
    escrow: "Escrow",
    receiptHash: "Bank receipt hash",
    fullRecord: "Full record",
    release: "Release to partner",
    returnFamily: "Rule against the partner",
    sendBack:
      "No money moved yet: it is still in escrow. Send each contribution back to its giver or the scholarship pool on the record →",
    poolTag: "Scholarship pool",
    poolLede:
      "Donors give to the pool without picking a student, and gifts from failed requests can land here too. Direct it to requests that would otherwise fall short.",
    notSetUp: "The pool for this currency is not set up yet. The admin runs `pnpm admin pool` once.",
    inPool: "In the pool",
    donated: "Donated",
    directed: "Directed to students",
    returnedToPool: "Came back from failed requests",
    waitingTag: "Requests still collecting",
    noWaiting: "No request is collecting right now.",
    loadingWaiting: "Loading requests…",
    cover: "Cover from the pool",
    covering: "Sending…",
    covered: "Sent from the pool to the request.",
    amount: "Amount",
    coverHint: (max, symbol) => `Up to ${max} ${symbol}.`,
    disputesTag: "Disputes",
    d: "d",
    h: "h",
    m: "m",
  },
  tr: {
    tag: "Hakem · burs komitesi",
    title: "Eksikleri kapatın, ",
    titleEm: "itirazları çözün.",
    lede: "İki görev. Burs havuzunu eksiği olan öğrencilere yönlendirin. İtirazları karara bağlayın: ödeme ortağı lirayı gönderdiğini bildirdi, üniversite onaylamadı ve son tarih geçti. Banka kanıtlarını zincir dışında inceleyin, ardından bir tarafı seçin. Para yalnızca ödeme ortağına aktarılabilir ya da katkı sahiplerine geri dönebilir.",
    connect: "Hakem cüzdanını bağlayın.",
    loading: "Yükleniyor…",
    rpcDown: "Devnet'e ulaşılamadı. Yeniden deneniyor…",
    noConfig: "Emanet bu ağda henüz başlatılmadı. Yönetici bir kez `pnpm admin init` çalıştırır.",
    notArbiter: (addr) => `Bu cüzdan (${addr}) hakem cüzdanı değil.`,
    loadingDisputes: "İtirazlar yükleniyor…",
    ruled: "Karar kaydedildi.",
    noDisputes: "Açık itiraz yok.",
    dispute: "İtiraz",
    ready: "Karara hazır",
    rulingOpensIn: (left) => `Karar ${left} sonra verilebilir`,
    claimedTo: "Ödendiği bildirilen alıcı:",
    escrow: "Emanet",
    receiptHash: "Banka dekontu hash'i",
    fullRecord: "Tüm kayıt",
    release: "Ödeme ortağına aktar",
    returnFamily: "Ödeme ortağı aleyhine karar ver",
    sendBack:
      "Henüz para hareket etmedi; emanet hesabında duruyor. Her katkıyı kayıt sayfasından sahibine ya da burs havuzuna geri gönderin →",
    poolTag: "Burs havuzu",
    poolLede:
      "Bağışçılar öğrenci seçmeden havuza bağış yapar; gerçekleşmeyen taleplerden gelen bağışlar da buraya düşebilir. Havuzu, aksi hâlde eksik kalacak taleplere yönlendirin.",
    notSetUp: "Bu para birimi için havuz henüz kurulmadı. Yönetici bir kez `pnpm admin pool` çalıştırır.",
    inPool: "Havuzda",
    donated: "Bağışlanan",
    directed: "Öğrencilere yönlendirilen",
    returnedToPool: "Gerçekleşmeyen taleplerden dönen",
    waitingTag: "Hâlâ toplanan talepler",
    noWaiting: "Şu an toplanan bir talep yok.",
    loadingWaiting: "Talepler yükleniyor…",
    cover: "Havuzdan karşıla",
    covering: "Gönderiliyor…",
    covered: "Havuzdan talebe gönderildi.",
    amount: "Tutar",
    coverHint: (max, symbol) => `En fazla ${max} ${symbol}.`,
    disputesTag: "İtirazlar",
    d: "g",
    h: "sa",
    m: "dk",
  },
};

/** d/h/m like Countdown; this card counts to opensAt, not to invoice.deadline. */
function formatLeft(left: number, t: Copy): string {
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return d > 0 ? `${d}${t.d} ${h}${t.h}` : h > 0 ? `${h}${t.h} ${m}${t.m}` : `${m}:${String(s).padStart(2, "0")}`;
}

export default function ArbiterPage() {
  const me = useWalletAddress();
  const config = useConfig();
  const isArbiter = !!me && config.data?.arbiter === me;
  const t = useT(T);
  return (
    <main className="desk-page">
      <header className="page-head">
        <div>
          <p className="tag">{t.tag}</p>
          <h1 className="page-title">
            {t.title}
            <em>{t.titleEm}</em>
          </h1>
          <p className="page-lede">{t.lede}</p>
        </div>
      </header>
      {!me ? (
        <ConnectPrompt>{t.connect}</ConnectPrompt>
      ) : config.data === null ? (
        <p className="desk-muted">{t.noConfig}</p>
      ) : !config.data ? (
        <p className="desk-muted">{config.error ? t.rpcDown : t.loading}</p>
      ) : !isArbiter ? (
        <ConnectPrompt>{t.notArbiter(shortAddress(me))}</ConnectPrompt>
      ) : (
        <>
          <ScholarshipPool />
          <h2 className="tag">{t.disputesTag}</h2>
          <Disputes />
        </>
      )}
    </main>
  );
}

function Disputes() {
  const { rpc } = useApp();
  const rows = useSWR("disputes", () => listInvoices(rpc, { status: Status.Paid }), { refreshInterval: 5000 });
  // Owned by the list: a ruled dispute disappears, and its notice must outlive it.
  const tx = useSendTx();
  // A ruling against the partner moves no money; point at the record where contributions are settled.
  const [ruled, setRuled] = useState<{ id: Address; toOffice: boolean } | null>(null);
  const t = useT(T);
  if (rows.isLoading) return <p className="desk-muted">{t.loadingDisputes}</p>;
  const notice = tx.status !== "idle" && (
    <>
      <TxNotice tx={tx} doneText={t.ruled} />
      {tx.status === "done" && ruled && !ruled.toOffice && (
        <p className="notice">
          <Link href={`/receipt/${ruled.id}`}>{t.sendBack}</Link>
        </p>
      )}
    </>
  );
  if (!rows.data?.length)
    return (
      <>
        {notice}
        <p className="desk-muted">{t.noDisputes}</p>
      </>
    );
  return (
    <>
      {notice}
      <div className="slips grid">
        {rows.data.map((r) => (
          <DisputeRow
            key={r.address}
            row={r}
            tx={tx}
            onRuled={(toOffice) => {
              setRuled({ id: r.address, toOffice });
              rows.mutate();
            }}
          />
        ))}
      </div>
    </>
  );
}

function DisputeRow({
  row,
  tx,
  onRuled,
}: {
  row: InvoiceRow;
  tx: ReturnType<typeof useSendTx>;
  onRuled: (toOffice: boolean) => void;
}) {
  const client = useApp();
  const now = useNow();
  const inv = row.data;
  const school = usePayeeName(inv.payee);
  const lang = useLang();
  const t = T[lang];
  const opensAt = Math.max(Number(inv.deadline), Number(inv.paidAt) + REVIEW_SECS);
  const ready = now >= opensAt;

  async function rule(toOffice: boolean) {
    const sig = await tx.send(async () => {
      const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
      return [
        await getCreateAssociatedTokenIdempotentInstructionAsync({
          payer: client.payer,
          owner: inv.office,
          mint: inv.mint,
          tokenProgram,
        }),
        await getResolveInstructionAsync({
          arbiter: client.payer,
          invoice: row.address,
          officeToken: await ataOf(inv.office, inv.mint, tokenProgram),
          mint: inv.mint,
          tokenProgram,
          toOffice,
        }),
      ];
    });
    if (sig) onRuled(toOffice);
  }

  return (
    <article className="paper sheet slip">
      <i className={ready ? "clip brass" : "clip"} aria-hidden />
      <div className="slip-top">
        <p className="label">
          {t.dispute} · {formatTerm(inv.term, lang)}
        </p>
        {ready ? (
          <span className="ink-chip ink-ok">{t.ready}</span>
        ) : (
          <span className="countdown">{t.rulingOpensIn(formatLeft(opensAt - now, t))}</span>
        )}
      </div>
      <p className="slip-amount">{formatTry(inv.amountTryKurus, lang)}</p>
      <p className="slip-meta">
        {t.claimedTo} <b>{school.data ?? shortAddress(inv.payee)}</b>
      </p>
      <dl className="slip-facts">
        <div>
          <dt className="label">{t.escrow}</dt>
          <dd>
            {formatAmount(inv.raised, lang)} {mintSymbol(inv.mint)}
          </dd>
        </div>
        <div>
          <dt className="label">{t.receiptHash}</dt>
          <dd className="hash">{toHex(inv.bankReceiptHash).slice(0, 16)}…</dd>
        </div>
      </dl>
      <p className="slip-meta">
        <Link href={`/receipt/${row.address}`}>{t.fullRecord}</Link>
      </p>
      <div className="actions">
        <button className="btn" disabled={!ready || tx.status === "pending"} onClick={() => rule(true)}>
          {t.release}
        </button>
        <button className="btn danger" disabled={!ready || tx.status === "pending"} onClick={() => rule(false)}>
          {t.returnFamily}
        </button>
      </div>
    </article>
  );
}

function ScholarshipPool() {
  const { rpc } = useApp();
  const now = useNow();
  const t = useT(T);
  const open = useSWR("collecting", () => listInvoices(rpc, { status: Status.Open }), { refreshInterval: 5000 });
  // Owned by the pool desk: a cover that completes a request drops its row, and the notice must outlive it.
  const tx = useSendTx();
  const waiting = (open.data ?? []).filter((r) => isFundingOpen(r.data, now));
  return (
    <section className="pool-desk">
      <h2 className="tag">{t.poolTag}</h2>
      <p className="page-lede">{t.poolLede}</p>
      <div className="slips grid">
        {MINTS.map((m) => (
          <PoolCard key={m.address} mint={m.address} />
        ))}
      </div>
      <h3 className="tag">{t.waitingTag}</h3>
      {tx.status !== "idle" && <TxNotice tx={tx} doneText={t.covered} />}
      {open.isLoading ? (
        <p className="desk-muted">{t.loadingWaiting}</p>
      ) : waiting.length === 0 ? (
        <p className="desk-muted">{t.noWaiting}</p>
      ) : (
        <div className="slips grid">
          {waiting.map((r) => (
            <CoverRow key={r.address} row={r} tx={tx} onChange={() => open.mutate()} />
          ))}
        </div>
      )}
    </section>
  );
}

function PoolCard({ mint }: { mint: Address }) {
  const pool = usePool(mint);
  const lang = useLang();
  const t = T[lang];
  const symbol = mintSymbol(mint);
  return (
    <article className="paper sheet slip compact">
      <i className="clip" aria-hidden />
      <p className="label">
        {t.inPool} · {symbol}
      </p>
      {pool.data === null ? (
        <p className="slip-note">{t.notSetUp}</p>
      ) : (
        <>
          <p className="slip-amount">
            {pool.data ? formatAmount(pool.data.balance, lang) : "…"}
            <small>{symbol}</small>
          </p>
          {pool.data && (
            <dl className="slip-facts">
              <div>
                <dt className="label">{t.donated}</dt>
                <dd>{formatAmount(pool.data.data.donated, lang)}</dd>
              </div>
              <div>
                <dt className="label">{t.directed}</dt>
                <dd>{formatAmount(pool.data.data.allocated, lang)}</dd>
              </div>
              <div>
                <dt className="label">{t.returnedToPool}</dt>
                <dd>{formatAmount(pool.data.data.returned, lang)}</dd>
              </div>
            </dl>
          )}
        </>
      )}
    </article>
  );
}

function CoverRow({ row, tx, onChange }: { row: InvoiceRow; tx: ReturnType<typeof useSendTx>; onChange: () => void }) {
  const client = useApp();
  const inv = row.data;
  const school = usePayeeName(inv.payee);
  const pool = usePool(inv.mint);
  const lang = useLang();
  const t = T[lang];
  const symbol = mintSymbol(inv.mint);
  const fee = useFee(inv.mint);
  const balance = pool.data?.balance ?? 0n;
  const missing = remainingOf(inv);
  // sending the whole pool delivers less than the balance when the mint charges a transfer fee
  const deliverable = fee.net(balance);
  const max = missing < deliverable ? missing : deliverable;
  const [text, setText] = useState("");
  const amount = text.trim() ? parseAmount(text, lang) : max;
  const valid = amount !== null && amount > 0n && amount <= max;

  async function cover() {
    const sig = await tx.send(() => allocateIxs(client, row.address, inv, amount as bigint));
    if (sig) {
      setText("");
      onChange();
      pool.mutate();
    }
  }

  return (
    <article className="paper sheet slip">
      <i className="clip" aria-hidden />
      <p className="label">
        {formatTerm(inv.term, lang)} · {school.data ?? shortAddress(inv.payee)}
      </p>
      <FundingBar inv={inv} />
      {pool.data && max > 0n && (
        <>
          <div className="fields stacked">
            <Field label={`${t.amount} (${symbol})`} hint={t.coverHint(formatAmount(max, lang), symbol)}>
              <input
                inputMode="decimal"
                value={text}
                placeholder={formatAmount(max, lang)}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
          </div>
          <div className="actions">
            <button className="btn" disabled={!valid || tx.status === "pending"} onClick={cover}>
              {tx.status === "pending" ? t.covering : t.cover}
            </button>
          </div>
        </>
      )}
      <p className="slip-meta">
        <Link href={`/receipt/${row.address}`}>{t.fullRecord}</Link>
      </p>
    </article>
  );
}
