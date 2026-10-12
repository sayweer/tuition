use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{transfer_hook::TransferHook, BaseStateWithExtensions, StateWithExtensions},
    state::Mint as MintState,
};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("E2cES7pe38nkQk1a9J7BXkP3htCAueFsE3TrZCHnRh1A");

pub const CONFIG_SEED: &[u8] = b"config";
pub const PAYEE_SEED: &[u8] = b"payee";
pub const INVOICE_SEED: &[u8] = b"invoice";
pub const VAULT_SEED: &[u8] = b"vault";
pub const MAX_MINTS: usize = 3;
pub const MAX_OFFICES: usize = 3;
pub const MAX_NAME_LEN: usize = 64;
/// Short floor so a demo can show expiry live; a real deployment would use days.
pub const MIN_WINDOW_SECS: i64 = 20;
pub const MAX_WINDOW_SECS: i64 = 30 * 24 * 60 * 60;

#[program]
pub mod tuition_escrow {
    use super::*;

    /// One-time setup. The first caller becomes admin; deploy and init in one go.
    pub fn init_config(
        ctx: Context<InitConfig>,
        arbiter: Pubkey,
        allowed_mints: Vec<Pubkey>,
        offices: Vec<Pubkey>,
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.bump = ctx.bumps.config;
        apply_config(c, arbiter, allowed_mints, offices)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        arbiter: Pubkey,
        allowed_mints: Vec<Pubkey>,
        offices: Vec<Pubkey>,
    ) -> Result<()> {
        apply_config(&mut ctx.accounts.config, arbiter, allowed_mints, offices)
    }

    /// Admin vouches that `authority` is a university finance office.
    pub fn register_payee(ctx: Context<RegisterPayee>, name: String) -> Result<()> {
        require!(
            !name.is_empty() && name.len() <= MAX_NAME_LEN,
            EscrowError::InvalidName
        );
        let authority = ctx.accounts.authority.key();
        let config = &ctx.accounts.config;
        require!(
            !config.offices.contains(&authority) && authority != config.arbiter,
            EscrowError::RoleConflict
        );

        let p = &mut ctx.accounts.payee;
        p.authority = authority;
        p.name = name;
        p.registered_at = Clock::get()?.unix_timestamp;
        p.bump = ctx.bumps.payee;

        emit!(PayeeRegistered {
            payee: authority,
            name: p.name.clone(),
        });
        Ok(())
    }

    /// The university opens a tuition request; the vault is created empty.
    pub fn create_invoice(
        ctx: Context<CreateInvoice>,
        nonce: u64,
        amount: u64,
        amount_try_kurus: u64,
        term: u32,
        student_ref_hash: [u8; 32],
        window_secs: i64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(
            (MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&window_secs),
            EscrowError::InvalidWindow
        );
        let mint = ctx.accounts.mint.key();
        require!(
            ctx.accounts.config.allowed_mints.contains(&mint),
            EscrowError::MintNotAllowed
        );
        ensure_no_transfer_hook(&ctx.accounts.mint.to_account_info())?;

        let now = Clock::get()?.unix_timestamp;
        let inv = &mut ctx.accounts.invoice;
        inv.payee = ctx.accounts.payee.key();
        inv.payer = Pubkey::default();
        inv.office = Pubkey::default();
        inv.mint = mint;
        inv.amount = amount;
        inv.deposited = 0;
        inv.amount_try_kurus = amount_try_kurus;
        inv.term = term;
        inv.student_ref_hash = student_ref_hash;
        inv.bank_receipt_hash = [0u8; 32];
        inv.nonce = nonce;
        inv.window_secs = window_secs;
        inv.created_at = now;
        inv.funded_at = 0;
        inv.deadline = 0;
        inv.paid_at = 0;
        inv.settled_at = 0;
        inv.status = Status::Open;
        inv.resolved_to_office = false;
        inv.bump = ctx.bumps.invoice;
        inv.vault_bump = ctx.bumps.vault;

        emit!(InvoiceCreated {
            invoice: inv.key(),
            payee: inv.payee,
            mint,
            amount,
            amount_try_kurus,
            term,
            student_ref_hash,
        });
        Ok(())
    }

    /// The family locks the tuition and picks a listed payout office; the clock starts.
    pub fn pay_invoice(ctx: Context<PayInvoice>) -> Result<()> {
        let payer = ctx.accounts.payer.key();
        let office = ctx.accounts.office.key();
        let config = &ctx.accounts.config;
        let inv = &mut ctx.accounts.invoice;
        require!(inv.status == Status::Open, EscrowError::InvalidStatus);
        require!(
            config.allowed_mints.contains(&inv.mint),
            EscrowError::MintNotAllowed
        );
        require!(
            config.offices.contains(&office),
            EscrowError::OfficeNotAllowed
        );
        require!(
            payer != inv.payee && payer != office && office != inv.payee,
            EscrowError::PartiesNotDistinct
        );
        ensure_no_transfer_hook(&ctx.accounts.mint.to_account_info())?;

        let now = Clock::get()?.unix_timestamp;
        let deadline = now
            .checked_add(inv.window_secs)
            .ok_or(EscrowError::MathOverflow)?;
        inv.payer = payer;
        inv.office = office;
        inv.funded_at = now;
        inv.deadline = deadline;
        inv.status = Status::Funded;

        let before = ctx.accounts.vault.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.payer_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            inv.amount,
            ctx.accounts.mint.decimals,
        )?;

        // Token-2022 transfer fees land short of `amount`: book what actually arrived.
        ctx.accounts.vault.reload()?;
        let deposited = ctx
            .accounts
            .vault
            .amount
            .checked_sub(before)
            .ok_or(EscrowError::MathOverflow)?;
        require!(deposited > 0, EscrowError::NothingDeposited);
        inv.deposited = deposited;

        emit!(InvoiceFunded {
            invoice: inv.key(),
            payer,
            office,
            deposited,
            deadline,
        });
        Ok(())
    }

    /// The office records that it sent TRY to the university (hash of the bank receipt).
    pub fn mark_paid(ctx: Context<MarkPaid>, bank_receipt_hash: [u8; 32]) -> Result<()> {
        require!(
            bank_receipt_hash != [0u8; 32],
            EscrowError::InvalidReceiptHash
        );
        let inv = &mut ctx.accounts.invoice;
        require!(inv.status == Status::Funded, EscrowError::InvalidStatus);
        let now = Clock::get()?.unix_timestamp;
        require!(now < inv.deadline, EscrowError::Expired);

        inv.bank_receipt_hash = bank_receipt_hash;
        inv.paid_at = now;
        inv.status = Status::Paid;

        emit!(PayoutMarked {
            invoice: inv.key(),
            office: inv.office,
            bank_receipt_hash,
        });
        Ok(())
    }

    /// The university confirms receipt with its own key: the vault goes to the office.
    /// No deadline check: the payee's signature is the strongest evidence there is.
    pub fn acknowledge(ctx: Context<Acknowledge>) -> Result<()> {
        let status = ctx.accounts.invoice.status;
        require!(
            status == Status::Funded || status == Status::Paid,
            EscrowError::InvalidStatus
        );
        let a = ctx.accounts;
        let amount = release_vault(
            &mut a.invoice,
            &mut a.vault,
            &a.office_token,
            &a.mint,
            &a.token_program,
            Status::Released,
        )?;

        emit!(InvoiceReleased {
            invoice: a.invoice.key(),
            payee: a.invoice.payee,
            office: a.invoice.office,
            amount,
        });
        Ok(())
    }

    /// Permissionless crank: the office never claimed payout before the deadline.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let inv = &ctx.accounts.invoice;
        require!(inv.status != Status::Paid, EscrowError::PaidAwaitsArbiter);
        require!(inv.status == Status::Funded, EscrowError::InvalidStatus);
        require!(
            Clock::get()?.unix_timestamp >= inv.deadline,
            EscrowError::NotExpired
        );
        let a = ctx.accounts;
        let amount = release_vault(
            &mut a.invoice,
            &mut a.vault,
            &a.payer_token,
            &a.mint,
            &a.token_program,
            Status::Refunded,
        )?;

        emit!(InvoiceRefunded {
            invoice: a.invoice.key(),
            payer: a.invoice.payer,
            amount,
            caller: a.caller.key(),
        });
        Ok(())
    }

    /// Dispute: the office claims it paid, the university has not signed, time is up.
    pub fn resolve(ctx: Context<Resolve>, to_office: bool) -> Result<()> {
        let inv = &ctx.accounts.invoice;
        require!(inv.status == Status::Paid, EscrowError::InvalidStatus);
        require!(
            Clock::get()?.unix_timestamp >= inv.deadline,
            EscrowError::NotExpired
        );
        let expected_owner = if to_office { inv.office } else { inv.payer };
        require_keys_eq!(
            ctx.accounts.destination.owner,
            expected_owner,
            EscrowError::WrongDestination
        );

        let a = ctx.accounts;
        a.invoice.resolved_to_office = to_office;
        let amount = release_vault(
            &mut a.invoice,
            &mut a.vault,
            &a.destination,
            &a.mint,
            &a.token_program,
            Status::Resolved,
        )?;

        emit!(InvoiceResolved {
            invoice: a.invoice.key(),
            arbiter: a.arbiter.key(),
            to_office,
            amount,
        });
        Ok(())
    }
}

// ------------------------------------------------------------- helpers

fn apply_config(
    c: &mut Config,
    arbiter: Pubkey,
    allowed_mints: Vec<Pubkey>,
    offices: Vec<Pubkey>,
) -> Result<()> {
    require!(
        !allowed_mints.is_empty() && allowed_mints.len() <= MAX_MINTS,
        EscrowError::InvalidConfig
    );
    require!(
        !offices.is_empty() && offices.len() <= MAX_OFFICES,
        EscrowError::InvalidConfig
    );
    require!(arbiter != Pubkey::default(), EscrowError::InvalidConfig);
    require!(!offices.contains(&arbiter), EscrowError::RoleConflict);

    c.arbiter = arbiter;
    c.allowed_mints = allowed_mints;
    c.offices = offices;

    emit!(ConfigUpdated {
        admin: c.admin,
        arbiter,
        allowed_mints: c.allowed_mints.clone(),
        offices: c.offices.clone(),
    });
    Ok(())
}

/// A hook program would need extra accounts on every vault transfer; refuse it outright.
fn ensure_no_transfer_hook(mint: &AccountInfo) -> Result<()> {
    if *mint.owner != anchor_spl::token_2022::ID {
        return Ok(());
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)?;
    if let Ok(hook) = state.get_extension::<TransferHook>() {
        require!(
            Option::<Pubkey>::from(hook.program_id).is_none(),
            EscrowError::TransferHookNotSupported
        );
    }
    Ok(())
}

/// Moves exactly the booked deposit out of the vault and finalises the invoice.
fn release_vault<'info>(
    invoice: &mut Account<'info, Invoice>,
    vault: &mut InterfaceAccount<'info, TokenAccount>,
    destination: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
    final_status: Status,
) -> Result<u64> {
    let amount = invoice.deposited;
    invoice.status = final_status; // effects before interactions
    invoice.settled_at = Clock::get()?.unix_timestamp;

    let expected_after = vault
        .amount
        .checked_sub(amount)
        .ok_or(EscrowError::ConservationViolated)?;

    let nonce = invoice.nonce.to_le_bytes();
    let bump = [invoice.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[INVOICE_SEED, invoice.payee.as_ref(), &nonce, &bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: invoice.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    )?;

    vault.reload()?;
    require!(
        vault.amount == expected_after,
        EscrowError::ConservationViolated
    );
    Ok(amount)
}

// ---------------------------------------------------------------- state

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum Status {
    /// Request exists, nothing locked yet.
    Open,
    /// Family locked the tuition; waiting for the office.
    Funded,
    /// Office says it sent TRY; waiting for the university.
    Paid,
    /// University signed: vault paid the office. This account is the receipt.
    Released,
    /// Deadline passed without a payout claim: vault returned to the family.
    Refunded,
    /// Arbiter decided a dispute (see `resolved_to_office`).
    Resolved,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub arbiter: Pubkey,
    #[max_len(MAX_MINTS)]
    pub allowed_mints: Vec<Pubkey>,
    #[max_len(MAX_OFFICES)]
    pub offices: Vec<Pubkey>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Payee {
    pub authority: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    pub registered_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Invoice {
    pub payee: Pubkey,
    pub payer: Pubkey,
    pub office: Pubkey,
    pub mint: Pubkey,
    /// Requested amount in mint base units.
    pub amount: u64,
    /// What actually reached the vault (differs from `amount` only under a transfer fee).
    pub deposited: u64,
    /// Informational TRY quote, in kuruş.
    pub amount_try_kurus: u64,
    /// Academic term code chosen by the client, e.g. 20261 = 2026 fall.
    pub term: u32,
    /// sha256 of the student reference; no personal data on-chain.
    pub student_ref_hash: [u8; 32],
    /// sha256 of the office's FAST/EFT receipt.
    pub bank_receipt_hash: [u8; 32],
    pub nonce: u64,
    pub window_secs: i64,
    pub created_at: i64,
    pub funded_at: i64,
    pub deadline: i64,
    pub paid_at: i64,
    pub settled_at: i64,
    pub status: Status,
    pub resolved_to_office: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

// ------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = Config::DISCRIMINATOR.len() + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ EscrowError::NotAdmin,
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct RegisterPayee<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ EscrowError::NotAdmin,
    )]
    pub config: Account<'info, Config>,
    /// CHECK: only its pubkey is recorded; it signs its own invoices later.
    pub authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        space = Payee::DISCRIMINATOR.len() + Payee::INIT_SPACE,
        seeds = [PAYEE_SEED, authority.key().as_ref()],
        bump,
    )]
    pub payee: Account<'info, Payee>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateInvoice<'info> {
    #[account(mut)]
    pub payee: Signer<'info>,
    #[account(
        seeds = [PAYEE_SEED, payee.key().as_ref()],
        bump = payee_record.bump,
    )]
    pub payee_record: Account<'info, Payee>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = payee,
        space = Invoice::DISCRIMINATOR.len() + Invoice::INIT_SPACE,
        seeds = [INVOICE_SEED, payee.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(
        init,
        payer = payee,
        seeds = [VAULT_SEED, invoice.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = invoice,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PayInvoice<'info> {
    pub payer: Signer<'info>,
    /// CHECK: only its pubkey is recorded; must be on the config office list (checked in handler).
    pub office: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.payee.as_ref(), &invoice.nonce.to_le_bytes()],
        bump = invoice.bump,
        has_one = mint @ EscrowError::WrongMint,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(
        mut,
        seeds = [VAULT_SEED, invoice.key().as_ref()],
        bump = invoice.vault_bump,
        token::mint = mint,
        token::authority = invoice,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = payer,
        token::token_program = token_program,
    )]
    pub payer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct MarkPaid<'info> {
    pub office: Signer<'info>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.payee.as_ref(), &invoice.nonce.to_le_bytes()],
        bump = invoice.bump,
        has_one = office @ EscrowError::NotOffice,
    )]
    pub invoice: Account<'info, Invoice>,
}

#[derive(Accounts)]
pub struct Acknowledge<'info> {
    pub payee: Signer<'info>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.payee.as_ref(), &invoice.nonce.to_le_bytes()],
        bump = invoice.bump,
        has_one = payee @ EscrowError::NotPayee,
        has_one = mint @ EscrowError::WrongMint,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(
        mut,
        seeds = [VAULT_SEED, invoice.key().as_ref()],
        bump = invoice.vault_bump,
        token::mint = mint,
        token::authority = invoice,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = invoice.office,
        token::token_program = token_program,
    )]
    pub office_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.payee.as_ref(), &invoice.nonce.to_le_bytes()],
        bump = invoice.bump,
        has_one = mint @ EscrowError::WrongMint,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(
        mut,
        seeds = [VAULT_SEED, invoice.key().as_ref()],
        bump = invoice.vault_bump,
        token::mint = mint,
        token::authority = invoice,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = invoice.payer,
        token::token_program = token_program,
    )]
    pub payer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    pub arbiter: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = arbiter @ EscrowError::NotArbiter,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.payee.as_ref(), &invoice.nonce.to_le_bytes()],
        bump = invoice.bump,
        has_one = mint @ EscrowError::WrongMint,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(
        mut,
        seeds = [VAULT_SEED, invoice.key().as_ref()],
        bump = invoice.vault_bump,
        token::mint = mint,
        token::authority = invoice,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// Owner is checked against the ruling (office or payer) in the handler.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

// --------------------------------------------------------------- events

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub arbiter: Pubkey,
    pub allowed_mints: Vec<Pubkey>,
    pub offices: Vec<Pubkey>,
}

#[event]
pub struct PayeeRegistered {
    pub payee: Pubkey,
    pub name: String,
}

#[event]
pub struct InvoiceCreated {
    pub invoice: Pubkey,
    pub payee: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub amount_try_kurus: u64,
    pub term: u32,
    pub student_ref_hash: [u8; 32],
}

#[event]
pub struct InvoiceFunded {
    pub invoice: Pubkey,
    pub payer: Pubkey,
    pub office: Pubkey,
    pub deposited: u64,
    pub deadline: i64,
}

#[event]
pub struct PayoutMarked {
    pub invoice: Pubkey,
    pub office: Pubkey,
    pub bank_receipt_hash: [u8; 32],
}

#[event]
pub struct InvoiceReleased {
    pub invoice: Pubkey,
    pub payee: Pubkey,
    pub office: Pubkey,
    pub amount: u64,
}

#[event]
pub struct InvoiceRefunded {
    pub invoice: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub caller: Pubkey,
}

#[event]
pub struct InvoiceResolved {
    pub invoice: Pubkey,
    pub arbiter: Pubkey,
    pub to_office: bool,
    pub amount: u64,
}

// --------------------------------------------------------------- errors

#[error_code]
pub enum EscrowError {
    #[msg("config needs 1..=3 mints, 1..=3 offices and a non-default arbiter")]
    InvalidConfig,
    #[msg("one key cannot hold two of the roles office, arbiter and payee")]
    RoleConflict,
    #[msg("payee name must be 1..=64 bytes")]
    InvalidName,
    #[msg("amount must be greater than zero")]
    InvalidAmount,
    #[msg("window outside allowed range")]
    InvalidWindow,
    #[msg("mint is not on the allow list")]
    MintNotAllowed,
    #[msg("mints with a transfer hook are not supported")]
    TransferHookNotSupported,
    #[msg("office is not on the allow list")]
    OfficeNotAllowed,
    #[msg("payer, office and payee must be distinct")]
    PartiesNotDistinct,
    #[msg("invoice is not in a state that allows this action")]
    InvalidStatus,
    #[msg("office claimed payout; only the payee or the arbiter can settle")]
    PaidAwaitsArbiter,
    #[msg("nothing reached the vault")]
    NothingDeposited,
    #[msg("bank receipt hash must not be empty")]
    InvalidReceiptHash,
    #[msg("deadline passed")]
    Expired,
    #[msg("deadline not reached yet")]
    NotExpired,
    #[msg("signer is not the admin")]
    NotAdmin,
    #[msg("signer is not the payee")]
    NotPayee,
    #[msg("signer is not the office")]
    NotOffice,
    #[msg("signer is not the arbiter")]
    NotArbiter,
    #[msg("mint mismatch")]
    WrongMint,
    #[msg("destination does not belong to the party the ruling names")]
    WrongDestination,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("vault balance does not match the expected payout")]
    ConservationViolated,
}
