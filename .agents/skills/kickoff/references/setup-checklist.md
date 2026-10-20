# Setup checklist

Use this before the product interview for both new and existing projects.
It captures scope decisions in one pass so the interview can focus on users
and journeys. These are onboarding choices, not runtime feature flags.

## Three kinds of setup

- **Capability checklist:** choices that change the product's scope. Collect
  these together before the interview.
- **Automatic defaults:** apply established template engineering rules and
  derive configuration from selected capabilities and repository evidence.
  Report what you applied without asking the owner to approve each detail.
- **Product conversation:** ask about behavior, business constraints and
  tradeoffs that the code and defaults cannot decide, one question at a time.

A slot is not automatically a question for the owner. Fill facts from evidence
and routine setup from defaults. Ask only for a decision that remains open.

## Present it

Read recorded choices in project intent first. For an existing project,
prefill from the survey and cite a source file for each inferred answer.
Keep an inference visibly separate from an owner decision. Missing code does
not prove a capability is unwanted. For a new project, use the suggestions
below, labelled as proposals until the owner accepts them.

Present one compact checklist with choices, not a sequence of questions.
Use a form with toggles when the host supports it; otherwise use a Markdown
table the owner can edit in one reply. Do not require a particular UI tool.
Offer: “Accept these choices or list changes; undecided is fine.”

Each capability has four choices:

- **On:** include it in scope and ask only for missing design details.
- **Off:** exclude it; skip its vendor research and interview questions.
- **Later:** exclude it from current scope and record it in “Later, not now”.
- **Undecided:** resolve it when a journey needs it, before a dependent design.

An omitted answer stays undecided unless the owner accepts the proposed
checklist as a whole. Do not treat silence as acceptance.

## Choices

| Choice | Options | New-project proposal |
| --- | --- | --- |
| App access | Public without sign-in / private / mixed public and private | Undecided |
| Authentication | On / off / later / undecided; when on, name a provider or “recommend one” and known sign-in methods | Undecided |
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
| Shared realtime updates and offline editing | Choose each separately: on / off / later / undecided | Undecided for each |
| Platforms | Web / native / both / other | Web |
| Repository access | Private / public; outside contributions yes / no | Private; no outside contributions |

Add a capability when the owner's brief calls for it. Do not turn engineering
quality rules such as validation, accessibility, authorization or performance
into optional features. Local-first interface rules still apply when shared
realtime sync is off; do not add a sync vendor merely to satisfy a checklist.

## Apply automatic defaults

Preserve named providers, frameworks, hosting and other constraints from the
brief or repository. Do not add a required checklist field for each one. For
new projects, use the template default where it fits; investigate and ask only
when there is no supported default or a concrete conflict.

Apply these during the phase that owns the work:

- Keep the validation gate, linting, formatting, type checks and security and
  performance rules. Derive extra checks and test coverage from the journeys.
- Use the framework default in the question bank for the chosen platform.
  Retain a compatible framework and test runners in an existing project.
- Configure PR previews where the host supports them and production on merge
  for new projects. Retain an existing deployment pipeline; ask about staging
  only when a release requirement calls for it.
- Apply the standard API error shape, request context and authorization
  mechanisms to selected surfaces. Adapt them to the actual access model.
- Derive seed fixtures from agreed journeys and roles, environment variable
  schemas from integrations, and secret inventories from configuration. Never
  put secret values in docs.
- Draft health checks, rollback instructions and operational runbooks from the
  selected deployment. Reuse existing error tracking; prepare integration
  configuration when a provider is settled. Missing provider, account or alert
  recipient choices remain explicit rather than being invented.
- When tokens or webhooks are on, apply their security defaults in the question
  bank without a separate interview about each safeguard.

Automatic setup does not select paid services, create external accounts or
publish deployments without authorization. Complete local configuration and
identify any specific prerequisite that prevents activation. Do not describe
an integration as working until it has been verified.

## Keep product questions conversational

Use journeys to discuss roles and invitations, tenant boundaries, sensitive
data, retention and restore windows, customer exports, support access,
recovery needs, languages and currencies. Ask only about applicable topics
whose answers are not already recorded. Engineering defaults implement these
decisions; they do not decide customer promises or accepted risks.

For example, auth on with a named provider routes to sign-in integration and
standard session handling automatically; who can invite members remains a
product question. MCP off skips its transport, tools and vendor research.
An existing deployment pipeline is retained unless a documented requirement
conflicts; its presence does not trigger a fresh hosting interview.

## Record and use it

Save reviewed choices under **Setup choices** in
`docs/contributing/project-intent.md`: one row per choice with the selection
and any provider or constraint. Link to the owning architecture page or
decision record as details are settled. Keep provider details in that owning
page rather than maintaining two copies. This records intent, not a list of
what is implemented. Use normal kickoff slots for unresolved decisions so a
later session can resume. Do not duplicate the table in the install manifest.

Check dependencies before drafting a design. Private access needs an access
boundary, which may be app authentication or an existing infrastructure gate.
Public access does not imply auth is off: a public app may have private account
areas. Multi-tenancy needs isolation and an actor/access model. MCP does not
automatically require a separately published REST API. Ask only about actual
conflicts, one at a time, and never silently turn another capability on.

Use on choices to route services and harness questions. A chosen provider
does not need a second selection interview; verify facts when designing its
integration. An off choice is already the answer, not a reason to pitch it
again. Revisit a choice only when the owner requests it or a concrete journey
conflicts, and explain that conflict.

During kickoff, adapt project architecture pages to the chosen scope,
including prose outside kickoff slots. For example, tenancy off removes
assumed personal tenants and membership roles from request context,
authorization and storage; describe the actual ownership and access boundary.
It does not remove access checks. MCP off means no MCP package, transport or
tools. Replace an unused architecture page with a short scope statement linked
to the choice, or delete it and update all inbound links. Apply the same rule
to user docs, registry entries, seed data and operational instructions. Keep
universal engineering principles unchanged; tenant isolation rules apply when
tenant data exists and do not require inventing tenants for a public app.

For existing projects, keep evidence of current behavior in architecture docs.
A requested change belongs in a decision record and the reconciliation flow;
the checklist alone does not authorize deleting features, migrating data or
claiming the code already matches the desired scope. Migration must still
follow its rule against changing behavior without an owner decision.

Before close, resolve undecided choices needed by current journeys. Move
explicit deferrals to “Later, not now”; do not silently convert them to off.
On a resumed kickoff, use saved answers and ask only what remains open.
