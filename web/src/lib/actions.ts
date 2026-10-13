import type { Address, Instruction } from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token-2022";
import {
  getAllocateInstructionAsync,
  getContributeInstructionAsync,
  getDonateInstructionAsync,
  getExpireInstruction,
  getRefundInstruction,
  getSettleContributionInstructionAsync,
} from "@/generated/tuition-escrow";
import type { AppClient } from "@/app/providers";
import { ataOf, fetchPool, tokenProgramOf, type ContributionRow, type Invoice } from "./escrow";

/** Contribution PDAs are keyed by (invoice, contributor, nonce); a millisecond clock plus an
 *  index keeps several contributions sent in one batch distinct. */
export function newNonce(index = 0): bigint {
  return BigInt(Date.now()) * 100n + BigInt(index);
}

/** Family, sponsor or foundation adds `amount` to one request. */
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
      amount,
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
      amount,
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
  if (c.toPoolOnFail) {
    const pool = await fetchPool(client.rpc, inv.mint);
    if (!pool) throw new Error("The scholarship pool for this currency is not set up yet.");
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
