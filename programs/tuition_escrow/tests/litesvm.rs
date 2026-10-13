// LiteSVM's FailedTransactionMetadata is large by design; boxing it in a test harness buys nothing.
#![allow(clippy::result_large_err)]

use anchor_lang::{
    prelude::Pubkey, system_program, AccountDeserialize, InstructionData, ToAccountMetas,
};
use litesvm::{types::FailedTransactionMetadata, LiteSVM};
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_system_interface::instruction as sysix;
use solana_transaction::versioned::VersionedTransaction;
use spl_associated_token_account_interface::{
    address::get_associated_token_address_with_program_id,
    instruction::create_associated_token_account,
};
use spl_token_2022_interface::{
    extension::{transfer_fee, transfer_hook, ExtensionType},
    instruction as tokix,
    state::Mint as MintState,
};

use tuition_escrow::{
    accounts, instruction, Config, Contribution, Invoice, Pool, Status, ID as PROGRAM_ID,
    MIN_WINDOW_SECS,
};

const TOKEN: Pubkey = anchor_spl::token::ID;
const TOKEN_2022: Pubkey = anchor_spl::token_2022::ID;
const DECIMALS: u8 = 6;
const AMOUNT: u64 = 300_000_000; // 300 USDG
const TRY_KURUS: u64 = 1_200_000;
const TERM: u32 = 20261;
const WINDOW: i64 = 60; // payout window once funded
const FUNDING: i64 = 120; // contributions accepted for this long
const NONCE: u64 = 1;
const FAMILY_START: u64 = 1_000_000_000;
const DONOR_START: u64 = 500_000_000;
const STRANGER_START: u64 = 50_000_000;
const SCHOOL_START: u64 = 10_000_000;
const RECEIPT: [u8; 32] = [42u8; 32];

#[derive(Clone, Copy)]
enum MintKind {
    Classic,
    T22,
    T22Fee(u16),
    T22Hook(Option<Pubkey>),
    /// Token-2022 with a permanent delegate (the admin), like USDG's issuer clawback.
    T22Delegate,
}

#[derive(Clone, Copy)]
enum Who {
    Admin,
    Arbiter,
    School,
    Office,
    Family,
    Donor,
    Stranger,
}

struct Env {
    svm: LiteSVM,
    prog: Pubkey,
    mint: Pubkey,
    admin: Keypair,
    arbiter: Keypair,
    school: Keypair,
    office: Keypair,
    family: Keypair,
    donor: Keypair,
    stranger: Keypair,
    family_ta: Pubkey,
    donor_ta: Pubkey,
    office_ta: Pubkey,
    school_ta: Pubkey,
    stranger_ta: Pubkey,
    pool: Pubkey,
    pool_vault: Pubkey,
    invoice: Pubkey,
    vault: Pubkey,
}

// ------------------------------------------------------------- plumbing

fn send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &Keypair,
    extra: &[&Keypair],
) -> Result<(), FailedTransactionMetadata> {
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    let r = svm.send_transaction(tx).map(|_| ());
    svm.expire_blockhash(); // lets us resend identical instructions
    r
}

fn kp(e: &Env, who: Who) -> &Keypair {
    match who {
        Who::Admin => &e.admin,
        Who::Arbiter => &e.arbiter,
        Who::School => &e.school,
        Who::Office => &e.office,
        Who::Family => &e.family,
        Who::Donor => &e.donor,
        Who::Stranger => &e.stranger,
    }
}

fn key(e: &Env, who: Who) -> Pubkey {
    kp(e, who).pubkey()
}

fn ta(e: &Env, who: Who) -> Pubkey {
    match who {
        Who::Family => e.family_ta,
        Who::Donor => e.donor_ta,
        Who::Office => e.office_ta,
        Who::School => e.school_ta,
        _ => e.stranger_ta,
    }
}

fn run(e: &mut Env, ix: Instruction, who: Who) -> Result<(), FailedTransactionMetadata> {
    let signer = match who {
        Who::Admin => &e.admin,
        Who::Arbiter => &e.arbiter,
        Who::School => &e.school,
        Who::Office => &e.office,
        Who::Family => &e.family,
        Who::Donor => &e.donor,
        Who::Stranger => &e.stranger,
    };
    send(&mut e.svm, &[ix], signer, &[])
}

fn assert_err(r: Result<(), FailedTransactionMetadata>, needle: &str) {
    let err = r.expect_err("tx should fail");
    let logs = err.meta.logs.join("\n");
    assert!(
        logs.contains(needle) || format!("{:?}", err.err).contains(needle),
        "expected `{needle}` in logs:\n{logs}\n{:?}",
        err.err
    );
}

fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

fn advance(svm: &mut LiteSVM, secs: i64) {
    let t = svm.get_sysvar::<Clock>().unix_timestamp + secs;
    set_time(svm, t);
}

fn balance(svm: &LiteSVM, ta: &Pubkey) -> u64 {
    let acc = svm.get_account(ta).expect("token account");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

fn decode<T: AccountDeserialize>(e: &Env, addr: &Pubkey) -> T {
    let acc = e.svm.get_account(addr).unwrap();
    T::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

fn invoice_state(e: &Env) -> Invoice {
    decode(e, &e.invoice)
}

/// Sum of every token balance the scenario touches: must never change (fee-free mints).
fn total(e: &Env) -> u64 {
    [
        e.family_ta,
        e.donor_ta,
        e.office_ta,
        e.school_ta,
        e.stranger_ta,
        e.vault,
        e.pool_vault,
    ]
    .iter()
    .filter(|a| e.svm.get_account(a).is_some())
    .map(|a| balance(&e.svm, a))
    .sum()
}

const TOTAL_AT_START: u64 = FAMILY_START + DONOR_START + STRANGER_START + SCHOOL_START;

// ---------------------------------------------------------------- PDAs

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &PROGRAM_ID).0
}
fn config_pda() -> Pubkey {
    pda(&[b"config"])
}
fn payee_pda(authority: &Pubkey) -> Pubkey {
    pda(&[b"payee", authority.as_ref()])
}
fn invoice_pda(payee: &Pubkey, nonce: u64) -> Pubkey {
    pda(&[b"invoice", payee.as_ref(), &nonce.to_le_bytes()])
}
fn vault_pda(invoice: &Pubkey) -> Pubkey {
    pda(&[b"vault", invoice.as_ref()])
}
fn pool_pda(mint: &Pubkey) -> Pubkey {
    pda(&[b"pool", mint.as_ref()])
}
fn pool_vault_pda(pool: &Pubkey) -> Pubkey {
    pda(&[b"pool_vault", pool.as_ref()])
}
fn contribution_pda(invoice: &Pubkey, contributor: &Pubkey, nonce: u64) -> Pubkey {
    pda(&[
        b"contribution",
        invoice.as_ref(),
        contributor.as_ref(),
        &nonce.to_le_bytes(),
    ])
}

// --------------------------------------------------------------- tokens

fn create_mint(svm: &mut LiteSVM, admin: &Keypair, kind: MintKind) -> (Pubkey, Pubkey) {
    let kp = Keypair::new();
    let (prog, exts) = match kind {
        MintKind::Classic => (TOKEN, vec![]),
        MintKind::T22 => (TOKEN_2022, vec![]),
        MintKind::T22Fee(_) => (TOKEN_2022, vec![ExtensionType::TransferFeeConfig]),
        MintKind::T22Hook(_) => (TOKEN_2022, vec![ExtensionType::TransferHook]),
        MintKind::T22Delegate => (TOKEN_2022, vec![ExtensionType::PermanentDelegate]),
    };
    let space = ExtensionType::try_calculate_account_len::<MintState>(&exts).unwrap();
    let rent = svm.minimum_balance_for_rent_exemption(space);
    let mut ixs = vec![sysix::create_account(
        &admin.pubkey(),
        &kp.pubkey(),
        rent,
        space as u64,
        &prog,
    )];
    match kind {
        MintKind::T22Fee(bps) => ixs.push(
            transfer_fee::instruction::initialize_transfer_fee_config(
                &prog,
                &kp.pubkey(),
                Some(&admin.pubkey()),
                Some(&admin.pubkey()),
                bps,
                u64::MAX,
            )
            .unwrap(),
        ),
        MintKind::T22Hook(hook) => ixs.push(
            transfer_hook::instruction::initialize(&prog, &kp.pubkey(), Some(admin.pubkey()), hook)
                .unwrap(),
        ),
        MintKind::T22Delegate => ixs.push(
            tokix::initialize_permanent_delegate(&prog, &kp.pubkey(), &admin.pubkey()).unwrap(),
        ),
        _ => {}
    }
    ixs.push(
        tokix::initialize_mint2(&prog, &kp.pubkey(), &admin.pubkey(), None, DECIMALS).unwrap(),
    );
    send(svm, &ixs, admin, &[&kp]).unwrap();
    (kp.pubkey(), prog)
}

fn ata(svm: &mut LiteSVM, payer: &Keypair, owner: &Pubkey, mint: &Pubkey, prog: &Pubkey) -> Pubkey {
    let ix = create_associated_token_account(&payer.pubkey(), owner, mint, prog);
    send(svm, &[ix], payer, &[]).unwrap();
    get_associated_token_address_with_program_id(owner, mint, prog)
}

fn mint_to(
    svm: &mut LiteSVM,
    admin: &Keypair,
    prog: &Pubkey,
    mint: &Pubkey,
    to: &Pubkey,
    amount: u64,
) {
    let ix = tokix::mint_to(prog, mint, to, &admin.pubkey(), &[], amount).unwrap();
    send(svm, &[ix], admin, &[]).unwrap();
}

// ---------------------------------------------------------- ix builders

fn init_config_ix(
    admin: &Pubkey,
    arbiter: Pubkey,
    allowed_mints: Vec<Pubkey>,
    offices: Vec<Pubkey>,
) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::InitConfig {
            admin: *admin,
            config: config_pda(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::InitConfig {
            arbiter,
            allowed_mints,
            offices,
        }
        .data(),
    }
}

fn update_config_ix(
    admin: &Pubkey,
    arbiter: Pubkey,
    allowed_mints: Vec<Pubkey>,
    offices: Vec<Pubkey>,
) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::UpdateConfig {
            admin: *admin,
            config: config_pda(),
        }
        .to_account_metas(None),
        data: instruction::UpdateConfig {
            arbiter,
            allowed_mints,
            offices,
        }
        .data(),
    }
}

fn register_payee_ix(admin: &Pubkey, authority: &Pubkey, name: &str) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::RegisterPayee {
            admin: *admin,
            config: config_pda(),
            authority: *authority,
            payee: payee_pda(authority),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::RegisterPayee {
            name: name.to_string(),
        }
        .data(),
    }
}

fn init_pool_ix(admin: &Pubkey, mint: &Pubkey, prog: &Pubkey) -> Instruction {
    let pool = pool_pda(mint);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::InitPool {
            admin: *admin,
            config: config_pda(),
            mint: *mint,
            pool,
            pool_vault: pool_vault_pda(&pool),
            token_program: *prog,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::InitPool {}.data(),
    }
}

#[allow(clippy::too_many_arguments)]
fn create_ix(
    e: &Env,
    payee: &Pubkey,
    office: &Pubkey,
    mint: &Pubkey,
    nonce: u64,
    amount: u64,
    window: i64,
    funding: i64,
) -> Instruction {
    let invoice = invoice_pda(payee, nonce);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::CreateInvoice {
            payee: *payee,
            payee_record: payee_pda(payee),
            config: config_pda(),
            office: *office,
            mint: *mint,
            invoice,
            vault: vault_pda(&invoice),
            token_program: e.prog,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::CreateInvoice {
            nonce,
            amount,
            amount_try_kurus: TRY_KURUS,
            term: TERM,
            student_ref_hash: [7u8; 32],
            window_secs: window,
            funding_secs: funding,
        }
        .data(),
    }
}

fn contribute_ix(
    e: &Env,
    contributor: &Pubkey,
    token: &Pubkey,
    cnonce: u64,
    amount: u64,
    to_pool: bool,
) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::Contribute {
            contributor: *contributor,
            invoice: e.invoice,
            vault: e.vault,
            contributor_token: *token,
            contribution: contribution_pda(&e.invoice, contributor, cnonce),
            mint: e.mint,
            token_program: e.prog,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::Contribute {
            nonce: cnonce,
            amount,
            to_pool_on_fail: to_pool,
        }
        .data(),
    }
}

fn donate_ix(e: &Env, donor: &Pubkey, token: &Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::Donate {
            donor: *donor,
            pool: e.pool,
            pool_vault: e.pool_vault,
            donor_token: *token,
            mint: e.mint,
            token_program: e.prog,
        }
        .to_account_metas(None),
        data: instruction::Donate { amount }.data(),
    }
}

fn allocate_ix(e: &Env, arbiter: &Pubkey, cnonce: u64, amount: u64) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::Allocate {
            arbiter: *arbiter,
            config: config_pda(),
            invoice: e.invoice,
            vault: e.vault,
            pool: e.pool,
            pool_vault: e.pool_vault,
            contribution: contribution_pda(&e.invoice, &e.pool, cnonce),
            mint: e.mint,
            token_program: e.prog,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::Allocate {
            nonce: cnonce,
            amount,
        }
        .data(),
    }
}

fn mark_paid_ix(e: &Env, office: &Pubkey, hash: [u8; 32]) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::MarkPaid {
            office: *office,
            invoice: e.invoice,
        }
        .to_account_metas(None),
        data: instruction::MarkPaid {
            bank_receipt_hash: hash,
        }
        .data(),
    }
}

fn ack_ix(e: &Env, payee: &Pubkey, office_token: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::Acknowledge {
            payee: *payee,
            invoice: e.invoice,
            vault: e.vault,
            office_token: *office_token,
            mint: e.mint,
            token_program: e.prog,
        }
        .to_account_metas(None),
        data: instruction::Acknowledge {}.data(),
    }
}

fn crank_ix(e: &Env, caller: &Pubkey, expire: bool) -> Instruction {
    let accounts = accounts::Crank {
        caller: *caller,
        invoice: e.invoice,
    }
    .to_account_metas(None);
    let data = if expire {
        instruction::Expire {}.data()
    } else {
        instruction::Refund {}.data()
    };
    Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data,
    }
}

fn resolve_ix(e: &Env, arbiter: &Pubkey, office_token: &Pubkey, to_office: bool) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::Resolve {
            arbiter: *arbiter,
            config: config_pda(),
            invoice: e.invoice,
            vault: e.vault,
            office_token: *office_token,
            mint: e.mint,
            token_program: e.prog,
        }
        .to_account_metas(None),
        data: instruction::Resolve { to_office }.data(),
    }
}

fn settle_ix(e: &Env, caller: &Pubkey, contribution: &Pubkey, destination: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::SettleContribution {
            caller: *caller,
            invoice: e.invoice,
            vault: e.vault,
            contribution: *contribution,
            pool: e.pool,
            destination: *destination,
            mint: e.mint,
            token_program: e.prog,
        }
        .to_account_metas(None),
        data: instruction::SettleContribution {}.data(),
    }
}

// ---------------------------------------------------------------- setup

fn setup(kind: MintKind) -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(PROGRAM_ID, "../../target/deploy/tuition_escrow.so")
        .unwrap();
    set_time(&mut svm, 1_800_000_000);

    let [admin, arbiter, school, office, family, donor, stranger] =
        std::array::from_fn(|_| Keypair::new());
    for k in [
        &admin, &arbiter, &school, &office, &family, &donor, &stranger,
    ] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let (mint, prog) = create_mint(&mut svm, &admin, kind);
    let family_ta = ata(&mut svm, &admin, &family.pubkey(), &mint, &prog);
    let donor_ta = ata(&mut svm, &admin, &donor.pubkey(), &mint, &prog);
    let office_ta = ata(&mut svm, &admin, &office.pubkey(), &mint, &prog);
    let school_ta = ata(&mut svm, &admin, &school.pubkey(), &mint, &prog);
    let stranger_ta = ata(&mut svm, &admin, &stranger.pubkey(), &mint, &prog);
    mint_to(&mut svm, &admin, &prog, &mint, &family_ta, FAMILY_START);
    mint_to(&mut svm, &admin, &prog, &mint, &donor_ta, DONOR_START);
    mint_to(&mut svm, &admin, &prog, &mint, &stranger_ta, STRANGER_START);
    mint_to(&mut svm, &admin, &prog, &mint, &school_ta, SCHOOL_START);

    let pool = pool_pda(&mint);
    let invoice = invoice_pda(&school.pubkey(), NONCE);
    let mut e = Env {
        svm,
        prog,
        mint,
        admin,
        arbiter,
        school,
        office,
        family,
        donor,
        stranger,
        family_ta,
        donor_ta,
        office_ta,
        school_ta,
        stranger_ta,
        pool,
        pool_vault: pool_vault_pda(&pool),
        invoice,
        vault: vault_pda(&invoice),
    };
    let ix = init_config_ix(
        &key(&e, Who::Admin),
        key(&e, Who::Arbiter),
        vec![mint],
        vec![key(&e, Who::Office)],
    );
    run(&mut e, ix, Who::Admin).unwrap();
    let ix = register_payee_ix(
        &key(&e, Who::Admin),
        &key(&e, Who::School),
        "Test University",
    );
    run(&mut e, ix, Who::Admin).unwrap();
    let ix = init_pool_ix(&key(&e, Who::Admin), &mint, &prog);
    run(&mut e, ix, Who::Admin).unwrap();
    e
}

// ------------------------------------------------------- scenario steps

fn create(e: &mut Env) {
    let ix = create_ix(
        e,
        &key(e, Who::School),
        &key(e, Who::Office),
        &e.mint,
        NONCE,
        AMOUNT,
        WINDOW,
        FUNDING,
    );
    run(e, ix, Who::School).unwrap();
}

fn give(
    e: &mut Env,
    who: Who,
    cnonce: u64,
    amount: u64,
    to_pool: bool,
) -> Result<(), FailedTransactionMetadata> {
    let ix = contribute_ix(e, &key(e, who), &ta(e, who), cnonce, amount, to_pool);
    run(e, ix, who)
}

fn donate(e: &mut Env, who: Who, amount: u64) -> Result<(), FailedTransactionMetadata> {
    let ix = donate_ix(e, &key(e, who), &ta(e, who), amount);
    run(e, ix, who)
}

fn allocate(e: &mut Env, cnonce: u64, amount: u64) -> Result<(), FailedTransactionMetadata> {
    let ix = allocate_ix(e, &key(e, Who::Arbiter), cnonce, amount);
    run(e, ix, Who::Arbiter)
}

fn mark_paid(e: &mut Env) -> Result<(), FailedTransactionMetadata> {
    let ix = mark_paid_ix(e, &key(e, Who::Office), RECEIPT);
    run(e, ix, Who::Office)
}

fn ack(e: &mut Env) -> Result<(), FailedTransactionMetadata> {
    let ix = ack_ix(e, &key(e, Who::School), &e.office_ta);
    run(e, ix, Who::School)
}

fn refund(e: &mut Env) -> Result<(), FailedTransactionMetadata> {
    let ix = crank_ix(e, &key(e, Who::Stranger), false);
    run(e, ix, Who::Stranger)
}

fn expire(e: &mut Env) -> Result<(), FailedTransactionMetadata> {
    let ix = crank_ix(e, &key(e, Who::Stranger), true);
    run(e, ix, Who::Stranger)
}

fn resolve(e: &mut Env, to_office: bool) -> Result<(), FailedTransactionMetadata> {
    let ix = resolve_ix(e, &key(e, Who::Arbiter), &e.office_ta, to_office);
    run(e, ix, Who::Arbiter)
}

#[derive(Clone, Copy)]
enum Dest {
    Pool,
    Of(Who),
}

/// Settles a contribution into the pool vault or someone's token account.
fn settle(
    e: &mut Env,
    contributor: &Pubkey,
    cnonce: u64,
    dest: Dest,
) -> Result<(), FailedTransactionMetadata> {
    let c = contribution_pda(&e.invoice, contributor, cnonce);
    let destination = match dest {
        Dest::Pool => e.pool_vault,
        Dest::Of(who) => ta(e, who),
    };
    let ix = settle_ix(e, &key(e, Who::Stranger), &c, &destination);
    run(e, ix, Who::Stranger)
}

/// Family pays the whole tuition in one contribution.
fn funded(kind: MintKind) -> Env {
    let mut e = setup(kind);
    create(&mut e);
    give(&mut e, Who::Family, 1, AMOUNT, false).unwrap();
    e
}

// ------------------------------------------------------------- tests

fn full_flow(kind: MintKind) {
    let mut e = setup(kind);
    create(&mut e);
    let inv = invoice_state(&e);
    assert_eq!(inv.status, Status::Open);
    assert_eq!(inv.office, key(&e, Who::Office));
    assert_eq!(inv.funding_deadline, inv.created_at + FUNDING);

    give(&mut e, Who::Family, 1, AMOUNT, false).unwrap();
    let inv = invoice_state(&e);
    assert_eq!(inv.status, Status::Funded);
    assert_eq!(inv.raised, AMOUNT);
    assert_eq!(inv.contributions, 1);
    assert_eq!(inv.deadline, inv.funded_at + WINDOW);

    mark_paid(&mut e).unwrap();
    ack(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.vault), 0);
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    assert_eq!(invoice_state(&e).status, Status::Released);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn family_pays_in_full_classic_spl() {
    full_flow(MintKind::Classic);
}

#[test]
fn family_pays_in_full_token_2022() {
    full_flow(MintKind::T22);
}

#[test]
fn a_donor_and_the_family_split_the_tuition() {
    let mut e = setup(MintKind::Classic);
    create(&mut e);
    give(&mut e, Who::Donor, 1, 100_000_000, true).unwrap();
    let inv = invoice_state(&e);
    assert_eq!(inv.status, Status::Open);
    assert_eq!(inv.raised, 100_000_000);
    assert_eq!(inv.deadline, 0); // the payout clock waits until the amount is complete

    give(&mut e, Who::Family, 1, 200_000_000, false).unwrap();
    let inv = invoice_state(&e);
    assert_eq!(inv.status, Status::Funded);
    assert_eq!(inv.contributions, 2);

    mark_paid(&mut e).unwrap();
    ack(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    // a released request has nothing to settle back
    let fam = key(&e, Who::Family);
    assert_err(
        settle(&mut e, &fam, 1, Dest::Of(Who::Family)),
        "InvalidStatus",
    );
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn the_pool_covers_the_shortfall() {
    let mut e = setup(MintKind::Classic);
    create(&mut e);
    donate(&mut e, Who::Donor, 250_000_000).unwrap();
    assert_eq!(decode::<Pool>(&e, &e.pool).donated, 250_000_000);
    give(&mut e, Who::Family, 1, 100_000_000, false).unwrap();
    allocate(&mut e, 1, 200_000_000).unwrap();

    let inv = invoice_state(&e);
    assert_eq!(inv.status, Status::Funded);
    assert_eq!(balance(&e.svm, &e.pool_vault), 50_000_000);
    assert_eq!(decode::<Pool>(&e, &e.pool).allocated, 200_000_000);
    let c: Contribution = decode(&e, &contribution_pda(&e.invoice, &e.pool, 1));
    assert_eq!(c.contributor, e.pool);
    assert!(c.to_pool_on_fail);

    ack(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn an_unfunded_request_expires_and_each_gift_goes_where_it_chose() {
    let mut e = setup(MintKind::Classic);
    create(&mut e);
    give(&mut e, Who::Donor, 1, 100_000_000, true).unwrap();
    give(&mut e, Who::Family, 1, 50_000_000, false).unwrap();

    assert_err(expire(&mut e), "NotExpired");
    advance(&mut e.svm, FUNDING - 1);
    give(&mut e, Who::Stranger, 1, 1_000_000, false).unwrap(); // still open one second before
    advance(&mut e.svm, 1);
    assert_err(give(&mut e, Who::Stranger, 2, 1_000_000, false), "Expired");
    expire(&mut e).unwrap();
    assert_eq!(invoice_state(&e).status, Status::Expired);
    assert_err(
        give(&mut e, Who::Family, 2, 1_000_000, false),
        "InvalidStatus",
    );

    let donor = key(&e, Who::Donor);
    let fam = key(&e, Who::Family);
    let stranger = key(&e, Who::Stranger);
    // a pool-bound gift cannot be pulled back to a wallet, and a refund cannot be redirected
    assert_err(
        settle(&mut e, &donor, 1, Dest::Of(Who::Donor)),
        "WrongDestination",
    );
    assert_err(
        settle(&mut e, &fam, 1, Dest::Of(Who::Stranger)),
        "WrongDestination",
    );

    settle(&mut e, &donor, 1, Dest::Pool).unwrap();
    settle(&mut e, &fam, 1, Dest::Of(Who::Family)).unwrap();
    settle(&mut e, &stranger, 1, Dest::Of(Who::Stranger)).unwrap();
    assert_err(
        settle(&mut e, &fam, 1, Dest::Of(Who::Family)),
        "AlreadySettled",
    );

    assert_eq!(balance(&e.svm, &e.vault), 0);
    assert_eq!(balance(&e.svm, &e.pool_vault), 100_000_000);
    assert_eq!(decode::<Pool>(&e, &e.pool).returned, 100_000_000);
    assert_eq!(balance(&e.svm, &e.family_ta), FAMILY_START);
    assert_eq!(balance(&e.svm, &e.stranger_ta), STRANGER_START);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn a_silent_partner_refunds_each_contribution_its_own_way() {
    let mut e = setup(MintKind::Classic);
    create(&mut e);
    give(&mut e, Who::Donor, 1, 100_000_000, true).unwrap();
    give(&mut e, Who::Family, 1, 200_000_000, false).unwrap();
    let donor = key(&e, Who::Donor);
    let fam = key(&e, Who::Family);

    assert_err(refund(&mut e), "NotExpired");
    assert_err(
        settle(&mut e, &fam, 1, Dest::Of(Who::Family)),
        "InvalidStatus",
    ); // not failed yet
    advance(&mut e.svm, WINDOW);
    refund(&mut e).unwrap();
    assert_eq!(invoice_state(&e).status, Status::Refunded);

    settle(&mut e, &donor, 1, Dest::Pool).unwrap();
    settle(&mut e, &fam, 1, Dest::Of(Who::Family)).unwrap();
    assert_eq!(balance(&e.svm, &e.pool_vault), 100_000_000);
    assert_eq!(balance(&e.svm, &e.family_ta), FAMILY_START);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn pool_money_returns_to_the_pool_when_a_request_fails() {
    let mut e = setup(MintKind::Classic);
    create(&mut e);
    donate(&mut e, Who::Donor, AMOUNT).unwrap();
    allocate(&mut e, 1, AMOUNT).unwrap();
    assert_eq!(invoice_state(&e).status, Status::Funded);
    advance(&mut e.svm, WINDOW);
    refund(&mut e).unwrap();
    let pool = e.pool;
    assert_err(
        settle(&mut e, &pool, 1, Dest::Of(Who::Donor)),
        "WrongDestination",
    );
    settle(&mut e, &pool, 1, Dest::Pool).unwrap();
    assert_eq!(balance(&e.svm, &e.pool_vault), AMOUNT);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn refund_is_blocked_once_the_partner_claims_payout() {
    let mut e = funded(MintKind::Classic);
    mark_paid(&mut e).unwrap();
    advance(&mut e.svm, WINDOW + 1);
    assert_err(refund(&mut e), "PaidAwaitsArbiter");
    assert_eq!(balance(&e.svm, &e.vault), AMOUNT);
}

#[test]
fn arbiter_rulings_pay_the_partner_or_release_the_contributions() {
    // for the family: contributions settle back
    let mut e = setup(MintKind::Classic);
    create(&mut e);
    give(&mut e, Who::Donor, 1, 100_000_000, true).unwrap();
    give(&mut e, Who::Family, 1, 200_000_000, false).unwrap();
    assert_err(resolve(&mut e, true), "InvalidStatus"); // Funded: no dispute
    mark_paid(&mut e).unwrap();
    assert_err(resolve(&mut e, true), "NotExpired");
    advance(&mut e.svm, WINDOW);
    let ix = resolve_ix(&e, &key(&e, Who::Stranger), &e.office_ta, true);
    assert_err(run(&mut e, ix, Who::Stranger), "NotArbiter");
    resolve(&mut e, false).unwrap();
    let inv = invoice_state(&e);
    assert_eq!(inv.status, Status::Resolved);
    assert!(!inv.resolved_to_office);
    let (donor, fam) = (key(&e, Who::Donor), key(&e, Who::Family));
    settle(&mut e, &donor, 1, Dest::Pool).unwrap();
    settle(&mut e, &fam, 1, Dest::Of(Who::Family)).unwrap();
    assert_eq!(balance(&e.svm, &e.family_ta), FAMILY_START);
    assert_eq!(total(&e), TOTAL_AT_START);

    // for the partner: it gets the whole vault and nothing settles back
    let mut e = funded(MintKind::Classic);
    mark_paid(&mut e).unwrap();
    advance(&mut e.svm, WINDOW);
    resolve(&mut e, true).unwrap();
    assert!(invoice_state(&e).resolved_to_office);
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    let fam = key(&e, Who::Family);
    assert_err(
        settle(&mut e, &fam, 1, Dest::Of(Who::Family)),
        "InvalidStatus",
    );
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn university_gets_a_review_window_after_a_last_second_mark_paid() {
    let mut e = funded(MintKind::Classic);
    advance(&mut e.svm, WINDOW - 1);
    mark_paid(&mut e).unwrap();
    advance(&mut e.svm, 1);
    assert_err(resolve(&mut e, true), "NotExpired");
    advance(&mut e.svm, MIN_WINDOW_SECS - 2);
    assert_err(resolve(&mut e, true), "NotExpired");
    advance(&mut e.svm, 1);
    resolve(&mut e, true).unwrap();
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
}

#[test]
fn contribution_rules() {
    let mut e = setup(MintKind::Classic);
    create(&mut e);
    assert_err(give(&mut e, Who::Family, 1, 0, false), "InvalidAmount");
    assert_err(
        give(&mut e, Who::Family, 1, AMOUNT + 1, false),
        "InvalidAmount",
    );
    // the university and its partner cannot fund their own request
    assert_err(
        give(&mut e, Who::School, 1, 1_000_000, false),
        "PartiesNotDistinct",
    );
    assert_err(
        give(&mut e, Who::Office, 1, 1_000_000, false),
        "PartiesNotDistinct",
    );
    // someone else's token account
    let ix = contribute_ix(&e, &key(&e, Who::Family), &e.donor_ta, 1, 1_000_000, false);
    assert_err(run(&mut e, ix, Who::Family), "ConstraintTokenOwner");
    // a second gift from the same wallet uses a fresh nonce; reusing one fails
    give(&mut e, Who::Donor, 1, 10_000_000, true).unwrap();
    assert!(give(&mut e, Who::Donor, 1, 10_000_000, true).is_err());
    give(&mut e, Who::Donor, 2, 10_000_000, true).unwrap();
    // nothing can exceed what is still missing
    assert_err(
        give(&mut e, Who::Family, 1, AMOUNT - 19_000_000, false),
        "InvalidAmount",
    );
    give(&mut e, Who::Family, 1, AMOUNT - 20_000_000, false).unwrap();
    assert_err(
        give(&mut e, Who::Stranger, 1, 1_000_000, false),
        "InvalidStatus",
    ); // funded
    assert_eq!(invoice_state(&e).raised, AMOUNT);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn allocation_and_pool_rules() {
    let mut e = setup(MintKind::Classic);
    create(&mut e);
    assert_err(donate(&mut e, Who::Donor, 0), "InvalidAmount");
    assert!(allocate(&mut e, 1, 1_000_000).is_err()); // empty pool
    donate(&mut e, Who::Donor, 100_000_000).unwrap();
    let ix = allocate_ix(&e, &key(&e, Who::Stranger), 1, 1_000_000);
    assert_err(run(&mut e, ix, Who::Stranger), "NotArbiter");
    assert_err(allocate(&mut e, 1, AMOUNT + 1), "InvalidAmount");
    allocate(&mut e, 1, 100_000_000).unwrap();
    assert!(allocate(&mut e, 2, 1).is_err()); // pool now empty
                                              // only the admin opens pools, once per allowed mint
    let (other, _) = create_mint(&mut e.svm, &e.admin, MintKind::Classic);
    let (admin, arbiter, office, mint, prog) = (
        key(&e, Who::Admin),
        key(&e, Who::Arbiter),
        key(&e, Who::Office),
        e.mint,
        e.prog,
    );
    let ix = init_pool_ix(&admin, &other, &prog);
    assert_err(run(&mut e, ix, Who::Admin), "MintNotAllowed");
    let ix = update_config_ix(&admin, arbiter, vec![mint, other], vec![office]);
    run(&mut e, ix, Who::Admin).unwrap();
    let ix = init_pool_ix(&key(&e, Who::Stranger), &other, &prog);
    assert_err(run(&mut e, ix, Who::Stranger), "NotAdmin");
    let ix = init_pool_ix(&admin, &other, &prog);
    run(&mut e, ix, Who::Admin).unwrap();
    let ix = init_pool_ix(&admin, &mint, &prog);
    assert!(run(&mut e, ix, Who::Admin).is_err()); // already exists
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn create_invoice_rules() {
    let mut e = setup(MintKind::Classic);
    let (school, office, mint) = (key(&e, Who::School), key(&e, Who::Office), e.mint);
    for (amount, window, funding, needle) in [
        (0, WINDOW, FUNDING, "InvalidAmount"),
        (AMOUNT, 19, FUNDING, "InvalidWindow"),
        (AMOUNT, WINDOW, 19, "InvalidWindow"),
        (AMOUNT, WINDOW, 31 * 24 * 3600, "InvalidWindow"),
    ] {
        let ix = create_ix(&e, &school, &office, &mint, NONCE, amount, window, funding);
        assert_err(run(&mut e, ix, Who::School), needle);
    }
    let stranger = key(&e, Who::Stranger);
    let ix = create_ix(
        &e, &school, &stranger, &mint, NONCE, AMOUNT, WINDOW, FUNDING,
    );
    assert_err(run(&mut e, ix, Who::School), "OfficeNotAllowed");
    let ix = create_ix(
        &e, &stranger, &office, &mint, NONCE, AMOUNT, WINDOW, FUNDING,
    );
    assert_err(run(&mut e, ix, Who::Stranger), "AccountNotInitialized"); // not a registered university
    let (other, _) = create_mint(&mut e.svm, &e.admin, MintKind::Classic);
    let ix = create_ix(&e, &school, &office, &other, NONCE, AMOUNT, WINDOW, FUNDING);
    assert_err(run(&mut e, ix, Who::School), "MintNotAllowed");
    create(&mut e);
    let ix = create_ix(&e, &school, &office, &mint, NONCE, AMOUNT, WINDOW, FUNDING);
    assert!(run(&mut e, ix, Who::School).is_err()); // nonce reuse
}

#[test]
fn signer_checks_for_partner_university_and_admin() {
    let mut e = setup(MintKind::Classic);
    create(&mut e);
    assert_err(mark_paid(&mut e), "InvalidStatus"); // not funded yet
    give(&mut e, Who::Family, 1, AMOUNT, false).unwrap();
    let ix = mark_paid_ix(&e, &key(&e, Who::Stranger), RECEIPT);
    assert_err(run(&mut e, ix, Who::Stranger), "NotOffice");
    let ix = mark_paid_ix(&e, &key(&e, Who::Office), [0u8; 32]);
    assert_err(run(&mut e, ix, Who::Office), "InvalidReceiptHash");
    for who in [Who::Office, Who::Family, Who::Stranger] {
        let ix = ack_ix(&e, &key(&e, who), &e.office_ta);
        assert_err(run(&mut e, ix, who), "NotPayee");
    }
    let ix = ack_ix(&e, &key(&e, Who::School), &e.school_ta);
    assert_err(run(&mut e, ix, Who::School), "ConstraintTokenOwner");
    advance(&mut e.svm, WINDOW);
    assert_err(mark_paid(&mut e), "Expired");

    let (stranger, office, mint) = (key(&e, Who::Stranger), key(&e, Who::Office), e.mint);
    let ix = update_config_ix(&stranger, stranger, vec![mint], vec![office]);
    assert_err(run(&mut e, ix, Who::Stranger), "NotAdmin");
    let ix = register_payee_ix(&stranger, &stranger, "Fake University");
    assert_err(run(&mut e, ix, Who::Stranger), "NotAdmin");
    let ix = register_payee_ix(&key(&e, Who::Admin), &office, "Office U");
    assert_err(run(&mut e, ix, Who::Admin), "RoleConflict");
    let cfg: Config = decode(&e, &config_pda());
    assert_eq!(cfg.arbiter, key(&e, Who::Arbiter));
}

#[test]
fn transfer_fee_books_what_actually_reached_the_vault() {
    let mut e = setup(MintKind::T22Fee(100)); // 1%
    create(&mut e);
    give(&mut e, Who::Donor, 1, 100_000_000, true).unwrap();
    assert_eq!(invoice_state(&e).raised, 99_000_000);
    assert_eq!(balance(&e.svm, &e.vault), 99_000_000);
}

#[test]
fn transfer_hook_mints_are_refused_even_if_enabled_later() {
    let mut e = setup(MintKind::T22Hook(None));
    create(&mut e);
    let ix = transfer_hook::instruction::update(
        &TOKEN_2022,
        &e.mint,
        &key(&e, Who::Admin),
        &[],
        Some(Pubkey::new_unique()),
    )
    .unwrap();
    run(&mut e, ix, Who::Admin).unwrap();
    assert_err(
        give(&mut e, Who::Family, 1, AMOUNT, false),
        "TransferHookNotSupported",
    );
    assert_err(
        donate(&mut e, Who::Donor, 1_000_000),
        "TransferHookNotSupported",
    );
}

#[test]
fn issuer_clawback_does_not_lock_the_rest_of_the_vault() {
    let mut e = funded(MintKind::T22Delegate);
    let ix = tokix::transfer_checked(
        &e.prog,
        &e.vault,
        &e.mint,
        &e.stranger_ta,
        &key(&e, Who::Admin),
        &[],
        1,
        DECIMALS,
    )
    .unwrap();
    run(&mut e, ix, Who::Admin).unwrap();
    ack(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.vault), 0);
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT - 1);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn vault_donation_cannot_brick_or_inflate_a_payout() {
    let mut e = funded(MintKind::Classic);
    let ix = tokix::transfer_checked(
        &e.prog,
        &e.stranger_ta,
        &e.mint,
        &e.vault,
        &key(&e, Who::Stranger),
        &[],
        1,
        DECIMALS,
    )
    .unwrap();
    run(&mut e, ix, Who::Stranger).unwrap();
    ack(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.vault), 1);
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn final_states_are_terminal() {
    let mut e = funded(MintKind::Classic);
    mark_paid(&mut e).unwrap();
    ack(&mut e).unwrap();
    assert_err(ack(&mut e), "InvalidStatus");
    assert_err(give(&mut e, Who::Donor, 1, 1, true), "InvalidStatus");
    assert_err(mark_paid(&mut e), "InvalidStatus");
    advance(&mut e.svm, FUNDING + WINDOW);
    assert_err(refund(&mut e), "InvalidStatus");
    assert_err(expire(&mut e), "InvalidStatus");
    assert_err(resolve(&mut e, false), "InvalidStatus");

    let mut e = setup(MintKind::Classic);
    create(&mut e);
    advance(&mut e.svm, FUNDING);
    expire(&mut e).unwrap();
    assert_err(expire(&mut e), "InvalidStatus");
    assert_err(refund(&mut e), "InvalidStatus");
    assert_err(ack(&mut e), "InvalidStatus");
    assert_err(allocate(&mut e, 1, 1), "InvalidStatus");
}
