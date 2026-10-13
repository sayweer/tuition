import { isSome, type Address, type Instruction } from "@solana/kit";
import {
  fetchMint,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  getAllocateInstructionAsync,
  getContributeInstructionAsync,
  getDonateInstructionAsync,
  getExpireInstruction,
  getRefundInstruction,
  getSettleContributionInstructionAsync,
} from "@/generated/tuition-escrow";
import type { AppClient } from "@/app/providers";
import { ataOf, fetchPool, PoolMissingError, tokenProgramOf, type ContributionRow, type Invoice } from "./escrow";

/** Contribution PDAs are keyed by (invoice, contributor, nonce); a millisecond clock plus an
 *  index keeps several contributions sent in one batch distinct. */
export function newNonce(index = 0): bigint {
  return BigInt(Date.now()) * 100n + BigInt(index);
}

/** A Token-2022 transfer fee, as the program sees it: `gross` is what to send for exactly `net`
 *  to arrive, `net` is what arrives when `gross` is sent. Identity for classic SPL and fee-free mints. */
export type FeeModel = { gross: (net: bigint) => bigint; net: (gross: bigint) => bigint };
export const NO_FEE: FeeModel = { gross: (n) => n, net: (g) => g };

export async function feeModelOf(rpc: AppClient["rpc"], mint: Address): Promise<FeeModel> {
  if ((await tokenProgramOf(rpc, mint)) !== TOKEN_2022_PROGRAM_ADDRESS) return NO_FEE;
  const { data } = await fetchMint(rpc, mint);
  const ext = isSome(data.extensions)
    ? data.extensions.value.find((x) => x.__kind === "TransferFeeConfig")
    : undefined;
  if (ext?.__kind !== "TransferFeeConfig") return NO_FEE;
  // the fee charged is the one of the epoch the transaction lands in; a boundary crossing between
  // building and landing can make the net differ by the rate change (the program then refuses)
  const { epoch } = await rpc.getEpochInfo().send();
  const f = epoch >= ext.newerTransferFee.epoch ? ext.newerTransferFee : ext.olderTransferFee;
  const bps = BigInt(f.transferFeeBasisPoints);
  if (bps === 0n) return NO_FEE;
  // Token-2022 rounds the fee up and caps it at maximumFee
  const fee = (g: bigint) => {
    const raw = (g * bps + 9_999n) / 10_000n;
    return raw < f.maximumFee ? raw : f.maximumFee;
  };
  const net = (g: bigint) => g - fee(g);
  const gross = (target: bigint) => {
    if (target === 0n) return 0n;
    // the uncapped estimate and the capped answer are each within a step or two of the smallest fit;
    // net rises by 0 or 1 per unit sent, so every target is reachable
    const capped = target + f.maximumFee;
    const estimate = bps < 10_000n ? (target * 10_000n + 9_999n - bps) / (10_000n - bps) : capped;
    let g = estimate < capped ? estimate : capped;
    while (g > 0n && net(g - 1n) >= target) g--;
    while (net(g) < target) g++;
    return g;
  };
  return { gross, net };
}

/** Family, sponsor or foundation adds `amount` (what should arrive) to one request. */
export async function contributeIxs(
  client: AppClient,
  invoice: Address,
  inv: Invoice,
  amount: bigint,
  toPoolOnFail: boolean,
  nonceIndex = 0,
): Promise<Instruction[]> {
  const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
  return [
    await getContributeInstructionAsync({
      contributor: client.payer,
      invoice,
      contributorToken: await ataOf(client.payer.address, inv.mint, tokenProgram),
      mint: inv.mint,
      tokenProgram,
      nonce: newNonce(nonceIndex),
      amount: (await feeModelOf(client.rpc, inv.mint)).gross(amount),
      toPoolOnFail,
    }),
  ];
}

/** An unearmarked gift to the scholarship pool of `mint`. */
export async function donateIxs(client: AppClient, mint: Address, amount: bigint): Promise<Instruction[]> {
  const tokenProgram = await tokenProgramOf(client.rpc, mint);
  return [
    await getDonateInstructionAsync({
      donor: client.payer,
      donorToken: await ataOf(client.payer.address, mint, tokenProgram),
      mint,
      tokenProgram,
      amount,
    }),
  ];
}

/** The committee (arbiter) covers part of a request from the pool. */
export async function allocateIxs(client: AppClient, invoice: Address, inv: Invoice, amount: bigint): Promise<Instruction[]> {
  const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
  return [
    await getAllocateInstructionAsync({
      arbiter: client.payer,
      invoice,
      mint: inv.mint,
      tokenProgram,
      nonce: newNonce(),
      amount: (await feeModelOf(client.rpc, inv.mint)).gross(amount),
    }),
  ];
}

export function refundIxs(client: AppClient, invoice: Address): Instruction[] {
  return [getRefundInstruction({ caller: client.payer, invoice })];
}

export function expireIxs(client: AppClient, invoice: Address): Instruction[] {
  return [getExpireInstruction({ caller: client.payer, invoice })];
}

/** Sends one contribution of a failed request back to its giver, or into the pool. */
export async function settleIxs(
  client: AppClient,
  invoice: Address,
  inv: Invoice,
  contribution: ContributionRow,
): Promise<Instruction[]> {
  const tokenProgram = await tokenProgramOf(client.rpc, inv.mint);
  const c = contribution.data;
  // settle_contribution takes the mint's pool account on both branches, so without it nothing can settle.
  const pool = await fetchPool(client.rpc, inv.mint);
  if (!pool) throw new PoolMissingError();
  if (c.toPoolOnFail) {
    return [
      await getSettleContributionInstructionAsync({
        caller: client.payer,
        invoice,
        contribution: contribution.address,
        destination: pool.vault,
        mint: inv.mint,
        tokenProgram,
      }),
    ];
  }
  return [
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: client.payer,
      owner: c.contributor,
      mint: inv.mint,
      tokenProgram,
    }),
    await getSettleContributionInstructionAsync({
      caller: client.payer,
      invoice,
      contribution: contribution.address,
      destination: await ataOf(c.contributor, inv.mint, tokenProgram),
      mint: inv.mint,
      tokenProgram,
    }),
  ];
}
