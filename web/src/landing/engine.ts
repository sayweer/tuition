import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// The four eases of the desk (mirrors --e-* in desk.css).
const LAND = "expo.out";
const POP = "back.out(1.6)";
const SHIFT = "power4.inOut";
const LEAVE = "expo.in";

type Point = { x: number; y: number };
type Scene = { sec: HTMLElement; stage: HTMLElement; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; routes: Route[]; coins: Coin[]; active: boolean; rect: DOMRect };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const baseRot = (el: Element) => parseFloat(getComputedStyle(el).getPropertyValue("--r")) || 0;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Where a route attaches: the document's clip, else its top centre, in stage coordinates. */
function anchor(el: Element, sc: Scene): Point {
  const target = el.classList.contains("clip") ? el : (el.querySelector(":scope > .clip") ?? el);
  const r = target.getBoundingClientRect();
  return { x: r.left + r.width / 2 - sc.rect.left, y: r.top + r.height / 2 - sc.rect.top };
}

/** An inked route between two documents, drawn as a gentle arc. `reveal` draws it progressively. */
class Route {
  reveal = 0;
  private a0: Point = { x: 0, y: 0 };
  private c: Point = { x: 0, y: 0 };
  private b0: Point = { x: 0, y: 0 };
  constructor(
    private sc: Scene,
    private a: Element,
    private b: Element,
    private opts: { bend?: number; color?: string } = {},
  ) {
    sc.routes.push(this);
  }
  update() {
    this.a0 = anchor(this.a, this.sc);
    this.b0 = anchor(this.b, this.sc);
    const dx = this.b0.x - this.a0.x;
    const dy = this.b0.y - this.a0.y;
    const bend = this.opts.bend ?? 0.16;
    // control point: midpoint pushed sideways (perpendicular) and a little down, like a flight arc
    this.c = { x: (this.a0.x + this.b0.x) / 2 - dy * bend, y: (this.a0.y + this.b0.y) / 2 + dx * bend + Math.hypot(dx, dy) * 0.05 };
  }
  pointAt(t: number): Point {
    const u = 1 - t;
    return {
      x: u * u * this.a0.x + 2 * u * t * this.c.x + t * t * this.b0.x,
      y: u * u * this.a0.y + 2 * u * t * this.c.y + t * t * this.b0.y,
    };
  }
  draw(ctx: CanvasRenderingContext2D) {
    if (this.reveal <= 0) return;
    const steps = 48;
    const end = Math.ceil(steps * this.reveal);
    ctx.save();
    ctx.strokeStyle = this.opts.color ?? "rgba(214, 52, 40, .92)";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.setLineDash([8, 7]);
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowOffsetY = 2;
    ctx.shadowBlur = 3;
    ctx.beginPath();
    for (let i = 0; i <= end; i++) {
      const p = this.pointAt(Math.min(i / steps, this.reveal));
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    // small ink dot where the route leaves the first document
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(this.a0.x, this.a0.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Money in transit: a glowing tag that travels along a route. */
class Coin {
  t = 0;
  on = false;
  constructor(
    private sc: Scene,
    private route: Route,
    private label: string,
    private tone: "gold" | "blue" = "gold",
  ) {
    sc.coins.push(this);
  }
  draw(ctx: CanvasRenderingContext2D) {
    if (!this.on) return;
    const p = this.route.pointAt(clamp(this.t, 0, 1));
    ctx.save();
    ctx.font = "600 12px 'JetBrains Mono', ui-monospace, monospace";
    const w = ctx.measureText(this.label).width + 20;
    const h = 24;
    ctx.shadowColor = this.tone === "gold" ? "rgba(255,214,110,.75)" : "rgba(120,170,255,.7)";
    ctx.shadowBlur = 22;
    ctx.fillStyle = this.tone === "gold" ? "#ffe08a" : "#cfe0ff";
    ctx.beginPath();
    ctx.roundRect(p.x - w / 2, p.y - h / 2, w, h, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#1d1a16";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.label, p.x, p.y + 1);
    ctx.restore();
  }
}

/** Wires every scene inside `root`; returns a cleanup that undoes tweens, triggers, listeners and DOM edits. */
export function initLanding(root: HTMLElement): () => void {
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`landing: missing ${sel}`);
    return el;
  };
  const qa = <T extends HTMLElement = HTMLElement>(sel: string): T[] => [...root.querySelectorAll<T>(sel)];

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cleanups: Array<() => void> = [];
  let alive = true;
  let raf = 0;

  // DOM the engine rewrites, restored on cleanup so a remount starts clean
  const headline = qa("h1 .line>span");
  const headlineHtml = headline.map((s) => s.innerHTML);
  const splitEls = qa("[data-split]");
  const splitHtml = splitEls.map((el) => el.innerHTML);
  const logLines = qa("#receipt .ln");
  const ticks = q("#ptape .ticks");
  const days = q("#ptape .days");

  // ── scenes ──────────────────────────────────────────────────────────
  const S: Record<string, Scene> = {};
  qa("[data-scene]").forEach((sec) => {
    const stage = sec.querySelector<HTMLElement>(".stage");
    const canvas = stage?.querySelector<HTMLCanvasElement>("canvas.routes");
    const ctx = canvas?.getContext("2d");
    if (!stage || !canvas || !ctx || !sec.dataset.scene) return;
    S[sec.dataset.scene] = { sec, stage, canvas, ctx, routes: [], coins: [], active: true, rect: stage.getBoundingClientRect() };
  });
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        const sc = Object.values(S).find((x) => x.sec === e.target);
        if (sc) sc.active = e.isIntersecting;
      }),
    { rootMargin: "120px" },
  );
  Object.values(S).forEach((sc) => io.observe(sc.sec));
  cleanups.push(() => io.disconnect());

  // ── routes and money in transit ─────────────────────────────────────
  const hero = [
    new Route(S.hero, q("#hFamily"), q("#hEscrow"), { bend: 0.14 }),
    new Route(S.hero, q("#hInvoice"), q("#hEscrow"), { bend: -0.14 }),
    new Route(S.hero, q("#hEscrow"), q("#hPartner"), { bend: 0.1 }),
    new Route(S.hero, q("#hPartner"), q("#hBursar"), { bend: -0.12, color: "rgba(120,160,240,.95)" }),
    new Route(S.hero, q("#hBursar"), q("#hStudent"), { bend: 0.2 }),
  ];
  const usdg = root.dataset.coinUsdg ?? "300 USDG";
  const lira = root.dataset.coinLira ?? "₺12,000";
  const heroCoin = new Coin(S.hero, hero[0], usdg);

  const sInv = new Route(S.so, q("#sInvoice"), q("#sEscrow"), { bend: 0.18 });
  const sLira = new Route(S.so, q("#sSlip"), q("#sBursar"), { bend: -0.16, color: "rgba(120,160,240,.95)" });
  const sOut = new Route(S.so, q("#sEscrow"), q("#sPayout"), { bend: 0.08 });
  const cLock = new Coin(S.so, sInv, usdg);
  const cLira = new Coin(S.so, sLira, lira, "blue");
  const cOut = new Coin(S.so, sOut, usdg);

  const rHold = new Route(S.rules, q("#rPartner"), q("#rArbiter"), { bend: 0.12 });

  // FROZEN tag hangs from the middle of the disputed route and swings like a pendulum
  const heldEl = q("#held");
  const held = {
    a: 0,
    va: 0,
    lx: null as number | null,
    vis: 0,
    update() {
      if (rHold.reveal < 1 || this.vis <= 0) {
        heldEl.style.visibility = "hidden";
        this.lx = null;
        return;
      }
      const p = rHold.pointAt(0.5);
      const ax = this.lx == null ? 0 : clamp(p.x - this.lx, -5, 5);
      this.lx = p.x;
      this.va += -this.a * 0.07 - this.va * 0.06 - ax * 0.8;
      this.a = clamp(this.a + this.va, -28, 28);
      heldEl.style.visibility = "visible";
      heldEl.style.transform = `translate(${p.x - heldEl.offsetWidth / 2}px,${p.y + 18}px) rotate(${this.a}deg) scale(${this.vis})`;
    },
  };

  const sizeCanvas = (sc: Scene) => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = sc.stage.clientWidth;
    const h = sc.stage.clientHeight;
    if (sc.canvas.width !== Math.round(w * dpr) || sc.canvas.height !== Math.round(h * dpr)) {
      sc.canvas.width = Math.round(w * dpr);
      sc.canvas.height = Math.round(h * dpr);
    }
    sc.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const frame = () => {
    if (!alive) return;
    for (const sc of Object.values(S)) {
      if (!sc.active) continue;
      sc.rect = sc.stage.getBoundingClientRect();
      sizeCanvas(sc);
      sc.ctx.clearRect(0, 0, sc.canvas.width, sc.canvas.height);
      for (const r of sc.routes) {
        r.update();
        r.draw(sc.ctx);
      }
      for (const c of sc.coins) c.draw(sc.ctx);
    }
    held.update();
    raf = requestAnimationFrame(frame);
  };

  // ── static DOM preparation ──────────────────────────────────────────
  for (let i = 0; i <= 72; i += 3) ticks.appendChild(document.createElement("i"));
  [0, 12, 24, 36, 48, 60, 72].forEach((n) => {
    const s = document.createElement("span");
    s.textContent = `${String(n).padStart(2, "0")}h`;
    days.appendChild(s);
  });
  // hero headline: letters grouped per word so lines only wrap between words
  const walk = (n: Node) => {
    [...n.childNodes].forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) {
        const f = document.createDocumentFragment();
        (c.textContent ?? "").split(/( )/).forEach((part) => {
          if (!part) return;
          if (part === " ") return void f.appendChild(document.createTextNode(" "));
          const w = document.createElement("span");
          w.className = "w";
          [...part].forEach((ch) => {
            const s = document.createElement("span");
            s.className = "ch";
            s.textContent = ch;
            w.appendChild(s);
          });
          f.appendChild(w);
        });
        c.replaceWith(f);
      } else walk(c);
    });
  };
  headline.forEach(walk);
  // scene titles: every word (or highlighted phrase) rises out of its own mask
  const mask = (inner: Node) => {
    const m = document.createElement("span");
    m.className = "wm";
    const i = document.createElement("span");
    i.className = "wi";
    m.appendChild(i);
    i.appendChild(inner);
    return m;
  };
  splitEls.forEach((el) => {
    [...el.childNodes].forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) {
        const f = document.createDocumentFragment();
        (c.textContent ?? "").split(/(\s+)/).forEach((part) => {
          if (!part) return;
          f.appendChild(/^\s+$/.test(part) ? document.createTextNode(" ") : mask(document.createTextNode(part)));
        });
        c.replaceWith(f);
      } else c.replaceWith(mask(c.cloneNode(true)));
    });
  });
  const rise = (sel: string, duration = 0.6) =>
    gsap.fromTo(qa(`${sel} .wi`), { yPercent: 115, rotation: 5 }, { yPercent: 0, rotation: 0, duration, ease: LAND, stagger: 0.05, immediateRender: true });

  const totalChars = logLines.reduce((a, l) => a + (l.dataset.text ?? "").length, 0);
  const typeTo = (n: number) => {
    let left = Math.round(n);
    logLines.forEach((l) => {
      const t = l.dataset.text ?? "";
      const k = clamp(left, 0, t.length);
      left -= t.length;
      const shown = t.slice(0, k).replace(/(locked|posted|released|kilitlendi|işlendi|aktarıldı)/g, "<b>$1</b>");
      l.innerHTML = shown + (k > 0 && k < t.length ? '<span class="caret"></span>' : "");
    });
  };
  const setOdo = (sel: string, v: number) => {
    q(sel).textContent = fmt(v);
  };

  // ── building blocks ─────────────────────────────────────────────────
  /** A document is dropped on the desk: flies in, lands, squashes, settles; the clip snaps on last. */
  const drop = (el: HTMLElement, o: { x?: number; y?: number; rot?: number; dur?: number } = {}) => {
    const r = baseRot(el);
    const clip = el.querySelector(":scope > .clip");
    const dur = o.dur ?? 0.42;
    const tl = gsap.timeline();
    tl.fromTo(
      el,
      { x: o.x ?? 0, y: o.y ?? -340, rotation: r + (o.rot ?? gsap.utils.random(-16, 16)), scale: 1.16, autoAlpha: 0 },
      { x: 0, y: 0, rotation: r, scale: 1, autoAlpha: 1, duration: dur, ease: LAND, immediateRender: true },
    )
      .fromTo(el, { "--air": 1 }, { "--air": 0, duration: dur * 0.9, ease: LEAVE, immediateRender: true }, "<")
      .to(el, { scaleX: 1.04, scaleY: 0.955, duration: 0.06, ease: SHIFT })
      .to(el, { scaleX: 1, scaleY: 1, duration: 0.34, ease: POP });
    if (clip)
      tl.fromTo(clip, { y: -24, scaleX: 1.6, autoAlpha: 0 }, { y: 0, scaleX: 1, autoAlpha: 1, duration: 0.24, ease: POP, immediateRender: true }, "<-.05");
    return tl;
  };
  const value = (from: number, to: number, duration: number, ease: string, onUpdate: (v: number) => void) => {
    const o = { v: from };
    return gsap.to(o, { v: to, duration, ease, onUpdate: () => onUpdate(o.v) });
  };
  const toggle = (onChange: (on: boolean) => void) => value(0, 1, 0.01, "none", (v) => onChange(v > 0.5));
  const flow = (coin: Coin, dur: number) =>
    value(0, 1, dur, SHIFT, (t) => {
      coin.t = t;
      coin.on = t > 0 && t < 1;
    });
  const receive = (el: HTMLElement) => gsap.timeline().to(el, { scale: 1.06, duration: 0.08, ease: SHIFT }).to(el, { scale: 1, duration: 0.4, ease: POP });
  /** A rubber stamp hits the paper: overshoots, then the document jolts. */
  const stamp = (el: HTMLElement, host: HTMLElement) =>
    gsap
      .timeline()
      .fromTo(el, { scale: 2.4, rotation: -26, autoAlpha: 0 }, { scale: 1, rotation: -12, autoAlpha: 1, duration: 0.3, ease: POP, immediateRender: true })
      .to(host, { y: 4, duration: 0.05, ease: SHIFT }, "<.12")
      .to(host, { y: 0, duration: 0.22, ease: POP });

  const finalStates = () => {
    [...hero, sInv, sLira, sOut, rHold].forEach((r) => (r.reveal = 1));
    held.vis = 1;
    setOdo("#escrowAmt", 300);
    setOdo("#payoutAmt", 300);
    setOdo("#refundAmt", 300);
    gsap.set(qa(".rstamp"), { autoAlpha: 1, scale: 1, rotation: -12 });
    gsap.set(q("#needle"), { left: "84%" });
    q("#ruler").classList.add("at-limit");
    typeTo(totalChars);
    gsap.set(qa(".step"), { opacity: 1, x: 0 });
  };

  // ── timelines ───────────────────────────────────────────────────────
  const buildHero = () => {
    const tl = gsap.timeline({ delay: 0.15 });
    tl.from(qa("h1 .ch"), { yPercent: 120, rotation: 8, duration: 0.55, ease: LAND, stagger: 0.014 })
      .from(q(".eyebrow"), { y: -40, rotation: -12, autoAlpha: 0, duration: 0.45, ease: POP }, "<.1")
      .from(q(".lede"), { y: 30, rotation: 1.5, autoAlpha: 0, duration: 0.55, ease: LAND }, "<.2")
      .from(qa(".hero-copy .btn"), { y: 24, autoAlpha: 0, duration: 0.45, ease: POP, stagger: 0.08 }, "<.1");
    ["#hFamily", "#hInvoice", "#hEscrow", "#hStudent", "#hPartner", "#hBursar"].forEach((s, i) =>
      tl.add(drop(q(s), { y: -380 - i * 24 }), 0.3 + i * 0.1),
    );
    tl.to(hero, { reveal: 1, duration: 0.7, ease: LAND, stagger: 0.12 }, ">-.2");
    // the family's payment keeps travelling into escrow, again and again
    const pay = gsap.timeline({ repeat: -1, repeatDelay: 1.6, paused: true });
    pay.add(flow(heroCoin, 1.3)).add(receive(q("#hEscrow")));
    tl.add(() => void pay.play(), ">-.3");
    if (matchMedia("(min-width:761px)").matches) {
      const st = { trigger: q("#hero"), start: "top top", end: "bottom top", scrub: 0.6 };
      qa(".hc").forEach((c) => {
        const d = parseFloat(c.dataset.depth ?? "1");
        gsap.to(c, { yPercent: -90 * d, xPercent: (d - 1) * 40, ease: "none", scrollTrigger: { ...st } });
      });
      qa("#hero h1 .line").forEach((l, i) => gsap.to(l, { yPercent: -40 - i * 22, ease: "none", scrollTrigger: { ...st } }));
      gsap.to(qa(".hero-copy .lede, .hero-copy .btnrow"), { yPercent: -60, autoAlpha: 0.2, ease: "none", scrollTrigger: { ...st } });
    }
  };

  const pinned = (trigger: HTMLElement, len: string, on: boolean) =>
    on
      ? { trigger, start: "top top", end: `+=${len}`, pin: true, scrub: 0.9, invalidateOnRefresh: true }
      : { trigger, start: "top 70%", end: "bottom 35%", scrub: 0.9, invalidateOnRefresh: true };

  const buildBut = (pin: boolean) => {
    const tl = gsap.timeline({ scrollTrigger: pinned(q("#but"), "210%", pin) });
    const sheet = q("#sheet");
    const [hl, hr] = [q("#sheet .half.l"), q("#sheet .half.r")];
    tl.add(drop(sheet, { y: -520, rot: -20, dur: 0.6 }))
      .add(rise(".but-title", 0.7), "-=.3")
      .add(drop(q("#stA"), { y: -260, x: -120, rot: -24 }), "+=.05")
      .add(drop(q("#stB"), { y: -260, x: 140, rot: 20 }), "<.15")
      .add(drop(q("#stC"), { y: 200, x: 160, rot: -16 }), "<.15")
      // pressure builds: the wire slip trembles
      .to(sheet, { keyframes: { rotation: [-1.5, -3, 0, -2.5, 0.5, -2], x: [0, -4, 5, -3, 4, 0] }, duration: 0.6, ease: "none" }, "+=.2")
      .addLabel("tear")
      .to(q("#sheetClip"), { keyframes: [{ y: -180, x: 140, rotation: 300, duration: 0.3, ease: LAND }, { y: 900, x: 320, rotation: 880, duration: 0.6, ease: LEAVE }] }, "tear")
      .add(toggle((on) => sheet.classList.toggle("torn", on)), "tear")
      .to(hl, { x: -60, y: 20, rotation: -11, transformOrigin: "0% 0%", duration: 0.35, ease: LAND }, "tear")
      .to(hr, { x: 70, y: 10, rotation: 13, transformOrigin: "100% 0%", duration: 0.35, ease: LAND }, "tear")
      .to(hl, { y: 900, rotation: -32, duration: 0.7, ease: LEAVE }, "tear+=.35")
      .to(hr, { y: 900, rotation: 41, duration: 0.75, ease: LEAVE }, "tear+=.4")
      .to(q("#stA"), { y: 820, x: -130, rotation: -36, duration: 0.9, ease: LEAVE }, "tear+=.15")
      .to(q("#stB"), { y: 900, x: 170, rotation: 44, duration: 0.9, ease: LEAVE }, "tear+=.22")
      .to(q("#stC"), { y: 760, x: 110, rotation: -30, duration: 0.9, ease: LEAVE }, "tear+=.3")
      .to({}, { duration: 0.5 });
  };

  const buildSo = (pin: boolean) => {
    const tl = gsap.timeline({ scrollTrigger: pinned(q("#so"), "320%", pin) });
    const step = (i: number) => gsap.to(q(`.step:nth-child(${i})`), { opacity: 1, x: 0, duration: 0.35, ease: LAND });
    const flag = (s: string) => gsap.fromTo(q(s), { y: -60, rotation: -12, autoAlpha: 0 }, { y: 0, rotation: 0, autoAlpha: 1, duration: 0.4, ease: POP });
    const burst = q("#burst");
    tl.add(rise(".so-title"))
      .add(drop(q("#sInvoice"), { y: -320, rot: -18 }), "<.15")
      .add(drop(q("#sEscrow"), { x: -280, y: -40, rot: 12 }))
      .to(sInv, { reveal: 1, duration: 0.45, ease: LAND }, "<.25")
      .add(flow(cLock, 1.1))
      .add(receive(q("#sEscrow")))
      .add(value(0, 300, 0.6, LAND, (v) => setOdo("#escrowAmt", v)), "<")
      .add(step(1), "<")
      .add(flag("#fl1"), "<")
      .to(q(".ptape .now"), { left: "8%", duration: 0.4, ease: SHIFT }, "<")
      // the partner pays lira off-chain, then posts the bank receipt
      .add(drop(q("#sSlip"), { y: -300, rot: 14 }), "+=.1")
      .add(drop(q("#sBursar"), { y: 300, rot: -12 }), "<.1")
      .to(sLira, { reveal: 1, duration: 0.45, ease: LAND }, "<.2")
      .add(flow(cLira, 1.1))
      .add(receive(q("#sBursar")))
      .add(step(2), "<")
      .add(flag("#fl2"), "<")
      .to(q(".ptape .now"), { left: "32%", duration: 0.4, ease: SHIFT }, "<")
      // the university signs with its own key: the stamp is the moment
      .add(stamp(q("#sStamp"), q("#sBursar")), "+=.15")
      .fromTo(burst, { autoAlpha: 1, scale: 0.2 }, {
        scale: 1.7, autoAlpha: 0, duration: 0.5, ease: LAND,
        onStart: () => {
          S.so.rect = S.so.stage.getBoundingClientRect();
          const p = anchor(q("#sStamp"), S.so);
          gsap.set(burst, { x: p.x, y: p.y });
        },
      }, "<.1")
      .add(step(3), "<")
      .add(flag("#fl3"), "<.1")
      .to(q(".ptape .now"), { left: "56%", duration: 0.4, ease: SHIFT }, "<")
      // escrow releases to the partner
      .add(drop(q("#sPayout"), { y: 320, rot: 16 }), "+=.1")
      .to(sOut, { reveal: 1, duration: 0.45, ease: LAND }, "<.2")
      .add(flow(cOut, 1))
      .add(receive(q("#sPayout")))
      .add(value(300, 0, 0.6, LAND, (v) => setOdo("#escrowAmt", v)), "<")
      .add(value(0, 300, 0.6, LAND, (v) => setOdo("#payoutAmt", v)), "<")
      .add(step(4), "<")
      .to(q("#sPayout"), { boxShadow: "0 0 0 3px #ffe08a, 0 0 40px 8px rgba(255,214,110,.6), 0 14px 28px -8px rgba(5,10,20,.6)", duration: 0.3, ease: LAND }, "<.2")
      .to({}, { duration: 0.9 });
  };

  const buildRules = (pin: boolean) => {
    const tl = gsap.timeline({ scrollTrigger: pinned(q("#rules"), "320%", pin) });
    const caseA = q("#rCaseA");
    const ruler = q("#ruler");
    tl.add(rise(".rules-title"))
      // case A: the window runs out with nobody paying, so the money goes home
      .add(drop(ruler, { y: 300, rot: -8 }), "<.2")
      .to(q("#needle"), { left: "90%", duration: 0.9, ease: SHIFT })
      .to(q("#needle"), { left: "84%", duration: 0.3, ease: POP })
      .add(toggle((on) => ruler.classList.toggle("at-limit", on)), ">")
      .add(drop(caseA, { x: -420, y: -60, rot: -16 }), "<")
      .add(value(0, 300, 0.6, LAND, (v) => setOdo("#refundAmt", v)), ">-.1")
      .add(stamp(q("#rRefund"), caseA), "<.3")
      // case B: paid but unconfirmed, so the money freezes and the arbiter rules
      .add(drop(q("#rArbiter"), { y: -400, rot: 18 }), "+=.2")
      .add(drop(q("#rPartner"), { x: 300, y: -80, rot: 24 }), "<.15")
      .to(rHold, { reveal: 1, duration: 0.5, ease: LAND }, "<.25")
      .to(held, { vis: 1, duration: 0.3, ease: POP }, ">")
      .add(() => {
        held.va += 4;
      }, "<.1")
      .add(drop(q("#receipt"), { y: 260, rot: 6 }), "+=.1")
      .add(value(0, totalChars, 1.6, "none", typeTo), ">-.1")
      .to({}, { duration: 0.8 });
  };

  const buildClose = () => {
    const tl = gsap.timeline({ paused: true });
    tl.add(drop(q("#closeCard"), { y: 260, rot: -10, dur: 0.6 }))
      .add(rise("#closeCard h2", 0.7), "-=.3")
      .from(qa("#closeCard > p, #closeCard .btnrow > *"), { y: 22, autoAlpha: 0, duration: 0.45, ease: LAND, stagger: 0.08 }, "-=.45")
      .add(drop(q("#termCard"), { y: -260, x: 160, rot: 32 }), "-=.3");
    ScrollTrigger.create({ trigger: q("#start"), start: "top 70%", once: true, onEnter: () => void tl.play() });
  };

  // ── wire it inside one context so a single revert undoes every tween ──
  const mm = gsap.matchMedia();
  const ctx = gsap.context(() => {
    qa(".doc").forEach((d) => gsap.set(d, { rotation: baseRot(d) }));
    if (REDUCED) {
      qa(".doc").forEach((d) => gsap.set(d, { autoAlpha: 1 }));
      finalStates();
    } else {
      buildHero();
      mm.add("(min-width:761px)", () => {
        buildBut(true);
        buildSo(true);
        buildRules(true);
      });
      mm.add("(max-width:760px)", () => {
        buildBut(false);
        buildSo(false);
        buildRules(false);
      });
      buildClose();
    }
  }, root);

  raf = requestAnimationFrame(frame);
  const refresh = () => {
    if (alive) ScrollTrigger.refresh();
  };
  window.addEventListener("load", refresh);
  cleanups.push(() => window.removeEventListener("load", refresh));
  void document.fonts?.ready.then(refresh);
  requestAnimationFrame(refresh);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    mm.revert();
    ctx.revert();
    cleanups.forEach((fn) => fn());
    logLines.forEach((l) => (l.innerHTML = ""));
    ticks.innerHTML = "";
    days.innerHTML = "";
    headline.forEach((s, i) => (s.innerHTML = headlineHtml[i]));
    splitEls.forEach((el, i) => (el.innerHTML = splitHtml[i]));
  };
}
