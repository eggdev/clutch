# Core journeys

Every product has these journeys. Each section names what the journey proves:
its outcomes, its user, its entry, its budgets, its vendors in test mode and
its failure states. The policy is in
[proof gates code](../../principles/proof-gates-code.md#core-journeys).

Kickoff records in `coreJourneys:` of `clutch.yaml` which core journeys the
project has. A journey that the project leaves out has a reason there. A
project adds its own core features to the
[hard invariants](../project-intent.md#hard-invariants).

Start each journey from its template in
[core journey templates](../../../.agents/skills/setup-verification/references/core-journeys/).

## Rules for every core journey

A journey proves a core journey when its header has `Core: <name>`, with a
name from this page. `clutch doctor --check` fails when the project adopts a
core journey and no journey has its `Core:` line. `check-journeys` holds each
`Core:` journey to these rules.

### Outcomes

Each outcome is a named assertion in a fixed form. The name stays the same
when the screens change, so a check can compare two copies of a journey.

- Web: `outcome(name, expected)` from `@repo/journeys/testing/outcome`.
  `expected` has the path, a visible text or both:
  `outcome('signed-in', { url: '/home', text: 'Welcome' })`.
- Native: a Maestro assertion with `label: outcome <name>`, such as
  `assertVisible: { text: Welcome, label: outcome signed-in }`.

A `Core:` journey asserts only through outcomes. On web it has no `expect`.
The names on this page are fixed. The path and the text come from the project.
The text must match the whole visible text, so `Pro` does not hold on
`Upgrade to Pro`.

A journey asserts every outcome and failure state that its section names,
`signed-up` first, each name as a literal string. `check-journeys` reads the
source for them. On web, the run is the proof. `outcome()` records each outcome that held,
and `bun run journey` fails a core journey whose run did not record each one on each device. A native core journey runs on the device host, which
does not record outcomes yet. Until it does, its source rules are its only
check. A call in a comment, or one that never runs, proves nothing.

Each outcome comes after a user step, such as a tap, a fill or a reload. An
outcome cannot hold on the screen that the journey was already on.

A web `Core:` journey imports only `@repo/journeys/testing`, takes `test`
from `@repo/journeys/testing/test`, and names the helper `const outcome =
outcomes(page)`. It runs no script in the page, mocks no route, and reaches
no file or environment. A native one keeps every step in its own flow, with
no `runFlow`. Its outcomes are `assertVisible` or `assertNotVisible`, never
`optional`, and never inside `repeat` or `retry`. So each step is in the file
that the checks read, and each outcome checks the screen.

### User

The user has a new account on the free plan, on a mid-range phone. The
journey makes the account through the sign-up screens, and asserts
`signed-up` before its own outcomes. A seed fixture, a seeded account or a
saved session does not count. A seeded paid account hides the free plan that
real users have.

### Entry

The entry is the first screen that a new user sees: `page.goto('/')` on web,
and `launchApp: { clearState: true }` as the first step on native. The journey opens no other URL or link. It reaches
each screen through the buttons that a user taps. A direct route does not
count, because it hides a screen that no button leads to.

### Budgets

The budgets come from `budgets:` in `clutch.yaml`, which kickoff fills. The
loader adds no value of its own, so `clutch doctor --check` fails on a budget
that an adopted core journey needs and that `budgets:` lacks.

- `layoutShift`: the cumulative layout shift limit. Kickoff writes 0.01.
- `clicks`: the clicks or taps to finish each core journey. Kickoff writes 3
  for sign-up.
- `timeToValue`: the seconds from the first screen to the activation event.
  No check reads it yet. Each outcome records its `elapsedMs` from the start
  of the test, so a later tool can check it.

Each journey also has no accessibility error: `accessible(page, 'where')`
after each step that renders a page. `outcome()` also runs axe after each
outcome holds, so each state that the journey proves is checked.

The journey test checks each run on each device. A layout shift at or over
`layoutShift` fails, and names the elements that moved. A click budget counts
each activation: a click or tap, or a key that clicks a control, such as Space
or Enter on a button. A choice in a `<select>` also counts. A press and hold
or a drag that activates nothing does not count. Sign-up counts from the entry to
`signed-up`. Each other journey counts from `signed-up` to the outcome that
its section names in its budget. A run over the budget fails at that outcome.
See [budgets](../end-to-end-testing.md#budgets).

### Vendors in test mode

A journey uses the test mode of each vendor that it touches, never a stand-in:

- The email inbox: the local mail catcher, or the email vendor's test inbox.
  The journey reads the email and opens its link.
- The payment provider: its test cards and its test clocks.

## Sign up (`sign-up`)

- Outcomes: `signed-up`, the user is signed in on the first screen after
  sign-up. `email-verified`, the link in the inbox verifies the address.
- User: a visitor with no account.
- Entry: the first screen, then its sign-up button.
- Budgets: the `clicks` budget, 3 clicks or taps from kickoff, from the entry
  to `signed-up`.
- Vendors in test mode: the email inbox, for the verification email.
- Failure states: `email-taken-refused` for an address that has an account,
  and `weak-password-refused`.

## Sign in (`sign-in`)

- Outcomes: `signed-out`, then `signed-in` with the new account.
  `session-kept`, a reload keeps the user signed in.
- User: the new account, signed out.
- Entry: the first screen, then its sign-in button.
- Budgets: the clicks that kickoff sets for `sign-in`, to `signed-in`.
- Vendors in test mode: the email inbox, when sign-in sends a link or a code.
- Failure states: `wrong-password-refused`.

## Onboarding (`onboarding`)

- Outcomes: `onboarded`, the user reaches the activation event that project
  intent names.
- User: the new account, just after `signed-up`.
- Entry: the first screen after sign-up.
- Budgets: `timeToValue`, and the clicks that kickoff sets for `onboarding`,
  to `onboarded`.
- Vendors in test mode: the email inbox, when onboarding sends an email.
- Failure states: `onboarding-resumed`, a user who leaves and comes back
  continues from the same step. `required-field-refused`, for an empty field
  that the step needs.

## Profile management (`profile-management`)

- Outcomes: `profile-saved`, a changed name shows after a reload.
  `email-changed`, the confirmation link changes the address.
- User: the new account.
- Entry: the first screen, then the button that opens the profile.
- Budgets: the clicks that kickoff sets for `profile-management`, to
  `profile-saved`.
- Vendors in test mode: the email inbox, for the confirmation email.
- Failure states: `invalid-field-refused`, for a value that the form does not
  take.

## Billing and checkout (`billing-and-checkout`)

- Outcomes: `plan-upgraded`, the paid plan shows after checkout.
  `plan-cancelled`, the account is back on the free plan.
- User: the new account on the free plan.
- Entry: the first screen, then the upgrade button.
- Budgets: the clicks that kickoff sets for `billing-and-checkout`, to
  `plan-upgraded`.
- Vendors in test mode: the payment provider's test cards, and a test clock
  that moves to the renewal date.
- Failure states: `card-declined`, with the provider's declined test card.
  `renewal-failed`, the account shows the renewal problem after the test
  clock moves to the renewal date.

## Roles and access (`roles-and-access`)

- Outcomes: `member-invited`, then `member-joined` when the invited user signs
  up from the invitation email.
- User: the new account, and a second new account that it invites.
- Entry: the first screen, then the button that opens the team.
- Budgets: the clicks that kickoff sets for `roles-and-access`, to
  `member-invited`.
- Vendors in test mode: the email inbox, for the invitation.
- Failure states: `role-refused`, a member without the role sees the refusal
  and changes nothing.

## Account security (`account-security`)

- Outcomes: `password-changed`, the new password signs in.
  `password-reset`, the reset link in the inbox sets a new password.
- User: the new account.
- Entry: the first screen, then the sign-in screen's reset link, and the
  button that opens security settings.
- Budgets: the clicks that kickoff sets for `account-security`, to
  `password-changed`.
- Vendors in test mode: the email inbox, for the reset email.
- Failure states: `wrong-password-refused`, for a wrong current password.

## Contact support (`contact-support`)

- Outcomes: `support-request-sent`, the user sees a confirmation, and the
  support tool or inbox gets the request.
- User: the new account.
- Entry: the first screen, then the button that opens support.
- Budgets: the clicks that kickoff sets for `contact-support`, to
  `support-request-sent`.
- Vendors in test mode: the support tool's test mode, or the email inbox.
- Failure states: `empty-request-refused`, for a request with no message.
