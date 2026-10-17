export type Provider = { id: string; label: string; bin: string };

/** The agent CLIs that can run kickoff. Add a CLI with one entry here and its commands in run-stage.ts. */
const providers: Array<Provider> = [
  { id: 'claude', label: 'Claude Code', bin: 'claude' },
  { id: 'codex', label: 'Codex', bin: 'codex' },
];

/** The providers whose CLI is on `env.PATH`, in table order. */
export function findProviders(env: Record<string, string | undefined>) {
  return providers.filter((provider) => Bun.which(provider.bin, { PATH: env.PATH ?? '' }));
}

export type Choice =
  | { kind: 'chosen'; provider: Provider }
  | { kind: 'ask'; options: Array<Provider> }
  | { kind: 'none'; reason: string };

/** Picks the provider from the `--agent` flag, then the saved choice, then the only one installed. */
export function chooseProvider(options: {
  installed: Array<Provider>;
  saved?: string;
  flag?: string;
}): Choice {
  const { installed, saved, flag } = options;
  if (flag) {
    const provider = installed.find((entry) => entry.id === flag);
    if (provider) {
      return { kind: 'chosen', provider };
    }
    const names = installed.map((entry) => entry.id).join(', ') || 'none';
    return { kind: 'none', reason: `${flag} is not on PATH. Installed: ${names}.` };
  }
  if (!installed.length) {
    const known = providers.map((entry) => `${entry.label} (${entry.bin})`).join(' or ');
    return {
      kind: 'none',
      reason: `No agent CLI is on PATH. Install ${known}, then run this again.`,
    };
  }
  const remembered = installed.find((entry) => entry.id === saved);
  if (remembered) {
    return { kind: 'chosen', provider: remembered };
  }
  if (installed.length === 1) {
    return { kind: 'chosen', provider: installed[0] };
  }
  return { kind: 'ask', options: installed };
}
