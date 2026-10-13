import {
  fetchEncodedAccount,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Encoder,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__INSTRUCTION_ERROR__INSUFFICIENT_FUNDS,
  SOLANA_ERROR__SIGNER__WALLET_ACCOUNT_CANNOT_SIGN_TRANSACTION,
  SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT,
  SOLANA_ERROR__WALLET__ACCOUNT_NOT_AVAILABLE,
  SOLANA_ERROR__WALLET__NO_SIGNER_CONNECTED,
  SOLANA_ERROR__WALLET__NOT_CONNECTED,
  SOLANA_ERROR__WALLET__SIGNER_NOT_AVAILABLE,
  type Address,
  type Base58EncodedBytes,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from "@solana/kit";
import { findAssociatedTokenPda, fetchMaybeToken } from "@solana-program/token-2022";
import {
  CONFIG_DISCRIMINATOR,
  CONTRIBUTION_DISCRIMINATOR,
  findConfigPda,
  findPayeePda,
  findPoolPda,
  findPoolVaultPda,
  getConfigDecoder,
  getContributionDecoder,
  getContributionSize,
  getInvoiceDecoder,
  getInvoiceSize,
  getPayeeDecoder,
  getPoolDecoder,
  INVOICE_DISCRIMINATOR,
  PAYEE_DISCRIMINATOR,
  POOL_DISCRIMINATOR,
  Status,
  TUITION_ESCROW_PROGRAM_ADDRESS,
  type Contribution,
  type Invoice,
  type Pool,
} from "@/generated/tuition-escrow";
import { DECIMALS } from "./constants";
import { locale, type Dict, type Lang } from "./i18n";

type AnyRpc = Rpc<SolanaRpcApi>;

export { Status, type Contribution, type Invoice, type Pool };

export type InvoiceRow = { address: Address; data: Invoice };
export type ContributionRow = { address: Address; data: Contribution };

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
const OFFSET = { payee: 8, office: 40, status: 264 } as const;

type Filter = { payee?: Address; office?: Address; status?: Status };

export async function listInvoices(rpc: AnyRpc, filter: Filter): Promise<InvoiceRow[]> {
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

/** Every contribution to one request, oldest first. */
export async function listContributions(rpc: AnyRpc, invoice: Address): Promise<ContributionRow[]> {
  const filters = [
    { dataSize: BigInt(getContributionSize()) },
    memcmp(0, new Uint8Array(CONTRIBUTION_DISCRIMINATOR)),
    memcmp(8, new Uint8Array(getAddressEncoder().encode(invoice))),
  ];
  const accounts = await rpc
    .getProgramAccounts(TUITION_ESCROW_PROGRAM_ADDRESS, { encoding: "base64", filters })
    .send();
  const decoder = getContributionDecoder();
  const b64 = getBase64Encoder();
  return accounts
    .map(({ pubkey, account }) => ({ address: pubkey, data: decoder.decode(b64.encode(account.data[0])) }))
    .sort((a, b) => Number(a.data.createdAt - b.data.createdAt));
}

export type PoolInfo = { address: Address; vault: Address; data: Pool; balance: bigint };

/** The scholarship pool for a mint, with what it holds right now. */
export async function fetchPool(rpc: AnyRpc, mint: Address): Promise<PoolInfo | null> {
  const [address] = await findPoolPda({ mint });
  const raw = await ownedData(rpc, address, POOL_DISCRIMINATOR);
  if (!raw) return null;
  const [vault] = await findPoolVaultPda({ pool: address });
  const acc = await fetchMaybeToken(rpc, vault);
  return { address, vault, data: getPoolDecoder().decode(raw), balance: acc.exists ? acc.data.amount : 0n };
}

export function remainingOf(inv: Invoice): bigint {
  return inv.amount > inv.raised ? inv.amount - inv.raised : 0n;
}

export function isFundingOpen(inv: Invoice, nowSecs: number): boolean {
  return inv.status === Status.Open && BigInt(nowSecs) < inv.fundingDeadline;
}

/** A failed request: its contributions can be settled back (to givers or to the pool). */
export function isSettleable(inv: Invoice): boolean {
  return (
    inv.status === Status.Refunded ||
    inv.status === Status.Expired ||
    (inv.status === Status.Resolved && !inv.resolvedToOffice)
  );
}

const b58 = getBase58Decoder();
function memcmp(offset: number, bytes: Uint8Array) {
  return {
    memcmp: {
      offset: BigInt(offset),
      bytes: b58.decode(bytes) as Base58EncodedBytes,
      encoding: "base58" as const,
    },
  };
}

// ------------------------------------------------------------- history

export type Step = "Created" | "Contributed" | "TRY sent" | "Signed" | "Refunded" | "Resolved" | "Expired";

const STEP_BY_IX: Record<string, Step> = {
  CreateInvoice: "Created",
  Contribute: "Contributed",
  Allocate: "Contributed",
  MarkPaid: "TRY sent",
  Acknowledge: "Signed",
  Refund: "Refunded",
  Resolve: "Resolved",
  Expire: "Expired",
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
export function formatAmount(base: bigint, lang: Lang = "en"): string {
  const value = Number(base) / 10 ** DECIMALS;
  return value.toLocaleString(locale(lang), { minimumFractionDigits: 2, maximumFractionDigits: DECIMALS });
}

export function formatTry(kurus: bigint, lang: Lang = "en"): string {
  return (Number(kurus) / 100).toLocaleString(locale(lang), { style: "currency", currency: "TRY" });
}

export function formatDateTime(unixSecs: number | bigint, lang: Lang = "en"): string {
  return new Date(Number(unixSecs) * 1000).toLocaleString(lang === "tr" ? "tr-TR" : "en-GB");
}

/** Whole part (bare digits or well-formed thousands groups), then an optional decimal part. */
const AMOUNT_RE: Dict<RegExp> = {
  en: /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d*))?$/,
  tr: /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d*))?$/,
};

/** Parses an amount the way `formatAmount` writes it in `lang` into base units, without float
 *  rounding: EN "1,500.25" (comma groups, dot is decimal), TR "1.500,25" (dot groups, comma is
 *  decimal). Grouping is optional but must be well formed, so EN "1,5" or TR "12.5" is rejected
 *  rather than guessed. More decimals than the unit allows is rejected, not truncated. */
export function parseAmount(input: string, lang: Lang, decimals = DECIMALS): bigint | null {
  const m = AMOUNT_RE[lang].exec(input.replace(/\s/g, ""));
  if (!m || (m[2] ?? "").length > decimals) return null;
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  return BigInt(m[1].replace(/\D/g, "")) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

const SEASONS: Dict<Record<number, string>> = {
  en: { 1: "Fall", 2: "Spring", 3: "Summer" },
  tr: { 1: "Güz", 2: "Bahar", 3: "Yaz" },
};

/** Term code = year * 10 + season (1 fall, 2 spring, 3 summer). */
export function formatTerm(term: number, lang: Lang = "en"): string {
  const season = SEASONS[lang][term % 10] ?? (lang === "tr" ? "Dönem" : "Term");
  const year = Math.floor(term / 10);
  return lang === "tr" ? `${year} ${season}` : `${season} ${year}`;
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

const PROGRAM_ERRORS: Dict<Record<number, string>> = {
  en: {
    6000: "Config is invalid.",
    6001: "One wallet cannot be both payout partner, arbiter and university.",
    6002: "Name must be 1 to 64 characters.",
    6003: "Amount must be more than zero and no more than what is still missing.",
    6004: "Payment window is out of range.",
    6005: "This currency is not accepted.",
    6006: "This token has a transfer hook, which escrow does not support.",
    6007: "This payout partner is not on the approved list.",
    6008: "The university and its payout partner cannot contribute to their own request.",
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
    6020: "That account does not belong to the party the ruling or contribution names.",
    6021: "Math overflow.",
    6022: "Escrow balance does not match the expected payout.",
    6023: "This contribution has already been sent back.",
  },
  tr: {
    6000: "Yapılandırma geçersiz.",
    6001: "Bir cüzdan hem ödeme ortağı, hem hakem, hem de üniversite olamaz.",
    6002: "Ad 1 ile 64 karakter arasında olmalı.",
    6003: "Tutar sıfırdan büyük ve eksik kalandan fazla olmamalı.",
    6004: "Ödeme süresi izin verilen aralığın dışında.",
    6005: "Bu para birimi kabul edilmiyor.",
    6006: "Bu token'da transfer hook var; emanet hesabı bunu desteklemiyor.",
    6007: "Bu ödeme ortağı onaylı listede değil.",
    6008: "Üniversite ve ödeme ortağı kendi taleplerine katkı yapamaz.",
    6009: "Bu talep bir sonraki aşamaya geçmiş. Sayfayı yenileyin.",
    6010: "Ödeme ortağı lirayı gönderdiğini bildirdi. Artık yalnızca üniversite ya da hakem sonuçlandırabilir.",
    6011: "Emanet hesabına hiçbir şey ulaşmadı.",
    6012: "Önce banka dekontunu ekleyin.",
    6013: "Son tarih geçti.",
    6014: "Son tarih henüz gelmedi.",
    6015: "Bunu yalnızca yönetici yapabilir.",
    6016: "Bu talebi yalnızca onu açan üniversite onaylayabilir.",
    6017: "Bunu yalnızca seçilen ödeme ortağı yapabilir.",
    6018: "Bunu yalnızca hakem yapabilir.",
    6019: "Bu talep için yanlış para birimi.",
    6020: "Bu hesap, kararda ya da katkıda adı geçen tarafa ait değil.",
    6021: "Hesaplama taşması.",
    6022: "Emanet bakiyesi beklenen ödemeyle eşleşmiyor.",
    6023: "Bu katkı zaten geri gönderildi.",
  },
};

const TX_ERRORS: Dict<{
  cancelled: string;
  balance: string;
  slow: string;
  noWallet: string;
  poolMissing: string;
  generic: string;
}> = {
  en: {
    cancelled: "You cancelled the request in your wallet.",
    balance: "Not enough balance. Top up devnet SOL or tokens and try again.",
    slow: "The network took too long. Try again.",
    noWallet: "Connect your wallet and try again.",
    poolMissing: "The scholarship pool for this currency is not set up yet.",
    generic: "The transaction did not go through. Try again; details are in the browser console.",
  },
  tr: {
    cancelled: "İsteği cüzdanınızda iptal ettiniz.",
    balance: "Bakiye yetersiz. Devnet SOL ya da token yükleyip tekrar deneyin.",
    slow: "Ağ çok geç yanıt verdi. Tekrar deneyin.",
    noWallet: "Cüzdanınızı bağlayıp tekrar deneyin.",
    poolMissing: "Bu para birimi için burs havuzu henüz kurulmadı.",
    generic: "İşlem gerçekleşmedi. Tekrar deneyin; ayrıntılar tarayıcı konsolunda.",
  },
};

/** Thrown before sending when the mint has no scholarship pool; describeError words it per language. */
export class PoolMissingError extends Error {
  constructor() {
    super("The scholarship pool for this currency is not set up yet.");
    this.name = "PoolMissingError";
  }
}

/** EIP-1193 / Phantom "user rejected" and its Wallet Standard counterpart
 *  (WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED). */
const USER_REJECTED = [4001, 4001000];
/** ACCOUNT_NOT_FOUND is what preflight returns for a fee payer with 0 SOL ("no record of a prior credit"). */
const BALANCE_CODES = [
  SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT,
  SOLANA_ERROR__INSTRUCTION_ERROR__INSUFFICIENT_FUNDS,
];
const SLOW_CODES = [SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED, SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND];
const NO_WALLET_CODES = [
  SOLANA_ERROR__WALLET__NOT_CONNECTED,
  SOLANA_ERROR__WALLET__NO_SIGNER_CONNECTED,
  SOLANA_ERROR__WALLET__SIGNER_NOT_AVAILABLE,
  SOLANA_ERROR__WALLET__ACCOUNT_NOT_AVAILABLE,
  SOLANA_ERROR__SIGNER__WALLET_ACCOUNT_CANNOT_SIGN_TRANSACTION,
];
/** Custom codes below the program's own 6000+: SPL Token InsufficientFunds (also the system
 *  program's negative-lamports error), and Anchor AccountNotInitialized for a payer with no token account. */
const BALANCE_CUSTOM = [1, 3012];

type ErrorNode = { message?: unknown; code?: unknown; cause?: unknown; context?: Record<string, unknown> };

/** The error plus everything reachable through `cause` and `context`, outermost first. In production
 *  builds kit's own message is only "Solana error #N; Decode…", so the wallet's readable text and the
 *  program's custom code sit further down this chain. */
function errorChain(e: unknown, depth = 0, out: ErrorNode[] = []): ErrorNode[] {
  if (!e || typeof e !== "object" || depth > 8) return out;
  const node = e as ErrorNode;
  out.push(node);
  for (const next of [node.cause, ...Object.values(node.context ?? {})]) errorChain(next, depth + 1, out);
  return out;
}

function findCustomCode(chain: ErrorNode[]): number | null {
  for (const { context } of chain) {
    const code = context?.code;
    const custom = context?.__code === SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM;
    if (typeof code === "number" && (custom || code >= 6000)) return code;
  }
  return null;
}

/** A short message in `lang` for any send failure. Never returns raw kit text; callers log the error itself. */
export function describeError(e: unknown, lang: Lang = "en"): string {
  const w = TX_ERRORS[lang];
  const chain = errorChain(e);
  const code = findCustomCode(chain);
  if (code !== null && PROGRAM_ERRORS[lang][code]) return PROGRAM_ERRORS[lang][code];
  if (chain.some((n) => n instanceof PoolMissingError)) return w.poolMissing;
  const kit = (codes: number[]) => chain.some((n) => codes.includes(n.context?.__code as number));
  const text = chain
    .map((n) => n.message)
    .filter((m): m is string => typeof m === "string" && !m.startsWith("Solana error #"))
    .join("\n");
  const rejected = chain.some((n) => USER_REJECTED.includes(n.code as number)) || kit(USER_REJECTED);
  if (rejected || /reject|denied|cancel/i.test(text)) return w.cancelled;
  const lowBalance = (code !== null && BALANCE_CUSTOM.includes(code)) || kit(BALANCE_CODES);
  if (lowBalance || /insufficient (funds|lamports)|0x1\b/i.test(text)) return w.balance;
  if (kit(SLOW_CODES) || /blockhash|block height exceeded/i.test(text)) return w.slow;
  if (kit(NO_WALLET_CODES)) return w.noWallet;
  return w.generic;
}
