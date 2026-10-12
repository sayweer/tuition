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
    <main className="desk-page">
      <header className="page-head split">
        <div>
          <p className="tag">Payout partner</p>
          <h1 className="page-title">
            Send the lira, <em>report it.</em>
          </h1>
          <p className="page-lede">
            Each slip is tuition a family has already locked for you. Send the lira to the university&apos;s bank,
            attach the bank receipt, and report it. You are paid when the university confirms.
          </p>
        </div>
        <aside className="house-rule">
          <i className="clip" aria-hidden />
          <p className="label">Before the deadline</p>
          <p>
            Report the transfer before the deadline, as soon as you send it. After the deadline an unreported request
            can be refunded to the family.
          </p>
        </aside>
      </header>
      {!me ? (
        <ConnectPrompt>Connect the payout partner wallet.</ConnectPrompt>
      ) : config.isLoading ? (
        <p className="desk-muted">Loading…</p>
      ) : !listed ? (
        <ConnectPrompt>
          This wallet ({shortAddress(me)}) is not an approved payout partner. You can still see requests already
          assigned to it below.
        </ConnectPrompt>
      ) : null}
      {me && <Queue me={me} />}
    </main>
  );
}

function Queue({ me }: { me: Address }) {
  const { rpc } = useApp();
  const rows = useSWR(["office-invoices", me], () => listInvoices(rpc, { office: me }), { refreshInterval: 5000 });
  if (rows.isLoading) return <p className="desk-muted">Loading requests…</p>;
  const all = rows.data ?? [];
  const todo = all.filter((r) => r.data.status === Status.Funded);
  const rest = all.filter((r) => r.data.status !== Status.Funded);
  return (
    <div className={rest.length > 0 ? "queue two" : "queue"}>
      <section className="col">
        <h2 className="tag">To pay</h2>
        {todo.length ? (
          <div className="slips">
            {todo.map((r) => (
              <PayRow key={r.address} row={r} onChange={() => rows.mutate()} />
            ))}
          </div>
        ) : (
          <p className="desk-muted">Nothing waiting. New locked tuition appears here automatically.</p>
        )}
      </section>
      {rest.length > 0 && (
        <section className="col">
          <h2 className="tag">History</h2>
          <div className="slips">
            {rest.map((r) => (
              <HistoryRow key={r.address} row={r} />
            ))}
          </div>
        </section>
      )}
    </div>
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
    <article className="paper sheet slip">
      <i className="clip brass" aria-hidden />
      <div className="slip-top">
        <p className="label">{formatTerm(inv.term)} · send lira</p>
        <Countdown invoice={inv} />
      </div>
      <p className="slip-amount">{formatTry(inv.amountTryKurus)}</p>
      <p className="slip-meta">
        to <b>{school.data ?? shortAddress(inv.payee)}</b>. Escrow holds {formatAmount(inv.deposited)}{" "}
        {mintSymbol(inv.mint)}.
      </p>
      <p className="slip-ref">
        <span className="label">Transfer description</span>
        <span className="transfer-ref">TUITION {row.address.slice(0, 8)}</span>
      </p>
      <label className="field slip-file">
        <span className="label">Bank receipt</span>
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setReceipt(file ? { name: file.name, hash: await sha256(await file.arrayBuffer()) } : null);
          }}
        />
        <span className="hint">PDF or image. Only its SHA-256 goes on-chain.</span>
      </label>
      {receipt && <p className="slip-meta hash">sha256 {toHex(receipt.hash).slice(0, 24)}…</p>}
      <div className="actions">
        <button className="btn" onClick={report} disabled={!receipt || expired || tx.status === "pending"}>
          {tx.status === "pending" ? "Reporting…" : "Report lira sent"}
        </button>
      </div>
      {tx.status !== "idle" && <TxNotice tx={tx} doneText="Reported. Waiting for the university to confirm." />}
    </article>
  );
}

function HistoryRow({ row }: { row: InvoiceRow }) {
  const inv = row.data;
  const school = usePayeeName(inv.payee);
  return (
    <article className="paper sheet slip compact">
      <i className="clip" aria-hidden />
      <p className="label">
        {formatTerm(inv.term)} · request {shortAddress(row.address)}
      </p>
      <p className="slip-amount">{formatTry(inv.amountTryKurus)}</p>
      <p className="slip-meta">
        to <b>{school.data ?? shortAddress(inv.payee)}</b>
      </p>
      <div className="status-line">
        <StatusBadge status={inv.status} /> {inv.status === Status.Paid && <Countdown invoice={inv} />}
      </div>
      <div className="actions">
        <Link className="btn ghost" href={`/receipt/${row.address}`}>
          Receipt <span className="arr" aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}
