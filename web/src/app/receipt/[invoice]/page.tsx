"use client";

import { useParams } from "next/navigation";
import { isAddress, type Address } from "@solana/kit";
import { Stamp } from "@/components/stamp";
import { AddressLink, StatusBadge, Timeline } from "@/components/ui";
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

  if (!id) return <p className="notice notice-error">This receipt link is not valid.</p>;
  if (invoice.isLoading) return <p className="muted">Loading the receipt…</p>;
  if (!invoice.data) return <p className="notice notice-error">No receipt exists at this address on devnet.</p>;

  const inv = invoice.data;
  const name = school.data ?? "Registered university";
  const symbol = mintSymbol(inv.mint);
  const settled = inv.status >= Status.Released;
  const unset = (a: string) => a === "11111111111111111111111111111111";

  return (
    <>
      <article className="receipt">
        <header className="receipt-head">
          <div>
            <p className="muted">{settled ? "Tuition receipt" : "Tuition request in progress"}</p>
            <h1 className="page-title" style={{ fontSize: "1.6rem" }}>
              {name}
            </h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <p className="muted">Receipt number</p>
            <p className="row-title hash">{id.slice(0, 8).toUpperCase()}</p>
          </div>
        </header>

        <div className="receipt-body">
          <div>
            <p className="muted">{formatTerm(inv.term)} tuition</p>
            <p className="receipt-amount">
              {formatAmount(inv.deposited > 0n ? inv.deposited : inv.amount)} {symbol}
            </p>
            <p className="muted">Paid to the university&apos;s bank as {formatTry(inv.amountTryKurus)}</p>
            <p style={{ marginTop: "0.75rem" }}>
              <StatusBadge status={inv.status} />
            </p>
          </div>
          <StampFor inv={inv} school={name} />
        </div>

        <dl className="receipt-grid">
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
          <div style={{ gridColumn: "1 / -1" }}>
            <dt>Student reference (salted SHA-256, no personal data on-chain)</dt>
            <dd className="hash">{toHex(inv.studentRefHash)}</dd>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <dt>Bank transfer receipt (SHA-256 posted by the payout partner)</dt>
            <dd className="hash">
              {inv.bankReceiptHash.every((b) => b === 0) ? "Not reported" : toHex(inv.bankReceiptHash)}
            </dd>
          </div>
        </dl>

        <h2 className="section-title">Record</h2>
        <Timeline invoice={inv} history={history.data} />

        <p className="muted" style={{ marginTop: "1.5rem", fontSize: "0.88rem" }}>
          This receipt is the Solana account{" "}
          <a className="hash" href={explorerAddress(id)} target="_blank" rel="noreferrer">
            {id}
          </a>{" "}
          on devnet. Anyone can verify it without trusting this website.
        </p>
      </article>
      <div className="actions no-print">
        <button className="btn btn-quiet" onClick={() => window.print()}>
          Print receipt
        </button>
        {inv.status === Status.Open && (
          <a className="btn btn-quiet" href={`/pay/${id}`}>
            Payment page
          </a>
        )}
      </div>
    </>
  );
}
