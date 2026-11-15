# 13. Shared costs: one document per split, people without accounts, the summary mailed with Swish codes

Date: 2026-11-15 · Status: accepted

## Context

A trip, a dinner, a shared house: some paid for everyone, and afterwards it has to be settled. The
people aren't all in the household, nor on the server, and in Sweden they settle with Swish. What's wanted
is to write down who paid for what, have it worked out who pays whom, and send everyone their part with
what they need to pay it.

## Decision

- **A split is a document of its own**, `split/<id>`, under Money (Ekonomi) beside the budgets: shared
  live with other accounts like anything else (decision 5), offline too, and in the search. Its parts:
  `meta`, `people`, `expenses`, `payments` (money that has changed hands since) and `sends` (when it was
  mailed out).
- **People are entries in the split, not accounts**: a name, a mobile number for Swish, an e-mail address.
  Someone with an account here can be picked from the server's people, which ties the entry to them (so the
  app knows "you"); everyone else is just written in. The person who makes a split is in it from the start,
  with the number and address from their last split.
- **An expense is split equally, in shares or in exact amounts**, among the people ticked. All in öre: an
  equal or weighted split gives the leftover öre one each to the largest remainders, so the parts always
  add up to the amount exactly; exact amounts have to add up before the expense is saved.
- **A scanned receipt becomes an expense** (decision 8): from the receipt's page ("To shared costs": who
  paid, split equally among everyone) or from the expense dialog ("From a scanned receipt"), with its shop,
  day and total, and the expense keeps the scan's id; a receipt already in a split isn't offered again.
  The expense dialog can also scan one there and then ("Scan a receipt": the phone's scanner, or a photo on
  the website); it's kept among the scans like any other, and what it says fills the expense in as soon as
  it's read (at once on the phone, when the worker has read a photo), but not over what was typed since.
- **Settling pays the largest debt to the largest claim first**, so n people settle in at most n − 1
  payments. A payment marked as made is recorded as money that changed hands, and the rest is worked out
  again; it can be undone.
- **The summary is mailed by the server, through the household's own SMTP server**, as Hooden and
  Deckforce do it: set by an admin in the app (the password is never shown again; a test mail says whether
  it works), or the container's `SMTP_*` variables. Each person with an address gets their own mail: what
  they pay (and to whom) or get back, and a PDF with everything. The server reads its own copy of the
  split, so the app waits until its changes have reached the server before it asks. Anyone who may change
  the split may send it; the mail says who did, and an answer goes to them.
- **The PDF is made in `@noterat/core`** (pdf-lib, `uqr` for the QR codes), so the server mails the same
  PDF the app shows: their part first, then every expense with their share, everyone's balance, who pays
  whom and what's already paid. For each payment it has a **Swish QR code** in Swish's own format
  (`C0701234567;1861,12;Fjallresan;0`: payee, amount and message filled in and locked), read with the Swish
  app's scanner; the message is in plain letters, as a QR code doesn't say which character set it's in.
  Under it, **a link that opens Swish** with the same payment (`app.swish.nu/1/p/sw/?sw=…&amt=…`), for
  someone reading the PDF or the mail on their phone.

## Consequences

- Nobody needs an account to be in a split or to get the summary, and nothing about them leaves the
  household's server except the mail itself.
- Without a mail server the split still works, and each person's PDF can be shared from the phone.
- Swish's link and QR formats for private numbers aren't documented by Swish; both are checked with a real
  phone, and a change on Swish's side means changing two functions in `split.ts`.
