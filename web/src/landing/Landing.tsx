"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import Link from "next/link";
import { explorerAddress } from "@/lib/constants";
import { initLanding } from "./engine";
import { useLang, useT } from "@/lib/i18n";
import { STRINGS } from "./strings";
import "@/styles/landing.css";

const PROGRAM = "E2cES7pe38nkQk1a9J7BXkP3htCAueFsE3TrZCHnRh1A";

type CardStyle = CSSProperties & { "--r": string };
/** Position on the desk and resting tilt of a document. */
const at = (left: string | null, top: string | null, r: string): CardStyle => ({
  ...(left ? { left } : {}),
  ...(top ? { top } : {}),
  "--r": r,
});

/** Remounts the whole desk when the language changes, so every scene rebuilds from the new text. */
export function Landing() {
  const lang = useLang();
  return <Desk key={lang} />;
}

function Desk() {
  const root = useRef<HTMLDivElement>(null);
  const L = useT(STRINGS);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    return initLanding(el);
  }, []);

  const c = L.card;
  return (
    <div className="landing" ref={root} data-coin-usdg={L.so.beads.lock} data-coin-lira={L.so.beads.lira}>
      {/* 1 · HERO: a tuition link, escrow in the middle, lira to the university */}
      <section className="scene" id="hero" data-scene="hero">
        <div className="stage">
          <canvas className="routes" />
          <div className="hero-copy">
            <span className="eyebrow">{L.hero.eyebrow}</span>
            <h1>
              <span className="line"><span>{L.hero.l1}</span></span>
              <span className="line"><span>{L.hero.l2}</span></span>
              <span className="line"><span><em>{L.hero.l3}</em></span></span>
            </h1>
            <p className="lede">{L.hero.lede}</p>
            <div className="btnrow">
              <Link className="btn" href="/school">{L.hero.start} <span className="arr">→</span></Link>
              <a className="btn ghost" href="#but">{L.hero.see} <span className="arr">↓</span></a>
            </div>
          </div>

          <div className="doc paper airmail hc" id="hFamily" data-depth="1.25" style={at("56vw", "11vh", "-2.5deg")}>
            <i className="clip brass" />
            <span className="label">{c.family}</span>
            <div className="dname">{c.familyName}</div>
            <span className="paylink">{c.link} ↗</span>
          </div>
          <div className="doc paper invoice hc" id="hInvoice" data-depth=".9" style={at("77vw", "12vh", "2deg")}>
            <i className="clip" />
            <span className="label">{c.invoice}</span>
            <h4>{c.invoiceFor}</h4>
            <div className="mono-amt">{c.invoiceAmt}</div>
            <div className="who"><span className="chip">{c.deadline}</span><span className="chip">{c.hashed}</span></div>
          </div>
          <div className="doc paper kraft vault hc" id="hEscrow" data-depth="1.1" style={at("64vw", "40vh", "1.5deg")}>
            <i className="clip" />
            <span className="label">{c.escrow}</span>
            <div className="amount">{c.escrowAmt}</div>
          </div>
          <div className="doc paper person hc" id="hStudent" data-depth="1.15" style={at("55vw", "66vh", "-4deg")}>
            <i className="clip" />
            <div className="face">A</div>
            <div className="name">{c.student}</div>
            <div className="role">{c.studentRole}</div>
          </div>
          <div className="doc paper person hc" id="hPartner" data-depth=".8" style={at("70vw", "69vh", "3deg")}>
            <i className="clip" />
            <div className="face" style={{ background: "#2c4f8f" }}>B</div>
            <div className="name">{c.partner}</div>
            <div className="role">{c.partnerRole}</div>
          </div>
          <div className="doc paper person hc" id="hBursar" data-depth="1.3" style={at("84vw", "64vh", "-2deg")}>
            <i className="clip" />
            <div className="face" style={{ background: "#9e2a20" }}>U</div>
            <div className="name">{c.bursar}</div>
            <div className="role">{c.bursarRole}</div>
          </div>
        </div>
      </section>

      {/* 2 · BUT: the wire disappears between banks */}
      <section className="scene" id="but" data-scene="but">
        <div className="stage">
          <canvas className="routes" />
          <div className="doc paper sticky" id="stA" style={at("8vw", "14vh", "-6deg")}>
            <i className="clip" /><p className="note">{L.but.note1}</p><span className="sig">— {L.but.sig1}</span>
          </div>
          <div className="doc paper sticky pink" id="stB" style={at("66vw", "15vh", "5deg")}>
            <i className="clip" /><p className="note">{L.but.note2}</p><span className="sig">— {L.but.sig2}</span>
          </div>
          <div className="doc paper sticky blue" id="stC" style={at("72vw", "44vh", "-3deg")}>
            <i className="clip" /><p className="note">{L.but.note3}</p>
          </div>
          <div className="doc sheet" id="sheet" style={at("31vw", "20vh", "-1.5deg")}>
            <i className="clip" id="sheetClip" />
            {(["l", "r"] as const).map((side) => (
              <div key={side} className={`half ${side}`} aria-hidden={side === "r" ? true : undefined}>
                <div className="tear">
                  <div className="bar"><span>{L.but.sheetFile}</span><span>{L.but.sheetSent}</span></div>
                  <table>
                    <tbody>
                      {L.but.rows.map(([a, b, note, cls]) => (
                        <tr key={a}><td>{a}</td><td>{b}</td><td className={cls}>{note}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          <div data-split className="big-say but-title">
            {L.but.titleA}<i>{L.but.titleEm}</i>{L.but.titleB}
          </div>
        </div>
      </section>

      {/* 3 · SO: escrow, lira, the university's signature */}
      <section className="scene" id="so" data-scene="so">
        <div className="stage">
          <canvas className="routes" />
          <div data-split className="big-say so-title">{L.so.title}</div>
          <div className="doc paper invoice" id="sInvoice" style={at("6vw", "11vh", "-2deg")}>
            <i className="clip" />
            <span className="label">{L.so.invoice}</span>
            <div className="row"><span className="note">{L.so.invoiceWho}</span><span className="amount">300 USDG</span></div>
          </div>
          <div className="doc paper kraft vault" id="sEscrow" style={at("10vw", "39vh", "1.5deg")}>
            <i className="clip" />
            <span className="label">{L.so.escrow}</span>
            <span className="amount"><span className="odo" id="escrowAmt">0</span> USDG</span>
          </div>
          <div className="doc paper slip" id="sSlip" style={at("34vw", "10vh", "-1deg")}>
            <i className="clip brass" />
            <span className="label">{L.so.slip}</span>
            <div className="slipline">{L.so.slipLine}</div>
            <div className="amount">{L.so.slipAmt}</div>
            <span className="label">{L.so.slipRef}</span>
          </div>
          <div className="doc paper bursar" id="sBursar" style={at("40vw", "44vh", "-2.5deg")}>
            <i className="clip" />
            <span className="label">{L.so.bursar}</span>
            <p className="note">{L.so.bursarNote}</p>
            <i className="rstamp" id="sStamp">{L.so.stamp}</i>
          </div>
          <div className="doc paper payee" id="sPayout" style={at("19vw", "63vh", "2.5deg")}>
            <i className="clip" />
            <span className="label">{L.so.payout}</span>
            <div className="amount"><span className="odo" id="payoutAmt">0</span> USDG</div>
          </div>
          <div className="burst" id="burst" />
          <div className="steps">
            {L.so.steps.map((s, i) => (
              <div className="step" key={s}><b>{String(i + 1).padStart(2, "0")}</b><span>{s}</span></div>
            ))}
          </div>
          <div className="ptape" id="ptape">
            <span className="label ptape-label">{L.so.window}</span>
            <div className="ticks" />
            <div className="days" />
            <span className="now" />
            {L.so.flags.map(([n, text], i) => (
              <span className="flag" id={`fl${i + 1}`} key={n} style={{ left: ["6%", "30%", "54%"][i] }}>
                {L.so.hour} <b>{n}</b>{text}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 4 · RULES: refund by default, frozen when disputed, arbiter decides */}
      <section className="scene" id="rules" data-scene="rules">
        <div className="stage">
          <canvas className="routes" />
          <div data-split className="big-say rules-title">{L.rules.title}</div>
          <div className="doc paper caseA" id="rCaseA" style={at("6vw", "42vh", "-1.5deg")}>
            <i className="clip" />
            <span className="label">{L.rules.caseA}</span>
            <h4>{L.rules.caseAH}</h4>
            <div className="amount"><span className="odo" id="refundAmt">0</span> USDG <span className="chip">{L.rules.refundTo}</span></div>
            <i className="rstamp blue" id="rRefund">{L.rules.refunded}</i>
          </div>
          <div className="doc paper kraft sender" id="rPartner" style={at("82vw", "50vh", "4deg")}>
            <i className="clip" />
            <span className="label">{L.rules.caseB}</span>
            <p className="note">{L.rules.partnerSays}</p>
          </div>
          <div className="doc paper agent" id="rArbiter" style={at("50vw", "12vh", "2deg")}>
            <i className="clip brass" />
            <span className="label">{L.rules.arbiter}</span>
            <p className="note" style={{ marginTop: 8 }}>{L.rules.arbiterNote}</p>
          </div>
          <span className="held" id="held">{L.rules.frozen}</span>
          <div className="doc ruler" id="ruler" style={at("42vw", "64vh", "-1deg")}>
            <i className="clip" />
            <span className="limitline" />
            <span className="needle" id="needle" />
            <span className="label">{L.rules.ruler}</span>
            <span className="limit">{L.rules.limit}</span>
          </div>
          <div className="doc receipt" id="receipt" style={at("6vw", "76vh", ".6deg")}>
            <i className="clip brass" />
            {L.rules.log.map((line) => (
              <div className="ln" data-text={line} key={line} />
            ))}
          </div>
        </div>
      </section>

      {/* 5 · CLOSE */}
      <section className="close" id="start">
        <div className="doc paper close-card" id="closeCard" style={at(null, null, "-.8deg")}>
          <i className="clip" />
          <div className="doc paper kraft term" id="termCard" style={at(null, null, "6deg")}>
            <i className="clip brass" />
            <span className="label">{L.close.term}</span>
            <div className="amount" style={{ marginTop: 6 }}>{L.close.opens}</div>
          </div>
          <span className="label">{L.close.label}</span>
          <h2 data-split style={{ marginTop: 18 }}>{L.close.title}</h2>
          <p>{L.close.body}</p>
          <div className="btnrow">
            <Link className="btn" href="/school">{L.hero.start} <span className="arr">→</span></Link>
            <a className="btn ghost" href={explorerAddress(PROGRAM)} target="_blank" rel="noreferrer">
              {L.close.program} <span className="arr">↗</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
