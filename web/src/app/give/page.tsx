"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { T } from "@/components/give/copy";
import { FundFlow } from "@/components/give/fund-flow";
import { PoolFlow } from "@/components/give/pool-flow";
import { STEP_HEADING, Steps, type CartItem, type Step } from "@/components/give/shared";
import { useWalletAddress } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import "@/styles/give.css";

type Tab = "fund" | "pool";
const TABS: Tab[] = ["fund", "pool"];

export default function GivePage() {
  const t = useT(T);
  const me = useWalletAddress();
  const [tab, setTab] = useState<Tab>("fund");
  const [step, setStep] = useState<Step>(1);
  // The list lives here so it survives switching tabs and going back from the review.
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toPool, setToPool] = useState(true);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ fund: null, pool: null });

  // Each step opens with a heading; move focus there (not on first load) so keyboard and
  // screen-reader users land at the start of the new step.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById(STEP_HEADING)?.focus();
  }, [step]);

  function choose(next: Tab) {
    setTab(next);
    setStep(1);
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.indexOf(tab);
    const next =
      e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length]
      : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length]
      : e.key === "Home" ? TABS[0]
      : e.key === "End" ? TABS[TABS.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    choose(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <main className="desk-page give">
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

      <div className="give-nav">
        <Steps step={step} />
        {step === 1 && (
          <div className="give-tabs" role="tablist" aria-label={t.tabsLabel}>
            {TABS.map((id) => (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                id={`give-tab-${id}`}
                aria-selected={tab === id}
                aria-controls="give-panel"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => choose(id)}
                onKeyDown={onTabKey}
              >
                {id === "fund" ? t.tabFund : t.tabPool}
              </button>
            ))}
          </div>
        )}
      </div>

      <div id="give-panel" role={step === 1 ? "tabpanel" : undefined} aria-labelledby={step === 1 ? `give-tab-${tab}` : undefined}>
        {tab === "fund" ? (
          <FundFlow
            step={step}
            setStep={setStep}
            me={me}
            cart={cart}
            setCart={setCart}
            toPool={toPool}
            setToPool={setToPool}
            onGoPool={() => {
              choose("pool");
              tabRefs.current.pool?.focus();
            }}
          />
        ) : (
          <PoolFlow step={step} setStep={setStep} me={me} />
        )}
      </div>
    </main>
  );
}
