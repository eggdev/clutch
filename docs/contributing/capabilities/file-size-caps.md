# File-size / blob-size caps

File-size caps set a maximum length for each source file, so that a reader or an agent can hold each file in context.

## Why

Rank 47 of the researched practices. More than one third of the leading repositories use it (37%). A large file costs an agent context and hides structure. A cap forces a split when a file gets hard to read.

## Detection

`clutch doctor` reports this capability as present when a `package.json` or `project.json` defines the Nx target `check-file-size`, or git tracks `tools/file-size-budgets.json`. See the `file_size_caps` entry in [the registry](./registry.yaml).

## Adopt

1. Add a script that counts the lines of each source file. This repository uses [`tools/check-file-size.ts`](../../../tools/check-file-size.ts).
2. Record each exception, with its reason, in [`tools/file-size-budgets.json`](../../../tools/file-size-budgets.json).
3. Add the root target `check-file-size`, and run it in the canonical check command.
4. Read [file size](../setup/checks.md#file-size) for the limits in this repository.
5. Set `file_size_caps` to `adopted` in `clutch.yaml`.

## Waive

Set `file_size_caps` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a repository of generated code or data files.
