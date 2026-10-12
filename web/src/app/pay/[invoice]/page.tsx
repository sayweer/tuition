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
import { useLang, useT, type Dict } from "@/lib/i18n";

type Tx = ReturnType<typeof useSendTx>;

type Copy = Record<
  | "invalid"
  | "loading"
  | "notFound"
  | "tuitionRequest"
  | "byAirmail"
  | "from"
  | "someUniversity"
  | "to"
  | "toFamily"
  | "locked"
  | "refunded"
  | "whereMoney"
  | "progress"
  | "openReceipt"
  | "verify"
  | "studentNumber"
  | "check"
  | "match"
  | "noMatch"
  | "noKey"
  | "yourPart"
  | "lockTitle"
  | "lockText"
  | "connectPay"
  | "partner"
  | "partnerHint"
  | "balance"
  | "usdgPre"
  | "usdgPost"
  | "askAdmin"
  | "locking"
  | "deadlinePassed"
  | "refundTitle"
  | "refundText"
  | "refunding"
  | "refund"
  | "connectRefund",
  string
> & {
  letterSub: (term: string, lira: string) => string;
  partnerOption: (n: number, addr: string) => string;
  notEnough: (symbol: string) => string;
  lock: (amount: string, symbol: string) => string;
};

const T: Dict<Copy> = {
  en: {
    invalid: "This payment link is not valid.",
    loading: "Loading the request…",
    notFound: "No tuition request exists at this link on devnet.",
    tuitionRequest: "Tuition request",
    byAirmail: "By airmail",
    from: "From",
    someUniversity: "A registered university",
    to: "To",
    toFamily: "the student's family",
    letterSub: (term, lira) => `${term} tuition, paid to the university as ${lira}`,
    locked: "Locked in escrow.",
    refunded: "Refunded to the family.",
    whereMoney: "Where the money is",
    progress: "Progress",
    openReceipt: "Open the receipt",
    verify: "Check this request is for your student",
    studentNumber: "Student number",
    check: "Check",
    match: "It matches. This request was issued for this student.",
    noMatch: "It does not match. Ask the university before you pay.",
    noKey: "Open the exact link the university sent you; it carries the key for this check.",
    yourPart: "Your part",
    lockTitle: "Lock the tuition",
    lockText:
      "The money goes into escrow, not to anyone. It is released to the payout partner only after the university confirms the lira arrived. If that has not happened by the deadline, it comes back to you.",
    connectPay: "Connect your wallet to pay.",
    partner: "Payout partner",
    partnerHint: "A licensed company that pays the university in lira.",
    partnerOption: (n, addr) => `Licensed partner ${n} (${addr})`,
    balance: "Your balance",
    notEnough: (symbol) => `Not enough ${symbol}.`,
    usdgPre: "Get test USDG at",
    usdgPost: ".",
    askAdmin: "Ask the demo admin for test dollars.",
    locking: "Locking…",
    lock: (amount, symbol) => `Lock ${amount} ${symbol}`,
    deadlinePassed: "Deadline passed",
    refundTitle: "The deadline passed with no payout",
    refundText:
      "The payout partner never reported sending lira. Anyone can return the full amount to the family wallet.",
    refunding: "Refunding…",
    refund: "Refund to the family",
    connectRefund: "Connect any wallet to send the refund.",
  },
  tr: {
    invalid: "Bu ödeme bağlantısı geçerli değil.",
    loading: "Talep yükleniyor…",
    notFound: "Devnet'te bu bağlantıya ait bir harç talebi yok.",
    tuitionRequest: "Harç talebi",
    byAirmail: "Uçak ile",
    from: "Gönderen",
    someUniversity: "Kayıtlı bir üniversite",
    to: "Alıcı",
    toFamily: "öğrencinin ailesi",
    letterSub: (term, lira) => `${term} dönemi harcı; üniversiteye ${lira} olarak ödenir`,
    locked: "Emanet hesabına kilitlendi.",
    refunded: "Aileye iade edildi.",
    whereMoney: "Para nerede",
    progress: "Süreç",
    openReceipt: "Makbuzu aç",
    verify: "Bu talebin öğrenciniz için olduğunu kontrol edin",
    studentNumber: "Öğrenci numarası",
    check: "Kontrol et",
    match: "Eşleşiyor. Bu talep bu öğrenci için oluşturulmuş.",
    noMatch: "Eşleşmiyor. Ödeme yapmadan önce üniversiteye danışın.",
    noKey: "Üniversitenin size gönderdiği bağlantının aynısını açın; bu kontrolün anahtarı o bağlantıda.",
    yourPart: "Sizin adımınız",
    lockTitle: "Harcı kilitleyin",
    lockText:
      "Para kimseye gitmez, emanet hesabına girer. Ödeme ortağına ancak üniversite liranın geldiğini onayladıktan sonra aktarılır. Son tarihe kadar bu gerçekleşmezse para size geri döner.",
    connectPay: "Ödemek için cüzdanınızı bağlayın.",
    partner: "Ödeme ortağı",
    partnerHint: "Üniversiteye lira olarak ödeme yapan lisanslı bir şirket.",
    partnerOption: (n, addr) => `Lisanslı ödeme ortağı ${n} (${addr})`,
    balance: "Bakiyeniz",
    notEnough: (symbol) => `${symbol} bakiyeniz yetersiz.`,
    usdgPre: "Test USDG'yi",
    usdgPost: " adresinden alabilirsiniz.",
    askAdmin: "Test doları için demo yöneticisine başvurun.",
    locking: "Kilitleniyor…",
    lock: (amount, symbol) => `${amount} ${symbol} kilitle`,
    deadlinePassed: "Son tarih geçti",
    refundTitle: "Son tarih ödeme yapılmadan geçti",
    refundText:
      "Ödeme ortağı lirayı gönderdiğini hiç bildirmedi. Tutarın tamamını aile cüzdanına herkes iade edebilir.",
    refunding: "İade ediliyor…",
    refund: "Aileye iade et",
    connectRefund: "İadeyi göndermek için herhangi bir cüzdanı bağlayın.",
  },
};

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
  const lang = useLang();
  const t = T[lang];

  if (!id) return <DeskNote problem>{t.invalid}</DeskNote>;
  if (invoice.isLoading) return <DeskNote>{t.loading}</DeskNote>;
  if (!invoice.data) return <DeskNote problem>{t.notFound}</DeskNote>;

  const inv = invoice.data;
  const symbol = mintSymbol(inv.mint);
  return (
    <main className="desk-page">
      <div className="pay-cols">
        <article className="paper airmail sheet letter tilt-l">
          <i className="clip brass" aria-hidden />
          <div className="letter-top">
            <p className="label">{t.tuitionRequest}</p>
            <span className="par-avion" aria-hidden>
              <b>Par avion</b>
              {t.byAirmail}
            </span>
          </div>
          <p className="label letter-from-label">{t.from}</p>
          <h1 className="letter-from">{school.data ?? t.someUniversity}</h1>
          <p className="letter-to">
            <span className="label">{t.to}</span>
            {t.toFamily}
          </p>
          <div className="letter-amount">
            <p className="big-amount">
              {formatAmount(inv.amount, lang)}
              <small>{symbol}</small>
            </p>
            <p className="letter-sub">
              {t.letterSub(formatTerm(inv.term, lang), formatTry(inv.amountTryKurus, lang))}
            </p>
            <div className="status-line">
              <StatusBadge status={inv.status} />{" "}
              {(inv.status === Status.Funded || inv.status === Status.Paid) && <Countdown invoice={inv} />}
            </div>
          </div>
          <VerifyStudent invoice={id} expected={inv.studentRefHash} />
        </article>

        <div className="pay-side">
          <Notice tx={lockTx} doneText={t.locked} />
          <Notice tx={refundTx} doneText={t.refunded} />
          {inv.status === Status.Open && <LockFunds id={id} inv={inv} tx={lockTx} onDone={() => invoice.mutate()} />}
          {inv.status === Status.Funded && (
            <RefundIfExpired id={id} inv={inv} tx={refundTx} onDone={() => invoice.mutate()} />
          )}
          <section className="paper sheet">
            <i className="clip" aria-hidden />
            <p className="label">{t.whereMoney}</p>
            <h2 className="sheet-title">{t.progress}</h2>
            <Timeline invoice={inv} history={history.data} />
            <div className="actions">
              <Link className="btn ghost" href={`/receipt/${id}`}>
                {t.openReceipt} <span className="arr" aria-hidden>→</span>
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
  const t = useT(T);

  async function check() {
    // the salt travels only in the link's #fragment, which never reaches a server or the chain
    const salt = linkSalt(window.location.hash);
    if (!salt) return setResult("no-key");
    setResult(toHex(await studentRefHash(invoice, ref, salt)) === toHex(expected));
  }

  return (
    <details className="verify">
      <summary>{t.verify}</summary>
      <div className="verify-row">
        <Field label={t.studentNumber}>
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
          {t.check}
        </button>
      </div>
      {result === true && <p className="notice notice-ok">{t.match}</p>}
      {result === false && <p className="notice notice-error">{t.noMatch}</p>}
      {result === "no-key" && <p className="notice notice-error">{t.noKey}</p>}
    </details>
  );
}

function LockFunds({ id, inv, tx, onDone }: { id: Address; inv: Invoice; tx: Tx; onDone: () => void }) {
  const client = useApp();
  const me = useWalletAddress();
  const config = useConfig();
  const lang = useLang();
  const t = T[lang];
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
      <p className="label">{t.yourPart}</p>
      <h2 className="sheet-title">{t.lockTitle}</h2>
      <p className="sheet-text">{t.lockText}</p>
      {!me ? (
        <ConnectPrompt>{t.connectPay}</ConnectPrompt>
      ) : (
        <>
          <div className="fields stacked">
            <Field label={t.partner} hint={t.partnerHint}>
              <select value={chosen} onChange={(e) => setOffice(e.target.value as Address)}>
                {offices.map((o, i) => (
                  <option key={o} value={o}>
                    {t.partnerOption(i + 1, shortAddress(o))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.balance}>
              <span className="field-value">
                {balance.data === undefined ? "…" : `${formatAmount(balance.data, lang)} ${symbol}`}
              </span>
            </Field>
          </div>
          {short && (
            <p className="notice notice-error">
              {t.notEnough(symbol)}{" "}
              {symbol === "USDG" ? (
                <>
                  {t.usdgPre}{" "}
                  <a href="https://faucet.paxos.com" target="_blank" rel="noreferrer">
                    faucet.paxos.com
                  </a>
                  {t.usdgPost}
                </>
              ) : (
                t.askAdmin
              )}
            </p>
          )}
          <div className="actions">
            <button className="btn" onClick={lock} disabled={!chosen || short || tx.status === "pending"}>
              {tx.status === "pending" ? t.locking : t.lock(formatAmount(inv.amount, lang), symbol)}
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
  const t = useT(T);
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
      <p className="label">{t.deadlinePassed}</p>
      <h2 className="sheet-title">{t.refundTitle}</h2>
      <p className="sheet-text">{t.refundText}</p>
      {me ? (
        <div className="actions">
          <button className="btn danger" onClick={refund} disabled={tx.status === "pending"}>
            {tx.status === "pending" ? t.refunding : t.refund}
          </button>
        </div>
      ) : (
        <ConnectPrompt>{t.connectRefund}</ConnectPrompt>
      )}
    </section>
  );
}
