# DoctorWealth Books — Phases 1 & 2

Money records for a doctor's family, rebuilt from the DoctorWealth blueprint. It is offline and written in **plain language**: accounts,
categories, money in / money out, what I own & owe. Correct double entry runs underneath, and a separate **For my CA**
section shows the formal accounting view and builds a one-click Excel pack for the accountant.
Plain JavaScript (ES modules, no framework, no build step). Data lives in this browser's IndexedDB.

## Plain language vs the CA view

| You see | Your CA sees (For my CA, or Settings → "Accountant words everywhere") |
|---|---|
| Account / category | Ledger |
| Section | Group |
| Entry · Money in / Money out / Transfer / Adjustment | Voucher · Receipt / Payment / Contra / Journal |
| From → To | Credit → Debit |
| Income & spending · Saved this year | Profit & loss · Surplus |
| What I own & owe · My net worth | Balance sheet · Capital account |
| To sort later · Bills to pay · Starting net worth | Suspense · Sundry payables · Capital (opening) |

**For my CA** has the trial balance, P&L, balance sheet, day book with Dr/Cr, ledgers & groups, and a **CA pack**. The pack is one Excel file with:
- trial balance, P&L and balance sheet
- day book and ledger-wise entries
- TDS for matching with 26AS
- cash vs digital receipts
- family transfers
- chart of accounts with section numbers

## Money with family

The **Money with family** screen records cash or bank money between You and Spouse (either direction) in both people's records at once.

- **Gift — not to be returned:** not income or spending for either person. In accounting terms it is drawings for the giver and capital introduced for the receiver.
- **To be returned:** a running "who owes whom" total, which cancels out in the Family view.

Editing or deleting a transfer changes both sides.

**Phase 1 scope:** entities, masters, entry and core reports, plus the file imports from the old app.

## Phase 2 — Investments

Investments are ordinary entries (buy, sell, dividend, deposit, withdrawal) that carry the investment details. Holdings, FIFO lots and capital gains are worked out from those entries, so the portfolio always agrees with the main records.

- **Types:** listed shares, equity / debt / gold mutual funds and ETFs, SGB, physical / digital gold, crypto, bonds, unlisted shares, property, FD, PPF, NPS. The type decides the tax treatment.
- **Buy:** quantity, price and charges (charges are added to cost). For a SIP you can save without units and fill them in later.
- **Sell:** a live FIFO preview shows which purchase lots are used. The profit is split automatically into short and long term, and booked to separate profit accounts (equity ST / LT, other ST / LT, crypto).
- **Past holdings:** "Already own some" adds purchase lots from before you started using the app. The Portfolio flags any account whose balance does not match its investments, with a one-click fix.
- **Splits and bonuses:** a bonus is a new lot dated on the allotment day at zero cost.
- **Grandfathering:** for equity bought before February 2018, the 31 Jan 2018 value is used.
- **FD / PPF / NPS:** deposits, interest (paid out or added to the investment), withdrawal and closing. The FD value is estimated with quarterly compounding.
- **Capital gains report:** works by tax year.
  - Equity: 20% short term; 12.5% long term above ₹1.25 lakh.
  - Other assets: short term at your slab rate; 12.5% long term without indexation.
  - Crypto: flat 30%, and losses are never set off.
  - Set-off order: short-term losses against any gain, long-term losses only against long-term gains. Losses to carry forward are shown, along with a tax estimate.
  - The rules live in `js/core/taxrules.js`, one table per tax year.
- **Prices:** entered by you by default (offline). An optional online fetch can be switched on in Settings: mutual fund NAV from mfapi.in and crypto from CoinGecko. The Zerodha holdings import updates share prices and adds missing shares to the Portfolio.
- **F&O / intraday:** a result per day or per month, with charges, STT and option premium. Turnover is |profit| + |loss| + premium received, with an audit-limit flag. F&O counts as business income and intraday as speculative.
- **CA pack:** adds Capital gains (FIFO lines with ISIN and dates), Holdings and F&O sheets.

**Detailed income / spending:** alongside quick entry, "Detailed income" and "Detailed expense" record more:
- who paid or was paid, and how (cash / UPI / card / bank transfer / cheque)
- reference number and bill / receipt number
- GST and supplier GSTIN, for expenses

These details are searchable in All entries and included in the CA pack's day book. A cheque that is not account-payee counts as cash for the presumptive-tax limit. Settings can make the detailed form the default.

## Run it

Serve the folder over HTTP (service workers and ES modules need it):

```
npm run serve        # python3 -m http.server 8080  →  http://localhost:8080
npm test             # core engine, parsers, migration (node --test, no dependencies)
```

On GitHub Pages it can be hosted at the same address as the old DoctorWealth. The two then share
browser storage, so the old data can be read and migrated in one click.

## What's in Phase 1

| Area | Delivered |
|---|---|
| People | You, Spouse and a deletable Demo entity with a sample year. Add more (HUF, parents…) and switch with F3, like Tally companies. Every record points to a permanent id, so renaming never breaks history. Each entity has its own accent colour. A family view sits on top. |
| Accounting model | Balanced double entry. Amounts are integer paise. Opening capital is the balancing figure, so books always open balanced. Every create/edit/delete goes into an audit trail (with restore). Finished financial years can be locked. |
| Masters | Five root types (asset, liability, capital, income, expense). Tally-style groups, with editable starter ledgers for You (PNH, DKM, Clinic, Arihant loan, TDS receivable…) and Spouse. Every ledger has a tax tag with stable keys, and section numbers sit in a lookup table by tax year (44ADA → 58 for 2026-27). Sites (PNH/DKM/Clinic), owner tags and free custom tags are supported. Masters can be copied between entities. |
| Entry | Quick one-line entry (`450 petrol sbi`, `+18k pnh`, `5000 sbi to cash`, `y 1200 groceries card`). Simple screens for Income (with TDS and a cash/digital split), Expense (split across ledgers), Transfer, Investment, Loan (EMI principal/interest, loans given and recovered) and the clinic/hospital daily summary (cash, UPI/card and patient count; no patient names). There is also a multi-day daily grid. Recurring entries are never posted silently, and any entry can be saved as a shortcut. Pro-mode journal with raw Dr/Cr. |
| Reports | Day book, ledger statement, trial balance, P&L (group-wise, professional summary, YoY compare), balance sheet (capital roll-forward), cash-flow statement (direct), net worth over time, analysis by site/ledger/group/tax tag/owner/tag/month, cash vs digital (₹50L / ₹75L presumptive limits), and the family view. Totals drill down to ledger and voucher. Every report exports to CSV, Excel and Print/PDF. |
| Imports | See below. |
| Safety | Integrity check on every open and after every change (vouchers balance, no orphan lines, TB and BS tally), plus a Health screen. Persistent storage is requested. Automatic snapshots are taken before upgrades, restores and deletions. Backup download/restore. |
| App | Installable PWA with every library bundled locally, so it works fully offline. A schema version number with an automatic snapshot before migrations. A "new version ready" prompt. Sidebar on laptop, bottom bar with a big + on phone. Light/dark themes that follow the device, a hide-amounts toggle, Indian number format and +/− signs alongside colour. |

## Imports (as in the previous version, plus migration)

Every import goes through a review screen and nothing posts until you approve. Each import is one batch with undo (Import → history).

- **Bank statements:** PDF (password-protected supported), CSV, XLS and XLSX. These are the old app's parsers, tuned for SBI, BoB, HDFC and IDFC, plus a generic column parser. The review screen offers:
  - editable rows and keyword → ledger rules (★ to create one from a row)
  - exact duplicates (re-imports) unticked, and near-duplicates of manual entries flagged
  - the statement's own arithmetic check, and reconciliation against the closing balance with an optional opening-balance adjustment
  - unclassified rows go to **Suspense** until you reclassify them
- **Old DoctorWealth data:** read once from this browser (`dw_state_v1`) or from its JSON backup; any schema version, rupees or paise. Old accounts are mapped to existing ledgers or new ones. Income with TDS becomes gross / TDS receivable / net, and loan EMIs split into principal and interest. Spouse-owned accounts go to the Spouse entity, with inter-entity current accounts. Investments, holdings, tax P&L, rules and hospitals come across. Every old account balance is checked against the new books before you import. The old data is never modified.
- **Zerodha tax P&L** (`taxpnl-….xlsx`): realised gains, F&O and dividends per entity and FY, stored for the tax engine.
- **Zerodha holdings** (Kite Excel): a snapshot compared at cost with the matching ledger.
- **Restore** a DoctorWealth Books backup.

## Layout

```
index.html, sw.js, manifest.webmanifest, css/app.css, icons/
js/lib      money (paise, Indian format), dates (FY), util (ids, fingerprints, CSV)
js/core     masters (templates, tax tags), books (engine & reports), vouchers (screens → entries),
            quick (one-line parser), recurring, integrity, demo, legacy (old-app migration)
js/import   statement-parse (PDF/CSV/XLS parsers), statement-plan (rules, duplicates), zerodha, libs (lazy vendor loader)
js/app      db (IndexedDB), store (state, audit, numbering, backups), app (shell, router, shortcuts)
js/ui, js/views   components and pages
vendor/     SheetJS 0.18.5, pdf.js 3.11.174 (bundled for offline use)
tests/      node --test suites
```

## Keyboard

`N` quick add · `F6` income · `F5` expense · `F4` transfer · `F7` journal · `F3` switch entity ·
`Ctrl+K` or `/` search · `Alt+H` hide amounts · `Ctrl+Enter` save · `G` then `D/B/L/T/P/S/C/A/I/F/H` to navigate · `?` help.

## Next phases

3. Tax engine: Sec 58 / 44ADA vs actual, regimes, advance tax, ITR-3 schedules, 26AS/AIS.
4. Imports & sync: Zerodha tradebook, MF/CoinDCX/AIS, device change-file sync, PIN and encryption.
