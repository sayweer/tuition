import { address, type Address } from "@solana/kit";

export const APP_NAME = "ThirdPay Tuition";

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** Both mints use 6 decimals; the program reads decimals from the mint itself. */
export const DECIMALS = 6;

export type MintOption = { address: Address; symbol: string; label: string };

export const MINTS: MintOption[] = [
  {
    address: address("4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7"),
    symbol: "USDG",
    label: "USDG (Paxos devnet)",
  },
  {
    address: address("7ZZoiCgpjzjDUbu7XxCNhfz7rnvhHSxKJCRe7mkz6NYz"),
    symbol: "tUSD",
    label: "Test dollar (mock)",
  },
];

export function mintSymbol(mint: Address): string {
  return MINTS.find((m) => m.address === mint)?.symbol ?? "tokens";
}

export const PAYMENT_WINDOWS = [
  { secs: 60, label: "60 seconds (demo)" },
  { secs: 10 * 60, label: "10 minutes" },
  { secs: 3 * 24 * 60 * 60, label: "3 days" },
];

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

/** Mirrors MIN_WINDOW_SECS in the program: the university's minimum time to respond after a payout claim. */
export const REVIEW_SECS = 20;
