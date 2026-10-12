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
  newSalt,
  studentRefHash,
  toHex,
  tokenProgramOf,
  type InvoiceRow,
} from "@/lib/escrow";
import { useApp, usePayeeName, useSendTx, useWalletAddress } from "@/lib/hooks";

// The student-number salt lives only in the family's link and in this browser, never on-chain.
const saltKey = (invoice: Address) => `tuition-salt:${invoice}`;
function payLink(invoice: Address): string {
  let salt: string | null = null;
  try {
    salt = localStorage.getItem(saltKey(invoice));
  } catch {
    // storage blocked: the link still works, only the student check needs the key
  }
  return `/pay/${invoice}${salt ? `#k=${salt}` : ""}`;
}

const TERMS = [20261, 20272, 20273];

export default function SchoolPage() {
  const me = useWalletAddress();
  const payee = usePayeeName(me);

  return (
    <main className="desk-page">
      <header className="page-head">
        <div>
          <p className="tag">University desk</p>
          <h1 className="page-title">
            Issue the request, <em>sign the receipt.</em>
          </h1>
          <p className="page-lede">
            Issue a tuition request, send the link to the family, and confirm when the lira reaches your bank. Your
            confirmation is the receipt.
          </p>
        </div>
      </header>
      {!me ? (
        <ConnectPrompt>Connect the university&apos;s finance wallet to continue.</ConnectPrompt>
      ) : payee.isLoading ? (
        <p className="desk-muted">Checking registration…</p>
      ) : !payee.data ? (
        <ConnectPrompt>
          This wallet ({shortAddress(me)}) is not a registered university. The platform admin registers each finance
          office once; send them this address.
        </ConnectPrompt>
      ) : (
        <Desk me={me} name={payee.data} />
      )}
    </main>
  );
}

function Desk({ me, name }: { me: Address; name: string }) {
  const { rpc } = useApp();
  const requests = useSWR(["school-invoices", me], () => listInvoices(rpc, { payee: me }), {
    refreshInterval: 5000,
  });
  return (
    <div className="desk-cols">
      <div className="col">
        <p className="nameplate">
          <span className="label">Signed in as</span>
          <b>{name}</b>
        </p>
        <CreateRequest me={me} onCreated={() => requests.mutate()} />
      </div>
      <section className="col">
        <h2 className="tag">Your requests</h2>
        {requests.isLoading ? (
          <p className="desk-muted">Loading requests…</p>
        ) : requests.data?.length ? (
          <div className="slips">
            {requests.data.map((r) => (
              <RequestRow key={r.address} row={r} onChange={() => requests.mutate()} />
            ))}
          </div>
        ) : (
          <p className="desk-muted">No requests yet. Each one you issue lands here as a slip.</p>
        )}
      </section>
    </div>
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
  const [created, setCreated] = useState<{ invoice: Address; salt: string } | null>(null);

  const amountBase = parseAmount(amount);
  const tryKurus = parseAmount(tryAmount, 2);
  const valid = !!amountBase && amountBase > 0n && tryKurus !== null && studentRef.trim().length > 0;

  async function submit() {
    const nonce = BigInt(Date.now());
    const [invoice] = await findInvoicePda({ payee: me, nonce });
    const salt = newSalt();
    const sig = await tx.send(async () => [
      await getCreateInvoiceInstructionAsync({
        payee: client.payer,
        mint,
        tokenProgram: await tokenProgramOf(client.rpc, mint),
        nonce,
        amount: amountBase as bigint,
        amountTryKurus: tryKurus as bigint,
        term,
        studentRefHash: await studentRefHash(invoice, studentRef, salt),
        windowSecs: BigInt(windowSecs),
      }),
    ]);
    if (sig) {
      try {
        localStorage.setItem(saltKey(invoice), toHex(salt));
      } catch {
        // storage blocked: the link shown below still carries the salt
      }
      setCreated({ invoice, salt: toHex(salt) });
      setStudentRef("");
      onCreated();
    }
  }

  return (
    <section className="paper sheet tilt-l">
      <i className="clip" aria-hidden />
      <p className="label">Finance office</p>
      <h2 className="sheet-title">New tuition request</h2>
      <div className="fields">
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
        <button className="btn" disabled={!valid || tx.status === "pending"} onClick={submit}>
          {tx.status === "pending" ? "Issuing…" : "Issue request"}
        </button>
      </div>
      <TxNotice tx={tx} doneText="Request issued." />
      {created && <ShareLink invoice={created.invoice} salt={created.salt} />}
    </section>
  );
}

function ShareLink({ invoice, salt }: { invoice: Address; salt: string }) {
  const path = `/pay/${invoice}#k=${salt}`;
  const url = `${window.location.origin}${path}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="share">
      <div className="qr">
        <QRCodeSVG value={url} size={148} marginSize={0} />
      </div>
      <div>
        <p className="label">Send this to the family</p>
        <p className="paylink">{url}</p>
        <div className="actions">
          <button
            className="btn paperbtn"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <Link className="btn ghost" href={path}>
            Open payment page <span className="arr" aria-hidden>→</span>
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
    const sig = await tx.send(async () => {
      const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
      return [
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
      ];
    });
    if (sig) onChange();
  }

  return (
    <article className="paper sheet slip">
      <i className={canConfirm ? "clip brass" : "clip"} aria-hidden />
      <p className="label">
        {formatTerm(inv.term)} · request {shortAddress(row.address)}
      </p>
      <p className="slip-amount">
        {formatAmount(inv.amount)}
        <small>{mintSymbol(inv.mint)}</small>
      </p>
      <p className="slip-meta">Lira quote {formatTry(inv.amountTryKurus)}</p>
      <div className="status-line">
        <StatusBadge status={inv.status} />
        {(inv.status === Status.Funded || inv.status === Status.Paid) && <Countdown invoice={inv} />}
      </div>
      {inv.status === Status.Funded && (
        <p className="slip-note">The partner has not reported the lira yet. Confirm only if it reached your bank.</p>
      )}
      <div className="actions">
        {canConfirm && (
          <button className="btn" onClick={confirm} disabled={tx.status === "pending"}>
            {tx.status === "pending" ? "Confirming…" : "Confirm lira received"}
          </button>
        )}
        <Link className="btn ghost" href={inv.status === Status.Open ? payLink(row.address) : `/receipt/${row.address}`}>
          {inv.status === Status.Open ? "Payment page" : "Receipt"} <span className="arr" aria-hidden>→</span>
        </Link>
      </div>
      {tx.status !== "idle" && <TxNotice tx={tx} doneText="Confirmed. Escrow released to the payout partner." />}
    </article>
  );
}
