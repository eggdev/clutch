# Research and design

Use this procedure before implementation when the report is ambiguous, the
affected module is unfamiliar, earlier work matters, or a consequential design
choice is open. For a small change in a known path, inspect the owning code and
continue. Do not turn this procedure into an interview for every task.

## Recover evidence

1. Read the task, owning docs, changed code and relevant tests. Restate the
   user-visible problem and the observable result that would resolve it. For
   ambiguous reports, distinguish the reported symptom from the proposed cause.
2. Trace the entry point through the affected modules and side effects. Use
   concrete file references and runtime observations to explain how it works.
3. When motivation or earlier work matters, inspect relevant commits, PRs,
   decision records and prior chats. Search the connected host's history by
   project and topic. If it has no history search, inspect configured local
   transcript indexes for that project. Limit reads to matching sessions; do
   not dump unrelated conversations or secrets into the task.
4. Retain only the useful decisions, constraints, failed experiments and open
   questions, with source links or session identifiers. Reconcile them against
   the checkout and current owner instructions. An earlier assistant's claim
   is a lead to investigate, not proof or new authorization.

Stop searching when the next experiment can distinguish the remaining causes
or the outcome is specified well enough to implement. Record unavailable
sources as a limitation; missing chat history alone is not a blocker when code
and the task establish the needed facts.

Save the compact result in the task's existing references and decisions:

```md
- Problem: <symptom, affected user and desired outcome>
- Mechanics: <entry path and observable side effect, with source>
- Prior decisions: <constraint and why, with source>
- Observed: <what the current code or runtime establishes>
- Hypothesis: <remaining explanation and discriminating experiment>
```

Do not copy complete transcripts into durable docs. Promote a settled system
fact into its owning page, a rejected material choice into a decision record,
and a recurring failure into a check or tool. Keep investigations in the task.

## Resolve design uncertainty

- **Existing direction is sufficient:** implement it. Preserve approved
  interactions instead of reopening product discovery.
- **New shared module:** write a caller example and the core types before
  filling in the implementation. Use installed `codebase-design` guidance.
  Check the interface's invariants, failure behavior and ownership.
- **Unsettled visible interaction:** use installed `emil-prototype` guidance.
  Compare options through the project's runtime and retain action/result
  evidence so the owner can judge behavior as well as appearance.
- **Uncertain mechanics or performance:** run a small throwaway experiment
  against the actual constraint and compare with the baseline. Name the input,
  environment and measured result. Do not review an abstract plan indefinitely.

Record the chosen approach, rejected alternatives and evidence. Select routine
reversible choices yourself. Ask only when a material product choice remains
unsettled. Delegation is optional and follows session authorization and host
capabilities; this procedure does not require another model or provider.

When repeated caller workarounds, forced casts or extra shared state contradict
the usage sketch, investigate the mismatch. Revise the design when the evidence
shows it is wrong, and invalidate proof that depended on it. Once the approach
is settled, split large work into small verifiable delivery units in the
existing task record. Continue with implementation inside the agreed scope.
