---
version: 1
slug: "src-split-splitscreen-tsx"
primary_target: "src/split/SplitScreen.tsx"
related_targets: ["src/budget/BudgetScreen.tsx"]
---

# Shared costs: a split's page

Scope: the page of one cost split (/budget/splits/:id) and the Money screen's list of splits. Mode: operate.
Audience: the household member who paid for things on a trip or a dinner, on the phone during it and at the
table afterwards; the others (often without accounts) only ever see the mailed PDF.
Task: add people (name, Swish number, e-mail), add expenses (equal, shares or exact), see where everyone
stands, mark payments made, send everyone their summary.
Constraints: the app's own world (styles.css tokens, system sans, light and dark), works offline; sending
needs the server and its SMTP.

## Direction contract

THESIS: The split is a table of people, not a ledger: each person is a card with what they paid, their
share and their balance, because each of them gets their own mail. It refuses the category's expense feed
with a balance strip on top.

OWN-WORLD: Noterat's paper surfaces and green accent; balances in the accent (owed to them) and the danger
red (they owe), tabular numerals, cards with a hairline border and 14px radius, a bar under each balance.

STORY: The visitor sees at once who is up and who is down and by how much, adds an expense or a person
without leaving the page, and sends it out when it's done; missing e-mail or Swish numbers are flagged on
the card itself.

FIRST VIEWPORT: Back to Money, the title with Share; one line "5 expenses · total 13 904,50 kr"; a two
column grid of person cards (avatar initial, name, "you" or the phone number, Paid and Share rows, the
balance large with its bar, warnings), a dashed "Add person" card across both columns; below, the latest
expenses; a docked bar above the tab bar with "+ Expense" and the primary "Send out".

FORM: person cards (position 2 of 7 on the ranked list); seed: 608e0bbd076048bf
Signature move: each balance drawn as a bar scaled to the largest balance in the split, green or red, so the
cards read together as one group settling to zero.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
