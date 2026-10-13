"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isAddress, type Address } from "@solana/kit";
import useSWR from "swr";
import { CloseFailed, Contributions, FundingBar } from "@/components/funding";
import { ConnectPrompt, Countdown, DeskNote, Field, StatusBadge, Timeline, TxNotice } from "@/components/ui";
import { contributeIxs } from "@/lib/actions";
import { mintSymbol } from "@/lib/constants";
import {
  Status,
  formatAmount,
  formatTerm,
  formatTry,
  isFundingOpen,
  linkSalt,
  parseAmount,
  remainingOf,
  shortAddress,
  studentRefHash,
  tokenBalance,
  toHex,
  type Invoice,
} from "@/lib/escrow";
import { useApp, useHistory, useInvoice, useNow, usePayeeName, useSendTx, useWalletAddress, type TxState } from "@/lib/hooks";
import { useLang, useT, type Dict } from "@/lib/i18n";

type Tx = ReturnType<typeof useSendTx>;

type Copy = Record<
  | "invalid"
  | "loading"
  | "notFound"
  | "rpcDown"
  | "retry"
  | "tuitionRequest"
  | "byAirmail"
  | "from"
  | "someUniversity"
  | "to"
  | "toFamily"
  | "locked"
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
  | "shareText"
  | "connectPay"
  | "ownRequest"
  | "amount"
  | "amountHint"
  | "badAmount"
  | "partner"
  | "balance"
  | "usdgPre"
  | "usdgPost"
  | "askAdmin"
  | "locking",
  string
> & {
  letterSub: (term: string, lira: string) => string;
  notEnough: (symbol: string) => string;
  lock: (amount: string, symbol: string) => string;
  tooMuch: (max: string, symbol: string) => string;
};

const T: Dict<Copy> = {
  en: {
    invalid: "This payment link is not valid.",
    loading: "Loading the request…",
    notFound: "No tuition request exists at this link on devnet.",
    rpcDown: "Could not reach devnet. Retrying…",
    retry: "Try again",
    tuitionRequest: "Tuition request",
    byAirmail: "By airmail",
    from: "From",
    someUniversity: "A registered university",
    to: "To",
    toFamily: "the student's family",
    letterSub: (term, lira) => `${term} tuition, paid to the university as ${lira}`,
    locked: "Your payment is in escrow.",
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
    lockTitle: "Pay the tuition",
    lockText:
      "The money goes into escrow, not to anyone. It is released only after the university confirms the lira arrived. If the request does not go through, your payment comes back to your wallet.",
    shareText:
      "You can pay all of it or only a part. Relatives or a sponsor can add the rest with this same link.",
    connectPay: "Connect your wallet to pay.",
    ownRequest:
      "The university and its payout partner cannot contribute to their own request. Send this link to the family.",
    amount: "Amount",
    amountHint: "Up to what is still missing.",
    badAmount: "Enter an amount above zero.",
    tooMuch: (max, symbol) => `Only ${max} ${symbol} is still missing.`,
    partner: "Payout partner",
    balance: "Your balance",
    notEnough: (symbol) => `Not enough ${symbol}.`,
    usdgPre: "Get test USDG at",
    usdgPost: ".",
    askAdmin: "Ask the demo admin for test dollars.",
    locking: "Paying…",
    lock: (amount, symbol) => `Pay ${amount} ${symbol} into escrow`,
  },
  tr: {
    invalid: "Bu ödeme bağlantısı geçerli değil.",
    loading: "Talep yükleniyor…",
    notFound: "Devnet'te bu bağlantıya ait bir harç talebi yok.",
    rpcDown: "Devnet'e ulaşılamadı. Yeniden deneniyor…",
    retry: "Tekrar dene",
    tuitionRequest: "Harç talebi",
    byAirmail: "Uçak ile",
    from: "Gönderen",
    someUniversity: "Kayıtlı bir üniversite",
    to: "Alıcı",
    toFamily: "öğrencinin ailesi",
    letterSub: (term, lira) => `${term} dönemi harcı; üniversiteye ${lira} olarak ödenir`,
    locked: "Ödemeniz emanet hesabında.",
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
    lockTitle: "Harcı ödeyin",
    lockText:
      "Para kimseye gitmez, emanet hesabına girer. Ancak üniversite liranın geldiğini onayladıktan sonra aktarılır. Talep gerçekleşmezse ödemeniz cüzdanınıza geri döner.",
    shareText:
      "Tamamını ya da bir kısmını ödeyebilirsiniz. Kalanı akrabalarınız ya da bir destekçi aynı bağlantıyla tamamlayabilir.",
    connectPay: "Ödemek için cüzdanınızı bağlayın.",
    ownRequest: "Üniversite ve ödeme ortağı kendi taleplerine katkı yapamaz. Bu bağlantıyı aileye gönderin.",
    amount: "Tutar",
    amountHint: "En fazla eksik kalan kadar.",
    badAmount: "Sıfırdan büyük bir tutar girin.",
    tooMuch: (max, symbol) => `Eksik kalan yalnızca ${max} ${symbol}.`,
    partner: "Ödeme ortağı",
    balance: "Bakiyeniz",
    notEnough: (symbol) => `${symbol} bakiyeniz yetersiz.`,
    usdgPre: "Test USDG'yi",
    usdgPost: " adresinden alabilirsiniz.",
    askAdmin: "Test doları için demo yöneticisine başvurun.",
    locking: "Ödeniyor…",
    lock: (amount, symbol) => `${amount} ${symbol} emanete öde`,
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
  const lang = useLang();
  const t = T[lang];

  if (!id) return <DeskNote problem>{t.invalid}</DeskNote>;
  // a failed fetch is not a missing account: SWR keeps retrying, so say so instead of "not found"
  if (invoice.error && !invoice.data)
    return (
      <DeskNote problem>
        {t.rpcDown}{" "}
        <button className="btn paperbtn" onClick={() => invoice.mutate()}>
          {t.retry}
        </button>
      </DeskNote>
    );
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
              <StatusBadge status={inv.status} invoice={inv} />{" "}
              {inv.status === Status.Funded && <Countdown invoice={inv} />}
            </div>
            <FundingBar inv={inv} />
          </div>
          <VerifyStudent invoice={id} expected={inv.studentRefHash} />
        </article>

        <div className="pay-side">
          <Notice tx={lockTx} doneText={t.locked} />
          {inv.status === Status.Open && <Contribute id={id} inv={inv} tx={lockTx} onDone={() => invoice.mutate()} />}
          <CloseFailed id={id} inv={inv} onDone={() => invoice.mutate()} />
          <Contributions id={id} inv={inv} />
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

function Contribute({ id, inv, tx, onDone }: { id: Address; inv: Invoice; tx: Tx; onDone: () => void }) {
  const client = useApp();
  const me = useWalletAddress();
  const now = useNow();
  const lang = useLang();
  const t = T[lang];
  const missing = remainingOf(inv);
  const [text, setText] = useState("");
  // the program rejects contributions from the request's own university or partner (6008)
  const own = me === inv.payee || me === inv.office;
  const balance = useSWR(me && !own ? ["balance", me, inv.mint, tx.status] : null, () =>
    tokenBalance(client.rpc, me as Address, inv.mint),
  );
  const symbol = mintSymbol(inv.mint);
  // empty field means "all that is missing"; it follows the target as others contribute
  const amount = text.trim() ? parseAmount(text, lang) : missing;
  const invalid = amount === null || amount <= 0n;
  const over = !invalid && amount > missing;
  const short = !invalid && balance.data !== undefined && balance.data < amount;

  // past the collecting deadline, CloseFailed takes over this spot
  if (!isFundingOpen(inv, now)) return null;

  async function pay() {
    if (invalid || over) return;
    const sig = await tx.send(() => contributeIxs(client, id, inv, amount as bigint, false));
    if (sig) {
      setText("");
      onDone();
    }
  }

  return (
    <section className="paper sheet tilt-r">
      <i className="clip brass" aria-hidden />
      <p className="label">{t.yourPart}</p>
      <h2 className="sheet-title">{t.lockTitle}</h2>
      <p className="sheet-text">{t.lockText}</p>
      <p className="sheet-text">{t.shareText}</p>
      {!me ? (
        <ConnectPrompt>{t.connectPay}</ConnectPrompt>
      ) : own ? (
        <p className="notice">{t.ownRequest}</p>
      ) : (
        <>
          <div className="fields stacked">
            <Field label={`${t.amount} (${symbol})`} hint={t.amountHint}>
              <input
                inputMode="decimal"
                value={text}
                placeholder={formatAmount(missing, lang)}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            <Field label={t.partner}>
              <span className="field-value hash">{shortAddress(inv.office)}</span>
            </Field>
            <Field label={t.balance}>
              <span className="field-value">
                {balance.data === undefined ? "…" : `${formatAmount(balance.data, lang)} ${symbol}`}
              </span>
            </Field>
          </div>
          {text.trim() !== "" && invalid && <p className="notice notice-error">{t.badAmount}</p>}
          {over && <p className="notice notice-error">{t.tooMuch(formatAmount(missing, lang), symbol)}</p>}
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
            <button className="btn" onClick={pay} disabled={invalid || over || short || tx.status === "pending"}>
              {tx.status === "pending" ? t.locking : t.lock(formatAmount(invalid ? 0n : (amount as bigint), lang), symbol)}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
