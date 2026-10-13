# Tuition

**Live app: [tuition-omega.vercel.app](https://tuition-omega.vercel.app)** (Solana devnet)

A family abroad locks a Turkish university's tuition in USDG on Solana. Relatives, sponsors and donors can fill the same request in parts, each from their own wallet, and a scholarship pool covers students who fall short. A licensed payout partner pays the university in lira over FAST/EFT. The escrow is released to the partner only when the university signs for the lira with its own key. That signature stays on-chain as a tuition receipt that the family, the donors, the student and the university can each check on their own.

Built for the Colosseum Crypto World's Fair (Superteam Türkiye local track and Arf × Superteam TR university track). Runs on **Solana devnet** with test tokens.

## The problem

- About 337,000 international students study in Türkiye (YÖK, 2024–25). Registration requires paid tuition (Law 2547, art. 46-g).
- In January 2026 YÖK asked universities to defer tuition for Iranian students who could not get money out of Iran. Turkmen families are capped at roughly $200 a month. Syrian families rely on multi-hop hawala with fees of up to $20.
- Foreigners cannot easily open a Turkish bank account without residency. When a payment gets stuck, nobody can see where.

## How it works

```
University ──create_invoice──▶ ┌──────────────────────────────┐
                               │ Invoice PDA  (the receipt)   │
Family, sponsor, donor         │ Vault PDA    (escrowed USDG) │
   ──contribute (any part)───▶ │ one Contribution PDA each    │
Scholarship pool ──allocate──▶ └──────────────────────────────┘
                     raised == amount → Funded, payout deadline starts
Payout partner ── FAST/EFT in TRY (off-chain) ──▶ university bank
Payout partner ──mark_paid(sha256 of bank receipt)──▶ Invoice
University ──acknowledge (own key)──▶ vault → payout partner, status Released
```

Every contribution records where it goes if the request fails: back to the giver's wallet, or into the scholarship pool. Families get their money back. Donors usually choose the pool, so a gift that missed one student reaches another.

| Situation | Outcome |
|---|---|
| The university confirms receipt (`acknowledge`) | Vault goes to the payout partner. The invoice freezes as `Released`: this is the receipt. |
| The collecting period ends before the full amount is raised | **Anyone** can call `expire`, then `settle_contribution` for each gift: it goes back to its giver or into the pool, as chosen. |
| The payout deadline passes and the partner never claimed payout | **Anyone** can call `refund`, then settle each contribution the same way. |
| The partner claimed payout (`mark_paid`) but the university never confirmed | Funds freeze. After the deadline, and at least `MIN_WINDOW_SECS` after the claim, the arbiter sends them to the partner or releases the contributions. **There is no default payout to the partner.** |

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
web/scripts/admin.ts       devnet admin tasks (config, university registry, pools, mock mint)
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
| `init_pool` | admin | Creates the scholarship pool and its vault for one allowed mint |
| `create_invoice(nonce, amount, amount_try_kurus, term, student_ref_hash, window_secs, funding_secs)` | registered university | Opens an invoice with a listed partner and a collecting period, and creates an empty vault |
| `contribute(nonce, amount, to_pool_on_fail)` | anyone but the university and its partner | Adds up to what is still missing and records a Contribution. Reaching the amount starts the payout deadline. |
| `donate(amount)` | anyone | An unearmarked gift to the pool |
| `allocate(nonce, amount)` | arbiter (scholarship committee) | Moves pool money into a request that is still collecting; on failure it returns to the pool |
| `mark_paid(bank_receipt_hash)` | payout partner | Records the bank receipt hash before the deadline |
| `acknowledge` | university | Pays the vault to the partner. Allowed whether or not the partner marked paid, and after the deadline. |
| `expire` | anyone | After the collecting period, if the status is still `Open`: marks the request `Expired` |
| `refund` | anyone | After the payout deadline, if the status is still `Funded`: marks the request `Refunded` |
| `resolve(to_office)` | arbiter | `Paid`, deadline passed and review window over: pays the partner, or releases the contributions |
| `settle_contribution` | anyone | After a failure: sends one contribution to its giver's account or to the pool vault, once |

**Safety properties, each covered by a LiteSVM test (20 tests):**
- Every instruction rejects the wrong signer.
- Final states (`Released`, `Refunded`, `Resolved`, `Expired`) are terminal: no double payment, no double release.
- `refund` and `expire` are rejected before their deadlines; `refund` is rejected once the partner has claimed payout.
- A contribution can exceed neither what is missing nor be settled twice, and it can only go to its giver or to the pool vault.
- The vault pays out exactly what it booked: value is conserved, and stray transfers into the vault cannot block a payout or inflate it.
- Only allowed mints are accepted. The university and its partner cannot contribute to their own request.
- **Token-2022:**
  - classic SPL and Token-2022 both work through `token_interface`;
  - with a transfer fee, the vault books what actually arrived, and the cap on a contribution applies to that amount: the app sends just enough extra for the net to close the gap, so a fee-bearing request still reaches `Funded`;
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
| `/pay/<invoice>` | Family: check the student number, pay all or part, see contributions, send them back after a failure |
| `/give` | Donors: pick open requests (or paste a tuition link), give part or all, review a summary, pay; or give to the pool |
| `/office` | Payout partner: queue, hash the bank receipt in the browser, report the lira as sent |
| `/arbiter` | Arbiter and scholarship committee: direct the pool, rule on expired disputes |
| `/receipt/<invoice>` | Public, printable receipt with an Explorer link for every step |

### Admin (devnet)

```bash
cd web
pnpm admin status
pnpm admin init --arbiter <ARBITER> --office <PARTNER>
pnpm admin register --school <UNIVERSITY_WALLET> --name "Example University"
pnpm admin pool                                          # one scholarship pool per allowed mint
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
- **Open contributions.** Anyone can contribute to a request with its address. Donors find requests on `/give`; student numbers cannot be searched because they are salted.
- **Pool trust.** The scholarship committee (the arbiter key) decides where pool money goes. Pool gifts are not refundable to donors.
- **Settlement is a crank.** After a failure, money moves only when someone calls `settle_contribution`. Anyone can, and the app offers a button for it; the destination is fixed by the contribution itself.
- **No cancellation.** An unfunded invoice cannot be cancelled, and accounts are never closed: the receipt is kept on purpose.
- **Issuer risk (USDG).**
  - Paxos holds the permanent delegate, freeze, transfer-fee and transfer-hook authorities on the USDG mint. It can move or freeze tokens in the vault.
  - Enabling a hook after funding blocks payouts until Paxos disables it.
  - A non-zero fee means givers pay slightly more than what reaches escrow, and a contribution that goes back loses the fee again.
  - The payout also pays the fee on its way out, so the partner receives the raised amount minus that fee.
  - After a partial clawback from a failed request's vault, `settle_contribution` pays contributions in full in the order they are settled, so the last ones settled absorb the shortfall.
- **CPI Guard.** A payer whose Token-2022 account has CPI Guard enabled cannot pay through the program; use a regular account.

## Disclosure

Everything in this repository was written during the hackathon window (from 12 October 2026), with AI assistance. No code from earlier projects is reused.

## License

MIT, see [LICENSE](LICENSE).
