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
    accounts, instruction, Config, Invoice, Status, ID as PROGRAM_ID, MIN_WINDOW_SECS,
};

const TOKEN: Pubkey = anchor_spl::token::ID;
const TOKEN_2022: Pubkey = anchor_spl::token_2022::ID;
const DECIMALS: u8 = 6;
const AMOUNT: u64 = 300_000_000; // 300 USDG
const TRY_KURUS: u64 = 1_200_000; // 12,000.00 TL, informational
const TERM: u32 = 20261;
const WINDOW: i64 = 60;
const NONCE: u64 = 1;
const FAMILY_START: u64 = 1_000_000_000;
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
    stranger: Keypair,
    family_ta: Pubkey,
    office_ta: Pubkey,
    school_ta: Pubkey,
    stranger_ta: Pubkey,
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

fn run(e: &mut Env, ix: Instruction, who: Who) -> Result<(), FailedTransactionMetadata> {
    let signer = match who {
        Who::Admin => &e.admin,
        Who::Arbiter => &e.arbiter,
        Who::School => &e.school,
        Who::Office => &e.office,
        Who::Family => &e.family,
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

fn invoice_state(e: &Env) -> Invoice {
    let acc = e.svm.get_account(&e.invoice).unwrap();
    Invoice::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

/// Sum of every token balance the scenario touches: must never change (fee-free mints).
fn total(e: &Env) -> u64 {
    [
        e.family_ta,
        e.office_ta,
        e.school_ta,
        e.stranger_ta,
        e.vault,
    ]
    .iter()
    .filter(|a| e.svm.get_account(a).is_some())
    .map(|a| balance(&e.svm, a))
    .sum()
}

const TOTAL_AT_START: u64 = FAMILY_START + STRANGER_START + SCHOOL_START;

// ---------------------------------------------------------------- PDAs

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &PROGRAM_ID).0
}

fn payee_pda(authority: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"payee", authority.as_ref()], &PROGRAM_ID).0
}

fn invoice_pda(payee: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"invoice", payee.as_ref(), &nonce.to_le_bytes()],
        &PROGRAM_ID,
    )
    .0
}

fn vault_pda(invoice: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", invoice.as_ref()], &PROGRAM_ID).0
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

// ---------------------------------------------------------------- setup

fn setup(kind: MintKind) -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(PROGRAM_ID, "../../target/deploy/tuition_escrow.so")
        .unwrap();
    set_time(&mut svm, 1_800_000_000);

    let [admin, arbiter, school, office, family, stranger] =
        std::array::from_fn(|_| Keypair::new());
    for k in [&admin, &arbiter, &school, &office, &family, &stranger] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }

    let (mint, prog) = create_mint(&mut svm, &admin, kind);
    let family_ta = ata(&mut svm, &admin, &family.pubkey(), &mint, &prog);
    let office_ta = ata(&mut svm, &admin, &office.pubkey(), &mint, &prog);
    let school_ta = ata(&mut svm, &admin, &school.pubkey(), &mint, &prog);
    let stranger_ta = ata(&mut svm, &admin, &stranger.pubkey(), &mint, &prog);
    mint_to(&mut svm, &admin, &prog, &mint, &family_ta, FAMILY_START);
    mint_to(&mut svm, &admin, &prog, &mint, &stranger_ta, STRANGER_START);
    mint_to(&mut svm, &admin, &prog, &mint, &school_ta, SCHOOL_START);

    let invoice = invoice_pda(&school.pubkey(), NONCE);
    let vault = vault_pda(&invoice);
    let mut e = Env {
        svm,
        prog,
        mint,
        admin,
        arbiter,
        school,
        office,
        family,
        stranger,
        family_ta,
        office_ta,
        school_ta,
        stranger_ta,
        invoice,
        vault,
    };

    let ix = init_config_ix(
        &e.admin.pubkey(),
        e.arbiter.pubkey(),
        vec![mint],
        vec![e.office.pubkey()],
    );
    run(&mut e, ix, Who::Admin).unwrap();
    let ix = register_payee_ix(&e.admin.pubkey(), &e.school.pubkey(), "Test University");
    run(&mut e, ix, Who::Admin).unwrap();
    e
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

fn create_ix(
    e: &Env,
    payee: &Pubkey,
    mint: &Pubkey,
    nonce: u64,
    amount: u64,
    window: i64,
) -> Instruction {
    let invoice = invoice_pda(payee, nonce);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::CreateInvoice {
            payee: *payee,
            payee_record: payee_pda(payee),
            config: config_pda(),
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
        }
        .data(),
    }
}

fn pay_ix(
    e: &Env,
    payer: &Pubkey,
    payer_token: &Pubkey,
    office: &Pubkey,
    mint: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::PayInvoice {
            payer: *payer,
            office: *office,
            config: config_pda(),
            invoice: e.invoice,
            vault: e.vault,
            payer_token: *payer_token,
            mint: *mint,
            token_program: e.prog,
        }
        .to_account_metas(None),
        data: instruction::PayInvoice {}.data(),
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

fn refund_ix(e: &Env, caller: &Pubkey, payer_token: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::Refund {
            caller: *caller,
            invoice: e.invoice,
            vault: e.vault,
            payer_token: *payer_token,
            mint: e.mint,
            token_program: e.prog,
        }
        .to_account_metas(None),
        data: instruction::Refund {}.data(),
    }
}

fn resolve_ix(e: &Env, arbiter: &Pubkey, destination: &Pubkey, to_office: bool) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: accounts::Resolve {
            arbiter: *arbiter,
            config: config_pda(),
            invoice: e.invoice,
            vault: e.vault,
            destination: *destination,
            mint: e.mint,
            token_program: e.prog,
        }
        .to_account_metas(None),
        data: instruction::Resolve { to_office }.data(),
    }
}

// ------------------------------------------------------- happy-path steps

fn do_create(e: &mut Env) {
    let ix = create_ix(e, &e.school.pubkey(), &e.mint, NONCE, AMOUNT, WINDOW);
    run(e, ix, Who::School).unwrap();
}

fn do_pay(e: &mut Env) -> Result<(), FailedTransactionMetadata> {
    let ix = pay_ix(
        e,
        &e.family.pubkey(),
        &e.family_ta,
        &e.office.pubkey(),
        &e.mint,
    );
    run(e, ix, Who::Family)
}

fn do_mark_paid(e: &mut Env) -> Result<(), FailedTransactionMetadata> {
    let ix = mark_paid_ix(e, &e.office.pubkey(), RECEIPT);
    run(e, ix, Who::Office)
}

fn do_ack(e: &mut Env) -> Result<(), FailedTransactionMetadata> {
    let ix = ack_ix(e, &e.school.pubkey(), &e.office_ta);
    run(e, ix, Who::School)
}

fn do_refund(e: &mut Env) -> Result<(), FailedTransactionMetadata> {
    let ix = refund_ix(e, &e.stranger.pubkey(), &e.family_ta);
    run(e, ix, Who::Stranger)
}

fn do_resolve(e: &mut Env, to_office: bool) -> Result<(), FailedTransactionMetadata> {
    let dest = if to_office { e.office_ta } else { e.family_ta };
    let ix = resolve_ix(e, &e.arbiter.pubkey(), &dest, to_office);
    run(e, ix, Who::Arbiter)
}

fn funded(kind: MintKind) -> Env {
    let mut e = setup(kind);
    do_create(&mut e);
    do_pay(&mut e).unwrap();
    e
}

// ------------------------------------------------------------- tests

fn full_flow(kind: MintKind) {
    let mut e = setup(kind);
    do_create(&mut e);
    let inv = invoice_state(&e);
    assert_eq!(inv.status, Status::Open);
    assert_eq!(inv.payee, e.school.pubkey());
    assert_eq!(inv.amount_try_kurus, TRY_KURUS);

    do_pay(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.vault), AMOUNT);
    assert_eq!(balance(&e.svm, &e.family_ta), FAMILY_START - AMOUNT);
    let inv = invoice_state(&e);
    assert_eq!(inv.status, Status::Funded);
    assert_eq!(inv.deposited, AMOUNT);
    assert_eq!(inv.payer, e.family.pubkey());
    assert_eq!(inv.office, e.office.pubkey());
    assert_eq!(inv.deadline, inv.funded_at + WINDOW);

    do_mark_paid(&mut e).unwrap();
    assert_eq!(invoice_state(&e).status, Status::Paid);
    assert_eq!(balance(&e.svm, &e.vault), AMOUNT); // the office's word moves nothing

    do_ack(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.vault), 0);
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    let receipt = invoice_state(&e);
    assert_eq!(receipt.status, Status::Released);
    assert_eq!(receipt.bank_receipt_hash, RECEIPT);
    assert!(receipt.settled_at >= receipt.paid_at);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn happy_path_classic_spl_ends_in_a_receipt_signed_by_the_university() {
    full_flow(MintKind::Classic);
}

#[test]
fn happy_path_token_2022_like_usdg() {
    full_flow(MintKind::T22);
}

#[test]
fn transfer_fee_books_what_actually_reached_the_vault() {
    let mut e = setup(MintKind::T22Fee(100)); // 1%
    do_create(&mut e);
    do_pay(&mut e).unwrap();
    let net = AMOUNT - AMOUNT / 100;
    assert_eq!(invoice_state(&e).deposited, net);
    assert_eq!(balance(&e.svm, &e.vault), net);

    do_ack(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.vault), 0); // exactly the booked deposit left
    assert_eq!(balance(&e.svm, &e.office_ta), net - net / 100);
}

#[test]
fn transfer_hook_mints_are_refused_even_if_enabled_later() {
    // hook active from the start: no invoice can be opened
    let mut e = setup(MintKind::T22Hook(Some(Pubkey::new_unique())));
    let ix = create_ix(&e, &e.school.pubkey(), &e.mint, NONCE, AMOUNT, WINDOW);
    assert_err(run(&mut e, ix, Who::School), "TransferHookNotSupported");

    // hook extension present but inactive, then the issuer switches it on
    let mut e = setup(MintKind::T22Hook(None));
    do_create(&mut e);
    let ix = transfer_hook::instruction::update(
        &TOKEN_2022,
        &e.mint,
        &e.admin.pubkey(),
        &[],
        Some(Pubkey::new_unique()),
    )
    .unwrap();
    run(&mut e, ix, Who::Admin).unwrap();
    assert_err(do_pay(&mut e), "TransferHookNotSupported");
    assert_eq!(balance(&e.svm, &e.family_ta), FAMILY_START);
}

#[test]
fn university_can_release_without_the_office_marking_paid() {
    let mut e = funded(MintKind::Classic);
    do_ack(&mut e).unwrap();
    assert_eq!(invoice_state(&e).status, Status::Released);
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn late_acknowledge_still_releases_a_paid_invoice() {
    let mut e = funded(MintKind::Classic);
    do_mark_paid(&mut e).unwrap();
    advance(&mut e.svm, WINDOW + 10);
    do_ack(&mut e).unwrap();
    assert_eq!(invoice_state(&e).status, Status::Released);
    assert_err(do_resolve(&mut e, false), "InvalidStatus");
}

#[test]
fn refund_is_permissionless_but_only_after_the_deadline() {
    let mut e = funded(MintKind::Classic);
    assert_err(do_refund(&mut e), "NotExpired");
    advance(&mut e.svm, WINDOW - 1);
    assert_err(do_refund(&mut e), "NotExpired");
    advance(&mut e.svm, 1); // == deadline

    // refund can only go to the payer's own token account
    let ix = refund_ix(&e, &e.stranger.pubkey(), &e.stranger_ta);
    assert_err(run(&mut e, ix, Who::Stranger), "ConstraintTokenOwner");

    do_refund(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.family_ta), FAMILY_START);
    assert_eq!(balance(&e.svm, &e.vault), 0);
    assert_eq!(invoice_state(&e).status, Status::Refunded);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn refund_is_blocked_once_the_office_claims_payout() {
    let mut e = funded(MintKind::Classic);
    do_mark_paid(&mut e).unwrap();
    advance(&mut e.svm, WINDOW + 1);
    assert_err(do_refund(&mut e), "PaidAwaitsArbiter");
    assert_eq!(balance(&e.svm, &e.vault), AMOUNT);
}

#[test]
fn mark_paid_needs_the_office_a_receipt_and_time_left() {
    let mut e = funded(MintKind::Classic);
    let ix = mark_paid_ix(&e, &e.stranger.pubkey(), RECEIPT);
    assert_err(run(&mut e, ix, Who::Stranger), "NotOffice");
    let ix = mark_paid_ix(&e, &e.office.pubkey(), [0u8; 32]);
    assert_err(run(&mut e, ix, Who::Office), "InvalidReceiptHash");
    advance(&mut e.svm, WINDOW);
    assert_err(do_mark_paid(&mut e), "Expired");

    // and never before the family has paid
    let mut e = setup(MintKind::Classic);
    do_create(&mut e);
    assert_err(do_mark_paid(&mut e), "NotOffice"); // office not set until funding
}

#[test]
fn arbiter_rules_only_on_expired_disputes() {
    let mut e = funded(MintKind::Classic);
    assert_err(do_resolve(&mut e, true), "InvalidStatus"); // Funded: no dispute
    do_mark_paid(&mut e).unwrap();
    assert_err(do_resolve(&mut e, true), "NotExpired");
    advance(&mut e.svm, WINDOW);

    let ix = resolve_ix(&e, &e.stranger.pubkey(), &e.stranger_ta, true);
    assert_err(run(&mut e, ix, Who::Stranger), "NotArbiter");
    let ix = resolve_ix(&e, &e.arbiter.pubkey(), &e.office_ta, false);
    assert_err(run(&mut e, ix, Who::Arbiter), "WrongDestination");
    let ix = resolve_ix(&e, &e.arbiter.pubkey(), &e.stranger_ta, true);
    assert_err(run(&mut e, ix, Who::Arbiter), "WrongDestination");

    do_resolve(&mut e, false).unwrap();
    let inv = invoice_state(&e);
    assert_eq!(inv.status, Status::Resolved);
    assert!(!inv.resolved_to_office);
    assert_eq!(balance(&e.svm, &e.family_ta), FAMILY_START);
    assert_eq!(total(&e), TOTAL_AT_START);

    // the other ruling
    let mut e = funded(MintKind::Classic);
    do_mark_paid(&mut e).unwrap();
    advance(&mut e.svm, WINDOW);
    do_resolve(&mut e, true).unwrap();
    assert!(invoice_state(&e).resolved_to_office);
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn only_the_registered_university_can_open_or_release() {
    let mut e = setup(MintKind::Classic);
    // an unregistered wallet has no payee record
    let ix = create_ix(&e, &e.stranger.pubkey(), &e.mint, NONCE, AMOUNT, WINDOW);
    assert_err(run(&mut e, ix, Who::Stranger), "AccountNotInitialized");

    do_create(&mut e);
    do_pay(&mut e).unwrap();
    for who in [Who::Office, Who::Stranger, Who::Family] {
        let signer = match who {
            Who::Office => e.office.pubkey(),
            Who::Stranger => e.stranger.pubkey(),
            _ => e.family.pubkey(),
        };
        let ix = ack_ix(&e, &signer, &e.office_ta);
        assert_err(run(&mut e, ix, who), "NotPayee");
    }
    // the university cannot redirect the payout away from the office
    let ix = ack_ix(&e, &e.school.pubkey(), &e.school_ta);
    assert_err(run(&mut e, ix, Who::School), "ConstraintTokenOwner");
    assert_eq!(balance(&e.svm, &e.vault), AMOUNT);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn admin_only_config_and_payee_registry() {
    let mut e = setup(MintKind::Classic);
    let ix = update_config_ix(
        &e.stranger.pubkey(),
        e.stranger.pubkey(),
        vec![e.mint],
        vec![e.office.pubkey()],
    );
    assert_err(run(&mut e, ix, Who::Stranger), "NotAdmin");
    let ix = register_payee_ix(
        &e.stranger.pubkey(),
        &e.stranger.pubkey(),
        "Fake University",
    );
    assert_err(run(&mut e, ix, Who::Stranger), "NotAdmin");
    // config can only be initialised once
    let ix = init_config_ix(
        &e.stranger.pubkey(),
        e.stranger.pubkey(),
        vec![e.mint],
        vec![e.office.pubkey()],
    );
    assert!(run(&mut e, ix, Who::Stranger).is_err());

    // roles cannot overlap
    let ix = register_payee_ix(&e.admin.pubkey(), &e.office.pubkey(), "Office U");
    assert_err(run(&mut e, ix, Who::Admin), "RoleConflict");
    let ix = register_payee_ix(&e.admin.pubkey(), &e.arbiter.pubkey(), "Arbiter U");
    assert_err(run(&mut e, ix, Who::Admin), "RoleConflict");
    let ix = update_config_ix(
        &e.admin.pubkey(),
        e.office.pubkey(),
        vec![e.mint],
        vec![e.office.pubkey()],
    );
    assert_err(run(&mut e, ix, Who::Admin), "RoleConflict");
    let ix = update_config_ix(
        &e.admin.pubkey(),
        e.arbiter.pubkey(),
        vec![],
        vec![e.office.pubkey()],
    );
    assert_err(run(&mut e, ix, Who::Admin), "InvalidConfig");
    let four = vec![Pubkey::new_unique(); 4];
    let ix = update_config_ix(&e.admin.pubkey(), e.arbiter.pubkey(), vec![e.mint], four);
    assert_err(run(&mut e, ix, Who::Admin), "InvalidConfig");

    let cfg =
        Config::try_deserialize(&mut e.svm.get_account(&config_pda()).unwrap().data.as_slice())
            .unwrap();
    assert_eq!(cfg.admin, e.admin.pubkey());
    assert_eq!(cfg.arbiter, e.arbiter.pubkey());
}

#[test]
fn parties_must_be_distinct_and_the_office_listed() {
    let mut e = setup(MintKind::Classic);
    do_create(&mut e);
    // unlisted office
    let ix = pay_ix(
        &e,
        &e.family.pubkey(),
        &e.family_ta,
        &e.stranger.pubkey(),
        &e.mint,
    );
    assert_err(run(&mut e, ix, Who::Family), "OfficeNotAllowed");
    // the university paying its own invoice
    let ix = pay_ix(
        &e,
        &e.school.pubkey(),
        &e.school_ta,
        &e.office.pubkey(),
        &e.mint,
    );
    assert_err(run(&mut e, ix, Who::School), "PartiesNotDistinct");
    // the office paying the invoice it would then collect
    let ix = pay_ix(
        &e,
        &e.office.pubkey(),
        &e.office_ta,
        &e.office.pubkey(),
        &e.mint,
    );
    assert_err(run(&mut e, ix, Who::Office), "PartiesNotDistinct");
    // someone else's token account
    let ix = pay_ix(
        &e,
        &e.family.pubkey(),
        &e.stranger_ta,
        &e.office.pubkey(),
        &e.mint,
    );
    assert_err(run(&mut e, ix, Who::Family), "ConstraintTokenOwner");
    assert_eq!(invoice_state(&e).status, Status::Open);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn mint_allow_list_is_enforced_at_creation_and_payment() {
    let mut e = setup(MintKind::Classic);
    let (other, _) = create_mint(&mut e.svm, &e.admin, MintKind::Classic);
    let ix = create_ix(&e, &e.school.pubkey(), &other, NONCE, AMOUNT, WINDOW);
    assert_err(run(&mut e, ix, Who::School), "MintNotAllowed");

    do_create(&mut e);
    let other_ta = ata(&mut e.svm, &e.admin, &e.family.pubkey(), &other, &TOKEN);
    let ix = pay_ix(
        &e,
        &e.family.pubkey(),
        &other_ta,
        &e.office.pubkey(),
        &other,
    );
    assert_err(run(&mut e, ix, Who::Family), "WrongMint");

    // admin delists the mint: open invoices in it can no longer be funded
    let ix = update_config_ix(
        &e.admin.pubkey(),
        e.arbiter.pubkey(),
        vec![other],
        vec![e.office.pubkey()],
    );
    run(&mut e, ix, Who::Admin).unwrap();
    assert_err(do_pay(&mut e), "MintNotAllowed");
}

#[test]
fn create_invoice_validates_input_and_nonce_reuse() {
    let mut e = setup(MintKind::Classic);
    for (amount, window, needle) in [
        (0, WINDOW, "InvalidAmount"),
        (AMOUNT, 19, "InvalidWindow"),
        (AMOUNT, 31 * 24 * 3600, "InvalidWindow"),
    ] {
        let ix = create_ix(&e, &e.school.pubkey(), &e.mint, NONCE, amount, window);
        assert_err(run(&mut e, ix, Who::School), needle);
    }
    do_create(&mut e);
    let ix = create_ix(&e, &e.school.pubkey(), &e.mint, NONCE, AMOUNT, WINDOW);
    assert!(run(&mut e, ix, Who::School).is_err()); // PDA already exists
    let ix = create_ix(&e, &e.school.pubkey(), &e.mint, NONCE + 1, AMOUNT, WINDOW);
    run(&mut e, ix, Who::School).unwrap();
}

#[test]
fn final_states_are_terminal() {
    // released
    let mut e = funded(MintKind::Classic);
    do_mark_paid(&mut e).unwrap();
    do_ack(&mut e).unwrap();
    assert_err(do_ack(&mut e), "InvalidStatus");
    assert_err(do_pay(&mut e), "InvalidStatus");
    assert_err(do_mark_paid(&mut e), "InvalidStatus");
    advance(&mut e.svm, WINDOW + 1);
    assert_err(do_refund(&mut e), "InvalidStatus");
    assert_err(do_resolve(&mut e, false), "InvalidStatus");
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    assert_eq!(total(&e), TOTAL_AT_START);

    // refunded
    let mut e = funded(MintKind::Classic);
    advance(&mut e.svm, WINDOW + 1);
    do_refund(&mut e).unwrap();
    assert_err(do_refund(&mut e), "InvalidStatus");
    assert_err(do_ack(&mut e), "InvalidStatus");
    assert_err(do_pay(&mut e), "InvalidStatus");
    assert_err(do_resolve(&mut e, true), "InvalidStatus");
    assert_eq!(balance(&e.svm, &e.family_ta), FAMILY_START);
    assert_eq!(total(&e), TOTAL_AT_START);

    // resolved
    let mut e = funded(MintKind::Classic);
    do_mark_paid(&mut e).unwrap();
    advance(&mut e.svm, WINDOW + 1);
    do_resolve(&mut e, true).unwrap();
    assert_err(do_resolve(&mut e, false), "InvalidStatus");
    assert_err(do_ack(&mut e), "InvalidStatus");
    assert_err(do_refund(&mut e), "InvalidStatus");
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn double_payment_is_rejected() {
    let mut e = funded(MintKind::Classic);
    assert_err(do_pay(&mut e), "InvalidStatus");
    assert_eq!(balance(&e.svm, &e.vault), AMOUNT);
    assert_eq!(balance(&e.svm, &e.family_ta), FAMILY_START - AMOUNT);
}

#[test]
fn vault_donation_cannot_brick_or_inflate_a_payout() {
    let mut e = funded(MintKind::Classic);
    let ix = tokix::transfer_checked(
        &e.prog,
        &e.stranger_ta,
        &e.mint,
        &e.vault,
        &e.stranger.pubkey(),
        &[],
        1,
        DECIMALS,
    )
    .unwrap();
    run(&mut e, ix, Who::Stranger).unwrap();
    do_ack(&mut e).unwrap();
    assert_eq!(balance(&e.svm, &e.vault), 1); // dust stays, payout exact
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
    assert_eq!(total(&e), TOTAL_AT_START);
}

#[test]
fn university_gets_a_review_window_after_a_last_second_mark_paid() {
    let mut e = funded(MintKind::Classic);
    advance(&mut e.svm, WINDOW - 1);
    do_mark_paid(&mut e).unwrap(); // one second before the deadline
    advance(&mut e.svm, 1);
    assert_err(do_resolve(&mut e, true), "NotExpired"); // deadline reached, review still open
    assert_err(do_refund(&mut e), "PaidAwaitsArbiter");
    advance(&mut e.svm, MIN_WINDOW_SECS - 2);
    assert_err(do_resolve(&mut e, true), "NotExpired");
    advance(&mut e.svm, 1); // == paid_at + MIN_WINDOW_SECS
    do_resolve(&mut e, true).unwrap();
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT);
}

#[test]
fn issuer_clawback_does_not_lock_the_rest_of_the_vault() {
    let mut e = funded(MintKind::T22Delegate);
    // the permanent delegate (admin) pulls one base unit out of the vault
    let ix = tokix::transfer_checked(
        &e.prog,
        &e.vault,
        &e.mint,
        &e.stranger_ta,
        &e.admin.pubkey(),
        &[],
        1,
        DECIMALS,
    )
    .unwrap();
    run(&mut e, ix, Who::Admin).unwrap();
    do_ack(&mut e).unwrap();
    assert_eq!(invoice_state(&e).status, Status::Released);
    assert_eq!(balance(&e.svm, &e.vault), 0);
    assert_eq!(balance(&e.svm, &e.office_ta), AMOUNT - 1);
    assert_eq!(total(&e), TOTAL_AT_START);
}
