"use client";

import { useParams } from "next/navigation";
import { isAddress, type Address } from "@solana/kit";
import { Stamp } from "@/components/stamp";
import { CloseFailed, Contributions } from "@/components/funding";
import { AddressLink, DeskNote, StatusBadge, Timeline } from "@/components/ui";
import { explorerAddress, mintSymbol } from "@/lib/constants";
import { Status, formatAmount, formatDateTime, formatTerm, formatTry, toHex, type Invoice } from "@/lib/escrow";
import { useContributions, useHistory, useInvoice, usePayeeName } from "@/lib/hooks";
import { useLang, useT, type Dict } from "@/lib/i18n";

type Copy = Record<
  | "invalid"
  | "loading"
  | "notFound"
  | "someUniversity"
  | "financeOffice"
  | "tuitionReceipt"
  | "closedRecord"
  | "inProgress"
  | "receiptNumber"
  | "tuition"
  | "payee"
  | "payer"
  | "notPaid"
  | "partner"
  | "issued"
  | "locked"
  | "settled"
  | "notYet"
  | "never"
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
  | "stampGoesBack"
  | "stampWentBack"
  | "stampNothingRaised"
  | "stampRuling"
  | "stampSettled"
  | "stampToPartner"
  | "stampUnfunded",
  string
> & {
  givers: (n: number) => string;
  paidAs: (lira: string) => string;
  goesBack: (raised: string, symbol: string, lira: string) => string;
  wentBack: (raised: string, symbol: string, lira: string) => string;
  nothingRaised: (lira: string) => string;
  raisedSoFar: (raised: string, symbol: string) => string;
  quote: (lira: string) => string;
};

// The stamp upper-cases with the UI locale; the Turkish strings are written in capitals anyway.
const T: Dict<Copy> = {
  en: {
    invalid: "This receipt link is not valid.",
    loading: "Loading the receipt…",
    notFound: "No receipt exists at this address on devnet.",
    someUniversity: "Registered university",
    financeOffice: "Finance office",
    tuitionReceipt: "Tuition receipt",
    closedRecord: "Closed without payout",
    inProgress: "Tuition request in progress",
    receiptNumber: "Receipt number",
    tuition: "tuition",
    paidAs: (lira) => `Paid to the university's bank as ${lira}`,
    goesBack: (raised, symbol, lira) =>
      `${raised} ${symbol} raised; each contribution goes back to its giver or to the scholarship pool, as they chose (lira quote was ${lira})`,
    wentBack: (raised, symbol, lira) =>
      `${raised} ${symbol} raised; every contribution went back to its giver or to the scholarship pool, as they chose (lira quote was ${lira})`,
    nothingRaised: (lira) => `Nothing was raised (lira quote was ${lira})`,
    raisedSoFar: (raised, symbol) => `${raised} ${symbol} raised so far`,
    quote: (lira) => `Lira quote ${lira}`,
    payee: "University (payee)",
    payer: "Raised from",
    notPaid: "No contributions yet",
    givers: (n) => (n === 1 ? "1 contribution" : `${n} contributions`),
    partner: "Payout partner",
    issued: "Issued",
    locked: "Fully funded",
    settled: "Settled",
    notYet: "Not yet",
    never: "Never",
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
    stampGoesBack: "goes back to givers or the pool",
    stampWentBack: "sent back to givers or the pool",
    stampNothingRaised: "nothing was raised",
    stampUnfunded: "NOT FUNDED",
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
    closedRecord: "Ödeme yapılmadan kapandı",
    inProgress: "Harç talebi sürüyor",
    receiptNumber: "Makbuz numarası",
    tuition: "dönemi harcı",
    paidAs: (lira) => `Üniversitenin bankasına ${lira} olarak ödendi`,
    goesBack: (raised, symbol, lira) =>
      `${raised} ${symbol} toplandı; her katkı, sahibinin seçtiği yere döner: kendi cüzdanı ya da burs havuzu (lira karşılığı ${lira} idi)`,
    wentBack: (raised, symbol, lira) =>
      `${raised} ${symbol} toplandı; her katkı, sahibinin seçtiği yere döndü: kendi cüzdanı ya da burs havuzu (lira karşılığı ${lira} idi)`,
    nothingRaised: (lira) => `Hiç katkı toplanmadı (lira karşılığı ${lira} idi)`,
    raisedSoFar: (raised, symbol) => `Şimdiye kadar ${raised} ${symbol} toplandı`,
    quote: (lira) => `Lira karşılığı ${lira}`,
    payee: "Üniversite (alıcı)",
    payer: "Toplanan katkı",
    notPaid: "Henüz katkı yok",
    givers: (n) => `${n} katkı`,
    partner: "Ödeme ortağı",
    issued: "Oluşturuldu",
    locked: "Tamamı toplandı",
    settled: "Sonuçlandı",
    notYet: "Henüz değil",
    never: "Hiç",
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
    stampGoesBack: "SAHİBİNE YA DA HAVUZA DÖNER",
    stampWentBack: "SAHİBİNE YA DA HAVUZA DÖNDÜ",
    stampNothingRaised: "KATKI TOPLANMADI",
    stampUnfunded: "TAMAMLANMADI",
    stampRuling: "HAKEM KARARI",
    stampSettled: "KARARA BAĞLANDI",
    stampToPartner: "ÖDEME ORTAĞINA AKTARILDI",
  },
};

function StampFor({ inv, school, allSettled }: { inv: Invoice; school: string; allSettled: boolean }) {
  const t = useT(T);
  // Case the on-chain name by its own language, not the UI's: "University" must not become "UNİVERSİTY".
  const name = /[çğıöşüÇĞİÖŞÜ]/.test(school) ? school.toLocaleUpperCase("tr-TR") : school.toUpperCase();
  const ring = `${name} ★ ${t.stampOffice} ★ `;
  // A failure only flips the status; the money moves later, one contribution at a time.
  const back = inv.contributions === 0 ? t.stampNothingRaised : allSettled ? t.stampWentBack : t.stampGoesBack;
  switch (inv.status) {
    case Status.Released:
      return <Stamp ring={ring} center={t.stampReceived} sub={t.stampSigned} />;
    case Status.Refunded:
      return (
        <Stamp
          ring={`${t.stampEscrow} ★ ${t.stampDeadline} ★ `}
          center={t.stampRefunded}
          sub={back}
          tone="back"
        />
      );
    case Status.Expired:
      return (
        <Stamp
          ring={`${t.stampEscrow} ★ ${t.stampDeadline} ★ `}
          center={t.stampUnfunded}
          sub={back}
          tone="back"
        />
      );
    case Status.Resolved:
      return (
        <Stamp
          ring={`${t.stampEscrow} ★ ${t.stampRuling} ★ `}
          center={t.stampSettled}
          sub={inv.resolvedToOffice ? t.stampToPartner : back}
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
  // Same key as the Contributions sheet below, so both read one fetch.
  const givers = useContributions(invoice.data ? id : null, `${invoice.data?.raised}-${invoice.data?.status}`);
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
  const returned =
    inv.status === Status.Refunded ||
    inv.status === Status.Expired ||
    (inv.status === Status.Resolved && !inv.resolvedToOffice);
  const allSettled = !!givers.data?.length && givers.data.every((c) => c.data.settled);
  const time = (secs: bigint) => (secs > 0n ? formatDateTime(secs, lang) : t.notYet);
  const lira = formatTry(inv.amountTryKurus, lang);
  const raised = formatAmount(inv.raised, lang);

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
              {t.financeOffice} · {paidToSchool ? t.tuitionReceipt : returned ? t.closedRecord : t.inProgress}
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
              {formatAmount(inv.amount, lang)}
              <small>{symbol}</small>
            </p>
            <p className="rcpt-try">
              {paidToSchool
                ? t.paidAs(lira)
                : returned
                  ? inv.contributions === 0
                    ? t.nothingRaised(lira)
                    : (allSettled ? t.wentBack : t.goesBack)(raised, symbol, lira)
                  : t.quote(lira)}
            </p>
            {!paidToSchool && !returned && inv.raised < inv.amount && (
              <p className="rcpt-try">{t.raisedSoFar(raised, symbol)}</p>
            )}
            <div className="status-line">
              <StatusBadge status={inv.status} invoice={inv} />
            </div>
          </div>
          <StampFor inv={inv} school={name} allSettled={allSettled} />
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
            <dd>{inv.contributions === 0 ? t.notPaid : t.givers(inv.contributions)}</dd>
          </div>
          <div>
            <dt>{t.partner}</dt>
            <dd>
              <AddressLink address={inv.office} />
            </dd>
          </div>
          <div>
            <dt>{t.issued}</dt>
            <dd>{time(inv.createdAt)}</dd>
          </div>
          <div>
            <dt>{t.locked}</dt>
            <dd>{inv.fundedAt === 0n && inv.status !== Status.Open ? t.never : time(inv.fundedAt)}</dd>
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
      <div className="no-print rcpt-givers">
        <CloseFailed id={id} inv={inv} onDone={() => invoice.mutate()} />
        <Contributions id={id} inv={inv} />
      </div>
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
