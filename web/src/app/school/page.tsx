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
import { useLang, useT, type Dict } from "@/lib/i18n";

type Copy = Record<
  | "tag"
  | "title"
  | "titleEm"
  | "lede"
  | "connect"
  | "checking"
  | "signedIn"
  | "yourRequests"
  | "loadingRequests"
  | "noRequests"
  | "financeOffice"
  | "newRequest"
  | "amount"
  | "liraQuote"
  | "liraHint"
  | "term"
  | "studentNumber"
  | "studentHint"
  | "studentPlaceholder"
  | "currency"
  | "payoutWindow"
  | "windowHint"
  | "issuing"
  | "issue"
  | "issued"
  | "sendToFamily"
  | "copied"
  | "copy"
  | "openPayment"
  | "request"
  | "notReported"
  | "confirming"
  | "confirm"
  | "paymentPage"
  | "receipt"
  | "confirmed",
  string
> & {
  notRegistered: (addr: string) => string;
  amountHint: (symbol: string) => string;
};

const T: Dict<Copy> = {
  en: {
    tag: "University desk",
    title: "Issue the request, ",
    titleEm: "sign the receipt.",
    lede: "Issue a tuition request, send the link to the family, and confirm when the lira reaches your bank. Your confirmation is the receipt.",
    connect: "Connect the university's finance wallet to continue.",
    checking: "Checking registration…",
    notRegistered: (addr) =>
      `This wallet (${addr}) is not a registered university. The platform admin registers each finance office once; send them this address.`,
    signedIn: "Signed in as",
    yourRequests: "Your requests",
    loadingRequests: "Loading requests…",
    noRequests: "No requests yet. Each one you issue lands here as a slip.",
    financeOffice: "Finance office",
    newRequest: "New tuition request",
    amount: "Amount",
    amountHint: (symbol) => `In ${symbol}. The family locks exactly this.`,
    liraQuote: "Lira quote",
    liraHint: "Shown to the family; the payout partner pays this in TRY.",
    term: "Term",
    studentNumber: "Student number",
    studentHint: "Hashed in your browser. Only the hash goes on-chain.",
    studentPlaceholder: "e.g. 2026-10482",
    currency: "Currency",
    payoutWindow: "Payout window",
    windowHint: "Starts when the family locks the money.",
    issuing: "Issuing…",
    issue: "Issue request",
    issued: "Request issued.",
    sendToFamily: "Send this to the family",
    copied: "Copied",
    copy: "Copy link",
    openPayment: "Open payment page",
    request: "request",
    notReported: "The partner has not reported the lira yet. Confirm only if it reached your bank.",
    confirming: "Confirming…",
    confirm: "Confirm lira received",
    paymentPage: "Payment page",
    receipt: "Receipt",
    confirmed: "Confirmed. Escrow released to the payout partner.",
  },
  tr: {
    tag: "Üniversite masası",
    title: "Talebi oluşturun, ",
    titleEm: "makbuzu imzalayın.",
    lede: "Harç talebi oluşturun, bağlantıyı aileye gönderin ve lira bankanıza ulaştığında onaylayın. Onayınız aynı zamanda makbuzdur.",
    connect: "Devam etmek için üniversitenin mali işler cüzdanını bağlayın.",
    checking: "Kayıt kontrol ediliyor…",
    notRegistered: (addr) =>
      `Bu cüzdan (${addr}) kayıtlı bir üniversite değil. Platform yöneticisi her mali işler ofisini bir kez kaydeder; bu adresi ona gönderin.`,
    signedIn: "Oturum açan",
    yourRequests: "Talepleriniz",
    loadingRequests: "Talepler yükleniyor…",
    noRequests: "Henüz talep yok. Oluşturduğunuz her talep buraya bir fiş olarak düşer.",
    financeOffice: "Mali işler ofisi",
    newRequest: "Yeni harç talebi",
    amount: "Tutar",
    amountHint: (symbol) => `${symbol} cinsinden. Aile tam olarak bu tutarı kilitler.`,
    liraQuote: "Lira karşılığı",
    liraHint: "Aileye gösterilir; ödeme ortağı bu tutarı TL olarak öder.",
    term: "Dönem",
    studentNumber: "Öğrenci numarası",
    studentHint: "Tarayıcınızda hash'e dönüştürülür. Zincire yalnızca hash yazılır.",
    studentPlaceholder: "örn. 2026-10482",
    currency: "Para birimi",
    payoutWindow: "Ödeme süresi",
    windowHint: "Aile parayı kilitlediğinde başlar.",
    issuing: "Oluşturuluyor…",
    issue: "Talep oluştur",
    issued: "Talep oluşturuldu.",
    sendToFamily: "Bunu aileye gönderin",
    copied: "Kopyalandı",
    copy: "Bağlantıyı kopyala",
    openPayment: "Ödeme sayfasını aç",
    request: "talep",
    notReported: "Ödeme ortağı lirayı gönderdiğini henüz bildirmedi. Yalnızca bankanıza ulaştıysa onaylayın.",
    confirming: "Onaylanıyor…",
    confirm: "Liranın geldiğini onayla",
    paymentPage: "Ödeme sayfası",
    receipt: "Makbuz",
    confirmed: "Onaylandı. Emanet, ödeme ortağına aktarıldı.",
  },
};

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
  const t = useT(T);

  return (
    <main className="desk-page">
      <header className="page-head">
        <div>
          <p className="tag">{t.tag}</p>
          <h1 className="page-title">
            {t.title}
            <em>{t.titleEm}</em>
          </h1>
          <p className="page-lede">{t.lede}</p>
        </div>
      </header>
      {!me ? (
        <ConnectPrompt>{t.connect}</ConnectPrompt>
      ) : payee.isLoading ? (
        <p className="desk-muted">{t.checking}</p>
      ) : !payee.data ? (
        <ConnectPrompt>{t.notRegistered(shortAddress(me))}</ConnectPrompt>
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
  const t = useT(T);
  return (
    <div className="desk-cols">
      <div className="col">
        <p className="nameplate">
          <span className="label">{t.signedIn}</span>
          <b>{name}</b>
        </p>
        <CreateRequest me={me} onCreated={() => requests.mutate()} />
      </div>
      <section className="col">
        <h2 className="tag">{t.yourRequests}</h2>
        {requests.isLoading ? (
          <p className="desk-muted">{t.loadingRequests}</p>
        ) : requests.data?.length ? (
          <div className="slips">
            {requests.data.map((r) => (
              <RequestRow key={r.address} row={r} onChange={() => requests.mutate()} />
            ))}
          </div>
        ) : (
          <p className="desk-muted">{t.noRequests}</p>
        )}
      </section>
    </div>
  );
}

function CreateRequest({ me, onCreated }: { me: Address; onCreated: () => void }) {
  const client = useApp();
  const tx = useSendTx();
  const lang = useLang();
  const t = T[lang];
  const [amount, setAmount] = useState("300");
  const [tryAmount, setTryAmount] = useState("12000");
  const [term, setTerm] = useState(TERMS[0]);
  const [studentRef, setStudentRef] = useState("");
  const [mint, setMint] = useState<Address>(MINTS[0].address);
  const [windowSecs, setWindowSecs] = useState(PAYMENT_WINDOWS[1].secs);
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
      <p className="label">{t.financeOffice}</p>
      <h2 className="sheet-title">{t.newRequest}</h2>
      <div className="fields">
        <Field label={t.amount} hint={t.amountHint(mintSymbol(mint))}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t.liraQuote} hint={t.liraHint}>
          <input inputMode="decimal" value={tryAmount} onChange={(e) => setTryAmount(e.target.value)} />
        </Field>
        <Field label={t.term}>
          <select value={term} onChange={(e) => setTerm(Number(e.target.value))}>
            {TERMS.map((code) => (
              <option key={code} value={code}>
                {formatTerm(code, lang)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.studentNumber} hint={t.studentHint}>
          <input value={studentRef} onChange={(e) => setStudentRef(e.target.value)} placeholder={t.studentPlaceholder} />
        </Field>
        <Field label={t.currency}>
          <select value={mint} onChange={(e) => setMint(e.target.value as Address)}>
            {MINTS.map((m) => (
              <option key={m.address} value={m.address}>
                {m.label[lang]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.payoutWindow} hint={t.windowHint}>
          <select value={windowSecs} onChange={(e) => setWindowSecs(Number(e.target.value))}>
            {PAYMENT_WINDOWS.map((w) => (
              <option key={w.secs} value={w.secs}>
                {w.label[lang]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="actions">
        <button className="btn" disabled={!valid || tx.status === "pending"} onClick={submit}>
          {tx.status === "pending" ? t.issuing : t.issue}
        </button>
      </div>
      <TxNotice tx={tx} doneText={t.issued} />
      {created && <ShareLink invoice={created.invoice} salt={created.salt} />}
    </section>
  );
}

function ShareLink({ invoice, salt }: { invoice: Address; salt: string }) {
  const path = `/pay/${invoice}#k=${salt}`;
  const url = `${window.location.origin}${path}`;
  const [copied, setCopied] = useState(false);
  const t = useT(T);
  return (
    <div className="share">
      <div className="qr">
        <QRCodeSVG value={url} size={148} marginSize={0} />
      </div>
      <div>
        <p className="label">{t.sendToFamily}</p>
        <p className="paylink">{url}</p>
        <div className="actions">
          <button
            className="btn paperbtn"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? t.copied : t.copy}
          </button>
          <Link className="btn ghost" href={path}>
            {t.openPayment} <span className="arr" aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function RequestRow({ row, onChange }: { row: InvoiceRow; onChange: () => void }) {
  const client = useApp();
  const tx = useSendTx();
  const lang = useLang();
  const t = T[lang];
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
        {formatTerm(inv.term, lang)} · {t.request} {shortAddress(row.address)}
      </p>
      <p className="slip-amount">
        {formatAmount(inv.amount, lang)}
        <small>{mintSymbol(inv.mint)}</small>
      </p>
      <p className="slip-meta">
        {t.liraQuote} {formatTry(inv.amountTryKurus, lang)}
      </p>
      <div className="status-line">
        <StatusBadge status={inv.status} />
        {(inv.status === Status.Funded || inv.status === Status.Paid) && <Countdown invoice={inv} />}
      </div>
      {inv.status === Status.Funded && (
        <p className="slip-note">{t.notReported}</p>
      )}
      <div className="actions">
        {canConfirm && (
          <button className="btn" onClick={confirm} disabled={tx.status === "pending"}>
            {tx.status === "pending" ? t.confirming : t.confirm}
          </button>
        )}
        <Link className="btn ghost" href={inv.status === Status.Open ? payLink(row.address) : `/receipt/${row.address}`}>
          {inv.status === Status.Open ? t.paymentPage : t.receipt} <span className="arr" aria-hidden>→</span>
        </Link>
      </div>
      {tx.status !== "idle" && <TxNotice tx={tx} doneText={t.confirmed} />}
    </article>
  );
}
