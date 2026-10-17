# Kickoff question bank

These questions produced the most value in past kickoffs. Each one asks for a
decision. Show a draft answer with each question.

## 1. Intent

- What does the product do, in two sentences? What is the one idea that every
  other decision protects?
- Who are the users? What goal brings each group to the product? Who pays, and
  who is invited?
- What does the product promise each user? Make the promise concrete enough
  to test.
- Which market, place, currency and languages are requirements from day one?
- What should the product optimize for? What should it turn away?
- Which features do you expect later? Which of them could a shape today block?
  (Money as integer minor units plus a currency is the usual first answer.)
- What are the hard invariants: the rules that, if broken, break the business?
  Probe each of these: records that never change, actions that need explicit
  consent, tenant isolation, who sees what, what can always be exported, and
  what a user never loses.
- What wrong model of the product would an agent bring from the code?
- Who approves a one-way change, and where do they want to be asked? Where
  does work that is not done live?

## 2. Journeys

- Walk me through the first time each user meets the product. Where do they
  come from: a link, a store, a search, an invitation?
- What is the first screen? What must it show, and what is the one action?
- What does an empty account look like? What does the second visit look like?
- What happens with no network? Which actions must work offline?
- Which steps send an email, a push or a text? What does each one say?
- What does the user see when a step fails? Who can fix it?
- Which journey proves each hard invariant?

## 3. Services

- Every resource belongs to a tenant, and signup creates a personal tenant.
  Does the product show organizations or teams now, or later? What may each
  role do?
- Where does each fact live? One database for all tenants, or one for each
  tenant? Bring the cost of each at the expected scale.
- Which sign-in methods does each user need now, and later?
- Do two people edit the same record at the same time? If so, how do edits
  merge, and who wins on a conflict?
- Does the client get updates by push or by poll? The default is push from a
  sync engine into a local store. See `docs/principles/local-first.md`.
- Which sync engine holds the local store? Bring two or three, with the device
  storage, the conflict rule and the local test runtime of each.
- Which writes must wait for the server? Start from writes that move money,
  give consent, change access or touch a hard invariant. Every other write is
  local first.
- Which actions does a frequent user repeat most? Each gets a shortcut in the
  registry. See `docs/principles/keyboard-first.md`.
- Which service holds feature flag state? PostHog is the default. Who owns the
  flag registry module?
- What may operators see? Is support access granted by the customer, for a
  set time?
- How does the customer pay: a subscription, usage-based billing, or not at
  all? For a subscription, what happens at a plan limit: stop, charge overage,
  or degrade? The default is stop with a clear message. Write a plan limits
  page only when the product bills.
- Does billing or a dashboard need usage events? Write a usage metering page
  only when it does.
- Does background work need a history that users can see, such as agent or job
  runs? Write a run history page only when it does.
- How long can a user restore deleted data? The default is 30 days. Which data
  is exempt from soft delete, and why?
- Does the product expose an API to third parties? Its error codes extend the
  table in `docs/contributing/architecture/api-errors.md`.
- Which work runs in the background? What retries, and what tells the user?
- What can a user export, in what format, and for how long is it kept?
- Which capabilities does the MCP server expose to agents? The default is to
  ship an MCP server. Which of its tools change data?
- Which ways can a request arrive: a browser, a token, a job, a webhook, an
  inbound message? Which of them have no person behind them?
- Which actions must a live person take, never automation: members, roles,
  billing?
- How long does each store keep data that grows? What leaves with a deleted
  tenant?
- Which key formats, object names and stored JSON shapes will outlive the first
  deploy?

## 4. Harness

- Which platforms: web only, or native too? Default: web only, as a Vite
  single-page app. Propose Next only when public pages need server rendering
  for search. Propose One or Expo only when project intent lists a native app
  as a must. Write the choice as a decision record.
- On native, which Tailwind binding? Look up which binding supports the
  Tailwind version of the web build, and bring its version.
- Which deploy target for each app?
- What should the product feel like? Draft the theme in
  `docs/contributing/architecture/styling.md`: the value of each role in each
  scheme, the font families, the shadow policy and the scheme for a first
  visit. The role names are fixed.
- Which environments: a preview for each PR and production on merge, or a
  staging step?
- What does the seed data contain, and which accounts does it create?
- Which CI steps does each PR need beyond `validate`?
- Which runtimes does the code target: browser, server, worker? Which tools
  generate types?
- Which test runner for each test type, and which journeys does the end-to-end
  suite cover?
- Which security rules must every later change keep? Which risks do you accept
  on purpose, and when would you revisit each one?
- Does the product encrypt stored data with a key that it holds, beyond the
  storage vendor's encryption? The default is no. Name the threat that needs it.
- Which secrets exist, what does each one protect, and what breaks when it
  rotates?
- Which vendor accounts hold the product, and how do you recover each one?
- Which production numbers does an agent need to read? Which analytics source
  gives them without customer content?
- What is the first action for each failure: roll back, or fix forward?
- How much data can each store lose, and how long may a restore take? Which
  stores are backed up, rebuilt or accepted as lost?
- Which check measures each budget in
  `docs/contributing/architecture/client-performance.md` that needs the app?
  The budgets are fixed. A project can only make one stricter. Does the live
  site get a weekly check against the budgets, with one tracking issue that
  opens and closes itself?

## 5. Product edges

Ask each one. When the owner does not know yet, add it to "Later, not now" in
project intent and move on. Each answer has a default to propose.

- Does the product need uptime monitoring? Default: a probe that runs outside
  the product's infrastructure and checks public endpoints only. It sends one
  alert for each outage, one reminder each day and one all-clear.
- Do operators get alerts about product events? Default: the product emits a
  domain event, and the alert subscribes to it. The product sends email
  directly only to the account owner, such as a password reset.
- Does the product issue API tokens? Default: a prefix that secret scanners
  find, only a hash stored, an idle expiry and an absolute expiry, and rotate
  and revoke for the user.
- Does the product accept inbound webhooks? Default: a wrong secret, a disabled
  endpoint and an unknown endpoint all return the same 404. Compare secrets in
  constant time. Cap the payload size, reject replays outside a time window,
  and let an old and a new secret overlap while a secret rotates.
- Is the repository public, and does it accept outside contributions? Default:
  private. A public repository that accepts contributions needs a license and
  a contributor license agreement.

## What past owners pushed back on

- Exceptions that "agents will misuse". Propose the rule with no exception.
- Phases such as "pre-baseline" or "until launch". Build it well from the start.
- Lists that someone must keep current by hand. Derive them, or check them.
- A vendor proposal without its cost or its deployment model.
- A question about a fact that a file or a vendor page answers.
- Principles drafted before the users were known.
