# 17. The phone's menu, a plus button, and Settings

Date: 2026-11-15 · Status: accepted (on trial)

## Context

On a phone the sections were a tab bar along the bottom: four of them, the rest under "More". Making
something new meant going to its section first and finding its New button, and a quick voice memo meant
opening Voice memos, tapping Record, and tapping again to stop. The account menu held five of this
person's own settings, each its own dialog.

## Decision

- **No tab bar.** On a phone (narrower than 720px) the sections are in a menu behind a button left of
  the name: a panel from the left with the start page and every section, the one you're in marked. A
  wider screen keeps them along the top.
- **A plus button**, low on the screen where a thumb reaches it, but not in the corner. A tap opens what it
  makes, above a microphone: nearest first a note, a list, an event, a journal entry, a recipe, a scan,
  an expense. Each opens its section asking for a new one, as the section's own New button does:
  - **Note and journal**: one is made and opened, as their New buttons do.
  - **List, event and recipe**: their dialogs open (a recipe from a link, or written by hand).
  - **Scan**: the phone's scanner opens.
  - **Expense**: it goes straight to the one budget or cost split you can add to. With several, you pick
    one, and with none you're shown the money page with its New buttons.
- **Held down, the microphone records a voice memo**, kept when let go, and written out as text as every
  memo can be. A finger slid away from it before letting go throws the recording away, and a tap only
  says to hold it.
- **Settings** (the account menu) is a page of this person's own settings on this device, laid out as
  Administration is. It holds appearance (with which side the plus button is on, right or left), the
  language (or the household's), notifications and the lock.
- **Android's back button** closes what's open over the page (the menu, the plus button's choices, a
  dialog) before it goes back a page.

## Consequences

- The plus button's choices use the same `?new=1` links as the phone's home-screen shortcuts
  (`useLinkedAction`), so each section decides what "new" means there, in one place.
- The plus button hides while something is being written (the keyboard is up), and sits above a page's
  own bar along the bottom (a cost split's).
- It's a trial: the wide layout is untouched, and the tab bar can come back if the menu doesn't suit.
