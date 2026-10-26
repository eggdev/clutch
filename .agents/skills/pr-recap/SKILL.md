---
name: pr-recap
description: Write or update the system recap block in a PR description - a GitHub-rendered summary of the primitives that a change touches, its risk and a mermaid diagram of the change. Use only when someone asks for a visual recap, a visual plan, a system recap or a PR recap. Do not run it on your own for each PR.
---

# PR recap

Run this skill only when someone asks for a recap or a plan. No check or hook
calls it, and a PR does not need a recap block.

Inputs are the requested scope, base/head and current diff; output is a factual
recap block. Writing a recap is not a correctness review. Produce it locally or
in chat unless updating the PR description is already authorized.

The recap block is one marker-delimited block in the PR description. GitHub
renders it. It helps a reviewer find the risk fast. The reviewer still reads
the diff.

## Modes

- **Plan mode** comes before the code exists. Write the block from the plan,
  with `**Mode:** plan`. When the plan changes no primitive, say so. That is
  the lowest risk.
- **Recap mode** comes after the code exists. Read the change from
  `git diff <base>...HEAD` and `git diff --stat <base>...HEAD`. Never write the
  recap from memory or from the chat. Each claim in the block must match the
  diff. The chat can explain intent only.

## Risk

The registry,
[`primitives.yaml`](../../../docs/contributing/architecture/primitives.yaml),
lists the primitives. Give the change one of three levels. Use the highest
level that applies.

| Level      | Risk   | Meaning                                                   | Also                                                      |
| ---------- | ------ | --------------------------------------------------------- | --------------------------------------------------------- |
| `composes` | low    | Wires existing primitives together. Their behavior stays. | Nothing more                                              |
| `extends`  | medium | Changes the behavior or the interface of a primitive.     | Name affected verification flows and their evidence |
| `adds`     | high   | Adds, removes or reshapes a primitive.                    | Update the registry and verify the affected public surface |

The classifier finds the primitives. You choose `composes` or `extends` from
the diff. A change is `adds` when the registry needs a new or changed entry: a
new `id`, a changed meaning, or code roots that must move. Do not edit a
`summary` for normal feature work. After a registry change, run
`mise exec -- bun tools/check-primitives.ts`.

For `extends` and `adds`, read the evidence from the project's verify skill.
Use UI interaction for UI claims and real library/CLI/service boundaries for
nonvisual claims. Name the flows, source revision and missing proof. Do not
launch a preview or sign-in flow for a library solely to produce a recap.

At each level, name each registry invariant that the change touches. The
classifier prints the invariants from the registry. Read each one against the
diff.

## Commands

1. Classify the changed paths:

   ```sh
   mise exec -- bun run recap:classify --base origin/main
   ```

   It prints the primitive that owns each changed path, the paths that no
   primitive owns, the affected Nx projects and the registry invariants. Add
   `--json` for machine-readable output. A path that no primitive owns is often
   a doc or a root config file. When it is code, the registry needs an entry.

2. Write the block to a file. Use the shape in
   [block format](./references/block-format.md).

3. Put the block in the PR description:

   ```sh
   mise exec -- bun run recap:upsert <pr-number> <block-file>
   ```

   The script replaces the text between the markers, or appends the block. It
   does not change text outside the markers. Run both commands again after a
   large push.

## Failures

- The script rejects a block file that does not start with
  `<!-- system-recap:start -->` and end with `<!-- system-recap:end -->`. Fix
  the file.
- The script rejects a PR body with a broken marker pair. Fix the markers in
  the PR description by hand, then run it again.
- When `gh pr edit` fails, the script prints the merged body. Paste that body
  into the PR description.
- GitHub shows a mermaid error in place of the diagram. Fix the diagram. Do not
  put `;` in a sequence message or note.
- A green health check is not a walk through a flow. It does not count as the
  preview check for `extends` or `adds`.
