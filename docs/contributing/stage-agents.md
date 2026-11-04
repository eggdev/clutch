# Stage agents

A lane run takes one issue through 5 stage agents in order: `triage`, `spec`,
`implement`, `review` and `verify`. Each agent is a file in the factory tree,
`factory/agents/<name>/agent.md`. The [factory tree schema](./architecture/factory-tree.md)
names its keys. This page is the hand-off contract between the stages.

C-Suite's foreman picks the project and the issue, and starts the lane. The
lane runs the stages. A lane is a T3 thread, a terminal session or the
foreman itself.

## The hand-off contract

A stage reads only the issue, the PR and the repository. It writes its output
there, so the next stage needs nothing from the lane's memory.

| Stage       | Reads               | Writes                                                                              | Done when                                                   |
| ----------- | ------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `triage`    | the issue           | `phase`, `depends_on`, `owner`, `status` and a `## Triage` note, in the issue       | the issue is `in_progress`, or `blocked` with a reason      |
| `spec`      | the issue, the code | Steps, Files, Acceptance criteria and Verify, in the issue                          | each criterion has a Verify command                         |
| `implement` | the issue, the PR   | the branch and the PR, with `bun run pr open`                                       | `validate` is green and the PR is open                      |
| `review`    | the PR, the issue   | one review comment with each finding and a verdict                                  | 0 blocking findings, or the findings go back to `implement` |
| `verify`    | the PR, the issue   | the screenshot comment of `clutch verify post`, and a proof note for each criterion | each criterion has proof                                    |

`triage` and `spec` commit their change to the issue file on the lane's
branch. `implement` adds its commits to the same branch and opens the PR, so
the PR holds the work of the first 3 stages.

## Run a lane

1. Make the lane's checkout:
   `mise exec -- bun run clutch worktree new <slug> --issue CL-NNN`. The
   branch is `clutch/cl-NNN-<slug>`. Run each stage in this checkout.
2. Run each stage with the issue, and with the PR once it exists:

   ```sh
   mise exec -- bun run clutch agent run triage --issue CL-NNN
   mise exec -- bun run clutch agent run spec --issue CL-NNN
   mise exec -- bun run clutch agent run implement --issue CL-NNN
   mise exec -- bun run clutch agent run review --issue CL-NNN --pr <number>
   mise exec -- bun run clutch agent run verify --issue CL-NNN --pr <number>
   ```

3. Stop the lane when a stage stops. A stage stops when it needs the owner, or
   when its "Done when" cannot become true. Its marker note says why.

`clutch agent run` runs the agent with its harness and model: `claude -p
--model <id>` or `codex exec -m <id>`. A `qwen` agent does not run yet.
`clutch agent prompt` prints the same prompt, so a T3 lane can paste it into a
thread on a model that the session picks.

The prompt is the agent's body, then the issue file and the PR's title, URL,
branches, head and body. The stage reads the diff and the comments itself.

## Send work back

`review` gives one of 3 verdicts:

- `pass`: 0 blocking findings. The lane runs `verify`.
- `back to implement`: 1 or more blocking findings. The lane runs `implement`
  again with `--pr`, then `review` again.
- `stop`: blocking findings remain after 2 rounds back to `implement`. The lane
  stops and asks the owner.

So `review` sends work back to `implement` at most twice. Each review comment
names its round. `review` counts the earlier `back to implement` verdicts on
the PR before it gives a new one.

## Stage markers

Each stage ends with `clutch agent mark`. The command posts one PR comment
that starts with a marker, so the foreman and `clutch metrics` can see which
stages ran:

```
<!-- clutch-stage:<role>:<head sha> -->
```

```sh
mise exec -- bun run clutch agent mark review --pr <number> --issue CL-NNN \
  --note-file /tmp/review-<number>.md
```

- `--head` names the commit that the stage judged. With `--pr` and no
  `--head`, it is the PR's head. With no `--pr`, it is `HEAD`.
- A second mark with the same stage and head edits that comment. A mark on a
  new head adds a comment, so each round shows.
- `triage` and `spec` run before the PR exists. Their mark takes `--issue` and
  no `--pr`, and saves the marker in the Git common folder, under
  `clutch-stages/CL-NNN.json`. Each worktree of the clone sees that file, and
  no commit picks it up. A second saved mark of the same stage replaces the
  first one. The first mark with both `--pr` and `--issue`, which
  `implement` makes, posts the saved markers first, in the order they ran.

A PR that went through a whole lane run has at least 5 markers:
`gh pr view <number> --comments | grep clutch-stage` lists them.
