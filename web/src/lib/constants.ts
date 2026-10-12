import { address, type Address } from "@solana/kit";

export const APP_NAME = "Tuition";

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** Both mints use 6 decimals; the program reads decimals from the mint itself. */
export const DECIMALS = 6;

export type MintOption = { address: Address; symbol: string; label: Record<"en" | "tr", string> };

export const MINTS: MintOption[] = [
  {
    address: address("4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7"),
    symbol: "USDG",
    label: { en: "USDG (Paxos devnet)", tr: "USDG (Paxos devnet)" },
  },
  {
    address: address("7ZZoiCgpjzjDUbu7XxCNhfz7rnvhHSxKJCRe7mkz6NYz"),
    symbol: "tUSD",
    label: { en: "Test dollar (mock)", tr: "Test doları (mock)" },
  },
];

export function mintSymbol(mint: Address): string {
  return MINTS.find((m) => m.address === mint)?.symbol ?? "tokens";
}

export const PAYMENT_WINDOWS: { secs: number; label: Record<"en" | "tr", string> }[] = [
  { secs: 60, label: { en: "60 seconds (demo)", tr: "60 saniye (demo)" } },
  { secs: 10 * 60, label: { en: "10 minutes", tr: "10 dakika" } },
  { secs: 3 * 24 * 60 * 60, label: { en: "3 days", tr: "3 gün" } },
];

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

/** Mirrors MIN_WINDOW_SECS in the program: the university's minimum time to respond after a payout claim. */
export const REVIEW_SECS = 20;
