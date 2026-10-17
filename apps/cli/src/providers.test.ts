import { expect, test } from 'bun:test';

import { chooseProvider, findProviders } from '@apps/cli/src/providers';
import { fakeBin } from '@apps/cli/src/testing/fake-bin';

test('only the agent CLIs on PATH are offered', async () => {
  await using bin = await fakeBin(['codex']);
  expect(findProviders({ PATH: bin.dir }).map((provider) => provider.id)).toEqual(['codex']);
});

test('a PATH with no agent CLI offers nothing', async () => {
  await using bin = await fakeBin(['git']);
  expect(findProviders({ PATH: bin.dir })).toEqual([]);
});

const claude = { id: 'claude', label: 'Claude Code', bin: 'claude' };
const codex = { id: 'codex', label: 'Codex', bin: 'codex' };

test('the --agent flag wins over the saved choice', () => {
  expect(chooseProvider({ installed: [claude, codex], saved: 'claude', flag: 'codex' })).toEqual({
    kind: 'chosen',
    provider: codex,
  });
});

test('a saved choice is used while its CLI is still installed', () => {
  expect(chooseProvider({ installed: [claude, codex], saved: 'codex' })).toEqual({
    kind: 'chosen',
    provider: codex,
  });
  expect(chooseProvider({ installed: [claude], saved: 'codex' })).toEqual({
    kind: 'chosen',
    provider: claude,
  });
});

test('one installed provider is used without a question, and two need one', () => {
  expect(chooseProvider({ installed: [codex] })).toEqual({ kind: 'chosen', provider: codex });
  expect(chooseProvider({ installed: [claude, codex] })).toEqual({
    kind: 'ask',
    options: [claude, codex],
  });
});

test('a flag that names a provider which is not installed stops, and says what is installed', () => {
  expect(chooseProvider({ installed: [claude], flag: 'codex' })).toEqual({
    kind: 'none',
    reason: 'codex is not on PATH. Installed: claude.',
  });
  expect(chooseProvider({ installed: [] })).toEqual({
    kind: 'none',
    reason:
      'No agent CLI is on PATH. Install Claude Code (claude) or Codex (codex), then run this again.',
  });
});
