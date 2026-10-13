# Security audit — 2026-10-13

Scope: `programs/tuition_escrow/src/lib.rs` (Anchor 1.1.2, devnet `E2cES7pe38nkQk1a9J7BXkP3htCAueFsE3TrZCHnRh1A`), the Next.js client in `web/src`, and `web/scripts/admin.ts`.
Commit: `edc047e`. This is an internal review. It does not replace an external audit.

## Summary

| Severity | Program | Web | Total |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 1 | 1 | 2 |
| Low | 3 | 6 | 9 |
| Info | 7 | 6 | 13 |

No fund-theft path was found. Every fund-moving instruction (`contribute`, `donate`, `allocate`, `acknowledge`, `resolve`, `settle_contribution`) checks the PDA with its stored bump, enforces `has_one` on mint and role, ties signers to stored state and uses `transfer_checked` through `token_interface`. Each one reloads the vault after the CPI and checks conservation.

## Instruction map

| Instruction | Signer | Moves funds / authority | Notes |
|---|---|---|---|
| `init_config` | first caller | sets admin | first-caller-wins (L-3) |
| `update_config` | admin | arbiter, mints, offices | |
| `register_payee` | admin | university role | no revoke (documented) |
| `init_pool` | admin | creates pool vault | requires the mint to be on the allow list |
| `create_invoice` | payee | creates vault | |
| `contribute` | anyone | user → vault | |
| `donate` | anyone | user → pool vault | |
| `allocate` | arbiter | pool vault → invoice vault | |
| `mark_paid` | office | status only | |
| `acknowledge` | payee | vault → office | |
| `refund` / `expire` | anyone | status only | |
| `resolve` | arbiter | vault → office, or unlock refunds | |
| `settle_contribution` | anyone | vault → contributor or pool | |

## Program findings

### M-1 · Refunds are locked when the invoice's mint has no pool
- **Location:** `lib.rs:1218-1224` (`SettleContribution.pool`, a required `Account<Pool>`), `lib.rs:79-82` (`init_pool` allow-list check)
- **Instruction:** `settle_contribution`
- **Scenario:** The admin adds a second mint to `allowed_mints` with `update_config` but does not run `init_pool` for it. A university creates an invoice in that mint, and a family contributes with `to_pool_on_fail = false`. The invoice expires. Every `settle_contribution` call then fails with `AccountNotInitialized` (3012) on `pool`, even though this refund never touches the pool. If the admin later removes that mint from the allow list, `init_pool` fails with `MintNotAllowed` and the refund stays locked until the mint is re-added. Only the admin can unlock it.
- **Verified:** a temporary LiteSVM PoC (deleted afterwards) reproduced all of the above. The vault kept 100 USDG and settle failed with 3012.
- **Fix:** take a `pool` account in `CreateInvoice` (seeds `[POOL_SEED, mint]`, `has_one = mint`) so an invoice cannot exist without its pool. Alternatively, make `SettleContribution.pool` an `Option<…>` that is required only when `to_pool_on_fail` is set.

### L-1 · A dust contribution can front-run the one that would complete the request
- **Location:** `lib.rs:228` (`require!(deposited <= remaining)`); `allocate` at `lib.rs:350` behaves the same way
- **Scenario:** A family sends a contribution that covers exactly what is missing. An attacker watching the mempool or leader lands a 1-base-unit `contribute` first. `remaining` drops by 1 and the family's transaction fails with `InvalidAmount`. The attacker can repeat this each time, at a cost of about 0.0016 SOL in contribution-PDA rent plus 1 unit. The rent is never reclaimed. Arbiter allocations can be blocked the same way.
- **Fix:** for mints without a transfer fee, clamp on-chain: transfer `min(amount, remaining)` and stop rejecting the overshoot. For fee mints, keep the reject or compute the gross amount from the fee config.

### L-2 · `MIN_WINDOW_SECS = 20` doubles as the university's review window
- **Location:** `lib.rs:21`, `lib.rs:477-484`
- **Scenario:** The office calls `mark_paid` one second before `deadline`. The arbiter can then rule 20 seconds later, so the university effectively gets no time to respond. This is documented as a demo setting. It must change before any real deployment.
- **Fix:** split the constants. Keep a demo funding floor, and use a day-scale `REVIEW_SECS` for the arbiter gate.

### L-3 · `init_config` is first-caller-wins
- **Location:** `lib.rs:29-39`, `lib.rs:843-856`
- **Scenario:** On a fresh deploy, anyone who calls `init_config` before the deployer becomes admin and controls `update_config`, `register_payee` and `init_pool`. Already documented in the README. The current devnet deployment is already initialized.
- **Fix (before mainnet):** add the `program` and `program_data` accounts and constrain `program_data.upgrade_authority_address == Some(admin.key())`.

### Info
- **I-1 · Trust model:** admin and arbiter together can drain the pool. The admin adds a colluding office and registers a colluding payee, the arbiter `allocate`s into that payee's invoice, and the payee acknowledges. Existing invoices are safe from the admin because `office` is fixed at creation. Neither role can move contributor funds alone.
- **I-2 · Role separation is checked only at write time:** `apply_config` does not check a new arbiter or office against registered payees (it cannot enumerate them), and `create_invoice` does not check that the payee is not an office or the arbiter (`lib.rs:51-61`, `596-611`).
- **I-3 · Tokens sent straight to a vault are stranded:** `release_vault` pays `raised.min(vault)` and settle pays `c.amount` (`lib.rs:694`, `538`). Anything above that has no sweep path.
- **I-4 · No account is ever closed:** invoice, vault and contribution accounts stay rent-locked forever.
- **I-5 · `Paid` waits on a single arbiter:** with no ruling and no university signature, the funds have no timeout fallback (documented).
- **I-6 · Issuer controls:** a USDG freeze authority, or a transfer hook enabled later, can stall the vault. The tests cover the hook-enabled-later case.
- **I-7 · Strict clippy:** `-W clippy::arithmetic_side_effects -D warnings` raises 6 hits, all of them on compile-time `space = X::DISCRIMINATOR.len() + X::INIT_SPACE` expressions. These are false positives. Default clippy is clean.

## Web findings

### M-W1 · A lost confirmation after `create_invoice` loses the student-check salt
- **Location:** `web/src/app/school/page.tsx:293-317`, `web/src/lib/hooks.ts:91-103`
- **Scenario:** The transaction lands but confirmation times out. `useSendTx` returns `null`, and the salt is written to localStorage only inside `if (sig)`, so it is lost. The family can never verify `student_ref_hash`, and the retry creates a second Open invoice.
- **Fix:** store `tuition-salt:<invoicePDA>` before `tx.send`. On error, run `fetchInvoice(invoicePDA)` before telling the user to retry.

### Low
- **L-W1 · The pay page has no "did it land?" check** (`web/src/app/pay/[invoice]/page.tsx:324-331`). After a lost confirmation, a donor who typed a partial amount can pay twice. `fund-flow.tsx` already guards this with `landedAmount()`; reuse that here.
- **L-W2 · Minimal CSP** (`web/next.config.ts:11`). It sets only `frame-ancestors`, `object-src` and `base-uri`. Add `default-src 'self'`, a `connect-src` limited to the RPC (https and wss), font and style sources, and a nonce-based `script-src`.
- **L-W3 · No network guard** (`web/src/lib/constants.ts:5`, `providers.tsx:13`, `scripts/admin.ts:45-47`). A mainnet RPC URL in `NEXT_PUBLIC_SOLANA_RPC_URL` or the shell would be used without complaint. Assert the devnet genesis hash at startup.
- **L-W4 · No u64 upper bound in `parseAmount`** (`escrow.ts:267-272`). An oversized amount makes the encoder throw, and the user sees a generic error.
- **L-W5 · The receipt page treats any RPC error as "not found"** (`receipt/[invoice]/page.tsx:220-222`). Copy the pay page's `rpcDown` branch.
- **L-W6 · Irreversible arbiter rulings are one click each** (`arbiter/page.tsx:347-352`). Add a confirmation step.

### Info
- The office and arbiter screens show `inv.raised` as escrow, but the payout is `min(raised, vault)`. After a clawback, the office could wire full TRY against a smaller vault. Show the live vault balance instead.
- `amount_try_kurus` is free-form. Nothing compares it to the USDG amount before the office wires TRY.
- On a fee mint, the donation confirmation screen shows the gross amount sent, not the net amount that arrived.
- The receipt labels an arbiter "ruled for partner" outcome as a tuition receipt, although the university never signed.
- `formatAmount` uses `Number`, which loses precision above about 9e9 tokens.
- `invoiceHistory` makes up to 40 `getTransaction` calls on each status change, which risks 429 errors on the public RPC. `TOKEN_PROGRAM` in `constants.ts:7` is unused.

## Needs verification
- Whether the devnet USDG mint (`4F6P…5BP7`) has PermanentDelegate or TransferFee extensions. This decides how much the "raised vs vault" display issue matters.
- The UI uses the browser clock for deadlines, so buttons can appear when the program will reject the action. The resulting error is handled.
- Invoices whose office has been removed from `config.offices` still route to that office, and the UI does not flag them.
- Switching language mid-entry reinterprets the typed amount (TR "1.500" becomes EN 1.5). The button shows the parsed value.

## Tests run
- `cargo test -p tuition_escrow` (LiteSVM): **20/20 pass**
- M-1 PoC: reproduced in a temporary test, then removed
- `cargo clippy --all-targets`: clean. Strict lints: 6 false positives (I-7)
- `pnpm lint` and `pnpm exec tsc --noEmit`: pass
- Not run: `cargo audit` (not installed), Trident fuzzing, `/profile-cu`, `solana-verify build`

## Verdict
No Critical or High findings. M-1 needs fixing before more mints are allowed. L-1 through L-3 should be fixed before any mainnet plan. The program holds user funds, so get an external audit before mainnet.
