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

- Is one account one person, or an organization with roles? What may each
  role do?
- Where does each fact live? One database for all tenants, or one for each
  tenant? Bring the cost of each at the expected scale.
- Which sign-in methods does each user need now, and later?
- Do two people edit the same record at the same time? If so, how do edits
  merge, and who wins on a conflict?
- Does the client get updates by push or by poll?
- What may operators see? Is support access granted by the customer, for a
  set time?
- How does the customer pay, and for what unit: seats, projects, usage?
- Which work runs in the background? What retries, and what tells the user?
- What can a user export, in what format, and for how long is it kept?

## 4. Harness

- Which app framework and deploy target? Web only, or native too?
- Which environments: a preview for each PR and production on merge, or a
  staging step?
- What does the seed data contain, and which accounts does it create?
- Which CI steps does each PR need beyond `validate`?

## What past owners pushed back on

- Exceptions that "agents will misuse". Propose the rule with no exception.
- Phases such as "pre-baseline" or "until launch". Build it well from the start.
- Lists that someone must keep current by hand. Derive them, or check them.
- A vendor proposal without its cost or its deployment model.
- A question about a fact that a file or a vendor page answers.
- Principles drafted before the users were known.
