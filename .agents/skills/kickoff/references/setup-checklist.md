# Setup checklist

Use this page before the product interview, for new and existing projects.
The checklist records scope in one pass. The interview can then stay on users
and journeys. These are scope choices. They are not runtime feature flags.

## Three kinds of setup

- **Capability checklist.** Choices that change the scope of the product.
  Collect them together, before the interview.
- **Automatic defaults.** Template rules and configuration that follow from
  the chosen capabilities and the repository. Apply them, then report what you
  applied. Do not ask the owner to approve each one.
- **Product conversation.** Behavior, business limits and tradeoffs that the
  code and the defaults cannot decide. Ask one question at a time.

A slot is not always a question for the owner. Fill a fact from evidence and
routine setup from a default. Ask only about a decision that is still open.

## Present it

Read the choices already in project intent first. For an existing project,
fill the checklist from the survey and cite a source file for each inferred
answer. Mark an inference as an inference until the owner confirms it. Code
that is missing does not prove that the owner does not want a capability. For
a new project, show the proposals below as proposals.

Show one short checklist, not a series of questions. Use a form with toggles
when the host has one. Otherwise use a Markdown table that the owner can edit
in one reply. Close with: "Accept these choices or list changes. Undecided is
fine."

Each capability has four choices:

- **On:** in scope. Ask only for design details that are missing.
- **Off:** out of scope. Skip its vendor research and its questions.
- **Later:** out of scope now. Add it to "Later, not now".
- **Undecided:** decide it when a journey needs it, before a design that
  depends on it.

A choice the owner does not answer stays undecided, unless the owner accepts
the whole checklist. Silence is not acceptance.

## Choices

| Choice | Options | New-project proposal |
| --- | --- | --- |
| App access | Public without sign-in / private / mixed public and private | Undecided |
| Authentication | On / off / later / undecided; when on, name a provider or "recommend one" and known sign-in methods | Undecided |
| Multi-tenancy | On / off / later / undecided; when on, personal accounts, organizations or both | Off |
| MCP server | On / off / later / undecided | Off |
| Third-party API and API tokens | On / off / later / undecided | Off |
| Billing and usage metering | On / off / later / undecided | Off |
| AI features | On / off / later / undecided | Off |
| File uploads and object storage | On / off / later / undecided | Off |
| Email, push or SMS notifications | On / off / later / undecided; name channels when known | Off |
| Background jobs and schedules | On / off / later / undecided | Off |
| Search beyond ordinary filters | On / off / later / undecided | Off |
| Product analytics and feature flags | Choose each separately: on / off / later / undecided | Off for each |
| Inbound webhooks | On / off / later / undecided | Off |
| Platforms and profiles | Web (Vite or Next.js) / native (One or Expo) / both / no client | Web, Vite with TanStack Router |
| Repository access | Private / public; outside contributions yes / no | Private; no outside contributions |
| Static analysis (SAST) | Auto / CodeQL / Semgrep. CodeQL is free on a public repository. On a private one it needs GitHub Code Security, about $30 per active committer per month, sold to organizations. Semgrep Community Edition is free everywhere; its findings show in the check log, with no Security tab. | Auto: CodeQL where code scanning takes results, Semgrep elsewhere |

Add a capability when the owner's brief calls for it. Validation,
accessibility, authorization and performance are quality rules. They are never
optional capabilities. Shared realtime updates and offline editing are not a
row: every client app uses the template's sync engine. Do not add a sync
vendor, an ORM or a data-fetching library.

## Apply automatic defaults

Keep each provider, framework, host and constraint that the brief or the
repository names. See [keep what works](../SKILL.md#rules-of-the-interview).
Do not add a checklist row for each one. In a new project, use the template
default where it fits. Research and ask only when no default fits or a
requirement conflicts with it.

Apply these in the phase that owns the work:

- Keep the validation gate, lint, format, type checks, and the security and
  performance rules. Add checks and test coverage from the journeys.
- Use the profile default in the question bank for the chosen platform. In an
  existing project, keep a framework and test runners that work, and record
  each departure from the template stack as a decision record.
- In a new project, set up PR previews where the host supports them, and a
  production deploy on merge. In an existing project, keep the deploy pipeline.
  Ask about staging only when a release requirement needs it.
- Apply the standard API error shape, request context and authorization to the
  chosen surfaces. Fit them to the real access model.
- Derive seed fixtures from the journeys and roles, environment variable
  schemas from the integrations, and the secret inventory from configuration.
  Never put a secret value in a doc.
- Derive delivery verification from the selected platforms: complete-stack
  commands, test accounts, platform launch and old-data fixtures. Fill
  [verification setup](../../../../docs/contributing/setup/verification.md)
  with commands or links to their owning pages and verify the available paths.
- Draft health checks, rollback steps and runbooks from the chosen deploy.
  Keep existing error tracking. Write the integration configuration when the
  provider is settled. When a provider, account or alert recipient is not
  chosen, write it as an open question. Do not invent one.
- When API tokens or webhooks are on, apply their security defaults from the
  question bank. Do not interview the owner about each safeguard.

Automatic setup never chooses a paid service, creates an external account or
publishes a deploy without the owner's approval. Finish the local
configuration, and name the prerequisite that blocks activation. Do not call
an integration working until you have verified it.

## Product questions

Use the journeys to ask about roles and invitations, tenant boundaries,
sensitive data, retention and restore windows, customer exports, support
access, recovery, languages and currencies. Skip a topic that does not apply
or that project intent already answers. Defaults implement these decisions.
They do not make customer promises or accept risks for the owner.

Examples:

- Auth is on with a named provider. Set up its sign-in and the standard
  session handling. Who can invite members is still a product question.
- MCP is off. Skip its transport, its tools and its vendor research.
- The project has a deploy pipeline. Keep it. Do not open a hosting interview
  unless a written requirement conflicts with it.

## Record and use it

Write the reviewed choices under **Setup choices** in
`docs/contributing/project-intent.md`: one row for each choice, with the
selection and any provider or constraint. Write the SAST choice as `sast:
auto`, `codeql` or `semgrep` in `clutch.yaml` too, because `sast.yml` reads it,
and fill its slot in `docs/contributing/capabilities/codeql-sast.md`. Provider details live in the owning
architecture page or decision record. The row links to it. The table records
scope. It is not a list of what is built. Keep a kickoff slot for each open
decision, so that a later session can resume. Do not copy the table into the
install manifest.

Check the dependencies between choices before you draft a design:

- Private access needs an access boundary: app sign-in or an existing
  infrastructure gate.
- Public access does not mean auth is off. A public app can have private
  account areas.
- Multi-tenancy needs isolation and a model of who acts and what they can
  reach.
- MCP does not need a separate published REST API.

Ask about a real conflict, one at a time. Never turn another capability on
without asking.

Use the on choices to route the services and harness questions. A chosen
provider needs no second selection interview. Check its facts when you design
the integration. Off is an answer. Do not propose an off capability again.
Open a choice again only when the owner asks, or when a journey conflicts with
it. Name the conflict.

Fit the architecture pages to the chosen scope, including prose outside the
slots:

- Tenancy off removes personal tenants and membership roles from request
  context, authorization and storage. Describe the real owner of the data and
  the access boundary. Access checks stay.
- MCP off means no MCP package, transport or tools.
- For a page that does not apply, replace it with a short scope statement that
  links to the choice. Or delete it and fix each link to it.

Apply the same rule to the user docs, registry entries, seed data and
operations pages. The principles do not change. Tenant isolation applies when
tenant data exists. It does not require tenants in a public app.

In an existing project, the architecture pages describe the current behavior.
A change the owner asks for goes into a decision record and the Reconcile
phase. The checklist alone never permits you to delete a feature, migrate
data or claim that the code matches the new scope. The migration still does
not change behavior without an owner decision.

Before close, decide each undecided choice that a current journey needs. Move
each deferral to "Later, not now". Do not turn a deferral into off. When
kickoff resumes, use the saved answers and ask only what is still open.
