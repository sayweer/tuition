import {
  fetchEncodedAccount,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Encoder,
  type Address,
  type Base58EncodedBytes,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from "@solana/kit";
import { findAssociatedTokenPda, fetchMaybeToken } from "@solana-program/token-2022";
import {
  CONFIG_DISCRIMINATOR,
  findConfigPda,
  findPayeePda,
  getConfigDecoder,
  getInvoiceDecoder,
  getInvoiceSize,
  getPayeeDecoder,
  INVOICE_DISCRIMINATOR,
  PAYEE_DISCRIMINATOR,
  Status,
  TUITION_ESCROW_PROGRAM_ADDRESS,
  type Invoice,
} from "@/generated/tuition-escrow";
import { DECIMALS } from "./constants";

type AnyRpc = Rpc<SolanaRpcApi>;

export { Status, type Invoice };

export type InvoiceRow = { address: Address; data: Invoice };

// --------------------------------------------------------------- reads

/** Raw data of an account only if this program owns it and it carries the expected discriminator.
 *  Anyone can create a look-alike account under another program and link to it, so nothing
 *  is decoded or shown without this check. */
async function ownedData(rpc: AnyRpc, addr: Address, discriminator: ArrayLike<number>): Promise<Uint8Array | null> {
  const acc = await fetchEncodedAccount(rpc, addr);
  if (!acc.exists || acc.programAddress !== TUITION_ESCROW_PROGRAM_ADDRESS) return null;
  const data = new Uint8Array(acc.data);
  for (let i = 0; i < discriminator.length; i++) if (data[i] !== discriminator[i]) return null;
  return data;
}

export async function fetchConfig(rpc: AnyRpc) {
  const [pda] = await findConfigPda();
  const data = await ownedData(rpc, pda, CONFIG_DISCRIMINATOR);
  return data ? getConfigDecoder().decode(data) : null;
}

export async function fetchPayeeName(rpc: AnyRpc, authority: Address): Promise<string | null> {
  const [pda] = await findPayeePda({ authority });
  const data = await ownedData(rpc, pda, PAYEE_DISCRIMINATOR);
  return data ? getPayeeDecoder().decode(data).name : null;
}

export async function fetchInvoice(rpc: AnyRpc, invoice: Address): Promise<Invoice | null> {
  const data = await ownedData(rpc, invoice, INVOICE_DISCRIMINATOR);
  return data && data.length === getInvoiceSize() ? getInvoiceDecoder().decode(data) : null;
}

/** The token program that owns a mint (classic SPL or Token-2022). */
export async function tokenProgramOf(rpc: AnyRpc, mint: Address): Promise<Address> {
  const acc = await fetchEncodedAccount(rpc, mint);
  if (!acc.exists) throw new Error("Mint not found on devnet.");
  return acc.programAddress;
}

export async function ataOf(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  return ata;
}

export async function tokenBalance(rpc: AnyRpc, owner: Address, mint: Address): Promise<bigint> {
  const program = await tokenProgramOf(rpc, mint);
  const acc = await fetchMaybeToken(rpc, await ataOf(owner, mint, program));
  return acc.exists ? acc.data.amount : 0n;
}

// ------------------------------------------------------------- listing

// Byte offsets inside an Invoice account (8-byte discriminator first).
const OFFSET = { payee: 8, payer: 40, office: 72, status: 284 } as const;

type Filter = { payee?: Address; office?: Address; status?: Status };

export async function listInvoices(rpc: AnyRpc, filter: Filter): Promise<InvoiceRow[]> {
  const b58 = getBase58Decoder();
  const memcmp = (offset: number, bytes: Uint8Array) => ({
    memcmp: {
      offset: BigInt(offset),
      bytes: b58.decode(bytes) as Base58EncodedBytes,
      encoding: "base58" as const,
    },
  });
  const filters = [
    { dataSize: BigInt(getInvoiceSize()) },
    memcmp(0, new Uint8Array(INVOICE_DISCRIMINATOR)),
  ];
  if (filter.payee) filters.push(memcmp(OFFSET.payee, new Uint8Array(getAddressEncoder().encode(filter.payee))));
  if (filter.office) filters.push(memcmp(OFFSET.office, new Uint8Array(getAddressEncoder().encode(filter.office))));
  if (filter.status !== undefined) filters.push(memcmp(OFFSET.status, new Uint8Array([filter.status])));

  const accounts = await rpc
    .getProgramAccounts(TUITION_ESCROW_PROGRAM_ADDRESS, { encoding: "base64", filters })
    .send();
  const decoder = getInvoiceDecoder();
  const b64 = getBase64Encoder();
  return accounts
    .map(({ pubkey, account }) => ({
      address: pubkey,
      data: decoder.decode(b64.encode(account.data[0])),
    }))
    .sort((a, b) => Number(b.data.createdAt - a.data.createdAt));
}

// ------------------------------------------------------------- history

export type Step = "Created" | "Locked" | "TRY sent" | "Signed" | "Refunded" | "Resolved";

const STEP_BY_IX: Record<string, Step> = {
  CreateInvoice: "Created",
  PayInvoice: "Locked",
  MarkPaid: "TRY sent",
  Acknowledge: "Signed",
  Refund: "Refunded",
  Resolve: "Resolved",
};

export type HistoryEntry = { step: Step; signature: Signature; blockTime: number | null };

/** Every program call that touched this invoice, oldest first, read straight from the chain. */
// Anchor logs the instruction name right after the runtime logs this program's invocation; a
// line anywhere else could come from any program that merely mentions the invoice account.
const INVOKE = `Program ${TUITION_ESCROW_PROGRAM_ADDRESS} invoke [`;

function escrowInstruction(logs: readonly string[]): string | undefined {
  for (let k = 1; k < logs.length; k++) {
    if (!logs[k - 1].startsWith(INVOKE)) continue;
    const name = /^Program log: Instruction: (\w+)$/.exec(logs[k])?.[1];
    if (name && STEP_BY_IX[name]) return name;
  }
  return undefined;
}

export async function invoiceHistory(rpc: AnyRpc, invoice: Address): Promise<HistoryEntry[]> {
  const sigs = await rpc.getSignaturesForAddress(invoice, { limit: 40 }).send();
  const entries = await Promise.all(
    sigs
      .filter((s) => s.err === null)
      .map(async (s) => {
        const tx = await rpc
          .getTransaction(s.signature, { maxSupportedTransactionVersion: 0, encoding: "json" })
          .send();
        const ix = escrowInstruction(tx?.meta?.logMessages ?? []);
        return ix
          ? { step: STEP_BY_IX[ix], signature: s.signature, blockTime: s.blockTime === null ? null : Number(s.blockTime) }
          : null;
      }),
  );
  return entries.filter((e): e is HistoryEntry => e !== null).reverse();
}

// ---------------------------------------------------------- formatting

/** Shows every significant decimal (at least two), so what is displayed is exactly what moves. */
export function formatAmount(base: bigint, decimals = DECIMALS): string {
  const value = Number(base) / 10 ** decimals;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: decimals });
}

export function formatTry(kurus: bigint): string {
  return (Number(kurus) / 100).toLocaleString("en-US", { style: "currency", currency: "TRY" });
}

/** Parses a decimal string ("300", "300.5") into base units without float rounding. */
export function parseAmount(input: string, decimals = DECIMALS): bigint | null {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(input.trim());
  if (!m || (m[2] ?? "").length > decimals) return null;
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

const SEASONS: Record<number, string> = { 1: "Fall", 2: "Spring", 3: "Summer" };

/** Term code = year * 10 + season (1 fall, 2 spring, 3 summer). */
export function formatTerm(term: number): string {
  return `${SEASONS[term % 10] ?? "Term"} ${Math.floor(term / 10)}`;
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function toHex(bytes: Uint8Array | ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(data: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/** A fresh random salt per request. It travels only in the family's link (#k=…), never on-chain,
 *  so a short student number cannot be brute-forced from the public hash. */
export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function linkSalt(hash: string): Uint8Array | null {
  const hex = /(?:^#|&)k=([0-9a-f]{32})(?:&|$)/i.exec(hash)?.[1];
  return hex ? Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16)) : null;
}

export function studentRefHash(invoice: Address, ref: string, salt: Uint8Array): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(`${invoice}:${ref.trim().toUpperCase()}:${toHex(salt)}`));
}

export function isExpired(inv: Invoice, nowSecs: number): boolean {
  return inv.deadline > 0n && BigInt(nowSecs) >= inv.deadline;
}

// --------------------------------------------------------------- errors

const PROGRAM_ERRORS: Record<number, string> = {
  6000: "Config is invalid.",
  6001: "One wallet cannot be both payout partner, arbiter and university.",
  6002: "Name must be 1 to 64 characters.",
  6003: "Amount must be more than zero.",
  6004: "Payment window is out of range.",
  6005: "This currency is not accepted.",
  6006: "This token has a transfer hook, which escrow does not support.",
  6007: "This payout partner is not on the approved list.",
  6008: "The family, payout partner and university must be three different wallets.",
  6009: "This request has already moved on. Refresh the page.",
  6010: "The payout partner reported sending lira. Only the university or the arbiter can settle it now.",
  6011: "Nothing reached escrow.",
  6012: "Attach the bank receipt first.",
  6013: "The deadline has passed.",
  6014: "The deadline has not passed yet.",
  6015: "Only the admin can do this.",
  6016: "Only the university that issued this request can confirm it.",
  6017: "Only the selected payout partner can do this.",
  6018: "Only the arbiter can do this.",
  6019: "Wrong currency for this request.",
  6020: "That account does not belong to the party in the ruling.",
  6021: "Math overflow.",
  6022: "Escrow balance does not match the expected payout.",
};

function findCustomCode(e: unknown, depth = 0): number | null {
  if (!e || typeof e !== "object" || depth > 8) return null;
  const obj = e as { context?: Record<string, unknown>; cause?: unknown };
  const code = obj.context?.code;
  if (typeof code === "number" && code >= 6000) return code;
  for (const next of [obj.cause, ...Object.values(obj.context ?? {})]) {
    const found = findCustomCode(next, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

export function describeError(e: unknown): string {
  const code = findCustomCode(e);
  if (code !== null && PROGRAM_ERRORS[code]) return PROGRAM_ERRORS[code];
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return "You cancelled the request in your wallet.";
  if (/insufficient (funds|lamports)|0x1\b/i.test(msg)) return "Not enough balance. Top up devnet SOL or tokens and try again.";
  if (/blockhash/i.test(msg)) return "The network took too long. Try again.";
  return msg;
}
