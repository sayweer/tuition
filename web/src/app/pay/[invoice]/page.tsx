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
  linkSalt,
  studentRefHash,
  tokenBalance,
  tokenProgramOf,
  toHex,
  type Invoice,
} from "@/lib/escrow";
import { useApp, useConfig, useHistory, useInvoice, usePayeeName, useSendTx, useWalletAddress, type TxState } from "@/lib/hooks";

type Tx = ReturnType<typeof useSendTx>;

export default function PayPage() {
  const params = useParams<{ invoice: string }>();
  const id = isAddress(params.invoice) ? (params.invoice as Address) : null;
  const invoice = useInvoice(id);
  const school = usePayeeName(invoice.data?.payee);
  const history = useHistory(id, invoice.data?.status);
  // Owned here, not by the action cards: they unmount when the status moves on, and the
  // success notice with its transaction link has to stay on screen.
  const lockTx = useSendTx();
  const refundTx = useSendTx();

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
              <StatusBadge status={inv.status} />{" "}
              {(inv.status === Status.Funded || inv.status === Status.Paid) && <Countdown invoice={inv} />}
            </div>
          </div>
          <VerifyStudent invoice={id} expected={inv.studentRefHash} />
        </article>

        <div className="pay-side">
          <Notice tx={lockTx} doneText="Locked in escrow." />
          <Notice tx={refundTx} doneText="Refunded to the family." />
          {inv.status === Status.Open && <LockFunds id={id} inv={inv} tx={lockTx} onDone={() => invoice.mutate()} />}
          {inv.status === Status.Funded && (
            <RefundIfExpired id={id} inv={inv} tx={refundTx} onDone={() => invoice.mutate()} />
          )}
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

function Notice({ tx, doneText }: { tx: TxState; doneText: string }) {
  if (tx.status === "idle") return null;
  return <TxNotice tx={tx} doneText={doneText} />;
}

function VerifyStudent({ invoice, expected }: { invoice: Address; expected: ArrayLike<number> }) {
  const [ref, setRef] = useState("");
  const [result, setResult] = useState<boolean | "no-key" | null>(null);

  async function check() {
    // the salt travels only in the link's #fragment, which never reaches a server or the chain
    const salt = linkSalt(window.location.hash);
    if (!salt) return setResult("no-key");
    setResult(toHex(await studentRefHash(invoice, ref, salt)) === toHex(expected));
  }

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
          onClick={check}
        >
          Check
        </button>
      </div>
      {result === true && <p className="notice notice-ok">It matches. This request was issued for this student.</p>}
      {result === false && (
        <p className="notice notice-error">It does not match. Ask the university before you pay.</p>
      )}
      {result === "no-key" && (
        <p className="notice notice-error">Open the exact link the university sent you; it carries the key for this check.</p>
      )}
    </details>
  );
}

function LockFunds({ id, inv, tx, onDone }: { id: Address; inv: Invoice; tx: Tx; onDone: () => void }) {
  const client = useApp();
  const me = useWalletAddress();
  const config = useConfig();
  const offices = config.data?.offices ?? [];
  const [office, setOffice] = useState<Address | "">("");
  const chosen = office || offices[0] || "";
  const balance = useSWR(me ? ["balance", me, inv.mint, tx.status] : null, () =>
    tokenBalance(client.rpc, me as Address, inv.mint),
  );
  const symbol = mintSymbol(inv.mint);
  const short = balance.data !== undefined && balance.data < inv.amount;

  async function lock() {
    const sig = await tx.send(async () => {
      const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
      return [
        await getPayInvoiceInstructionAsync({
          payer: client.payer,
          office: chosen as Address,
          invoice: id,
          payerToken: await ataOf(me as Address, inv.mint, tokenProgram),
          mint: inv.mint,
          tokenProgram,
        }),
      ];
    });
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
        </>
      )}
    </section>
  );
}

function RefundIfExpired({ id, inv, tx, onDone }: { id: Address; inv: Invoice; tx: Tx; onDone: () => void }) {
  const client = useApp();
  const me = useWalletAddress();
  const expired = useIsExpired(inv);
  if (!expired) return null;

  async function refund() {
    const sig = await tx.send(async () => {
      const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
      return [
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
      ];
    });
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
    </section>
  );
}
