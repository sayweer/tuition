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

export default function ArbiterPage() {
  const me = useWalletAddress();
  const config = useConfig();
  const isArbiter = !!me && config.data?.arbiter === me;
  return (
    <main className="desk-page">
      <header className="page-head">
        <div>
          <p className="tag">Arbiter</p>
          <h1 className="page-title">
            Settle the <em>disputes.</em>
          </h1>
          <p className="page-lede">
            These requests are disputed: the payout partner reported sending lira, the university has not confirmed,
            and the deadline has passed. Check the bank evidence off-chain, then send the escrow to one side. Funds can
            only go to the partner or back to the family.
          </p>
        </div>
      </header>
      {!me ? (
        <ConnectPrompt>Connect the arbiter wallet.</ConnectPrompt>
      ) : !config.data ? (
        <p className="desk-muted">Loading…</p>
      ) : !isArbiter ? (
        <ConnectPrompt>This wallet ({shortAddress(me)}) is not the arbiter.</ConnectPrompt>
      ) : (
        <Disputes />
      )}
    </main>
  );
}

function Disputes() {
  const { rpc } = useApp();
  const rows = useSWR("disputes", () => listInvoices(rpc, { status: Status.Paid }), { refreshInterval: 5000 });
  if (rows.isLoading) return <p className="desk-muted">Loading disputes…</p>;
  if (!rows.data?.length) return <p className="desk-muted">No open disputes.</p>;
  return (
    <div className="slips grid">
      {rows.data.map((r) => (
        <DisputeRow key={r.address} row={r} onChange={() => rows.mutate()} />
      ))}
    </div>
  );
}

function DisputeRow({ row, onChange }: { row: InvoiceRow; onChange: () => void }) {
  const client = useApp();
  const now = useNow();
  const inv = row.data;
  const school = usePayeeName(inv.payee);
  const tx = useSendTx();
  const opensAt = Math.max(Number(inv.deadline), Number(inv.paidAt) + REVIEW_SECS);
  const ready = now >= opensAt;

  async function rule(toOffice: boolean) {
    const owner = toOffice ? inv.office : inv.payer;
    const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
    const sig = await tx.send(async () => [
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
    ]);
    if (sig) onChange();
  }

  return (
    <article className="paper sheet slip">
      <i className={ready ? "clip brass" : "clip"} aria-hidden />
      <div className="slip-top">
        <p className="label">Dispute · {formatTerm(inv.term)}</p>
        {ready ? (
          <span className="ink-chip ink-ok">Ready for a ruling</span>
        ) : (
          <span className="countdown">The university can still confirm for {opensAt - now}s</span>
        )}
      </div>
      <p className="slip-amount">{formatTry(inv.amountTryKurus)}</p>
      <p className="slip-meta">
        claimed paid to <b>{school.data ?? shortAddress(inv.payee)}</b>
      </p>
      <dl className="slip-facts">
        <div>
          <dt className="label">Escrow</dt>
          <dd>
            {formatAmount(inv.deposited)} {mintSymbol(inv.mint)}
          </dd>
        </div>
        <div>
          <dt className="label">Bank receipt hash</dt>
          <dd className="hash">{toHex(inv.bankReceiptHash).slice(0, 16)}…</dd>
        </div>
      </dl>
      <p className="slip-meta">
        <Link href={`/receipt/${row.address}`}>Full record</Link>
      </p>
      <div className="actions">
        <button className="btn" disabled={!ready || tx.status === "pending"} onClick={() => rule(true)}>
          Release to partner
        </button>
        <button className="btn danger" disabled={!ready || tx.status === "pending"} onClick={() => rule(false)}>
          Return to family
        </button>
      </div>
      {tx.status !== "idle" && <TxNotice tx={tx} doneText="Ruling recorded." />}
    </article>
  );
}
