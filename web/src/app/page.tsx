import Link from "next/link";
import { Stamp } from "@/components/stamp";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <h1 className="page-title">Tuition from abroad, paid in lira, signed by the university.</h1>
          <p className="lede">
            A family outside Türkiye locks the tuition in USDG. A licensed payout partner sends lira to the
            university&apos;s bank. The money leaves escrow only when the university confirms it with its own key,
            and that confirmation stays on Solana as a receipt anyone can check.
          </p>
          <div className="actions">
            <Link className="btn btn-primary" href="/school">
              Open the university desk
            </Link>
            <Link className="btn btn-quiet" href="/office">
              Payout partner queue
            </Link>
          </div>
        </div>
        <div className="receipt" aria-hidden>
          <div className="receipt-head">
            <div>
              <p className="muted">Tuition receipt</p>
              <p className="row-title">Fall 2026</p>
            </div>
            <p className="muted">Example University</p>
          </div>
          <div className="receipt-body">
            <div>
              <p className="receipt-amount">300.00</p>
              <p className="row-title">USDG</p>
              <p className="muted">≈ ₺12,000.00 paid to the university&apos;s bank</p>
            </div>
            <Stamp ring="Example University ★ finance office ★ " center="Received" sub="signed on Solana" />
          </div>
        </div>
      </section>

      <h2 className="section-title">How a payment moves</h2>
      <ol className="flow">
        <li>
          <strong>The university issues a request.</strong>
          <p className="muted">Amount, term and a hashed student reference. It gets a link and a QR code to send.</p>
        </li>
        <li>
          <strong>The family locks the tuition.</strong>
          <p className="muted">USDG goes into escrow, not to anyone. A deadline starts.</p>
        </li>
        <li>
          <strong>The payout partner sends lira.</strong>
          <p className="muted">FAST/EFT to the university&apos;s bank, then it records the receipt hash.</p>
        </li>
        <li>
          <strong>The university confirms.</strong>
          <p className="muted">Its own signature releases escrow to the partner and seals the receipt.</p>
        </li>
      </ol>

      <h2 className="section-title">If something goes wrong</h2>
      <div className="form-grid">
        <p className="muted">
          <strong className="row-title" style={{ color: "var(--ink)" }}>
            Nobody pays out before the deadline.
          </strong>{" "}
          Anyone can return the full amount to the family.
        </p>
        <p className="muted">
          <strong className="row-title" style={{ color: "var(--ink)" }}>
            The partner says it paid, the university says nothing.
          </strong>{" "}
          The money stays frozen until the arbiter decides. It never goes to the partner by default.
        </p>
      </div>

      <h2 className="section-title">Open your desk</h2>
      <div className="roles">
        <Link href="/school">
          <strong>University finance office</strong>
          <span className="muted">Issue requests and confirm receipts</span>
        </Link>
        <Link href="/office">
          <strong>Payout partner</strong>
          <span className="muted">See locked tuition and report lira sent</span>
        </Link>
        <Link href="/arbiter">
          <strong>Arbiter</strong>
          <span className="muted">Settle requests the university did not confirm</span>
        </Link>
      </div>
      <p className="muted" style={{ marginTop: "1rem" }}>
        Families open the payment link the university sends them.
      </p>
    </>
  );
}
