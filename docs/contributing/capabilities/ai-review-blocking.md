# AI review findings gate merge (severity / triage)

AI review gating lets a blocking finding from the review agent stop the merge.

## Why

Rank 62 of the researched practices. About one in seven of the leading repositories use it (15%). It lets a team trust a green pull request without a full human read. A finding level separates a blocking finding from a note.

## Detection

`clutch doctor` reports this capability as present when one rule passes: a workflow file with `review` in its name reads the `.blocking` result of the review. See the `ai_review_blocking` entry in [the registry](./registry.yaml).

## Adopt

1. Define the finding levels in the review rules. See [finding levels](../review.md#finding-levels).
2. Make the review job report each finding. No finding fails it. See [`.github/workflows/agent-review.yml`](../../../.github/workflows/agent-review.yml).
3. Confirm that the review passed on several recent pull requests.
4. Keep `agent-review` out of the required status checks, so a model outage holds no merge.
5. Run `mise exec -- bun run clutch doctor --remote` to confirm the result.
6. Set `ai_review_blocking` to `adopted` in `clutch.yaml`.

## Waive

Set `ai_review_blocking` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when a person approves each merge and reads the agent review as advice.
