"use client";

import { useState } from "react";
import Link from "next/link";
import type { Address } from "@solana/kit";
import useSWR from "swr";
import { getMarkPaidInstruction } from "@/generated/tuition-escrow";
import { ConnectPrompt, Countdown, StatusBadge, TxNotice, useIsExpired } from "@/components/ui";
import { mintSymbol } from "@/lib/constants";
import {
  Status,
  formatAmount,
  formatTerm,
  formatTry,
  listInvoices,
  sha256,
  shortAddress,
  toHex,
  type InvoiceRow,
} from "@/lib/escrow";
import { useApp, useConfig, usePayeeName, useSendTx, useWalletAddress } from "@/lib/hooks";
import { useLang, useT, type Dict } from "@/lib/i18n";

type Copy = Record<
  | "tag"
  | "title"
  | "titleEm"
  | "lede"
  | "beforeDeadline"
  | "rule"
  | "connect"
  | "loading"
  | "loadingRequests"
  | "reported"
  | "toPay"
  | "nothing"
  | "history"
  | "sendLira"
  | "to"
  | "transferRef"
  | "bankReceipt"
  | "fileHint"
  | "reporting"
  | "report"
  | "request"
  | "receipt",
  string
> & {
  notApproved: (addr: string) => string;
  escrowHolds: (amount: string, symbol: string) => string;
};

const T: Dict<Copy> = {
  en: {
    tag: "Payout partner",
    title: "Send the lira, ",
    titleEm: "report it.",
    lede: "Each slip is tuition a family has already locked for you. Send the lira to the university's bank, attach the bank receipt, and report it. You are paid when the university confirms.",
    beforeDeadline: "Before the deadline",
    rule: "Report the transfer before the deadline, as soon as you send it. After the deadline an unreported request can be refunded to the family.",
    connect: "Connect the payout partner wallet.",
    loading: "Loading…",
    notApproved: (addr) =>
      `This wallet (${addr}) is not an approved payout partner. You can still see requests already assigned to it below.`,
    loadingRequests: "Loading requests…",
    reported: "Reported. Waiting for the university to confirm.",
    toPay: "To pay",
    nothing: "Nothing waiting. New locked tuition appears here automatically.",
    history: "History",
    sendLira: "send lira",
    to: "to",
    escrowHolds: (amount, symbol) => `Escrow holds ${amount} ${symbol}.`,
    transferRef: "Transfer description",
    bankReceipt: "Bank receipt",
    fileHint: "PDF or image. Only its SHA-256 goes on-chain.",
    reporting: "Reporting…",
    report: "Report lira sent",
    request: "request",
    receipt: "Receipt",
  },
  tr: {
    tag: "Ödeme ortağı",
    title: "Lirayı gönderin, ",
    titleEm: "bildirin.",
    lede: "Her fiş, bir ailenin sizin için kilitlediği bir harçtır. Lirayı üniversitenin bankasına gönderin, banka dekontunu ekleyin ve bildirin. Üniversite onayladığında ödemenizi alırsınız.",
    beforeDeadline: "Son tarihten önce",
    rule: "Havaleyi gönderir göndermez, son tarihten önce bildirin. Son tarihten sonra, bildirilmemiş bir talep aileye iade edilebilir.",
    connect: "Ödeme ortağı cüzdanını bağlayın.",
    loading: "Yükleniyor…",
    notApproved: (addr) =>
      `Bu cüzdan (${addr}) onaylı bir ödeme ortağı değil. Yine de bu cüzdana atanmış talepleri aşağıda görebilirsiniz.`,
    loadingRequests: "Talepler yükleniyor…",
    reported: "Bildirildi. Üniversitenin onayı bekleniyor.",
    toPay: "Ödenecekler",
    nothing: "Bekleyen bir şey yok. Yeni kilitlenen harçlar burada kendiliğinden görünür.",
    history: "Geçmiş",
    sendLira: "lira gönderilecek",
    to: "Alıcı:",
    escrowHolds: (amount, symbol) => `Emanet hesabında ${amount} ${symbol} var.`,
    transferRef: "Havale açıklaması",
    bankReceipt: "Banka dekontu",
    fileHint: "PDF ya da görsel. Zincire yalnızca SHA-256 özeti yazılır.",
    reporting: "Bildiriliyor…",
    report: "Liranın gönderildiğini bildir",
    request: "talep",
    receipt: "Makbuz",
  },
};

export default function OfficePage() {
  const me = useWalletAddress();
  const config = useConfig();
  const listed = !!me && !!config.data?.offices.includes(me);
  const t = useT(T);

  return (
    <main className="desk-page">
      <header className="page-head split">
        <div>
          <p className="tag">{t.tag}</p>
          <h1 className="page-title">
            {t.title}
            <em>{t.titleEm}</em>
          </h1>
          <p className="page-lede">{t.lede}</p>
        </div>
        <aside className="house-rule">
          <i className="clip" aria-hidden />
          <p className="label">{t.beforeDeadline}</p>
          <p>{t.rule}</p>
        </aside>
      </header>
      {!me ? (
        <ConnectPrompt>{t.connect}</ConnectPrompt>
      ) : config.isLoading ? (
        <p className="desk-muted">{t.loading}</p>
      ) : !listed ? (
        <ConnectPrompt>{t.notApproved(shortAddress(me))}</ConnectPrompt>
      ) : null}
      {me && <Queue me={me} />}
    </main>
  );
}

function Queue({ me }: { me: Address }) {
  const { rpc } = useApp();
  const rows = useSWR(["office-invoices", me], () => listInvoices(rpc, { office: me }), { refreshInterval: 5000 });
  // Owned by the queue: a reported slip leaves "To pay", and its notice must outlive it.
  const tx = useSendTx();
  const t = useT(T);
  if (rows.isLoading) return <p className="desk-muted">{t.loadingRequests}</p>;
  const all = rows.data ?? [];
  const todo = all.filter((r) => r.data.status === Status.Funded);
  const rest = all.filter((r) => r.data.status !== Status.Funded);
  return (
    <>
    {tx.status !== "idle" && <TxNotice tx={tx} doneText={t.reported} />}
    <div className={rest.length > 0 ? "queue two" : "queue"}>
      <section className="col">
        <h2 className="tag">{t.toPay}</h2>
        {todo.length ? (
          <div className="slips">
            {todo.map((r) => (
              <PayRow key={r.address} row={r} tx={tx} onChange={() => rows.mutate()} />
            ))}
          </div>
        ) : (
          <p className="desk-muted">{t.nothing}</p>
        )}
      </section>
      {rest.length > 0 && (
        <section className="col">
          <h2 className="tag">{t.history}</h2>
          <div className="slips">
            {rest.map((r) => (
              <HistoryRow key={r.address} row={r} />
            ))}
          </div>
        </section>
      )}
    </div>
    </>
  );
}

function PayRow({ row, tx, onChange }: { row: InvoiceRow; tx: ReturnType<typeof useSendTx>; onChange: () => void }) {
  const client = useApp();
  const inv = row.data;
  const school = usePayeeName(inv.payee);
  const expired = useIsExpired(inv);
  const lang = useLang();
  const t = T[lang];
  const [receipt, setReceipt] = useState<{ name: string; hash: Uint8Array } | null>(null);

  async function report() {
    if (!receipt) return;
    const sig = await tx.send(async () => [
      getMarkPaidInstruction({ office: client.payer, invoice: row.address, bankReceiptHash: receipt.hash }),
    ]);
    if (sig) onChange();
  }

  return (
    <article className="paper sheet slip">
      <i className="clip brass" aria-hidden />
      <div className="slip-top">
        <p className="label">
          {formatTerm(inv.term, lang)} · {t.sendLira}
        </p>
        <Countdown invoice={inv} />
      </div>
      <p className="slip-amount">{formatTry(inv.amountTryKurus, lang)}</p>
      <p className="slip-meta">
        {t.to} <b>{school.data ?? shortAddress(inv.payee)}</b>.{" "}
        {t.escrowHolds(formatAmount(inv.raised, lang), mintSymbol(inv.mint))}
      </p>
      <p className="slip-ref">
        <span className="label">{t.transferRef}</span>
        <span className="transfer-ref">TUITION {row.address.slice(0, 8)}</span>
      </p>
      <label className="field slip-file">
        <span className="label">{t.bankReceipt}</span>
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setReceipt(file ? { name: file.name, hash: await sha256(await file.arrayBuffer()) } : null);
          }}
        />
        <span className="hint">{t.fileHint}</span>
      </label>
      {receipt && <p className="slip-meta hash">sha256 {toHex(receipt.hash).slice(0, 24)}…</p>}
      <div className="actions">
        <button className="btn" onClick={report} disabled={!receipt || expired || tx.status === "pending"}>
          {tx.status === "pending" ? t.reporting : t.report}
        </button>
      </div>
    </article>
  );
}

function HistoryRow({ row }: { row: InvoiceRow }) {
  const inv = row.data;
  const school = usePayeeName(inv.payee);
  const lang = useLang();
  const t = T[lang];
  return (
    <article className="paper sheet slip compact">
      <i className="clip" aria-hidden />
      <p className="label">
        {formatTerm(inv.term, lang)} · {t.request} {shortAddress(row.address)}
      </p>
      <p className="slip-amount">{formatTry(inv.amountTryKurus, lang)}</p>
      <p className="slip-meta">
        {t.to} <b>{school.data ?? shortAddress(inv.payee)}</b>
      </p>
      <div className="status-line">
        <StatusBadge status={inv.status} /> {inv.status === Status.Paid && <Countdown invoice={inv} />}
      </div>
      <div className="actions">
        <Link className="btn ghost" href={`/receipt/${row.address}`}>
          {t.receipt} <span className="arr" aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}
