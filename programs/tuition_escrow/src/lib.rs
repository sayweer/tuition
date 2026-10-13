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
pub const CONTRIBUTION_SEED: &[u8] = b"contribution";
pub const POOL_SEED: &[u8] = b"pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
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

    /// One scholarship pool per allowed mint, holding unearmarked donations.
    pub fn init_pool(ctx: Context<InitPool>) -> Result<()> {
        let mint = ctx.accounts.mint.key();
        require!(
            ctx.accounts.config.allowed_mints.contains(&mint),
            EscrowError::MintNotAllowed
        );
        ensure_no_transfer_hook(&ctx.accounts.mint.to_account_info())?;
        let p = &mut ctx.accounts.pool;
        p.mint = mint;
        p.donated = 0;
        p.allocated = 0;
        p.returned = 0;
        p.bump = ctx.bumps.pool;
        p.vault_bump = ctx.bumps.pool_vault;
        emit!(PoolCreated {
            pool: p.key(),
            mint
        });
        Ok(())
    }

    /// The university opens a tuition request and names its licensed payout partner.
    /// Contributions are accepted until `funding_secs` from now; once the amount is reached,
    /// the partner has `window_secs` to report the lira.
    #[allow(clippy::too_many_arguments)]
    pub fn create_invoice(
        ctx: Context<CreateInvoice>,
        nonce: u64,
        amount: u64,
        amount_try_kurus: u64,
        term: u32,
        student_ref_hash: [u8; 32],
        window_secs: i64,
        funding_secs: i64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(
            (MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&window_secs)
                && (MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&funding_secs),
            EscrowError::InvalidWindow
        );
        let mint = ctx.accounts.mint.key();
        let office = ctx.accounts.office.key();
        let config = &ctx.accounts.config;
        require!(
            config.allowed_mints.contains(&mint),
            EscrowError::MintNotAllowed
        );
        require!(
            config.offices.contains(&office),
            EscrowError::OfficeNotAllowed
        );
        require!(
            office != ctx.accounts.payee.key(),
            EscrowError::PartiesNotDistinct
        );
        ensure_no_transfer_hook(&ctx.accounts.mint.to_account_info())?;

        let now = Clock::get()?.unix_timestamp;
        let funding_deadline = now
            .checked_add(funding_secs)
            .ok_or(EscrowError::MathOverflow)?;
        let inv = &mut ctx.accounts.invoice;
        inv.payee = ctx.accounts.payee.key();
        inv.office = office;
        inv.mint = mint;
        inv.amount = amount;
        inv.raised = 0;
        inv.amount_try_kurus = amount_try_kurus;
        inv.term = term;
        inv.student_ref_hash = student_ref_hash;
        inv.bank_receipt_hash = [0u8; 32];
        inv.nonce = nonce;
        inv.window_secs = window_secs;
        inv.created_at = now;
        inv.funding_deadline = funding_deadline;
        inv.funded_at = 0;
        inv.deadline = 0;
        inv.paid_at = 0;
        inv.settled_at = 0;
        inv.contributions = 0;
        inv.status = Status::Open;
        inv.resolved_to_office = false;
        inv.bump = ctx.bumps.invoice;
        inv.vault_bump = ctx.bumps.vault;

        emit!(InvoiceCreated {
            invoice: inv.key(),
            payee: inv.payee,
            office,
            mint,
            amount,
            amount_try_kurus,
            term,
            student_ref_hash,
            funding_deadline,
        });
        Ok(())
    }

    /// Anyone (family, sponsor, foundation) adds up to the remaining amount. If the request
    /// fails, the contribution goes back to the contributor, or to the scholarship pool when
    /// `to_pool_on_fail` is set.
    pub fn contribute(
        ctx: Context<Contribute>,
        nonce: u64,
        amount: u64,
        to_pool_on_fail: bool,
    ) -> Result<()> {
        let contributor = ctx.accounts.contributor.key();
        let invoice_key = ctx.accounts.invoice.key();
        let inv = &mut ctx.accounts.invoice;
        require!(inv.status == Status::Open, EscrowError::InvalidStatus);
        let now = Clock::get()?.unix_timestamp;
        require!(now < inv.funding_deadline, EscrowError::Expired);
        require!(
            contributor != inv.payee && contributor != inv.office,
            EscrowError::PartiesNotDistinct
        );
        let remaining = inv
            .amount
            .checked_sub(inv.raised)
            .ok_or(EscrowError::MathOverflow)?;
        require!(
            amount > 0 && amount <= remaining,
            EscrowError::InvalidAmount
        );
        ensure_no_transfer_hook(&ctx.accounts.mint.to_account_info())?;

        let before = ctx.accounts.vault.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.contributor_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.contributor.to_account_info(),
                },
            ),
            amount,
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

        let funded = record_contribution(
            inv,
            &mut ctx.accounts.contribution,
            invoice_key,
            contributor,
            nonce,
            deposited,
            to_pool_on_fail,
            now,
            ctx.bumps.contribution,
        )?;
        emit!(Contributed {
            invoice: invoice_key,
            contributor,
            amount: deposited,
            raised: inv.raised,
            to_pool_on_fail,
            from_pool: false,
        });
        if funded {
            emit!(InvoiceFunded {
                invoice: invoice_key,
                raised: inv.raised,
                deadline: inv.deadline,
            });
        }
        Ok(())
    }

    /// An unearmarked gift to the scholarship pool. Gifts are not refundable; the committee
    /// directs them to requests that would otherwise fall short.
    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        ensure_no_transfer_hook(&ctx.accounts.mint.to_account_info())?;
        let before = ctx.accounts.pool_vault.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.donor_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.pool_vault.to_account_info(),
                    authority: ctx.accounts.donor.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.pool_vault.reload()?;
        let deposited = ctx
            .accounts
            .pool_vault
            .amount
            .checked_sub(before)
            .ok_or(EscrowError::MathOverflow)?;
        require!(deposited > 0, EscrowError::NothingDeposited);
        let pool = &mut ctx.accounts.pool;
        pool.donated = pool
            .donated
            .checked_add(deposited)
            .ok_or(EscrowError::MathOverflow)?;
        emit!(PoolDonated {
            pool: pool.key(),
            donor: ctx.accounts.donor.key(),
            amount: deposited,
        });
        Ok(())
    }

    /// The scholarship committee (the arbiter key) covers part or all of a request's shortfall
    /// from the pool. If the request later fails, that money returns to the pool.
    pub fn allocate(ctx: Context<Allocate>, nonce: u64, amount: u64) -> Result<()> {
        let invoice_key = ctx.accounts.invoice.key();
        let pool_key = ctx.accounts.pool.key();
        let inv = &mut ctx.accounts.invoice;
        require!(inv.status == Status::Open, EscrowError::InvalidStatus);
        let now = Clock::get()?.unix_timestamp;
        require!(now < inv.funding_deadline, EscrowError::Expired);
        let remaining = inv
            .amount
            .checked_sub(inv.raised)
            .ok_or(EscrowError::MathOverflow)?;
        require!(
            amount > 0 && amount <= remaining,
            EscrowError::InvalidAmount
        );
        ensure_no_transfer_hook(&ctx.accounts.mint.to_account_info())?;

        let pool_before = ctx.accounts.pool_vault.amount;
        let before = ctx.accounts.vault.amount;
        let mint_key = ctx.accounts.mint.key();
        let bump = [ctx.accounts.pool.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[POOL_SEED, mint_key.as_ref(), &bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.pool_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.pool_vault.reload()?;
        ctx.accounts.vault.reload()?;
        require!(
            ctx.accounts.pool_vault.amount
                == pool_before
                    .checked_sub(amount)
                    .ok_or(EscrowError::ConservationViolated)?,
            EscrowError::ConservationViolated
        );
        let deposited = ctx
            .accounts
            .vault
            .amount
            .checked_sub(before)
            .ok_or(EscrowError::MathOverflow)?;
        require!(deposited > 0, EscrowError::NothingDeposited);
        let pool = &mut ctx.accounts.pool;
        pool.allocated = pool
            .allocated
            .checked_add(amount)
            .ok_or(EscrowError::MathOverflow)?;

        let funded = record_contribution(
            inv,
            &mut ctx.accounts.contribution,
            invoice_key,
            pool_key,
            nonce,
            deposited,
            true,
            now,
            ctx.bumps.contribution,
        )?;
        emit!(Contributed {
            invoice: invoice_key,
            contributor: pool_key,
            amount: deposited,
            raised: inv.raised,
            to_pool_on_fail: true,
            from_pool: true,
        });
        if funded {
            emit!(InvoiceFunded {
                invoice: invoice_key,
                raised: inv.raised,
                deadline: inv.deadline,
            });
        }
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

    /// Permissionless crank: the office never claimed payout before the deadline. Each
    /// contribution then settles on its own with `settle_contribution`.
    pub fn refund(ctx: Context<Crank>) -> Result<()> {
        let inv = &mut ctx.accounts.invoice;
        require!(inv.status != Status::Paid, EscrowError::PaidAwaitsArbiter);
        require!(inv.status == Status::Funded, EscrowError::InvalidStatus);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= inv.deadline, EscrowError::NotExpired);
        inv.status = Status::Refunded;
        inv.settled_at = now;
        emit!(InvoiceRefunded {
            invoice: inv.key(),
            caller: ctx.accounts.caller.key(),
        });
        Ok(())
    }

    /// Permissionless crank: the request did not reach its amount in time. Each contribution
    /// then settles on its own with `settle_contribution`.
    pub fn expire(ctx: Context<Crank>) -> Result<()> {
        let inv = &mut ctx.accounts.invoice;
        require!(inv.status == Status::Open, EscrowError::InvalidStatus);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= inv.funding_deadline, EscrowError::NotExpired);
        inv.status = Status::Expired;
        inv.settled_at = now;
        emit!(InvoiceExpired {
            invoice: inv.key(),
            raised: inv.raised,
        });
        Ok(())
    }

    /// Dispute: the office claims it paid, the university has not signed, time is up.
    /// The university always gets at least MIN_WINDOW_SECS after `mark_paid` to respond.
    /// A ruling for the office pays it; a ruling against releases the contributions.
    pub fn resolve(ctx: Context<Resolve>, to_office: bool) -> Result<()> {
        let inv = &ctx.accounts.invoice;
        require!(inv.status == Status::Paid, EscrowError::InvalidStatus);
        let now = Clock::get()?.unix_timestamp;
        let review_ends = inv
            .paid_at
            .checked_add(MIN_WINDOW_SECS)
            .ok_or(EscrowError::MathOverflow)?;
        require!(
            now >= inv.deadline && now >= review_ends,
            EscrowError::NotExpired
        );

        let a = ctx.accounts;
        let amount = if to_office {
            a.invoice.resolved_to_office = true;
            release_vault(
                &mut a.invoice,
                &mut a.vault,
                &a.office_token,
                &a.mint,
                &a.token_program,
                Status::Resolved,
            )?
        } else {
            a.invoice.resolved_to_office = false;
            a.invoice.status = Status::Resolved;
            a.invoice.settled_at = now;
            0
        };

        emit!(InvoiceResolved {
            invoice: a.invoice.key(),
            arbiter: a.arbiter.key(),
            to_office,
            amount,
        });
        Ok(())
    }

    /// Permissionless crank after a failed request: returns one contribution to its
    /// contributor, or to the scholarship pool when it was marked that way.
    pub fn settle_contribution(ctx: Context<SettleContribution>) -> Result<()> {
        let inv = &ctx.accounts.invoice;
        let failed = matches!(inv.status, Status::Refunded | Status::Expired)
            || (inv.status == Status::Resolved && !inv.resolved_to_office);
        require!(failed, EscrowError::InvalidStatus);
        let c = &ctx.accounts.contribution;
        require!(!c.settled, EscrowError::AlreadySettled);

        let to_pool = c.to_pool_on_fail;
        let destination = ctx.accounts.destination.key();
        if to_pool {
            let pool_vault = ctx.accounts.pool.vault_address(&ctx.accounts.pool.key())?;
            require_keys_eq!(destination, pool_vault, EscrowError::WrongDestination);
        } else {
            require_keys_eq!(
                ctx.accounts.destination.owner,
                c.contributor,
                EscrowError::WrongDestination
            );
        }

        let vault_amount = ctx.accounts.vault.amount;
        let amount = c.amount.min(vault_amount);
        let contributor = c.contributor;
        ctx.accounts.contribution.settled = true; // effects before interactions

        let expected_after = vault_amount
            .checked_sub(amount)
            .ok_or(EscrowError::ConservationViolated)?;
        let a = &ctx.accounts;
        let nonce = a.invoice.nonce.to_le_bytes();
        let bump = [a.invoice.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[INVOICE_SEED, a.invoice.payee.as_ref(), &nonce, &bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                a.token_program.key(),
                TransferChecked {
                    from: a.vault.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.destination.to_account_info(),
                    authority: a.invoice.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            a.mint.decimals,
        )?;
        ctx.accounts.vault.reload()?;
        require!(
            ctx.accounts.vault.amount == expected_after,
            EscrowError::ConservationViolated
        );
        if to_pool {
            let pool = &mut ctx.accounts.pool;
            pool.returned = pool
                .returned
                .checked_add(amount)
                .ok_or(EscrowError::MathOverflow)?;
        }

        emit!(ContributionSettled {
            invoice: ctx.accounts.invoice.key(),
            contributor,
            amount,
            to_pool,
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

/// Books one contribution; returns true when it completes the request (which starts the
/// partner's payout window).
#[allow(clippy::too_many_arguments)]
fn record_contribution(
    inv: &mut Invoice,
    c: &mut Contribution,
    invoice: Pubkey,
    contributor: Pubkey,
    nonce: u64,
    deposited: u64,
    to_pool_on_fail: bool,
    now: i64,
    bump: u8,
) -> Result<bool> {
    c.invoice = invoice;
    c.contributor = contributor;
    c.nonce = nonce;
    c.amount = deposited;
    c.to_pool_on_fail = to_pool_on_fail;
    c.settled = false;
    c.created_at = now;
    c.bump = bump;

    inv.raised = inv
        .raised
        .checked_add(deposited)
        .ok_or(EscrowError::MathOverflow)?;
    inv.contributions = inv
        .contributions
        .checked_add(1)
        .ok_or(EscrowError::MathOverflow)?;
    if inv.raised >= inv.amount {
        inv.status = Status::Funded;
        inv.funded_at = now;
        inv.deadline = now
            .checked_add(inv.window_secs)
            .ok_or(EscrowError::MathOverflow)?;
        return Ok(true);
    }
    Ok(false)
}

/// Moves the raised amount out of the vault and finalises the invoice. If the issuer's
/// permanent delegate clawed part of it back, pays what is left instead of locking forever.
fn release_vault<'info>(
    invoice: &mut Account<'info, Invoice>,
    vault: &mut InterfaceAccount<'info, TokenAccount>,
    destination: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
    final_status: Status,
) -> Result<u64> {
    let amount = invoice.raised.min(vault.amount);
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
    /// Open for contributions until the funding deadline.
    Open,
    /// Fully funded; waiting for the office.
    Funded,
    /// Office says it sent TRY; waiting for the university.
    Paid,
    /// University signed: vault paid the office. This account is the receipt.
    Released,
    /// Payout deadline passed without a claim: contributions settle back.
    Refunded,
    /// Arbiter decided a dispute (see `resolved_to_office`).
    Resolved,
    /// Funding deadline passed short of the amount: contributions settle back.
    Expired,
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
pub struct Pool {
    pub mint: Pubkey,
    /// Total ever donated, allocated to requests, and returned from failed requests.
    pub donated: u64,
    pub allocated: u64,
    pub returned: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Pool {
    /// Address of this pool's token vault, from its stored bump.
    pub fn vault_address(&self, pool: &Pubkey) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[POOL_VAULT_SEED, pool.as_ref(), &[self.vault_bump]],
            &crate::ID,
        )
        .map_err(|_| error!(EscrowError::WrongDestination))
    }
}

#[account]
#[derive(InitSpace)]
pub struct Invoice {
    pub payee: Pubkey,
    pub office: Pubkey,
    pub mint: Pubkey,
    /// Requested amount in mint base units.
    pub amount: u64,
    /// Sum of all contributions that reached the vault.
    pub raised: u64,
    /// Informational TRY quote, in kuruş.
    pub amount_try_kurus: u64,
    /// Academic term code chosen by the client, e.g. 20261 = 2026 fall.
    pub term: u32,
    /// sha256 of the student reference (salted off-chain); no personal data on-chain.
    pub student_ref_hash: [u8; 32],
    /// sha256 of the office's FAST/EFT receipt.
    pub bank_receipt_hash: [u8; 32],
    pub nonce: u64,
    pub window_secs: i64,
    pub created_at: i64,
    pub funding_deadline: i64,
    pub funded_at: i64,
    pub deadline: i64,
    pub paid_at: i64,
    pub settled_at: i64,
    pub contributions: u32,
    pub status: Status,
    pub resolved_to_office: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Contribution {
    pub invoice: Pubkey,
    /// The wallet that paid, or the pool PDA for a committee allocation.
    pub contributor: Pubkey,
    pub nonce: u64,
    pub amount: u64,
    pub to_pool_on_fail: bool,
    pub settled: bool,
    pub created_at: i64,
    pub bump: u8,
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
pub struct InitPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ EscrowError::NotAdmin,
    )]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = admin,
        space = Pool::DISCRIMINATOR.len() + Pool::INIT_SPACE,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = admin,
        seeds = [POOL_VAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub pool_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
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
    /// CHECK: only its pubkey is recorded; must be on the config office list (checked in handler).
    pub office: UncheckedAccount<'info>,
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
#[instruction(nonce: u64)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,
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
        token::authority = contributor,
        token::token_program = token_program,
    )]
    pub contributor_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = contributor,
        space = Contribution::DISCRIMINATOR.len() + Contribution::INIT_SPACE,
        seeds = [CONTRIBUTION_SEED, invoice.key().as_ref(), contributor.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub contribution: Account<'info, Contribution>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Donate<'info> {
    pub donor: Signer<'info>,
    #[account(
        mut,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump = pool.bump,
        has_one = mint @ EscrowError::WrongMint,
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        token::mint = mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub pool_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = donor,
        token::token_program = token_program,
    )]
    pub donor_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Allocate<'info> {
    #[account(mut)]
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
    #[account(
        mut,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump = pool.bump,
        has_one = mint @ EscrowError::WrongMint,
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        token::mint = mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub pool_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = arbiter,
        space = Contribution::DISCRIMINATOR.len() + Contribution::INIT_SPACE,
        seeds = [CONTRIBUTION_SEED, invoice.key().as_ref(), pool.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub contribution: Account<'info, Contribution>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
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

/// Status-only cranks (`refund`, `expire`): no money moves here.
#[derive(Accounts)]
pub struct Crank<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.payee.as_ref(), &invoice.nonce.to_le_bytes()],
        bump = invoice.bump,
    )]
    pub invoice: Account<'info, Invoice>,
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
pub struct SettleContribution<'info> {
    pub caller: Signer<'info>,
    #[account(
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
        seeds = [
            CONTRIBUTION_SEED,
            invoice.key().as_ref(),
            contribution.contributor.as_ref(),
            &contribution.nonce.to_le_bytes(),
        ],
        bump = contribution.bump,
        has_one = invoice @ EscrowError::WrongDestination,
    )]
    pub contribution: Account<'info, Contribution>,
    #[account(
        mut,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump = pool.bump,
        has_one = mint @ EscrowError::WrongMint,
    )]
    pub pool: Account<'info, Pool>,
    /// The contributor's token account, or the pool vault (checked in the handler).
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
pub struct PoolCreated {
    pub pool: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct InvoiceCreated {
    pub invoice: Pubkey,
    pub payee: Pubkey,
    pub office: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub amount_try_kurus: u64,
    pub term: u32,
    pub student_ref_hash: [u8; 32],
    pub funding_deadline: i64,
}

#[event]
pub struct Contributed {
    pub invoice: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub raised: u64,
    pub to_pool_on_fail: bool,
    pub from_pool: bool,
}

#[event]
pub struct InvoiceFunded {
    pub invoice: Pubkey,
    pub raised: u64,
    pub deadline: i64,
}

#[event]
pub struct PoolDonated {
    pub pool: Pubkey,
    pub donor: Pubkey,
    pub amount: u64,
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
    pub caller: Pubkey,
}

#[event]
pub struct InvoiceExpired {
    pub invoice: Pubkey,
    pub raised: u64,
}

#[event]
pub struct InvoiceResolved {
    pub invoice: Pubkey,
    pub arbiter: Pubkey,
    pub to_office: bool,
    pub amount: u64,
}

#[event]
pub struct ContributionSettled {
    pub invoice: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub to_pool: bool,
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
    #[msg("amount must be greater than zero and at most what is still missing")]
    InvalidAmount,
    #[msg("window outside allowed range")]
    InvalidWindow,
    #[msg("mint is not on the allow list")]
    MintNotAllowed,
    #[msg("mints with a transfer hook are not supported")]
    TransferHookNotSupported,
    #[msg("office is not on the allow list")]
    OfficeNotAllowed,
    #[msg("the university and its payout partner cannot contribute to their own request")]
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
    #[msg("destination does not belong to the party the ruling or contribution names")]
    WrongDestination,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("vault balance does not match the expected payout")]
    ConservationViolated,
    #[msg("this contribution was already settled")]
    AlreadySettled,
}
