# Friction logs / agent learnings file

A friction log is a file where agents record what slowed them down, so that a later pass can turn each entry into a fix.

## Why

Rank 9 of the researched practices. About one in four of the leading repositories use it (26%). It ranks high because it feeds every other improvement. Each entry shows where a doc, a check or a tool cost an agent time.

## Detection

`clutch doctor` reports this capability as present when git tracks `.clutch/friction.jsonl` or a file named `learnings.md` in any folder. See the `friction_log` entry in [the registry](./registry.yaml).

## Adopt

1. Pick one file for the entries. Use `.clutch/friction.jsonl` with one JSON object on each line, or a `learnings.md` file.
2. Give each entry a time, a kind, a short text and the branch or the issue. Useful kinds are tooling, docs, check and flake.
3. Add one rule to `AGENTS.md`: record any friction that costs more than five minutes.
4. Read the log in a weekly [gardening](../harness-engineering.md#weekly-gardening) pass. Turn the top entries into a doc, a check or a tool fix. Then remove the handled entries.
5. Set `friction_log` to `adopted` in `clutch.yaml`.

## Waive

Set `friction_log` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when no agent works in the repository, or when another tracker collects the same signal.
