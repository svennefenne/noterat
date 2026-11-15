# 11. The budget: one document per household, amounts in öre, the bank's CSV read on the device

Date: 2026-11-15 · Status: accepted (phase 7)

## Context

Phase 7 brings the household's money: a budget month by month, what was actually spent, the bank's
transactions brought in without typing them, and the receipts from the scanner (decision 8) tied to
them. Swedish banks have no open API for a household to use (PSD2 access needs a licensed third party),
but every one of them exports an account's transactions as CSV, each in its own way.

## Decision

- **A budget is a document**, `budget/<id>`, usually one per household, shared with everyone in it
  (decision 5), so a purchase booked on one phone is on the other at once, offline too. Its parts:
  `meta` (title, method), `categories` (name, group, income or expense, order), `plans` (a `Y.Map` per
  month, `"2026-11"`, of category → planned amount), `transactions` (a `Y.Map` each: date, amount, text,
  category, note, the receipt's scan id, and the import key), `rules`, `recurring` and `goals`.
- **Amounts are integers in öre**, negative for money out, so sums are exact and two people's changes
  never meet in a floating-point rounding.
- **Two ways to budget, one data model.** *Envelopes*: each category gets an amount a month and what's
  left carries over to the next (an expense category's "left" is everything planned minus everything
  spent, up to this month). *Zero-based*: every krona of income gets a job, and "to assign" (income minus
  planned) is meant to reach zero. The method only changes what's summed and shown; switching is safe.
- **The bank's CSV is read on the device**, in `@noterat/core`: the separator found from the first lines
  (`;`, tab or `,`), quotes, a decimal comma and "1 234,50", dates as `2026-11-14`, `14.11.2026` and the
  like, the header row found below a line or two of preamble, and the columns found by their Swedish (or
  English) names: *Transaktionsdag/Bokföringsdag/Datum*, *Belopp*, *Beskrivning/Text/Rubrik*. What isn't
  found is picked by hand, with a look at the rows first. The file is read as UTF-8, else as Windows-1252,
  which older bank exports use. Nothing about the bank account leaves the device but the transactions.
- **No row twice.** Each imported row gets a key of date, amount and text (and its number among identical
  rows in the same file), so exporting an overlapping period again adds only what's new.
- **Categories are learned.** Putting a transaction in a category remembers its text → category; the next
  import with that text gets it at once. The defaults are a Swedish household's usual categories, which
  people rename, remove or add to.
- **A receipt is tied to the bank's line for it**: a transaction with the same amount within three days
  either side, not yet tied to a receipt, is offered first; else the receipt is booked as a new
  expense. Either way the transaction keeps the scan's id and links to it, and the scan says where it was
  booked.
- **Recurring items** (rent, subscriptions) are reminders to book, shown in the month they're due, not
  transactions made by themselves: the bank's export is the truth, and it would bring them twice.
- **The report is six months of spending per category**, drawn as bars in plain HTML, no chart library.

## Consequences

- The budget works offline and is shared live like everything else, and it's in the search (the
  transactions' texts and amounts).
- A bank whose export the reader doesn't recognise still works, by picking the columns; a new bank's
  header names can be added to the list without a migration.
- Transactions are kept in one document per budget; a household's few thousand a year is small for Yjs,
  and a budget that grows too big can be split by year later.
- The receipt-to-bank match is by amount and date only; a coincidence is offered, never applied.
