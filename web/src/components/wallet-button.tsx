"use client";

import { useState, useSyncExternalStore } from "react";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  WalletReadyGate,
} from "@solana/kit-plugin-wallet/react";
import { useApp } from "@/lib/hooks";
import { useT, type Dict } from "@/lib/i18n";
import { shortAddress } from "@/lib/escrow";

const T = {
  en: { disconnect: "Disconnect", install: "Install Phantom", connecting: "Connecting…", connect: "Connect wallet", loading: "Loading wallets…" },
  tr: { disconnect: "Bağlantıyı kes", install: "Phantom'u kur", connecting: "Bağlanıyor…", connect: "Cüzdanı bağla", loading: "Cüzdanlar yükleniyor…" },
} satisfies Dict<Record<string, string>>;

function Picker() {
  const client = useApp();
  const t = useT(T);
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatch: connect, isRunning } = useConnect(client);
  const { dispatch: disconnect } = useDisconnect(client);
  const [open, setOpen] = useState(false);

  if (connected) {
    return (
      <button className="cta" onClick={() => disconnect()} title={t.disconnect}>
        ● {shortAddress(connected.account.address)}
      </button>
    );
  }
  if (wallets.length === 0) {
    return (
      <a className="cta" href="https://phantom.com/download" target="_blank" rel="noreferrer">
        {t.install}
      </a>
    );
  }
  return (
    <>
      <button className="cta" onClick={() => setOpen((o) => !o)} disabled={isRunning} aria-expanded={open}>
        {isRunning ? t.connecting : t.connect}
      </button>
      {open && (
        <ul className="wallet-menu" role="menu">
          {wallets.map((w) => (
            <li key={w.name}>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  connect(w);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.icon} alt="" width={20} height={20} /> {w.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function WalletButton() {
  const client = useApp();
  const t = useT(T);
  // Wallet discovery only exists in the browser; render the placeholder until mounted.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const placeholder = <span className="cta" style={{ padding: "9px 12px", fontSize: 12 }}>{t.loading}</span>;
  if (!mounted) return placeholder;
  return (
    <WalletReadyGate client={client} fallback={placeholder}>
      <Picker />
    </WalletReadyGate>
  );
}
