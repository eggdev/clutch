# The daily security pass

`.github/workflows/security.yml` runs this pass once a day. It keeps the
promises in [SECURITY.md](../../../../SECURITY.md) without a person on call:
acknowledge a report within 3 business days, triage it within 7 days, and fix
a critical bug within 30 days. Run each command below exactly as written. The
workflow allows only these commands.

## Inputs

Read each input. When one fails, for example because the token cannot read
it, say so in the pull request body and go on.

1. **New private reports.**
   `gh api repos/<REPO>/security-advisories?state=triage`. Each one is a
   vulnerability report that nobody has triaged yet.
2. **Code scanning alerts.** `gh api repos/<REPO>/code-scanning/alerts?state=open`
3. **Dependabot alerts.** `gh api repos/<REPO>/dependabot/alerts?state=open`
4. **Secret scanning alerts.**
   `gh api repos/<REPO>/secret-scanning/alerts?state=open&hide_secret=true`
5. **Open dependency updates.** `gh pr list --label dependencies --state open`
6. **The dependency audit.** `bun tools/audit-prod.ts`
7. **The whole git history.** `gitleaks git --redact`. `.gitleaksignore` holds
   the approved false positives.
8. **The project's logs.** `bun run security-logs`, when `package.json` has
   that script. [The security page](../../../../docs/contributing/security.md#logs)
   names the source. Look for signs of abuse: bursts of failed sign-ins,
   requests that probe for files, and errors that a payload causes.

## Private reports

A private report stays private until the owner publishes it.

- Never write a report's id, title or details in a file, a commit, the pull
  request title or its body. The workflow refuses to push a pull request that
  names one.
- For each report, return an item in `advisories` with its `ghsa_id`, a
  `severity` and a `note`. The workflow adds the note to the report's
  description, where only the owner and the reporter read it. It sets the
  severity only when the report has none. This is the acknowledgement.
- The note says whether you could confirm the report, and how: the file and
  line, or the request that shows it. Rate the severity from the impact and
  the reach, as CVSS does. Then propose a fix in prose, with the files it
  changes. The owner makes the fix in the report's private fork.
- Never publish, close or accept a report. The workflow cannot do it either:
  only the owner does.

## Other findings

- Fix what you can confirm with small edits to files: update a vulnerable
  package, remove a secret from a file and name its rotation in the body, or
  fix the code that an alert names.
- Do not run git, and do not push. A later step commits your edits and opens
  one pull request.
- Never copy a secret's value anywhere, even a revoked one.
- An alert that is a false positive goes in the body with the reason. Do not
  dismiss it: the owner does.
- A change to a guardrail file needs the owner's decision. Write it in the
  body as a proposal, not as an edit.

## The result

- `title`: a Conventional Commit of 72 characters or fewer. Leave it empty
  when there is no edit.
- `body`: each edit and its reason, each false positive, each proposal and
  each input that you could not read.
- `advisories`: one item for each private report in the triage state.
