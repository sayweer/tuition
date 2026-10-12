"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isAddress, type Address } from "@solana/kit";
import useSWR from "swr";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token-2022";
import { getPayInvoiceInstructionAsync, getRefundInstructionAsync } from "@/generated/tuition-escrow";
import { ConnectPrompt, Countdown, DeskNote, Field, StatusBadge, Timeline, TxNotice, useIsExpired } from "@/components/ui";
import { mintSymbol } from "@/lib/constants";
import {
  Status,
  ataOf,
  formatAmount,
  formatTerm,
  formatTry,
  shortAddress,
  studentRefHash,
  tokenBalance,
  tokenProgramOf,
  toHex,
  type Invoice,
} from "@/lib/escrow";
import { useApp, useConfig, useHistory, useInvoice, usePayeeName, useSendTx, useWalletAddress } from "@/lib/hooks";

export default function PayPage() {
  const params = useParams<{ invoice: string }>();
  const id = isAddress(params.invoice) ? (params.invoice as Address) : null;
  const invoice = useInvoice(id);
  const school = usePayeeName(invoice.data?.payee);
  const history = useHistory(id, invoice.data?.status);

  if (!id) return <DeskNote problem>This payment link is not valid.</DeskNote>;
  if (invoice.isLoading) return <DeskNote>Loading the request…</DeskNote>;
  if (!invoice.data) return <DeskNote problem>No tuition request exists at this link on devnet.</DeskNote>;

  const inv = invoice.data;
  const symbol = mintSymbol(inv.mint);
  return (
    <main className="desk-page">
      <div className="pay-cols">
        <article className="paper airmail sheet letter tilt-l">
          <i className="clip brass" aria-hidden />
          <div className="letter-top">
            <p className="label">Tuition request</p>
            <span className="par-avion" aria-hidden>
              <b>Par avion</b>
              By airmail
            </span>
          </div>
          <p className="label letter-from-label">From</p>
          <h1 className="letter-from">{school.data ?? "A registered university"}</h1>
          <p className="letter-to">
            <span className="label">To</span>
            the student&apos;s family
          </p>
          <div className="letter-amount">
            <p className="big-amount">
              {formatAmount(inv.amount)}
              <small>{symbol}</small>
            </p>
            <p className="letter-sub">
              {formatTerm(inv.term)} tuition, paid to the university as {formatTry(inv.amountTryKurus)}
            </p>
            <div className="status-line">
              <StatusBadge status={inv.status} /> <Countdown invoice={inv} />
            </div>
          </div>
          <VerifyStudent invoice={id} expected={inv.studentRefHash} />
        </article>

        <div className="pay-side">
          {inv.status === Status.Open && <LockFunds id={id} inv={inv} onDone={() => invoice.mutate()} />}
          {inv.status === Status.Funded && <RefundIfExpired id={id} inv={inv} onDone={() => invoice.mutate()} />}
          <section className="paper sheet">
            <i className="clip" aria-hidden />
            <p className="label">Where the money is</p>
            <h2 className="sheet-title">Progress</h2>
            <Timeline invoice={inv} history={history.data} />
            <div className="actions">
              <Link className="btn ghost" href={`/receipt/${id}`}>
                Open the receipt <span className="arr" aria-hidden>→</span>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function VerifyStudent({ invoice, expected }: { invoice: Address; expected: ArrayLike<number> }) {
  const [ref, setRef] = useState("");
  const [result, setResult] = useState<boolean | null>(null);
  return (
    <details className="verify">
      <summary>Check this request is for your student</summary>
      <div className="verify-row">
        <Field label="Student number">
          <input
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
              setResult(null);
            }}
          />
        </Field>
        <button
          className="btn paperbtn"
          disabled={!ref.trim()}
          onClick={async () => setResult(toHex(await studentRefHash(invoice, ref)) === toHex(expected))}
        >
          Check
        </button>
      </div>
      {result === true && <p className="notice notice-ok">It matches. This request was issued for this student.</p>}
      {result === false && (
        <p className="notice notice-error">It does not match. Ask the university before you pay.</p>
      )}
    </details>
  );
}

function LockFunds({ id, inv, onDone }: { id: Address; inv: Invoice; onDone: () => void }) {
  const client = useApp();
  const me = useWalletAddress();
  const config = useConfig();
  const tx = useSendTx();
  const offices = config.data?.offices ?? [];
  const [office, setOffice] = useState<Address | "">("");
  const chosen = office || offices[0] || "";
  const balance = useSWR(me ? ["balance", me, inv.mint, tx.status] : null, () =>
    tokenBalance(client.rpc, me as Address, inv.mint),
  );
  const symbol = mintSymbol(inv.mint);
  const short = balance.data !== undefined && balance.data < inv.amount;

  async function lock() {
    const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
    const sig = await tx.send(async () => [
      await getPayInvoiceInstructionAsync({
        payer: client.payer,
        office: chosen as Address,
        invoice: id,
        payerToken: await ataOf(me as Address, inv.mint, tokenProgram),
        mint: inv.mint,
        tokenProgram,
      }),
    ]);
    if (sig) onDone();
  }

  return (
    <section className="paper sheet tilt-r">
      <i className="clip brass" aria-hidden />
      <p className="label">Your part</p>
      <h2 className="sheet-title">Lock the tuition</h2>
      <p className="sheet-text">
        The money goes into escrow, not to anyone. It is released to the payout partner only after the university
        confirms the lira arrived. If that has not happened by the deadline, it comes back to you.
      </p>
      {!me ? (
        <ConnectPrompt>Connect your wallet to pay.</ConnectPrompt>
      ) : (
        <>
          <div className="fields stacked">
            <Field label="Payout partner" hint="A licensed company that pays the university in lira.">
              <select value={chosen} onChange={(e) => setOffice(e.target.value as Address)}>
                {offices.map((o, i) => (
                  <option key={o} value={o}>
                    Licensed partner {i + 1} ({shortAddress(o)})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Your balance">
              <span className="field-value">
                {balance.data === undefined ? "…" : `${formatAmount(balance.data)} ${symbol}`}
              </span>
            </Field>
          </div>
          {short && (
            <p className="notice notice-error">
              Not enough {symbol}.{" "}
              {symbol === "USDG" ? (
                <>
                  Get test USDG at{" "}
                  <a href="https://faucet.paxos.com" target="_blank" rel="noreferrer">
                    faucet.paxos.com
                  </a>
                  .
                </>
              ) : (
                "Ask the demo admin for test dollars."
              )}
            </p>
          )}
          <div className="actions">
            <button className="btn" onClick={lock} disabled={!chosen || short || tx.status === "pending"}>
              {tx.status === "pending" ? "Locking…" : `Lock ${formatAmount(inv.amount)} ${symbol}`}
            </button>
          </div>
          <TxNotice tx={tx} doneText="Locked in escrow." />
        </>
      )}
    </section>
  );
}

function RefundIfExpired({ id, inv, onDone }: { id: Address; inv: Invoice; onDone: () => void }) {
  const client = useApp();
  const me = useWalletAddress();
  const expired = useIsExpired(inv);
  const tx = useSendTx();
  if (!expired) return null;

  async function refund() {
    const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
    const sig = await tx.send(async () => [
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: client.payer,
        owner: inv.payer,
        mint: inv.mint,
        tokenProgram,
      }),
      await getRefundInstructionAsync({
        caller: client.payer,
        invoice: id,
        payerToken: await ataOf(inv.payer, inv.mint, tokenProgram),
        mint: inv.mint,
        tokenProgram,
      }),
    ]);
    if (sig) onDone();
  }

  return (
    <section className="paper sheet tilt-r">
      <i className="clip" aria-hidden />
      <p className="label">Deadline passed</p>
      <h2 className="sheet-title">The deadline passed with no payout</h2>
      <p className="sheet-text">
        The payout partner never reported sending lira. Anyone can return the full amount to the family wallet.
      </p>
      {me ? (
        <div className="actions">
          <button className="btn danger" onClick={refund} disabled={tx.status === "pending"}>
            {tx.status === "pending" ? "Refunding…" : "Refund to the family"}
          </button>
        </div>
      ) : (
        <ConnectPrompt>Connect any wallet to send the refund.</ConnectPrompt>
      )}
      <TxNotice tx={tx} doneText="Refunded to the family." />
    </section>
  );
}
