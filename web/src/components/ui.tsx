"use client";

import type { ReactNode } from "react";
import { explorerAddress, explorerTx } from "@/lib/constants";
import { Status, isExpired, shortAddress, type HistoryEntry, type Invoice } from "@/lib/escrow";
import { useNow, type TxState } from "@/lib/hooks";

/** The chip carries a short ink stamp; the rest of the sentence sits next to it. */
const STATUS_COPY: Record<Status, { stamp: string; rest: string; tone: "wait" | "ok" | "back" | "info" }> = {
  [Status.Open]: { stamp: "Issued", rest: "waiting for the family", tone: "wait" },
  [Status.Funded]: { stamp: "Locked", rest: "waiting for the payout partner", tone: "wait" },
  [Status.Paid]: { stamp: "Lira sent", rest: "waiting for the university", tone: "wait" },
  [Status.Released]: { stamp: "Received", rest: "by the university", tone: "ok" },
  [Status.Refunded]: { stamp: "Refunded", rest: "to the family", tone: "back" },
  [Status.Resolved]: { stamp: "Settled", rest: "by the arbiter", tone: "info" },
};

export function StatusBadge({ status }: { status: Status }) {
  const { stamp, rest, tone } = STATUS_COPY[status];
  return (
    <span className="status">
      <span className={`ink-chip ink-${tone}`}>{stamp}</span>
      <span className="status-rest">{rest}</span>
    </span>
  );
}

export function Countdown({ invoice }: { invoice: Invoice }) {
  const now = useNow();
  if (invoice.deadline === 0n) return null;
  const left = Number(invoice.deadline) - now;
  if (left <= 0) return <span className="countdown expired">Deadline passed</span>;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`;
  return (
    <span className="countdown" aria-live="off">
      {text} left
    </span>
  );
}

export function useIsExpired(invoice: Invoice | null | undefined): boolean {
  const now = useNow();
  return invoice ? isExpired(invoice, now) : false;
}

export function TxNotice({ tx, doneText }: { tx: TxState; doneText: string }) {
  if (tx.status === "pending") return <p className="notice">Waiting for your wallet and the network…</p>;
  if (tx.status === "error") return <p className="notice notice-error" role="alert">{tx.error}</p>;
  if (tx.status === "done" && tx.signature)
    return (
      <p className="notice notice-ok" role="status">
        {doneText}{" "}
        <a href={explorerTx(tx.signature)} target="_blank" rel="noreferrer">
          View transaction
        </a>
      </p>
    );
  return null;
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a className="mono-link" href={explorerAddress(address)} target="_blank" rel="noreferrer" title={address}>
      {label ?? shortAddress(address)}
    </a>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

const SEQUENCE: { step: HistoryEntry["step"]; text: string }[] = [
  { step: "Created", text: "University issued the request" },
  { step: "Locked", text: "Family locked the tuition in escrow" },
  { step: "TRY sent", text: "Payout partner sent lira to the university's bank" },
  { step: "Signed", text: "University confirmed receipt with its own key" },
];

const TERMINAL: Partial<Record<Status, { step: HistoryEntry["step"]; text: string }>> = {
  [Status.Refunded]: { step: "Refunded", text: "Deadline passed without payout: refunded to the family" },
  [Status.Resolved]: { step: "Resolved", text: "Arbiter settled the dispute" },
};

export function Timeline({ invoice, history }: { invoice: Invoice; history: HistoryEntry[] | undefined }) {
  const terminal = TERMINAL[invoice.status];
  const steps = terminal
    ? [...SEQUENCE.filter((s) => history?.some((h) => h.step === s.step) || s.step === "Created"), terminal]
    : SEQUENCE;
  return (
    <ol className="timeline">
      {steps.map((s, i) => {
        const entry = history?.find((h) => h.step === s.step);
        return (
          <li key={s.step} className={entry ? "done" : "todo"}>
            <span className="timeline-index" aria-hidden>
              {i + 1}
            </span>
            <div>
              <p className="timeline-text">{s.text}</p>
              {entry ? (
                <p className="timeline-meta">
                  {entry.blockTime ? new Date(entry.blockTime * 1000).toLocaleString("en-GB") : "Confirmed"}{" "}
                  <a href={explorerTx(entry.signature)} target="_blank" rel="noreferrer">
                    Transaction
                  </a>
                </p>
              ) : (
                <p className="timeline-meta">Not yet</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** On the desk: a kraft card clipped to the blotter. Inside a sheet: a dashed box. */
export function ConnectPrompt({ children }: { children: ReactNode }) {
  return (
    <div className="prompt">
      <i className="clip" aria-hidden />
      {children}
    </div>
  );
}

/** Whole-page state before a document exists: loading text on the desk, or a paper note for a bad link. */
export function DeskNote({ children, problem = false }: { children: ReactNode; problem?: boolean }) {
  return (
    <main className="desk-page">
      {problem ? (
        <div className="paper sheet tilt-l problem">
          <i className="clip" aria-hidden />
          <p className="label">Cannot open this link</p>
          <p className="problem-text">{children}</p>
        </div>
      ) : (
        <p className="desk-muted">{children}</p>
      )}
    </main>
  );
}
