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
import { shortAddress } from "@/lib/escrow";

function Picker() {
  const client = useApp();
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatch: connect, isRunning } = useConnect(client);
  const { dispatch: disconnect } = useDisconnect(client);
  const [open, setOpen] = useState(false);

  if (connected) {
    return (
      <button className="cta" onClick={() => disconnect()} title="Disconnect">
        ● {shortAddress(connected.account.address)}
      </button>
    );
  }
  if (wallets.length === 0) {
    return (
      <a className="cta" href="https://phantom.com/download" target="_blank" rel="noreferrer">
        Install Phantom
      </a>
    );
  }
  return (
    <>
      <button className="cta" onClick={() => setOpen((o) => !o)} disabled={isRunning} aria-expanded={open}>
        {isRunning ? "Connecting…" : "Connect wallet"}
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
  // Wallet discovery only exists in the browser; render the placeholder until mounted.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const placeholder = <span className="cta" style={{ padding: "9px 12px", fontSize: 12 }}>Loading wallets…</span>;
  if (!mounted) return placeholder;
  return (
    <WalletReadyGate client={client} fallback={placeholder}>
      <Picker />
    </WalletReadyGate>
  );
}
