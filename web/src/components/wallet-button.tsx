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
      <button className="btn btn-quiet" onClick={() => disconnect()} title="Disconnect">
        <span className="dot" aria-hidden /> {shortAddress(connected.account.address)}
      </button>
    );
  }
  if (wallets.length === 0) {
    return (
      <a className="btn btn-quiet" href="https://phantom.com/download" target="_blank" rel="noreferrer">
        Install Phantom or Solflare
      </a>
    );
  }
  return (
    <div className="relative">
      <button className="btn btn-primary" onClick={() => setOpen((o) => !o)} disabled={isRunning}>
        {isRunning ? "Connecting…" : "Connect wallet"}
      </button>
      {open && (
        <ul className="menu" role="menu">
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
    </div>
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
  if (!mounted) return <span className="btn btn-quiet">Loading wallets…</span>;
  return (
    <WalletReadyGate client={client} fallback={<span className="btn btn-quiet">Loading wallets…</span>}>
      <Picker />
    </WalletReadyGate>
  );
}
