"use client";

import { useParams } from "next/navigation";
import { isAddress, type Address } from "@solana/kit";
import { Stamp } from "@/components/stamp";
import { AddressLink, DeskNote, StatusBadge, Timeline } from "@/components/ui";
import { explorerAddress, mintSymbol } from "@/lib/constants";
import { Status, formatAmount, formatTerm, formatTry, toHex, type Invoice } from "@/lib/escrow";
import { useHistory, useInvoice, usePayeeName } from "@/lib/hooks";

function fmtTime(secs: bigint): string {
  return secs > 0n ? new Date(Number(secs) * 1000).toLocaleString("en-GB") : "Not yet";
}

function StampFor({ inv, school }: { inv: Invoice; school: string }) {
  const ring = `${school} ★ finance office ★ `;
  switch (inv.status) {
    case Status.Released:
      return <Stamp ring={ring} center="Received" sub="signed by the university" />;
    case Status.Refunded:
      return <Stamp ring="Escrow ★ deadline passed ★ " center="Refunded" sub="returned to the family" tone="back" />;
    case Status.Resolved:
      return (
        <Stamp
          ring="Escrow ★ arbiter ruling ★ "
          center="Settled"
          sub={inv.resolvedToOffice ? "released to the partner" : "returned to the family"}
          tone="info"
        />
      );
    default:
      return null;
  }
}

export default function ReceiptPage() {
  const params = useParams<{ invoice: string }>();
  const id = isAddress(params.invoice) ? (params.invoice as Address) : null;
  const invoice = useInvoice(id);
  const school = usePayeeName(invoice.data?.payee);
  const history = useHistory(id, invoice.data?.status);

  if (!id) return <DeskNote problem>This receipt link is not valid.</DeskNote>;
  if (invoice.isLoading) return <DeskNote>Loading the receipt…</DeskNote>;
  if (!invoice.data) return <DeskNote problem>No receipt exists at this address on devnet.</DeskNote>;

  const inv = invoice.data;
  const name = school.data ?? "Registered university";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const symbol = mintSymbol(inv.mint);
  const settled = inv.status >= Status.Released;
  const unset = (a: string) => a === "11111111111111111111111111111111";

  return (
    <main className="desk-page receipt-page">
      <article className="paper rcpt">
        <i className="clip brass" aria-hidden />
        <header className="rcpt-head">
          <span className="crest" aria-hidden>
            {initials}
          </span>
          <div>
            <h1 className="rcpt-school">{name}</h1>
            <p className="label rcpt-kind">
              Finance office · {settled ? "Tuition receipt" : "Tuition request in progress"}
            </p>
          </div>
          <div className="rcpt-no">
            <p className="label">Receipt number</p>
            <p className="rcpt-num">{id.slice(0, 8).toUpperCase()}</p>
          </div>
        </header>

        <div className="rcpt-body">
          <div>
            <p className="label">{formatTerm(inv.term)} tuition</p>
            <p className="rcpt-amount">
              {formatAmount(inv.deposited > 0n ? inv.deposited : inv.amount)}
              <small>{symbol}</small>
            </p>
            <p className="rcpt-try">Paid to the university&apos;s bank as {formatTry(inv.amountTryKurus)}</p>
            <div className="status-line">
              <StatusBadge status={inv.status} />
            </div>
          </div>
          <StampFor inv={inv} school={name} />
        </div>

        <dl className="rcpt-grid">
          <div>
            <dt>University (payee)</dt>
            <dd>
              <AddressLink address={inv.payee} />
            </dd>
          </div>
          <div>
            <dt>Family wallet (payer)</dt>
            <dd>{unset(inv.payer) ? "Not paid yet" : <AddressLink address={inv.payer} />}</dd>
          </div>
          <div>
            <dt>Payout partner</dt>
            <dd>{unset(inv.office) ? "Chosen at payment" : <AddressLink address={inv.office} />}</dd>
          </div>
          <div>
            <dt>Issued</dt>
            <dd>{fmtTime(inv.createdAt)}</dd>
          </div>
          <div>
            <dt>Locked in escrow</dt>
            <dd>{fmtTime(inv.fundedAt)}</dd>
          </div>
          <div>
            <dt>Settled</dt>
            <dd>{fmtTime(inv.settledAt)}</dd>
          </div>
          <div className="wide">
            <dt>Student reference (salted SHA-256, no personal data on-chain)</dt>
            <dd className="hash">{toHex(inv.studentRefHash)}</dd>
          </div>
          <div className="wide">
            <dt>Bank transfer receipt (SHA-256 posted by the payout partner)</dt>
            <dd className="hash">
              {inv.bankReceiptHash.every((b) => b === 0) ? "Not reported" : toHex(inv.bankReceiptHash)}
            </dd>
          </div>
        </dl>

        <section className="rcpt-record">
          <h2 className="label">Record</h2>
          <Timeline invoice={inv} history={history.data} />
        </section>

        <p className="rcpt-foot">
          This receipt is the Solana account{" "}
          <a className="hash" href={explorerAddress(id)} target="_blank" rel="noreferrer">
            {id}
          </a>{" "}
          on devnet. Anyone can verify it without trusting this website.
        </p>
      </article>
      <div className="desk-actions no-print">
        <button className="btn paperbtn" onClick={() => window.print()}>
          Print receipt
        </button>
        {inv.status === Status.Open && (
          <a className="btn ghost" href={`/pay/${id}`}>
            Payment page <span className="arr" aria-hidden>→</span>
          </a>
        )}
      </div>
    </main>
  );
}
