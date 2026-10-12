"use client";

import { useState } from "react";
import Link from "next/link";
import type { Address } from "@solana/kit";
import { QRCodeSVG } from "qrcode.react";
import useSWR from "swr";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token-2022";
import {
  findInvoicePda,
  getAcknowledgeInstructionAsync,
  getCreateInvoiceInstructionAsync,
} from "@/generated/tuition-escrow";
import { ConnectPrompt, Countdown, Field, StatusBadge, TxNotice } from "@/components/ui";
import { MINTS, PAYMENT_WINDOWS, mintSymbol } from "@/lib/constants";
import {
  Status,
  ataOf,
  formatAmount,
  formatTerm,
  formatTry,
  listInvoices,
  parseAmount,
  shortAddress,
  studentRefHash,
  tokenProgramOf,
  type InvoiceRow,
} from "@/lib/escrow";
import { useApp, usePayeeName, useSendTx, useWalletAddress } from "@/lib/hooks";

const TERMS = [20261, 20272, 20273];

export default function SchoolPage() {
  const me = useWalletAddress();
  const payee = usePayeeName(me);

  return (
    <>
      <h1 className="page-title">University desk</h1>
      <p className="lede">
        Issue a tuition request, send the link to the family, and confirm when the lira reaches your bank. Your
        confirmation is the receipt.
      </p>
      <div style={{ marginTop: "2rem" }}>
        {!me ? (
          <ConnectPrompt>Connect the university&apos;s finance wallet to continue.</ConnectPrompt>
        ) : payee.isLoading ? (
          <p className="muted">Checking registration…</p>
        ) : !payee.data ? (
          <ConnectPrompt>
            This wallet ({shortAddress(me)}) is not a registered university. The platform admin registers each
            finance office once; send them this address.
          </ConnectPrompt>
        ) : (
          <Desk me={me} name={payee.data} />
        )}
      </div>
    </>
  );
}

function Desk({ me, name }: { me: Address; name: string }) {
  const { rpc } = useApp();
  const requests = useSWR(["school-invoices", me], () => listInvoices(rpc, { payee: me }), {
    refreshInterval: 5000,
  });
  return (
    <>
      <p className="row-meta">Signed in as {name}</p>
      <CreateRequest me={me} onCreated={() => requests.mutate()} />
      <h2 className="section-title">Your requests</h2>
      {requests.isLoading ? (
        <p className="muted">Loading requests…</p>
      ) : requests.data?.length ? (
        <div className="rows">
          {requests.data.map((r) => (
            <RequestRow key={r.address} row={r} onChange={() => requests.mutate()} />
          ))}
        </div>
      ) : (
        <p className="muted">No requests yet. Issue the first one above.</p>
      )}
    </>
  );
}

function CreateRequest({ me, onCreated }: { me: Address; onCreated: () => void }) {
  const client = useApp();
  const tx = useSendTx();
  const [amount, setAmount] = useState("300");
  const [tryAmount, setTryAmount] = useState("12000");
  const [term, setTerm] = useState(TERMS[0]);
  const [studentRef, setStudentRef] = useState("");
  const [mint, setMint] = useState<Address>(MINTS[0].address);
  const [windowSecs, setWindowSecs] = useState(PAYMENT_WINDOWS[0].secs);
  const [created, setCreated] = useState<Address | null>(null);

  const amountBase = parseAmount(amount);
  const tryKurus = parseAmount(tryAmount, 2);
  const valid = !!amountBase && amountBase > 0n && tryKurus !== null && studentRef.trim().length > 0;

  async function submit() {
    const nonce = BigInt(Date.now());
    const [invoice] = await findInvoicePda({ payee: me, nonce });
    const sig = await tx.send(async () => [
      await getCreateInvoiceInstructionAsync({
        payee: client.payer,
        mint,
        tokenProgram: await tokenProgramOf(client.rpc, mint),
        nonce,
        amount: amountBase as bigint,
        amountTryKurus: tryKurus as bigint,
        term,
        studentRefHash: await studentRefHash(invoice, studentRef),
        windowSecs: BigInt(windowSecs),
      }),
    ]);
    if (sig) {
      setCreated(invoice);
      setStudentRef("");
      onCreated();
    }
  }

  return (
    <section className="panel" style={{ marginTop: "1.25rem" }}>
      <h2 className="row-title">New tuition request</h2>
      <div className="form-grid" style={{ marginTop: "1rem" }}>
        <Field label="Amount" hint={`In ${mintSymbol(mint)}. The family locks exactly this.`}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Lira quote" hint="Shown to the family; the payout partner pays this in TRY.">
          <input inputMode="decimal" value={tryAmount} onChange={(e) => setTryAmount(e.target.value)} />
        </Field>
        <Field label="Term">
          <select value={term} onChange={(e) => setTerm(Number(e.target.value))}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {formatTerm(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Student number" hint="Hashed in your browser. Only the hash goes on-chain.">
          <input value={studentRef} onChange={(e) => setStudentRef(e.target.value)} placeholder="e.g. 2026-10482" />
        </Field>
        <Field label="Currency">
          <select value={mint} onChange={(e) => setMint(e.target.value as Address)}>
            {MINTS.map((m) => (
              <option key={m.address} value={m.address}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payout window" hint="Starts when the family locks the money.">
          <select value={windowSecs} onChange={(e) => setWindowSecs(Number(e.target.value))}>
            {PAYMENT_WINDOWS.map((w) => (
              <option key={w.secs} value={w.secs}>
                {w.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="actions">
        <button className="btn btn-primary" disabled={!valid || tx.status === "pending"} onClick={submit}>
          {tx.status === "pending" ? "Issuing…" : "Issue request"}
        </button>
      </div>
      <TxNotice tx={tx} doneText="Request issued." />
      {created && <ShareLink invoice={created} />}
    </section>
  );
}

function ShareLink({ invoice }: { invoice: Address }) {
  const url = `${window.location.origin}/pay/${invoice}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="share">
      <div style={{ background: "#fff", padding: 8, border: "1px solid var(--rule)", borderRadius: 6 }}>
        <QRCodeSVG value={url} size={148} marginSize={0} />
      </div>
      <div style={{ minWidth: 0 }}>
        <p className="row-title">Send this to the family</p>
        <p className="hash">{url}</p>
        <div className="actions" style={{ marginTop: "0.75rem" }}>
          <button
            className="btn btn-quiet"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <Link className="btn btn-quiet" href={`/pay/${invoice}`}>
            Open payment page
          </Link>
        </div>
      </div>
    </div>
  );
}

function RequestRow({ row, onChange }: { row: InvoiceRow; onChange: () => void }) {
  const client = useApp();
  const tx = useSendTx();
  const inv = row.data;
  const canConfirm = inv.status === Status.Funded || inv.status === Status.Paid;

  async function confirm() {
    const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
    const sig = await tx.send(async () => [
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: client.payer,
        owner: inv.office,
        mint: inv.mint,
        tokenProgram,
      }),
      await getAcknowledgeInstructionAsync({
        payee: client.payer,
        invoice: row.address,
        officeToken: await ataOf(inv.office, inv.mint, tokenProgram),
        mint: inv.mint,
        tokenProgram,
      }),
    ]);
    if (sig) onChange();
  }

  return (
    <div className="row">
      <div>
        <p className="row-title">
          {formatTerm(inv.term)}, {formatAmount(inv.amount)} {mintSymbol(inv.mint)}
        </p>
        <p className="row-meta">
          {formatTry(inv.amountTryKurus)} quote, request {shortAddress(row.address)}
        </p>
      </div>
      <div>
        <StatusBadge status={inv.status} />{" "}
        {(inv.status === Status.Funded || inv.status === Status.Paid) && <Countdown invoice={inv} />}
        {inv.status === Status.Funded && (
          <p className="row-meta">The partner has not reported the lira yet. Confirm only if it reached your bank.</p>
        )}
      </div>
      <div className="actions" style={{ marginTop: 0 }}>
        {canConfirm && (
          <button className="btn btn-primary" onClick={confirm} disabled={tx.status === "pending"}>
            {tx.status === "pending" ? "Confirming…" : "Confirm lira received"}
          </button>
        )}
        <Link className="btn btn-quiet" href={inv.status === Status.Open ? `/pay/${row.address}` : `/receipt/${row.address}`}>
          {inv.status === Status.Open ? "Payment page" : "Receipt"}
        </Link>
      </div>
      {tx.status !== "idle" && (
        <div style={{ gridColumn: "1 / -1" }}>
          <TxNotice tx={tx} doneText="Confirmed. Escrow released to the payout partner." />
        </div>
      )}
    </div>
  );
}
