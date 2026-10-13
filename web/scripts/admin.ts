// Devnet admin tasks, signed with the Solana CLI wallet.
//   pnpm admin status
//   pnpm admin init --arbiter <ADDR> --office <ADDR>
//   pnpm admin register --school <ADDR> --name "Example University"
//   pnpm admin mint --to <ADDR> --amount 1000        (mock dollar only)
//   pnpm admin pool                                   (scholarship pool for every allowed mint)
// Keypair: $SOLANA_KEYPAIR, else ~/.config/solana/tuition-devnet.json
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import {
  address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  devnet,
  fetchEncodedAccount,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  fetchMaybeConfig,
  findConfigPda,
  getInitConfigInstructionAsync,
  getInitPoolInstructionAsync,
  getRegisterPayeeInstructionAsync,
} from "../src/generated/tuition-escrow";
import { MINTS } from "../src/lib/constants";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(devnet(RPC));
const rpcSubscriptions = createSolanaRpcSubscriptions(devnet(RPC.replace(/^http/, "ws")));
const keypairPath = process.env.SOLANA_KEYPAIR ?? `${homedir()}/.config/solana/tuition-devnet.json`;
// Loaded once, and only by commands that sign; `status` never touches the key.
// Kit rejects two signer instances for one address, so every caller shares this one.
let adminSigner: ReturnType<typeof createKeyPairSignerFromBytes> | undefined;
const loadAdmin = () =>
  (adminSigner ??= createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(readFileSync(keypairPath, "utf8"))),
  ));
const MOCK_MINT = MINTS[1].address;

async function send(ixs: Instruction[]): Promise<string> {
  const admin = await loadAdmin();
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(admin, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(tx);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(tx, { commitment: "confirmed" });
  const sig = getSignatureFromTransaction(tx);
  console.log(`ok  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  return sig;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    arbiter: { type: "string" },
    office: { type: "string" },
    school: { type: "string" },
    name: { type: "string" },
    to: { type: "string" },
    amount: { type: "string" },
  },
});

function need(name: keyof typeof values): string {
  const v = values[name];
  if (!v) throw new Error(`--${name} is required`);
  return v;
}

async function main() {
  switch (positionals[0]) {
    case "status": {
      const [pda] = await findConfigPda();
      const cfg = await fetchMaybeConfig(rpc, pda);
      console.log(cfg.exists ? { config: pda, ...cfg.data, discriminator: undefined } : `no config at ${pda}`);
      break;
    }
    case "init": {
      const admin = await loadAdmin();
      await send([
        await getInitConfigInstructionAsync({
          admin,
          arbiter: address(need("arbiter")),
          allowedMints: MINTS.map((m) => m.address),
          offices: [address(need("office"))],
        }),
      ]);
      break;
    }
    case "register": {
      const admin = await loadAdmin();
      await send([
        await getRegisterPayeeInstructionAsync({ admin, authority: address(need("school")), name: need("name") }),
      ]);
      break;
    }
    case "pool": {
      const admin = await loadAdmin();
      for (const m of MINTS) {
        const owner = await fetchEncodedAccount(rpc, m.address);
        if (!owner.exists) throw new Error(`mint ${m.symbol} not found`);
        await send([
          await getInitPoolInstructionAsync({
            admin,
            mint: m.address,
            tokenProgram: owner.programAddress,
          }),
        ]);
      }
      break;
    }
    case "mint": {
      const admin = await loadAdmin();
      const owner = address(need("to"));
      const [ata] = await findAssociatedTokenPda({ owner, mint: MOCK_MINT, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
      await send([
        await getCreateAssociatedTokenIdempotentInstructionAsync({
          payer: admin,
          owner,
          mint: MOCK_MINT,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        }),
        getMintToInstruction({
          mint: MOCK_MINT,
          token: ata,
          mintAuthority: admin,
          amount: BigInt(Math.round(Number(need("amount")) * 1e6)),
        }),
      ]);
      break;
    }
    default:
      console.log("usage: pnpm admin <status|init|register|pool|mint> [--flags]");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
