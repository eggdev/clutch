# Local CI

Local CI is one service for one machine. It runs the CI jobs of each watched
repository in containers, and posts one commit status for each job. It does not
use GitHub Actions, and a watched repository needs no change.

## How it works

Every `poll_seconds`, the service lists the open pull requests of each watched
repository. It runs a pull request only when the head branch is in the watched
repository and the author is in `authors`. A fork never runs. For each new head
commit, it runs each job in `checks`. The job definition is the one in
`.github/workflows/` at that commit, and [act](https://github.com/nektos/act) runs it.
The status `context` is the job name. A newer commit cancels the jobs of the older one.
The service calls GitHub with its user's `gh` login. A job gets that token, or the one in `job_token_file`.

Each job runs in a new container of [`image/Dockerfile`](./image/Dockerfile).
The container mounts nothing from the host and holds its own Docker daemon. Its
cores and memory bind everything the job starts. The job reads a new clone of
the exact commit. It gets only the secrets that its definition names. A secret
that the service cannot read gives an `error` status that names it. The
container, its volume and the clone go away when the job ends.

## Install or update

```sh
docker build -t local-ci-job:1 apps/local-ci/image
bun build --compile apps/local-ci/src/main.ts --outfile ~/.local/share/local-ci/local-ci
cp apps/local-ci/local-ci.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable local-ci && systemctl --user restart local-ci
```

## Configure

`~/.config/local-ci/config.yaml` names the repositories and the limits:

```yaml
max_jobs: 3
defaults: { cpus: 4, memory: 12g, timeout_minutes: 60 }
action_overrides: { actions/upload-artifact: ea165f8d65b6e75b540449e92b4886f43607fa02 }
repos:
  eggdev/clutch:
    checks: [validate, journeys, secrets, commits, sast]
    authors: [eggdev, 'eggdev-clutch-bot[bot]']
    limits: { journeys: { cpus: 6 } }
    op_environment: clutch-ci
    vars: { NEON_PROJECT_ID: example }
```

Each of the `max_jobs` slots owns an equal share of the machine's cores, and a job gets `cpus` of them.
`timeout_minutes` is the most that a job can ask for. `action_overrides` names the commit to
run for an action that act cannot run as pinned.

`op_environment` names the 1Password Environment that holds the secrets of a repository. The `op`
CLI reads it with the repository's service account token, in
`~/.config/local-ci/secrets/<owner>__<repo>.op-token`, with mode 600. The `.env` file next to it
holds `NAME=value` lines for what the Environment lacks. `NAME=` means that the secret is empty on purpose.

## Operate

- Service state and log: `systemctl --user status local-ci` and `journalctl --user -u local-ci`.
- Job logs and artifacts, kept for `log_days` days: `~/.local/state/local-ci/logs/<owner>__<repo>/<commit>/`.
- Run a check again: `~/.local/share/local-ci/local-ci rerun <owner>/<repo>#<number> [job]`.
