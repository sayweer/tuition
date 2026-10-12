# Tuition

**Live app: [tuition-omega.vercel.app](https://tuition-omega.vercel.app)** (Solana devnet)

A family abroad locks a Turkish university's tuition in USDG on Solana. A licensed payout partner pays the university in lira over FAST/EFT. The escrow is released to the partner only when the university signs for the lira with its own key. That signature stays on-chain as a tuition receipt that the family, the student and the university can each check on their own.

Built for the Colosseum Crypto World's Fair (Superteam Türkiye local track and Arf × Superteam TR university track). Runs on **Solana devnet** with test tokens.

## The problem

- About 337,000 international students study in Türkiye (YÖK, 2024–25). Registration requires paid tuition (Law 2547, art. 46-g).
- In January 2026 YÖK asked universities to defer tuition for Iranian students who could not get money out of Iran. Turkmen families are capped at roughly $200 a month. Syrian families rely on multi-hop hawala with fees of up to $20.
- Foreigners cannot easily open a Turkish bank account without residency. When a payment gets stuck, nobody can see where.

## How it works

```
University ──create_invoice──▶ ┌──────────────────────────────┐
                               │ Invoice PDA  (the receipt)   │
Family ──pay_invoice (USDG)──▶ │ Vault PDA    (escrowed USDG) │
                               └──────────────────────────────┘
Payout partner ── FAST/EFT in TRY (off-chain) ──▶ university bank
Payout partner ──mark_paid(sha256 of bank receipt)──▶ Invoice
University ──acknowledge (own key)──▶ vault → payout partner, status Released
```

| Situation | Outcome |
|---|---|
| The university confirms receipt (`acknowledge`) | Vault goes to the payout partner. The invoice freezes as `Released`: this is the receipt. |
| The deadline passes and the partner never claimed payout | **Anyone** can call `refund`. The full amount goes back to the family. |
| The partner claimed payout (`mark_paid`) but the university never confirmed | Funds freeze. After the deadline, and at least `MIN_WINDOW_SECS` after the claim, the arbiter sends them to the partner or back to the family. **There is no default payout to the partner.** |

### Why Solana

1. **One rule binds three parties who don't trust each other:** the money is either delivered or refunded. The partner can front lira without credit risk because it can see the USDG locked in a program it does not control.
2. **The payee signs the receipt.** No single platform's database holds it. The family, the student and the university verify the same account independently.
3. **USDG is native on Solana.** Fees are a fraction of a cent and settlement takes seconds.

A closed app could keep this flow in a database. The chain adds the three properties above, and we say so in the pitch.

The partner's job is what Arf finances for licensed payment companies: same-day local payout **without prefunding**. This project does not integrate with Arf. Arf has no public API.

## Repository

```
programs/tuition_escrow/   Anchor 1.1.2 program + LiteSVM tests
idl/                       Anchor IDL (source for the generated client)
web/                       Next.js 16 app on @solana/kit 8 (Wallet Standard: Phantom, Solflare)
web/src/generated/         Codama client generated from idl/ (pnpm codama)
web/scripts/admin.ts       devnet admin tasks (config, university registry, mock mint)
```

## Devnet addresses

| What | Address |
|---|---|
| Program | `E2cES7pe38nkQk1a9J7BXkP3htCAueFsE3TrZCHnRh1A` |
| Config PDA | `7zb8AKaW2bD4BjngzrahXam4Zh1HcVoRruWqnDmEui42` |
| USDG (Paxos devnet, Token-2022, 6 decimals) | `4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7`. Faucet: [faucet.paxos.com](https://faucet.paxos.com) |
| Mock dollar (Token-2022, 6 decimals, demo fallback) | `7ZZoiCgpjzjDUbu7XxCNhfz7rnvhHSxKJCRe7mkz6NYz` |

## Program

| Instruction | Signer | Effect |
|---|---|---|
| `init_config` | admin (first caller) | Sets the arbiter, allowed mints (≤3) and payout partners (≤3) |
| `update_config` | admin | Replaces the same fields |
| `register_payee(name)` | admin | Registers a university finance wallet |
| `create_invoice(nonce, amount, amount_try_kurus, term, student_ref_hash, window_secs)` | registered university | Opens an invoice and creates an empty vault |
| `pay_invoice` | family | Locks `amount`, picks a listed partner, starts the deadline |
| `mark_paid(bank_receipt_hash)` | payout partner | Records the bank receipt hash before the deadline |
| `acknowledge` | university | Pays the vault to the partner. Allowed whether or not the partner marked paid, and after the deadline. |
| `refund` | anyone | After the deadline, if the status is still `Funded`: pays the vault back to the family |
| `resolve(to_office)` | arbiter | `Paid`, deadline passed and review window over: pays to the partner or to the family |

**Safety properties, each covered by a LiteSVM test (20 tests):**
- Every instruction rejects the wrong signer.
- Final states (`Released`, `Refunded`, `Resolved`) are terminal: no double payment, no double release.
- `refund` is rejected before the deadline and once the partner has claimed payout.
- The vault pays out exactly what it booked: value is conserved, and donations to the vault cannot block a payout or inflate it.
- Only allowed mints are accepted. The payer, the partner and the university must be three different wallets.
- **Token-2022:**
  - classic SPL and Token-2022 both work through `token_interface`;
  - with a transfer fee, the vault books what actually arrived;
  - mints with an active transfer hook are refused at creation and at payment.
- A partial clawback by the issuer's permanent delegate pays out the remainder instead of locking the vault.

### Build and test

Tested with Anchor 1.1.2, Solana CLI 4.1.1, Rust 1.98 and Node 22+.

```bash
anchor build                        # program, IDL, TS types
cargo test -p tuition_escrow        # 20 LiteSVM tests (needs target/deploy/tuition_escrow.so)
```

### Web app

```bash
cd web
pnpm install
pnpm codama        # regenerate the client after an IDL change
pnpm dev           # http://localhost:3000
pnpm build && pnpm lint && pnpm typecheck
```

Optional `NEXT_PUBLIC_SOLANA_RPC_URL` points the app at another devnet RPC. The default is `https://api.devnet.solana.com`.

| Page | For |
|---|---|
| `/school` | University desk: issue a request (link + QR), confirm receipt |
| `/pay/<invoice>` | Family: check the student number, lock funds, refund after the deadline |
| `/office` | Payout partner: queue, hash the bank receipt in the browser, report the lira as sent |
| `/arbiter` | Arbiter: rule on expired disputes |
| `/receipt/<invoice>` | Public, printable receipt with an Explorer link for every step |

### Admin (devnet)

```bash
cd web
pnpm admin status
pnpm admin init --arbiter <ARBITER> --office <PARTNER>
pnpm admin register --school <UNIVERSITY_WALLET> --name "Example University"
pnpm admin mint --to <FAMILY_WALLET> --amount 1000      # mock dollar
```

The script signs with `~/.config/solana/tuition-devnet.json`. Set `SOLANA_KEYPAIR` to use another key.

## What this demo does not claim

- **No lira moves on-chain.** The chain cannot prove that the partner paid. The proof is the university's own signature.
- **Partners must be licensed.** In production the payout partner has to be a licensed payment institution (Law 6493) and carries KYC. Crypto is not used to pay for services in Türkiye: the university receives lira from its bank (CBRT 2021 rule).
- **No personal data on-chain.** There are no names, IBANs or student numbers. The student reference is `sha256(invoice_address:STUDENT_NUMBER:salt)`. The salt is random per request and travels only in the family's link (`#k=…`, a URL fragment that never reaches a server). Nobody can brute-force the student number from the public hash, while a family holding the link can still check it.

## Known limits and risks

- **Demo timing.** `MIN_WINDOW_SECS = 20` exists so a demo can show expiry live. A real deployment needs windows of a day or more, and the partner should call `mark_paid` as it sends the lira, not afterwards.
- **One arbiter key.** A real deployment needs a 2-of-3 panel or a tie-breaker; two arbiters alone can deadlock 1–1. The admin can replace the arbiter and the partner list at any time. The admin role cannot be transferred and a university cannot be revoked.
- **First caller becomes admin.** `init_config` is first-caller-wins, so deploy and init back to back.
- **Payer not fixed.** An invoice is not tied to a specific payer wallet. Anyone can fund it first; they pay the tuition with their own money.
- **No cancellation.** An unfunded invoice cannot be cancelled, and accounts are never closed: the receipt is kept on purpose.
- **Issuer risk (USDG).**
  - Paxos holds the permanent delegate, freeze, transfer-fee and transfer-hook authorities on the USDG mint. It can move or freeze tokens in the vault.
  - Enabling a hook after funding blocks payouts until Paxos disables it.
  - A higher fee reduces what recipients get.
- **CPI Guard.** A payer whose Token-2022 account has CPI Guard enabled cannot pay through the program; use a regular account.

## Disclosure

Everything in this repository was written during the hackathon window (from 12 October 2026), with AI assistance. No code from earlier projects is reused.

## License

MIT, see [LICENSE](LICENSE).
