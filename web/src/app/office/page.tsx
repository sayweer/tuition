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

export default function OfficePage() {
  const me = useWalletAddress();
  const config = useConfig();
  const listed = !!me && !!config.data?.offices.includes(me);

  return (
    <>
      <h1 className="page-title">Payout partner queue</h1>
      <p className="lede">
        Each row is tuition a family has already locked for you. Send the lira to the university&apos;s bank, attach
        the bank receipt, and report it. You are paid when the university confirms.
      </p>
      <p className="notice">
        Report the transfer before the deadline, as soon as you send it. After the deadline an unreported request can
        be refunded to the family.
      </p>
      <div style={{ marginTop: "2rem" }}>
        {!me ? (
          <ConnectPrompt>Connect the payout partner wallet.</ConnectPrompt>
        ) : config.isLoading ? (
          <p className="muted">Loading…</p>
        ) : !listed ? (
          <ConnectPrompt>
            This wallet ({shortAddress(me)}) is not an approved payout partner. You can still see requests already
            assigned to it below.
          </ConnectPrompt>
        ) : null}
        {me && <Queue me={me} />}
      </div>
    </>
  );
}

function Queue({ me }: { me: Address }) {
  const { rpc } = useApp();
  const rows = useSWR(["office-invoices", me], () => listInvoices(rpc, { office: me }), { refreshInterval: 5000 });
  if (rows.isLoading) return <p className="muted">Loading requests…</p>;
  const all = rows.data ?? [];
  const todo = all.filter((r) => r.data.status === Status.Funded);
  const rest = all.filter((r) => r.data.status !== Status.Funded);
  return (
    <>
      <h2 className="section-title">To pay</h2>
      {todo.length ? (
        <div className="rows">
          {todo.map((r) => (
            <PayRow key={r.address} row={r} onChange={() => rows.mutate()} />
          ))}
        </div>
      ) : (
        <p className="muted">Nothing waiting. New locked tuition appears here automatically.</p>
      )}
      {rest.length > 0 && (
        <>
          <h2 className="section-title">History</h2>
          <div className="rows">
            {rest.map((r) => (
              <HistoryRow key={r.address} row={r} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function PayRow({ row, onChange }: { row: InvoiceRow; onChange: () => void }) {
  const client = useApp();
  const inv = row.data;
  const school = usePayeeName(inv.payee);
  const expired = useIsExpired(inv);
  const tx = useSendTx();
  const [receipt, setReceipt] = useState<{ name: string; hash: Uint8Array } | null>(null);

  async function report() {
    if (!receipt) return;
    const sig = await tx.send(async () => [
      getMarkPaidInstruction({ office: client.payer, invoice: row.address, bankReceiptHash: receipt.hash }),
    ]);
    if (sig) onChange();
  }

  return (
    <div className="row">
      <div>
        <p className="row-title">
          Send {formatTry(inv.amountTryKurus)} to {school.data ?? shortAddress(inv.payee)}
        </p>
        <p className="row-meta">
          Transfer description: <span className="hash">TUITION {row.address.slice(0, 8)}</span>
          <br />
          {formatTerm(inv.term)}, escrow holds {formatAmount(inv.deposited)} {mintSymbol(inv.mint)}
        </p>
      </div>
      <div>
        <Countdown invoice={inv} />
        <label className="field" style={{ marginTop: "0.5rem" }}>
          <span className="field-hint">Bank receipt (PDF or image). Only its SHA-256 goes on-chain.</span>
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setReceipt(file ? { name: file.name, hash: await sha256(await file.arrayBuffer()) } : null);
            }}
          />
        </label>
        {receipt && <p className="row-meta hash">sha256 {toHex(receipt.hash).slice(0, 24)}…</p>}
      </div>
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" onClick={report} disabled={!receipt || expired || tx.status === "pending"}>
          {tx.status === "pending" ? "Reporting…" : "Report lira sent"}
        </button>
      </div>
      {tx.status !== "idle" && (
        <div style={{ gridColumn: "1 / -1" }}>
          <TxNotice tx={tx} doneText="Reported. Waiting for the university to confirm." />
        </div>
      )}
    </div>
  );
}

function HistoryRow({ row }: { row: InvoiceRow }) {
  const inv = row.data;
  const school = usePayeeName(inv.payee);
  return (
    <div className="row">
      <div>
        <p className="row-title">
          {formatTry(inv.amountTryKurus)} to {school.data ?? shortAddress(inv.payee)}
        </p>
        <p className="row-meta">
          {formatTerm(inv.term)}, request {shortAddress(row.address)}
        </p>
      </div>
      <div>
        <StatusBadge status={inv.status} /> {inv.status === Status.Paid && <Countdown invoice={inv} />}
      </div>
      <div className="actions" style={{ marginTop: 0 }}>
        <Link className="btn btn-quiet" href={`/receipt/${row.address}`}>
          Receipt
        </Link>
      </div>
    </div>
  );
}
