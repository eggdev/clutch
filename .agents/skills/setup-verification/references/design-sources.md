# Verification design sources

Reviewed Cursor/PStack at revision 9e88dad267e8991d26a6debc0db0d943d437104b.
These are conceptual influences, not installed dependencies or copied workflows.

- [Create verification](https://github.com/cursor/plugins/blob/9e88dad267e8991d26a6debc0db0d943d437104b/pstack/skills/create-verification-skill/SKILL.md):
  discover real surfaces, reuse controls, and execute generated instructions cold.
  Here the output is always one committed verify skill rather than verify-app.
- [Maintain verification](https://github.com/cursor/plugins/blob/9e88dad267e8991d26a6debc0db0d943d437104b/pstack/skills/maintain-verification-skill/SKILL.md):
  distinguish source drift from broken product behavior; require live proof for
  claimed coverage and preserve evidence through failed iterations. We do not
  import mandatory subagents or PR publication.
- [Formal creation](https://github.com/cursor/plugins/blob/9e88dad267e8991d26a6debc0db0d943d437104b/pstack/skills/create-formal-verification-skill/SKILL.md)
  and [formal maintenance](https://github.com/cursor/plugins/blob/9e88dad267e8991d26a6debc0db0d943d437104b/pstack/skills/maintain-formal-verification-skill/SKILL.md):
  tie properties to code, state assumptions/bounds and prove checks can fail.
  No proof assistant or model checker is installed by this cleanup.
- [Idempotent operations](https://github.com/cursor/plugins/blob/9e88dad267e8991d26a6debc0db0d943d437104b/pstack/skills/principle-make-operations-idempotent/SKILL.md):
  reconcile durable observed state after interrupted operations, not an imagined
  previous outcome. This does not authorize replaying uncertain UI actions.
- [Prove it works](https://github.com/cursor/plugins/blob/9e88dad267e8991d26a6debc0db0d943d437104b/pstack/skills/principle-prove-it-works/SKILL.md):
  observe the actual result; a process, build or receipt alone proves less than
  the requested workflow. We retain executable positive and negative controls.
