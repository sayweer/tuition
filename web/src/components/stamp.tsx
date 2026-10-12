import { useId } from "react";

// Two arcs of ring text, split by the band across the middle. Each spans 144°.
const SPAN = (144 / 180) * Math.PI;
const TOP_R = 71; // baseline radius of the upper arc: glyphs stand outward
const BOTTOM_R = 81; // baseline radius of the lower arc: glyphs hang inward
const TOP_ARC = "M32.48,78.06 A71,71 0 0 1 167.52,78.06";
const BOTTOM_ARC = "M22.96,125.03 A81,81 0 0 0 177.04,125.03";

/** Font size and tracking that fit `text` on an arc, in JetBrains Mono (0.6em per glyph). */
function fit(text: string, length: number) {
  const per = length / Math.max(text.length, 1);
  const fontSize = Math.min(13, per / 0.72);
  return { fontSize, letterSpacing: Math.min(per - 0.6 * fontSize, 0.45 * fontSize) };
}

/** Splits a phrase into at most two lines of similar length. */
function twoLines(text: string): string[] {
  if (text.length <= 14) return [text];
  const words = text.split(" ");
  let best = [text];
  let diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (Math.abs(a.length - b.length) < diff) {
      diff = Math.abs(a.length - b.length);
      best = [a, b];
    }
  }
  return best;
}

/**
 * The university's rubber stamp, inked onto the receipt. `ring` is split on "★": the first part runs
 * over the top, the rest under the bottom. Tones: ok = red "received", back = blue, info = soft ink.
 */
export function Stamp({
  ring,
  center,
  sub,
  tone = "ok",
}: {
  ring: string;
  center: string;
  sub?: string;
  tone?: "ok" | "back" | "info";
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [top = "", ...rest] = ring
    .split("★")
    .map((s) => s.trim())
    .filter(Boolean);
  const bottom = rest.join(" ★ ");
  const word = center.toUpperCase();
  const subLines = sub ? twoLines(sub.toUpperCase()) : [];
  const subSize = Math.min(9.5, 82 / (Math.max(0, ...subLines.map((l) => l.length)) * 0.6 || 1));
  const cls = tone === "ok" ? "stamp" : `stamp stamp-${tone}`;

  return (
    <svg className={cls} viewBox="0 0 200 200" role="img" aria-label={[center, sub, top, bottom].filter(Boolean).join(". ")}>
      <defs>
        <path id={`${uid}-top`} d={TOP_ARC} />
        <path id={`${uid}-bottom`} d={BOTTOM_ARC} />
        <mask id={`${uid}-band`}>
          <rect width="200" height="200" fill="#fff" />
          <rect y="78" width="200" height="44" fill="#000" />
        </mask>
        {/* uneven rubber: rough edges, lighter patches, a few dropouts */}
        <filter id={`${uid}-ink`} x="-3%" y="-3%" width="106%" height="106%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={3} result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale={1.8} xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves={3} seed={11} result="blot" />
          <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.2 0 0 0 2.3" result="patchy" />
          <feComposite in="rough" in2="patchy" operator="in" result="inked" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -6 0 0 0 4.4" result="specks" />
          <feComposite in="inked" in2="specks" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${uid}-ink)`} fill="currentColor">
        <g mask={`url(#${uid}-band)`} fill="none" stroke="currentColor">
          <circle cx="100" cy="100" r="95" strokeWidth="4" />
          <circle cx="100" cy="100" r="88" strokeWidth="1.2" />
          <circle cx="100" cy="100" r="62" strokeWidth="1.2" />
        </g>
        <text className="stamp-arc" textAnchor="middle" {...fit(top.toUpperCase(), TOP_R * SPAN)}>
          <textPath href={`#${uid}-top`} startOffset="50%">
            {top.toUpperCase()}
          </textPath>
        </text>
        {bottom && (
          <text className="stamp-arc" textAnchor="middle" {...fit(bottom.toUpperCase(), BOTTOM_R * SPAN)}>
            <textPath href={`#${uid}-bottom`} startOffset="50%">
              {bottom.toUpperCase()}
            </textPath>
          </text>
        )}
        <text className="stamp-stars" x="100" y="68" textAnchor="middle" fontSize="11" letterSpacing="5">
          ★★★
        </text>
        <rect x="3" y="81" width="194" height="38" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <rect x="8" y="85.5" width="184" height="29" fill="none" stroke="currentColor" strokeWidth="1" />
        <text
          className="stamp-word"
          x="100"
          y="109.5"
          textAnchor="middle"
          fontSize="26"
          letterSpacing="2"
          textLength={word.length > 9 ? 172 : undefined}
          lengthAdjust="spacingAndGlyphs"
        >
          {word}
        </text>
        {subLines.map((line, i) => (
          <text
            key={line}
            className="stamp-sub"
            x="100"
            y={subLines.length === 1 ? 140 : 135 + i * 12}
            textAnchor="middle"
            fontSize={subSize}
          >
            {line}
          </text>
        ))}
      </g>
    </svg>
  );
}
