# Changelog

## 1.10.0 (2026-11-13)

### Features

- feat(primitives): name the journey of each invariant (CL-536)

## 1.9.3 (2026-11-13)

### Fixes and maintenance

- docs(decisions): keep the checks with no cap or monthly target (CL-527)

## 1.9.2 (2026-11-13)

### Fixes and maintenance

- docs(checks): limit the time rule to the time of a run (CL-548)

## 1.9.1 (2026-11-13)

### Fixes and maintenance

- fix(tools): keep the count of the contract check, and name a check that wrote no findings (CL-547)

## 1.9.0 (2026-11-13)

### Features

- feat(cli): report the time of the agent loop in clutch metrics (CL-535)

## 1.8.0 (2026-11-13)

### Features

- feat(tools): give check findings stable ids and a JSON form (CL-534)

## 1.7.4 (2026-11-13)

### Fixes and maintenance

- docs(principles): show the check that holds each principle (CL-531)

## 1.7.3 (2026-11-13)

### Fixes and maintenance

- docs(ci): list the iOS lane variable in the escape hatch table (CL-485)

## 1.7.2 (2026-11-13)

### Fixes and maintenance

- fix(ci): start the iOS lane only where a repository turns it on (CL-484)

## 1.7.1 (2026-11-13)

### Fixes and maintenance

- chore(clutch): file the follow-ups of the 2026-11-12 merge day

## 1.7.0 (2026-11-12)

### Features

- feat(review): list the owner findings of merged pull requests in the weekly digest (CL-472)

## 1.6.0 (2026-11-12)

### Features

- feat(risk): ask the owner only for what cannot be paid back (CL-463)

## 1.5.0 (2026-11-12)

### Features

- feat(pr): hold a pull request that makes a contract break (CL-464)

## 1.4.0 (2026-11-12)

### Features

- Hold a migration for the owner only when its SQL can lose data, and take policy docs out of the hard core.

## 1.3.0 (2026-11-12)

### Features

- Hold a PR that removes a screen or route, and tie a new feature to a user goal from project intent.

## 1.2.0 (2026-11-12)

### Features

- Deploy each green main, prove the core journeys on production, and fail a project that ships with no deploy.
- feat(deploy): deploy green main and prove it on production

## 1.1.0 (2026-11-12)

### Features

- Take agent review and the visual verdict out of the merge decision.
- Replace the design stop with a hand-test marker, and fail a pull request over its scope limit.

## 1.0.2 (2026-11-12)

### Fixes and maintenance

- fix(journeys): start the native lanes only for a change that can reach the app (CL-474)

## 1.0.1 (2026-11-12)

### Fixes and maintenance

- chore(clutch): file the findings of the council review

## 1.0.0 (2026-11-12)

### Breaking changes

- feat(contract)!: declare each package once in a contract, and derive the checks, the manifest and the agent tools from it
- feat(app)!: ship one universal client on One with Expo and React Native, with a universal design system, a SQLite local database on a device, and a first-screen check that reads each built page

### Features

- Let a sensitive path leave the owner's hold when its journeys exist, and hold a PR on a failed native journey.

## 0.70.0 (2026-11-12)

### Features

- Let a sensitive path leave the owner's hold when its journeys exist, and hold a PR on a failed native journey.

## 0.69.0 (2026-11-12)

### Features

- Take agent review and the visual verdict out of the merge decision.

## 0.68.0 (2026-11-12)

### Features

- Let the server merge a green agent PR with no session, and stop open review threads holding a merge.
- Add the system-review skill, a fixed council review of how well a project ships with its owner hands off.

## 0.67.0 (2026-11-12)

### Features

- Let the server merge a green agent PR with no session, and stop open review threads holding a merge.

## 0.66.0 (2026-11-12)

### Features

- Hold a PR that weakens a journey or budget, by a deterministic comparison, and make model review findings advisory.

## 0.65.0 (2026-11-12)

### Features

- Remove the revert brake, and stop sending an unanswered PR comment to the owner.

## 0.64.1 (2026-11-12)

### Fixes and maintenance

- fix(lint): count outcome as an assertion in a core journey

## 0.64.0 (2026-11-08)

### Features

- Fail a journeys run that tests nothing when a feature ships a screen.

## 0.63.0 (2026-11-08)

### Features

- feat(pr): reach the owner in the session's thread, with pr ask as the fallback (CL-445)

## 0.62.0 (2026-11-08)

### Features

- feat(journeys): add core journey without and an inbox helper

## 0.61.0 (2026-11-08)

### Features

- feat(journeys): run core journeys on every device with budgets (CL-442)

## 0.60.2 (2026-11-07)

### Fixes and maintenance

- test(access): warm PGlite before the first access test (CL-448)

## 0.60.1 (2026-11-07)

### Fixes and maintenance

- test(cli): await the intake check before its repo is removed (CL-450)

## 0.60.0 (2026-11-07)

### Features

- feat(journeys): ship the core journey catalog (CL-440)

## 0.59.0 (2026-11-07)

### Features

- feat(pr): merge, watch main and revert in the delivering session (CL-436)

## 0.58.0 (2026-11-07)

### Features

- chore(tools): remove check-test-integrity and its allow list

### Fixes and maintenance

- docs(principles): proof gates code, and the owner gates the product (CL-439)

## 0.57.0 (2026-11-07)

### Features

- docs(principles): add the single-page app principle

## 0.56.5 (2026-11-06)

### Fixes and maintenance

- chore(risk): hold every auto-merge file for the owner

## 0.56.4 (2026-11-06)

### Fixes and maintenance

- chore(automerge): name the owner whose approval merges

## 0.56.3 (2026-11-06)

### Fixes and maintenance

- fix(auto-merge): merge after an approval and merge stacked PRs

## 0.56.2 (2026-11-06)

### Fixes and maintenance

- fix(auto-merge): let owner approval lift only the tier and findings

## 0.56.1 (2026-11-06)

### Fixes and maintenance

- fix(sync): format the sync changeset in the project's style

## 0.56.0 (2026-11-06)

### Features

- feat(auto-merge): merge a PR that the owner approved

## 0.55.1 (2026-11-05)

### Fixes and maintenance

- chore(clutch): file the gaps that the Neighborhood sync found

## 0.55.0 (2026-11-05)

### Features

- feat(metrics): report Warp's autonomy, cycle time and reverts (CL-141)
- feat(tools): cap every AGENTS.md at 20 lines, and add nested agent rules for tools (CL-307)
- feat(cli): run the project check in a new worktree (CL-312)
- feat(cli): add clutch verify post and the verify agent (CL-313)
- feat(cli): add clutch agent and 5 stage agent prompts (CL-314)
- feat(cli): run a factory scorer on a Qwen judge (CL-426)
- feat(cli): add clutch bench to compare models on pinned tasks (CL-427)
- feat(cli): add the factory tree schema and its check (CL-514)
- feat(doctor): add factory_as_code and a starter tree with sync (CL-515)
- feat(cli): link each agent file to the docs it must read (CL-516)
- feat(cli): name the factory intake labels and states (CL-517)

### Fixes and maintenance

- chore(clutch): file the factory stack test week issues

## 0.54.1 (2026-11-04)

### Fixes and maintenance

- fix(journeys): list the web apps in a fixed order (CL-434)

## 0.54.0 (2026-11-04)

### Features

- feat(review): hold for the owner only the hard core (CL-419)
- feat(babysit): babysit every agent PR from a workflow (CL-420)

## 0.53.7 (2026-11-04)

### Fixes and maintenance

- chore(clutch): record a journeys run.test flake

## 0.53.6 (2026-11-04)

### Fixes and maintenance

- ci(sync): run the Clutch sync only when a person starts it

## 0.53.5 (2026-11-04)

### Fixes and maintenance

- fix(tools): take Neighborhood's fixes to managed files (CL-425)

## 0.53.4 (2026-11-04)

### Fixes and maintenance

- docs(skills): name both reasons a Decide step skips

## 0.53.3 (2026-11-04)

### Fixes and maintenance

- ci(sast): run SAST in one job, and skip a docs-only PR (CL-422)
- ci(labels): compute the risk tier in the labels workflow (CL-423)
- ci(auto-merge): find the pull request in the decide job (CL-424)

## 0.53.2 (2026-11-04)

### Fixes and maintenance

- chore(clutch): record design-proposal first-run friction

## 0.53.1 (2026-11-03)

### Fixes and maintenance

- docs(journeys): name VISUAL_COMPARE for screenshots (CL-418)

## 0.53.0 (2026-11-03)

### Features

- feat(journeys): compare journey screenshots with baselines (CL-412)
- feat(review): review changed screenshots with an image model (CL-413)

## 0.52.1 (2026-11-03)

### Fixes and maintenance

- docs(skills): keep the owner's approval when answering findings (CL-417)

## 0.52.0 (2026-11-03)

### Features

- feat(lint): reject raw elements that the design system wraps (CL-406)

## 0.51.0 (2026-11-03)

### Features

- feat(pr): answer every review finding before merge (CL-415)

## 0.50.0 (2026-11-03)

### Features

- feat(digest): show the week's screenshot changes (CL-414)

## 0.49.1 (2026-11-03)

### Fixes and maintenance

- docs(decisions): adopt no design canvas tool for proposals (CL-411)

## 0.49.0 (2026-11-03)

### Features

- feat(skills): propose a design before building a screen (CL-410)

## 0.48.1 (2026-11-03)

### Fixes and maintenance

- docs(skills): link decision 0003 by URL in the deliver doc (CL-237)

## 0.48.0 (2026-11-03)

### Features

- feat(auto-merge): let a pure sync pass owner findings approved upstream

### Fixes and maintenance

- Auto-merge: a dispatched run names the repository for gh, so its find job no longer fails without a checkout.

## 0.47.0 (2026-11-03)

### Features

- feat(sync): name the project pages whose Clutch copy changed

## 0.46.0 (2026-11-03)

### Features

- feat(revert): keep drill reverts out of the brake and metric

### Fixes and maintenance

- fix(auto-merge): retry GitHub errors and re-decide stale PRs

## 0.45.0 (2026-11-03)

### Features

- `clutch worktree prune` removes each checkout whose PR is merged or closed, when nothing in it would be lost.

## 0.44.4 (2026-11-03)

### Fixes and maintenance

- fix(pr): read blocking and owner counts the way the gate does

## 0.44.3 (2026-11-03)

### Fixes and maintenance

- fix(test-integrity): honor an allow entry only in the change that adds it

## 0.44.2 (2026-11-03)

### Fixes and maintenance

- fix(sync): fix three breaks found by the Neighborhood sync
- fix(pr): see the owner approval and count findings from the gate

## 0.44.1 (2026-11-03)

### Fixes and maintenance

- fix(ci): judge a red main by its required checks in auto-revert

## 0.44.0 (2026-11-03)

### Features

- feat(ci): judge agent PRs by author and auto-merge reverts
- feat(ci): hold the hard core without trusting the agent
- feat(skills): run Linear issues in parallel lanes that auto-merge
- feat(skills): put Linear delivery proof in checks, not PR prose
- feat(ci): step auto-merge down when reverts pass 2%
- feat(ci): count every owner finding and review the full diff
- feat(ci): keep an owner finding until the diff removes its cause

### Fixes and maintenance

- fix(sync): make a sync land with no hand fixes
- fix(journeys): find the web app and warn when no journey ran
- fix(labels): create the revert label in every project

## 0.43.1 (2026-11-03)

### Fixes and maintenance

- fix(github): edit issue bodies through REST in grade-verdicts

## 0.43.0 (2026-11-03)

### Features

- feat(pr): mark the issue done in the PR head before auto-merge

## 0.42.0 (2026-11-03)

### Features

- feat(ci): turn each revert into a regression test in gardening

## 0.41.0 (2026-11-03)

### Features

- feat(tools): name the slowest tests and file an issue per flake

## 0.40.0 (2026-11-02)

### Features

- A project behind a new Clutch release only warns for `template.grace_days` days, and `clutch-sync.yml` opens a sync PR that auto-merges under a new bot rule. Sync now ships `packages/journeys`.

### Fixes and maintenance

- fix(pr): read owner findings and every review wording (CL-210)

## 0.39.0 (2026-11-02)

### Features

- feat(ci): merge 80% of PRs with no human (CL-209)

## 0.38.0 (2026-11-02)

### Features

- feat(ci): revert a red auto-merge and watch the revert rate (CL-207)
- feat(review): route a weakened check to the owner (CL-208)

## 0.37.0 (2026-11-02)

### Features

- feat(cli): add the friction log and clutch friction (CL-306)
- feat(ci): feed friction and expiring flakes to gardening (CL-501)
- feat(ci): add a nightly flake hunt (CL-502)

## 0.36.0 (2026-11-02)

### Features

- A daily security agent triages new vulnerability reports in private and opens one pull request with fixes (CL-108).

## 0.35.0 (2026-11-02)

### Features

- feat(cli): add the shrink-only ratchet engine (CL-302)
- feat(cli): add clutch ratchet and adopt the first ratchet (CL-302b)

## 0.34.2 (2026-11-02)

### Fixes and maintenance

- docs(review): drop a rule that a check covers

## 0.34.1 (2026-11-02)

### Fixes and maintenance

- test(db): give the drizzle-kit test a measured timeout (CL-128)

## 0.34.0 (2026-11-02)

### Features

- Journeys fail on serious accessibility violations: an axe check in `@repo/journeys`, and the `a11y_checks` capability (CL-505).

## 0.33.0 (2026-11-02)

### Features

- feat(metrics): add the weekly cross-repo doctor digest (CL-504)

## 0.32.2 (2026-11-02)

### Fixes and maintenance

- docs(decisions): allow shrink-only ratchets for adopted repos (CL-301)

## 0.32.1 (2026-11-02)

### Fixes and maintenance

- fix(sync): keep Clutch-only tests out of project syncs (CL-139)

## 0.32.0 (2026-11-01)

### Features

- feat(ci): turn auto-merge on for low-risk agent PRs (CL-405)

## 0.31.0 (2026-11-01)

### Features

- feat(tools): quarantine flaky tests with an expiry (CL-304)
- feat(ci): explain a failed CI run on its PR (CL-305)

## 0.30.0 (2026-11-01)

### Features

- feat(env): add a dev container and the Cursor cloud setup (CL-203)
- feat(agents): add the repo MCP config for agents (CL-205)

## 0.29.0 (2026-11-01)

### Features

- feat(ci): keep lockfile packages on the npm registry (CL-133)
- feat(ci): pin each required check to the Actions app (CL-134)

## 0.28.2 (2026-11-01)

### Fixes and maintenance

- docs(tracker): record the Neighborhood starting branch (CL-601)

## 0.28.1 (2026-11-01)

### Fixes and maintenance

- docs(tracker): record that clutch drives the workflow (CL-902)

## 0.28.0 (2026-11-01)

### Features

- feat(tracker): generate the tracker on main, never in a PR (CL-123)

### Fixes and maintenance

- docs(skills): ask the owner for one approval round per batch (CL-124)
- fix(pr): keep the whole stack and only the PR's commits in sync (CL-311)

## 0.27.0 (2026-10-31)

### Features

- feat(cli): add clutch worktree new and list (CL-201)
- feat(cli): add clutch worktree rm and dev --stop (CL-201b)

### Fixes and maintenance

- fix(pr): act on the checkout's head in pr sync and pr wait (CL-122)
- fix(pr): refuse a merge that waits for a code owner (CL-138)
- docs(worktree): document per-checkout isolation (CL-202)

## 0.26.2 (2026-10-31)

### Fixes and maintenance

- test(release): read the capability count (CL-127)

## 0.26.1 (2026-10-31)

### Fixes and maintenance

- ci: check only the affected scope on each PR (CL-303)

## 0.26.0 (2026-10-31)

### Features

- feat(validate): add validate --changed and clutch checks (CL-204)

## 0.25.3 (2026-10-31)

### Fixes and maintenance

- test: wait for the event instead of a fixed sleep (CL-309)

## 0.25.2 (2026-10-31)

### Fixes and maintenance

- test(cli): stop CLI tests needing tags or a fixed count (CL-310)

## 0.25.1 (2026-10-31)

### Fixes and maintenance

- docs(tracker): survey Neighborhood for upstream (CL-605)

## 0.25.0 (2026-10-31)

### Features

- feat(pr): open agent PRs as the release bot (CL-137)

## 0.24.0 (2026-10-31)

### Features

- feat(metrics): grade dry-run verdicts in one place (CL-130)

## 0.23.0 (2026-10-30)

### Features

- feat(ci): turn auto-merge on for bot PRs (CL-405)

## 0.22.0 (2026-10-30)

### Features

- feat(ci): auto-merge in steps, with a main-red guard (CL-132)

## 0.21.0 (2026-10-30)

### Features

- feat(cli): add PR size, agent branches and steps to metrics (CL-503b)

## 0.20.3 (2026-10-30)

### Fixes and maintenance

- fix(pr): fix three gaps in the pr commands (CL-121)

## 0.20.2 (2026-10-30)

### Fixes and maintenance

- fix(cli): let clutch sync finish in a fresh project (CL-131)

## 0.20.1 (2026-10-30)

### Fixes and maintenance

- ci(release): keep the bot key in a main-only environment (CL-136)

## 0.20.0 (2026-10-30)

### Features

- feat(ci): require agent review and SAST via a synced ruleset (CL-308)

## 0.19.0 (2026-10-30)

### Features

- feat(ci): label each PR with its size and warn when large (CL-401)

## 0.18.0 (2026-10-30)

### Features

- feat(ci): run Semgrep where code scanning is not available (CL-135)

## 0.17.0 (2026-10-30)

### Features

- feat(ci): label each PR with its kind and areas (CL-109)

## 0.16.0 (2026-10-30)

### Features

- feat(skills): add the babysit-pr skill (CL-111)

## 0.15.0 (2026-10-30)

### Features

- feat(ci): revert a merged PR with one label (CL-110)

## 0.14.3 (2026-10-30)

### Fixes and maintenance

- fix(verify): start no flow before its owner record (CL-107)

## 0.14.2 (2026-10-30)

### Fixes and maintenance

- test(sync): migrate the PGlite test database once (CL-903)

## 0.14.1 (2026-10-30)

### Fixes and maintenance

- ci(review): drop the unused id-token grant (CL-115)

## 0.14.0 (2026-10-30)

### Features

- feat(skills): add a command index and nudge raw gh calls (CL-120)

## 0.13.3 (2026-10-30)

### Fixes and maintenance

- docs(gardening): name the token that opens the gardening PR

## 0.13.2 (2026-10-30)

### Fixes and maintenance

- build(deps): add Renovate with a 3-day minimum release age (CL-104)

## 0.13.1 (2026-10-30)

### Fixes and maintenance

- build(validate): run validate from tools/validate.ts (CL-126)

## 0.13.0 (2026-10-30)

### Features

- feat(pr): add status, wait, failures, sync and ready commands (CL-117)

## 0.12.2 (2026-10-30)

### Fixes and maintenance

- docs(skills): add the run-lanes skill (CL-119)

## 0.12.1 (2026-10-30)

### Fixes and maintenance

- build(validate): print failing task output inline (CL-125)

## 0.12.0 (2026-10-30)

### Features

- feat(cli): add clutch issues new with safe ids (CL-118)

## 0.11.1 (2026-10-30)

### Fixes and maintenance

- fix(release): pass check-changeset on a release commit (CL-116)

## 0.11.0 (2026-10-30)

### Features

- feat(risk): re-tier risk to Brendan's rule (CL-114)

## 0.10.0 (2026-10-30)

### Features

- feat(ci): make every dry-run verdict countable (CL-112)

## 0.9.4 (2026-10-30)

### Fixes and maintenance

- docs(ci): audit CI credentials and waive oidc_ci (CL-105)

## 0.9.3 (2026-10-30)

### Fixes and maintenance

- ci(codeql): add the CodeQL workflow (CL-102)

## 0.9.2 (2026-10-30)

### Fixes and maintenance

- ci(workflows): admit only same-repo runs to auto-merge (CL-113)

## 0.9.1 (2026-10-30)

### Fixes and maintenance

- ci(workflows): lint workflows with actionlint and zizmor (CL-103b)

## 0.9.0 (2026-10-30)

### Features

- feat(ci): add the low-risk auto-merge workflow in dry-run mode (CL-404)

## 0.8.0 (2026-10-30)

### Features

- feat(cli): add risk tiers by path (CL-403)

## 0.7.0 (2026-10-30)

### Features

- feat(cli): add clutch metrics for factory observability (CL-503)

### Fixes and maintenance

- ci(workflows): pin every action to a commit SHA (CL-103)

## 0.6.8 (2026-10-30)

### Fixes and maintenance

- ci: run actions on Node 24 and pin ubuntu-26.04 (CL-042)

## 0.6.7 (2026-10-30)

### Fixes and maintenance

- ci(gardening): let gardening PRs pass the gates (CL-041)

## 0.6.6 (2026-10-30)

### Fixes and maintenance

- chore(trust): record the main ruleset and adopt protection (CL-106)

## 0.6.5 (2026-10-30)

### Fixes and maintenance

- docs(tracker): re-sequence the plan around delegated merge (CL-040)

## 0.6.4 (2026-10-30)

### Fixes and maintenance

- fix(doctor): prove review and gardening agents can run (CL-038)

## 0.6.3 (2026-10-30)

### Fixes and maintenance

- fix(tracker): close the gaps the P0 audit found (CL-036)

## 0.6.2 (2026-10-30)

### Fixes and maintenance

- ci(release): push releases with a GitHub App token (CL-039)

## 0.6.1 (2026-10-30)

### Fixes and maintenance

- ci(review): run agent workflows on the cheapest model (CL-037)

## 0.6.0 (2026-10-30)

### Features

- feat(security): scan secrets with gitleaks, add SECURITY.md (CL-101)

## 0.5.2 (2026-10-30)

### Fixes and maintenance

- docs(tracker): refresh every plan against the current repository

## 0.5.1 (2026-10-30)

### Fixes and maintenance

- docs(tests): review every test file (CL-029)

## 0.5.0 (2026-10-30)

### Features

- feat(cli): run sync, init and doctor from the release binary (CL-028b)

## 0.4.0 (2026-10-30)

### Features

- feat(cli): follow the latest Clutch release, not a pin (CL-028)

## 0.3.0 (2026-10-30)

### Features

- feat(mise): install the clutch binary from the latest release (CL-025b)

## 0.2.0 (2026-10-30)

### Features

- feat(cli): ship clutch as a release binary for the tracker (CL-025)

## 0.1.0 (2026-10-30)

### Features

- feat(release): add changesets and the changeset check (CL-032)
- feat(release): release on each merge and start projects fresh (CL-032b)

### Fixes and maintenance

- fix(release): install without git hooks in the release job
