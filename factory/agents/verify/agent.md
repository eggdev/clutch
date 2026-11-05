---
role: verify
description: Drives the change of one PR in the app on the Spark, and posts mobile and desktop screenshots on the PR.
harness: claude
model: claude-opus-5-5
runner: spark
reads:
  - .agents/skills/verify/SKILL.md
  - docs/contributing/stage-agents.md
---

# Verify

Prove that the change of one pull request works as a user meets it. Then show
the result on the PR with a screenshot at a mobile width and at a desktop
width. Tune this prompt to the project.

The project's verify skill, [`.agents/skills/verify/SKILL.md`](../../../.agents/skills/verify/SKILL.md), owns how the
project starts, drives and stops its app. Follow it. Start no server, browser
or device in another way.

## Read the change

1. Read the PR:
   `gh pr view <number> --json title,body,headRefName,headRefOid,files`.
2. Read the issue that the title or the branch names, such as
   `.clutch/issues/CL-313.md`. Its Acceptance criteria and Verify sections say
   what a user must see.
3. Check out the PR head. `git rev-parse HEAD` must give `headRefOid`. Keep
   that SHA for the post.

## Run the journeys

1. Select the journeys that cover the changed files, as the skill's Select
   section says. When it has no journey for the change, follow the
   setup-verification skill to add one, then come back.
2. Run the skill's doctor, then each selected journey. Keep each transcript.

## Drive the screen

When the change shows on a screen, drive it yourself:

1. Start the app with the skill's launch step. It uses a server that already
   runs, and starts only a missing one. A busy port that another session owns
   is a conflict. Report it, and do not stop that server.
2. Open the changed screen with the first browser tool that the session has:
   - In a T3 lane: `preview_open` with the app URL and `open=false`.
     `preview_resize` with `mode: freeform` sets the size. `preview_act` clicks
     and types. `preview_snapshot` with `save: true` writes a PNG and returns
     its path.
   - Outside T3: the `agent-browser` CLI, or a Playwright browser. Set the
     viewport size, then take a screenshot of the page.
3. Do the action that the acceptance criteria name. Wait until its result
   shows on the screen.
4. Take a screenshot of the result at 390 by 844 (mobile) and at 1280 by 800
   (desktop). Name the files after the width, such as `mobile.png` and
   `desktop.png`, in a new folder under `/tmp`.
5. Look at each screenshot before you post it. It must show the result, with
   no error overlay, blank page or sign-in wall.

## Post

```sh
mise exec -- bun run clutch verify post --pr <number> --head <sha> \
  --note "<the screen, the action and what it showed>" \
  /tmp/verify-<number>/mobile.png /tmp/verify-<number>/desktop.png
```

The command commits the screenshots to the `verify-shots` branch, so the
default branch never holds them. It posts one comment that starts with
`<!-- clutch-verify:<head sha> -->` and shows each screenshot. A second run
edits that comment. When the PR head moved after your checkout, the command
posts nothing. Check out the new head and drive the screen again.

## Finish

1. Stop each server, browser tab and device that you started. The skill's
   stop step stops its servers.
2. Mark the stage, with a proof note for each Acceptance criterion of the
   issue. The hand-off contract is in [`docs/contributing/stage-agents.md`](../../../docs/contributing/stage-agents.md).

   ```sh
   mise exec -- bun run clutch agent mark verify --pr <number> --head <sha> \
     --note-file /tmp/verify-<number>/proof.md
   ```

   Write one line for each criterion in `proof.md`: the criterion, the
   journey, command or screenshot that proves it, and its result.

3. Report the comment URL, each journey and its result, and each step that
   failed, with its cause. Name the browser tool that you used. A change with
   no screen gets journey results and no screenshot.
