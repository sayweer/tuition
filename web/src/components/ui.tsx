"use client";

import type { ReactNode } from "react";
import { explorerAddress, explorerTx } from "@/lib/constants";
import { Status, formatDateTime, isExpired, shortAddress, type HistoryEntry, type Invoice } from "@/lib/escrow";
import { useNow, type TxState } from "@/lib/hooks";
import { useLang, useT, type Dict } from "@/lib/i18n";

type Tone = "wait" | "ok" | "back" | "info";
const TONE: Record<Status, Tone> = {
  [Status.Open]: "wait",
  [Status.Funded]: "wait",
  [Status.Paid]: "wait",
  [Status.Released]: "ok",
  [Status.Refunded]: "back",
  [Status.Resolved]: "info",
  [Status.Expired]: "back",
};

/** The chip carries a short ink stamp; the rest of the sentence sits next to it. */
const STATUS_COPY: Dict<Record<Status, { stamp: string; rest: string }>> = {
  en: {
    [Status.Open]: { stamp: "Open", rest: "collecting contributions" },
    [Status.Funded]: { stamp: "Locked", rest: "waiting for the payout partner" },
    [Status.Paid]: { stamp: "Lira sent", rest: "waiting for the university" },
    [Status.Released]: { stamp: "Received", rest: "by the university" },
    [Status.Refunded]: { stamp: "Refunded", rest: "to the family" },
    [Status.Resolved]: { stamp: "Settled", rest: "by the arbiter" },
    [Status.Expired]: { stamp: "Not funded", rest: "in time; gifts go back" },
  },
  tr: {
    [Status.Open]: { stamp: "Açık", rest: "katkı toplanıyor" },
    [Status.Funded]: { stamp: "Kilitlendi", rest: "ödeme ortağı bekleniyor" },
    [Status.Paid]: { stamp: "Lira gönderildi", rest: "üniversite bekleniyor" },
    [Status.Released]: { stamp: "Tahsil edildi", rest: "üniversite onayladı" },
    [Status.Refunded]: { stamp: "İade edildi", rest: "aileye" },
    [Status.Resolved]: { stamp: "Karara bağlandı", rest: "hakem tarafından" },
    [Status.Expired]: { stamp: "Tamamlanmadı", rest: "süresinde; katkılar geri döner" },
  },
};

const T = {
  en: {
    passed: "Deadline passed",
    left: "left",
    d: "d",
    h: "h",
    m: "m",
    pending: "Waiting for your wallet and the network…",
    view: "View transaction",
    confirmed: "Confirmed",
    tx: "Transaction",
    onChain: "Confirmed on-chain",
    notYet: "Not yet",
    cannotOpen: "Cannot open this link",
  },
  tr: {
    passed: "Süre doldu",
    left: "kaldı",
    d: "g",
    h: "sa",
    m: "dk",
    pending: "Cüzdanınız ve ağ bekleniyor…",
    view: "İşlemi görüntüle",
    confirmed: "Onaylandı",
    tx: "İşlem",
    onChain: "Zincirde onaylandı",
    notYet: "Henüz değil",
    cannotOpen: "Bu bağlantı açılamıyor",
  },
} satisfies Dict<Record<string, string>>;

export function StatusBadge({ status }: { status: Status }) {
  const { stamp, rest } = useT(STATUS_COPY)[status];
  const tone = TONE[status];
  return (
    <span className="status">
      <span className={`ink-chip ink-${tone}`}>{stamp}</span>
      <span className="status-rest">{rest}</span>
    </span>
  );
}

export function Countdown({ invoice }: { invoice: Invoice }) {
  const now = useNow();
  const t = useT(T);
  if (invoice.deadline === 0n) return null;
  const left = Number(invoice.deadline) - now;
  if (left <= 0) return <span className="countdown expired">{t.passed}</span>;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const text =
    d > 0 ? `${d}${t.d} ${h}${t.h}` : h > 0 ? `${h}${t.h} ${m}${t.m}` : `${m}:${String(s).padStart(2, "0")}`;
  return (
    <span className="countdown" aria-live="off">
      {text} {t.left}
    </span>
  );
}

export function useIsExpired(invoice: Invoice | null | undefined): boolean {
  const now = useNow();
  return invoice ? isExpired(invoice, now) : false;
}

export function TxNotice({ tx, doneText }: { tx: TxState; doneText: string }) {
  const t = useT(T);
  if (tx.status === "pending") return <p className="notice">{t.pending}</p>;
  if (tx.status === "error") return <p className="notice notice-error" role="alert">{tx.error}</p>;
  if (tx.status === "done" && tx.signature)
    return (
      <p className="notice notice-ok" role="status">
        {doneText}{" "}
        <a href={explorerTx(tx.signature)} target="_blank" rel="noreferrer">
          {t.view}
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

type StepCopy = { step: HistoryEntry["step"]; text: string };
const SEQUENCE: Dict<StepCopy[]> = {
  en: [
    { step: "Created", text: "University issued the request" },
    { step: "Contributed", text: "Tuition fully funded in escrow" },
    { step: "TRY sent", text: "Payout partner sent lira to the university's bank" },
    { step: "Signed", text: "University confirmed receipt with its own key" },
  ],
  tr: [
    { step: "Created", text: "Üniversite talebi açtı" },
    { step: "Contributed", text: "Harç emanet hesabında tamamlandı" },
    { step: "TRY sent", text: "Ödeme ortağı lirayı üniversitenin bankasına gönderdi" },
    { step: "Signed", text: "Üniversite tahsilatı kendi anahtarıyla onayladı" },
  ],
};

const TERMINAL: Dict<Partial<Record<Status, StepCopy>>> = {
  en: {
    [Status.Refunded]: { step: "Refunded", text: "Deadline passed without payout: refunded to the family" },
    [Status.Resolved]: { step: "Resolved", text: "Arbiter settled the dispute" },
    [Status.Expired]: { step: "Expired", text: "Not fully funded in time: contributions go back" },
  },
  tr: {
    [Status.Refunded]: { step: "Refunded", text: "Süre ödeme yapılmadan doldu: aileye iade edildi" },
    [Status.Resolved]: { step: "Resolved", text: "Hakem anlaşmazlığı karara bağladı" },
    [Status.Expired]: { step: "Expired", text: "Süresinde tamamlanmadı: katkılar geri döner" },
  },
};

export function Timeline({ invoice, history }: { invoice: Invoice; history: HistoryEntry[] | undefined }) {
  const lang = useLang();
  const t = T[lang];
  const sequence = SEQUENCE[lang];
  // A step counts as done only when the invoice account itself says so; history only adds the link.
  const reached: Record<HistoryEntry["step"], boolean> = {
    Created: true,
    Contributed: invoice.fundedAt > 0n,
    "TRY sent": invoice.paidAt > 0n,
    Signed: invoice.status === Status.Released,
    Refunded: invoice.status === Status.Refunded,
    Resolved: invoice.status === Status.Resolved,
    Expired: invoice.status === Status.Expired,
  };
  const terminal = TERMINAL[lang][invoice.status];
  // Once settled, steps that never happened (e.g. confirmed before the partner reported) are dropped.
  const steps = terminal
    ? [...sequence.filter((s) => reached[s.step]), terminal]
    : invoice.status === Status.Released
      ? sequence.filter((s) => reached[s.step])
      : sequence;
  return (
    <ol className="timeline">
      {steps.map((s, i) => {
        const done = reached[s.step];
        // several contributions may exist; the one that completed the amount is the latest
        const entry = done ? history?.findLast((h) => h.step === s.step) : undefined;
        return (
          <li key={s.step} className={done ? "done" : "todo"}>
            <span className="timeline-index" aria-hidden>
              {i + 1}
            </span>
            <div>
              <p className="timeline-text">{s.text}</p>
              {entry ? (
                <p className="timeline-meta">
                  {entry.blockTime ? formatDateTime(entry.blockTime, lang) : t.confirmed}{" "}
                  <a href={explorerTx(entry.signature)} target="_blank" rel="noreferrer">
                    {t.tx}
                  </a>
                </p>
              ) : (
                <p className="timeline-meta">{done ? t.onChain : t.notYet}</p>
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
  const t = useT(T);
  return (
    <main className="desk-page">
      {problem ? (
        <div className="paper sheet tilt-l problem">
          <i className="clip" aria-hidden />
          <p className="label">{t.cannotOpen}</p>
          <p className="problem-text">{children}</p>
        </div>
      ) : (
        <p className="desk-muted">{children}</p>
      )}
    </main>
  );
}
