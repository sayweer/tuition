"use client";

import { useEffect, useSyncExternalStore } from "react";

export type Lang = "en" | "tr";

/** Every component keeps its own copy as `{ en, tr }`; `tr` is typed against `en`, so a missing
 *  key is a compile error. */
export type Dict<T> = Record<Lang, T>;

const KEY = "tuition-lang";
const listeners = new Set<() => void>();

function read(): Lang {
  try {
    return localStorage.getItem(KEY) === "tr" ? "tr" : "en";
  } catch {
    return "en";
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // storage blocked: the switch still works for this page view
  }
  document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}

/** The server always renders English; the browser switches to the saved language after hydration. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, read, () => "en" as const);
}

export function useT<T>(dict: Dict<T>): T {
  return dict[useLang()];
}

export const locale = (lang: Lang) => (lang === "tr" ? "tr-TR" : "en-US");

/** Sits in the header on every page; it also keeps <html lang> in step for screen readers and CSS. */
export function LangSwitch() {
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <span className="lang-switch" role="group" aria-label="Language / Dil">
      {(["en", "tr"] as const).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
