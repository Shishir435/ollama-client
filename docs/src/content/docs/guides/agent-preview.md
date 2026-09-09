---
title: Agent (Preview)
description: What the supervised browser agent does, what it refuses, and where it stops.
---

Agent drives one browser tab towards a goal you write, one step at a time, and
asks before anything that changes the page in a way you would not want undone.
It is a Preview: the loop is real and supervised, and the list of what it
cannot yet do is longer than the list of what it can.

It is off unless you turn it on, and it never reads a page without the
page-observation permission you grant explicitly.

## How a step works

Every step is the same six things, in order, and none of them is skipped.

1. **Observe** — the tab's own content script reports the page: its URL, title,
   the text you can see, the rest of the document's text, open dialogs, and
   every interactive control with a short reference like `e1`.
2. **Decide** — your selected model is asked for exactly one next action,
   naming a control by its reference. Page content is supplied as data, never
   as instructions.
3. **Ground** — the action is resolved against the exact control the
   observation reported. A reference the page no longer holds, or a command the
   control cannot accept, is refused and the model is told why.
4. **Authorize** — policy classifies what the action would actually do and
   decides whether you are asked.
5. **Execute** — the resolved action runs against that control and no other.
6. **Verify** — the page is observed again and compared. A step is *confirmed*,
   *refused*, or *unresolved* — and an unresolved step pauses the run rather
   than being retried, because repeating an action that may already have
   happened is how one click becomes two.

## What it asks you about

| Action | What happens |
| --- | --- |
| Reading, scrolling | Runs without asking |
| Following a link within a site you already allowed | Runs without asking |
| Clicking a control, typing into a field | Asks the first time |
| Submitting a form, anything destructive | Asks every time |
| Payment, sign-in, one-time codes, file pickers | Hands the page to you |

When Agent asks about a click or a field, you can allow that kind of action on
that site for the rest of the run. That offer is never made for a submission,
anything destructive, a payment, a sign-in, or a sensitive field: those keep
asking, every time, because a prompt you cannot turn off is the only kind that
still means something.

Anything Agent hands to you is yours to finish. It does not type a password, a
card number or a one-time code, and it will not choose a file for you.

## What it will not do

- **One tab at a time.** Agent drives the tab it currently controls. It can
  open a tab and switch to one, and every tab it acts on has to be readable
  and on a site you allowed — an unfamiliar site is a new approval. It is not
  restricted to tabs it opened itself, so treat "sites you allowed" rather
  than "the tab you started on" as the boundary that holds.
- **Only sites you allowed.** A destination on a new site is a new decision.
- **Only what the page rendered.** Destinations come from links the page
  actually showed; a URL the model composed carrying data from your page is
  refused outright when that data is something you typed.
- **Nothing it cannot verify.** A step whose effect cannot be observed pauses
  the run and is reported as unresolved, not as done.

## Where it stops

These are current limits, not design decisions.

- **No tab allowlist.** Switching tabs is bounded by readability and the site
  allowlist, not by which tabs the run has been involved with.

- **One frame.** Content inside an iframe or a shadow root is not observed, so
  a control inside one cannot be used.
- **Native dialogs.** A JavaScript `alert`, `confirm` or `prompt` blocks the
  page and cannot be seen or answered. In-page dialogs and menus are fine.
- **No vision.** Only the page's structure and text; an image, a canvas or a
  chart is not read.
- **Large pages cost tokens.** A page with a thousand controls is a large
  prompt, and a small local model may run out of room before it can answer.
- **Twenty-five observations, ten minutes.** A run that passes either stops.
- **A restart pauses the run.** If the browser stops the extension's worker
  mid-step, the run comes back paused, with the interrupted step marked
  unresolved, and waits for you.

## Choosing a model

Agent needs a model that supports tool calling, and a small one will struggle
regardless. Tool calling is checked before a run starts and refused if
missing. A model that answers but cannot follow the one-action-at-a-time
contract will exhaust its retries and stop visibly rather than act on a
half-understood answer.

## If a run stops

The panel keeps the reason. A paused run tells you why it paused; a failed run
records what failed. Both stay on screen after the run ends, because the record
is the only account of what happened.
