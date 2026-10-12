"use client";

import Link from "next/link";
import useSWR from "swr";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token-2022";
import { getResolveInstructionAsync } from "@/generated/tuition-escrow";
import { ConnectPrompt, TxNotice } from "@/components/ui";
import { REVIEW_SECS, mintSymbol } from "@/lib/constants";
import {
  Status,
  ataOf,
  formatAmount,
  formatTerm,
  formatTry,
  listInvoices,
  shortAddress,
  toHex,
  tokenProgramOf,
  type InvoiceRow,
} from "@/lib/escrow";
import { useApp, useConfig, useNow, usePayeeName, useSendTx, useWalletAddress } from "@/lib/hooks";
import { useLang, useT, type Dict } from "@/lib/i18n";

type Copy = Record<
  | "tag"
  | "title"
  | "titleEm"
  | "lede"
  | "connect"
  | "loading"
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
  | "returnFamily",
  string
> & {
  notArbiter: (addr: string) => string;
  canStillConfirm: (secs: number) => string;
};

const T: Dict<Copy> = {
  en: {
    tag: "Arbiter",
    title: "Settle the ",
    titleEm: "disputes.",
    lede: "These requests are disputed: the payout partner reported sending lira, the university has not confirmed, and the deadline has passed. Check the bank evidence off-chain, then send the escrow to one side. Funds can only go to the partner or back to the family.",
    connect: "Connect the arbiter wallet.",
    loading: "Loading…",
    notArbiter: (addr) => `This wallet (${addr}) is not the arbiter.`,
    loadingDisputes: "Loading disputes…",
    ruled: "Ruling recorded.",
    noDisputes: "No open disputes.",
    dispute: "Dispute",
    ready: "Ready for a ruling",
    canStillConfirm: (secs) => `The university can still confirm for ${secs}s`,
    claimedTo: "claimed paid to",
    escrow: "Escrow",
    receiptHash: "Bank receipt hash",
    fullRecord: "Full record",
    release: "Release to partner",
    returnFamily: "Return to family",
  },
  tr: {
    tag: "Hakem",
    title: "İtirazları ",
    titleEm: "karara bağlayın.",
    lede: "Bu taleplere itiraz var: ödeme ortağı lirayı gönderdiğini bildirdi, üniversite onaylamadı ve son tarih geçti. Banka kanıtlarını zincir dışında inceleyin, ardından emaneti taraflardan birine gönderin. Para yalnızca ödeme ortağına aktarılabilir ya da aileye geri dönebilir.",
    connect: "Hakem cüzdanını bağlayın.",
    loading: "Yükleniyor…",
    notArbiter: (addr) => `Bu cüzdan (${addr}) hakem cüzdanı değil.`,
    loadingDisputes: "İtirazlar yükleniyor…",
    ruled: "Karar kaydedildi.",
    noDisputes: "Açık itiraz yok.",
    dispute: "İtiraz",
    ready: "Karara hazır",
    canStillConfirm: (secs) => `Üniversite ${secs} sn daha onaylayabilir`,
    claimedTo: "Ödendiği bildirilen alıcı:",
    escrow: "Emanet",
    receiptHash: "Banka dekontu hash'i",
    fullRecord: "Tüm kayıt",
    release: "Ödeme ortağına aktar",
    returnFamily: "Aileye iade et",
  },
};

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
      ) : !config.data ? (
        <p className="desk-muted">{t.loading}</p>
      ) : !isArbiter ? (
        <ConnectPrompt>{t.notArbiter(shortAddress(me))}</ConnectPrompt>
      ) : (
        <Disputes />
      )}
    </main>
  );
}

function Disputes() {
  const { rpc } = useApp();
  const rows = useSWR("disputes", () => listInvoices(rpc, { status: Status.Paid }), { refreshInterval: 5000 });
  // Owned by the list: a ruled dispute disappears, and its notice must outlive it.
  const tx = useSendTx();
  const t = useT(T);
  if (rows.isLoading) return <p className="desk-muted">{t.loadingDisputes}</p>;
  const notice = tx.status !== "idle" && <TxNotice tx={tx} doneText={t.ruled} />;
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
          <DisputeRow key={r.address} row={r} tx={tx} onChange={() => rows.mutate()} />
        ))}
      </div>
    </>
  );
}

function DisputeRow({ row, tx, onChange }: { row: InvoiceRow; tx: ReturnType<typeof useSendTx>; onChange: () => void }) {
  const client = useApp();
  const now = useNow();
  const inv = row.data;
  const school = usePayeeName(inv.payee);
  const lang = useLang();
  const t = T[lang];
  const opensAt = Math.max(Number(inv.deadline), Number(inv.paidAt) + REVIEW_SECS);
  const ready = now >= opensAt;

  async function rule(toOffice: boolean) {
    const owner = toOffice ? inv.office : inv.payer;
    const sig = await tx.send(async () => {
      const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
      return [
        await getCreateAssociatedTokenIdempotentInstructionAsync({
          payer: client.payer,
          owner,
          mint: inv.mint,
          tokenProgram,
        }),
        await getResolveInstructionAsync({
          arbiter: client.payer,
          invoice: row.address,
          destination: await ataOf(owner, inv.mint, tokenProgram),
          mint: inv.mint,
          tokenProgram,
          toOffice,
        }),
      ];
    });
    if (sig) onChange();
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
          <span className="countdown">{t.canStillConfirm(opensAt - now)}</span>
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
            {formatAmount(inv.deposited, lang)} {mintSymbol(inv.mint)}
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
