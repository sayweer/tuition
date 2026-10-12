"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address, Instruction } from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { useClient } from "@solana/react";
import useSWR from "swr";
import type { AppClient } from "@/app/providers";
import { describeError, fetchConfig, fetchInvoice, fetchPayeeName, invoiceHistory } from "./escrow";

const REFRESH_MS = 4000;

export function useApp() {
  return useClient<AppClient>();
}

/** Connected wallet address, or null. */
export function useWalletAddress(): Address | null {
  const client = useApp();
  const connected = useConnectedWallet(client);
  return (connected?.account.address as Address | undefined) ?? null;
}

/** Unix seconds, ticking once per second (for countdowns). */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function useConfig() {
  const { rpc } = useApp();
  return useSWR("config", () => fetchConfig(rpc), { refreshInterval: 30_000 });
}

export function usePayeeName(authority: Address | null | undefined) {
  const { rpc } = useApp();
  return useSWR(authority ? ["payee", authority] : null, () => fetchPayeeName(rpc, authority as Address));
}

export function useInvoice(invoice: Address | null) {
  const { rpc } = useApp();
  return useSWR(invoice ? ["invoice", invoice] : null, () => fetchInvoice(rpc, invoice as Address), {
    refreshInterval: REFRESH_MS,
  });
}

export function useHistory(invoice: Address | null, refreshKey: unknown) {
  const { rpc } = useApp();
  return useSWR(invoice ? ["history", invoice, String(refreshKey)] : null, () =>
    invoiceHistory(rpc, invoice as Address),
  );
}

export type TxState = { status: "idle" | "pending" | "done" | "error"; signature?: string; error?: string };

/** Sends instructions with the connected wallet and tracks the outcome for the UI. */
export function useSendTx() {
  const client = useApp();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const send = useCallback(
    async (build: () => Promise<Instruction[]>): Promise<string | null> => {
      setState({ status: "pending" });
      try {
        const ixs = await build();
        const result = await client.sendTransaction(ixs);
        const signature = result.context.signature;
        setState({ status: "done", signature });
        return signature;
      } catch (e) {
        console.error(e);
        setState({ status: "error", error: describeError(e) });
        return null;
      }
    },
    [client],
  );

  return { ...state, send, reset: () => setState({ status: "idle" }) };
}
