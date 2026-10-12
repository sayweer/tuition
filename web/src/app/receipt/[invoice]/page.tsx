"use client";

import { useParams } from "next/navigation";
import { isAddress, type Address } from "@solana/kit";
import { Stamp } from "@/components/stamp";
import { AddressLink, DeskNote, StatusBadge, Timeline } from "@/components/ui";
import { explorerAddress, mintSymbol } from "@/lib/constants";
import { Status, formatAmount, formatDateTime, formatTerm, formatTry, toHex, type Invoice } from "@/lib/escrow";
import { useHistory, useInvoice, usePayeeName } from "@/lib/hooks";
import { useLang, useT, type Dict } from "@/lib/i18n";

type Copy = Record<
  | "invalid"
  | "loading"
  | "notFound"
  | "someUniversity"
  | "financeOffice"
  | "tuitionReceipt"
  | "refundRecord"
  | "inProgress"
  | "receiptNumber"
  | "tuition"
  | "payee"
  | "payer"
  | "notPaid"
  | "partner"
  | "chosenAtPayment"
  | "issued"
  | "locked"
  | "settled"
  | "notYet"
  | "studentRef"
  | "bankReceipt"
  | "notReported"
  | "record"
  | "footPre"
  | "footPost"
  | "print"
  | "paymentPage"
  | "stampOffice"
  | "stampReceived"
  | "stampSigned"
  | "stampEscrow"
  | "stampDeadline"
  | "stampRefunded"
  | "stampReturned"
  | "stampRuling"
  | "stampSettled"
  | "stampToPartner",
  string
> & {
  paidAs: (lira: string) => string;
  returnedQuote: (lira: string) => string;
  quote: (lira: string) => string;
};

// Turkish stamp text is written in capitals here: the stamp upper-cases with the default locale,
// which would turn "i" into "I" instead of "İ".
const T: Dict<Copy> = {
  en: {
    invalid: "This receipt link is not valid.",
    loading: "Loading the receipt…",
    notFound: "No receipt exists at this address on devnet.",
    someUniversity: "Registered university",
    financeOffice: "Finance office",
    tuitionReceipt: "Tuition receipt",
    refundRecord: "Refund record",
    inProgress: "Tuition request in progress",
    receiptNumber: "Receipt number",
    tuition: "tuition",
    paidAs: (lira) => `Paid to the university's bank as ${lira}`,
    returnedQuote: (lira) => `Returned to the family (lira quote was ${lira})`,
    quote: (lira) => `Lira quote ${lira}`,
    payee: "University (payee)",
    payer: "Family wallet (payer)",
    notPaid: "Not paid yet",
    partner: "Payout partner",
    chosenAtPayment: "Chosen at payment",
    issued: "Issued",
    locked: "Locked in escrow",
    settled: "Settled",
    notYet: "Not yet",
    studentRef: "Student reference (salted SHA-256, no personal data on-chain)",
    bankReceipt: "Bank transfer receipt (SHA-256 posted by the payout partner)",
    notReported: "Not reported",
    record: "Record",
    footPre: "This receipt is the Solana account",
    footPost: "on devnet. Anyone can verify it without trusting this website.",
    print: "Print receipt",
    paymentPage: "Payment page",
    stampOffice: "finance office",
    stampReceived: "RECEIVED",
    stampSigned: "signed by the university",
    stampEscrow: "Escrow",
    stampDeadline: "deadline passed",
    stampRefunded: "REFUNDED",
    stampReturned: "returned to the family",
    stampRuling: "arbiter ruling",
    stampSettled: "SETTLED",
    stampToPartner: "released to the partner",
  },
  tr: {
    invalid: "Bu makbuz bağlantısı geçerli değil.",
    loading: "Makbuz yükleniyor…",
    notFound: "Devnet'te bu adreste bir makbuz yok.",
    someUniversity: "Kayıtlı üniversite",
    financeOffice: "Mali işler ofisi",
    tuitionReceipt: "Harç makbuzu",
    refundRecord: "İade kaydı",
    inProgress: "Harç talebi sürüyor",
    receiptNumber: "Makbuz numarası",
    tuition: "dönemi harcı",
    paidAs: (lira) => `Üniversitenin bankasına ${lira} olarak ödendi`,
    returnedQuote: (lira) => `Aileye iade edildi (lira karşılığı ${lira} idi)`,
    quote: (lira) => `Lira karşılığı ${lira}`,
    payee: "Üniversite (alıcı)",
    payer: "Aile cüzdanı (ödeyen)",
    notPaid: "Henüz ödenmedi",
    partner: "Ödeme ortağı",
    chosenAtPayment: "Ödeme sırasında seçilir",
    issued: "Oluşturuldu",
    locked: "Emanete kilitlendi",
    settled: "Sonuçlandı",
    notYet: "Henüz değil",
    studentRef: "Öğrenci referansı (tuzlanmış SHA-256; zincirde kişisel veri yok)",
    bankReceipt: "Banka dekontu (ödeme ortağının zincire yazdığı SHA-256)",
    notReported: "Bildirilmedi",
    record: "Kayıt",
    footPre: "Bu makbuz, devnet'teki",
    footPost: "Solana hesabıdır. Herkes bu siteye güvenmek zorunda kalmadan doğrulayabilir.",
    print: "Makbuzu yazdır",
    paymentPage: "Ödeme sayfası",
    stampOffice: "MALİ İŞLER OFİSİ",
    stampReceived: "TAHSİL EDİLDİ",
    stampSigned: "ÜNİVERSİTE İMZALADI",
    stampEscrow: "EMANET",
    stampDeadline: "SON TARİH GEÇTİ",
    stampRefunded: "İADE EDİLDİ",
    stampReturned: "AİLEYE GERİ GÖNDERİLDİ",
    stampRuling: "HAKEM KARARI",
    stampSettled: "KARARA BAĞLANDI",
    stampToPartner: "ÖDEME ORTAĞINA AKTARILDI",
  },
};

function StampFor({ inv, school }: { inv: Invoice; school: string }) {
  const t = useT(T);
  const ring = `${school} ★ ${t.stampOffice} ★ `;
  switch (inv.status) {
    case Status.Released:
      return <Stamp ring={ring} center={t.stampReceived} sub={t.stampSigned} />;
    case Status.Refunded:
      return (
        <Stamp
          ring={`${t.stampEscrow} ★ ${t.stampDeadline} ★ `}
          center={t.stampRefunded}
          sub={t.stampReturned}
          tone="back"
        />
      );
    case Status.Resolved:
      return (
        <Stamp
          ring={`${t.stampEscrow} ★ ${t.stampRuling} ★ `}
          center={t.stampSettled}
          sub={inv.resolvedToOffice ? t.stampToPartner : t.stampReturned}
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
  const lang = useLang();
  const t = T[lang];

  if (!id) return <DeskNote problem>{t.invalid}</DeskNote>;
  if (invoice.isLoading) return <DeskNote>{t.loading}</DeskNote>;
  if (!invoice.data) return <DeskNote problem>{t.notFound}</DeskNote>;

  const inv = invoice.data;
  const name = school.data ?? t.someUniversity;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const symbol = mintSymbol(inv.mint);
  // Only a release (or a ruling for the partner) means the university was paid; a refund is not a receipt.
  const paidToSchool = inv.status === Status.Released || (inv.status === Status.Resolved && inv.resolvedToOffice);
  const returned = inv.status === Status.Refunded || (inv.status === Status.Resolved && !inv.resolvedToOffice);
  const unset = (a: string) => a === "11111111111111111111111111111111";
  const time = (secs: bigint) => (secs > 0n ? formatDateTime(secs, lang) : t.notYet);

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
              {t.financeOffice} · {paidToSchool ? t.tuitionReceipt : returned ? t.refundRecord : t.inProgress}
            </p>
          </div>
          <div className="rcpt-no">
            <p className="label">{t.receiptNumber}</p>
            <p className="rcpt-num">{id.slice(0, 8).toUpperCase()}</p>
          </div>
        </header>

        <div className="rcpt-body">
          <div>
            <p className="label">
              {formatTerm(inv.term, lang)} {t.tuition}
            </p>
            <p className="rcpt-amount">
              {formatAmount(inv.deposited > 0n ? inv.deposited : inv.amount, lang)}
              <small>{symbol}</small>
            </p>
            <p className="rcpt-try">
              {paidToSchool
                ? t.paidAs(formatTry(inv.amountTryKurus, lang))
                : returned
                  ? t.returnedQuote(formatTry(inv.amountTryKurus, lang))
                  : t.quote(formatTry(inv.amountTryKurus, lang))}
            </p>
            <div className="status-line">
              <StatusBadge status={inv.status} />
            </div>
          </div>
          <StampFor inv={inv} school={name} />
        </div>

        <dl className="rcpt-grid">
          <div>
            <dt>{t.payee}</dt>
            <dd>
              <AddressLink address={inv.payee} />
            </dd>
          </div>
          <div>
            <dt>{t.payer}</dt>
            <dd>{unset(inv.payer) ? t.notPaid : <AddressLink address={inv.payer} />}</dd>
          </div>
          <div>
            <dt>{t.partner}</dt>
            <dd>{unset(inv.office) ? t.chosenAtPayment : <AddressLink address={inv.office} />}</dd>
          </div>
          <div>
            <dt>{t.issued}</dt>
            <dd>{time(inv.createdAt)}</dd>
          </div>
          <div>
            <dt>{t.locked}</dt>
            <dd>{time(inv.fundedAt)}</dd>
          </div>
          <div>
            <dt>{t.settled}</dt>
            <dd>{time(inv.settledAt)}</dd>
          </div>
          <div className="wide">
            <dt>{t.studentRef}</dt>
            <dd className="hash">{toHex(inv.studentRefHash)}</dd>
          </div>
          <div className="wide">
            <dt>{t.bankReceipt}</dt>
            <dd className="hash">
              {inv.bankReceiptHash.every((b) => b === 0) ? t.notReported : toHex(inv.bankReceiptHash)}
            </dd>
          </div>
        </dl>

        <section className="rcpt-record">
          <h2 className="label">{t.record}</h2>
          <Timeline invoice={inv} history={history.data} />
        </section>

        <p className="rcpt-foot">
          {t.footPre}{" "}
          <a className="hash" href={explorerAddress(id)} target="_blank" rel="noreferrer">
            {id}
          </a>{" "}
          {t.footPost}
        </p>
      </article>
      <div className="desk-actions no-print">
        <button className="btn paperbtn" onClick={() => window.print()}>
          {t.print}
        </button>
        {inv.status === Status.Open && (
          <a className="btn ghost" href={`/pay/${id}`}>
            {t.paymentPage} <span className="arr" aria-hidden>→</span>
          </a>
        )}
      </div>
    </main>
  );
}
