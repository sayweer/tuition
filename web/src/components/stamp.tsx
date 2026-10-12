/** The university's "received" stamp: the one loud element of the visual system. */
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
  const cls = tone === "ok" ? "stamp" : `stamp stamp-${tone}`;
  return (
    <svg className={cls} viewBox="0 0 200 200" role="img" aria-label={`${center}. ${ring}`}>
      <defs>
        <path id="stamp-ring" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" />
      </defs>
      <circle cx="100" cy="100" r="95" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="58" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text fill="currentColor" fontSize="13" fontWeight="700" letterSpacing="2.2">
        <textPath href="#stamp-ring" startOffset="0">
          {ring.toUpperCase()}
        </textPath>
      </text>
      <text x="100" y="98" textAnchor="middle" fill="currentColor" fontSize="18" fontWeight="800" letterSpacing="0.5">
        {center.toUpperCase()}
      </text>
      {sub && (
        <text x="100" y="120" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="600">
          {sub}
        </text>
      )}
    </svg>
  );
}
