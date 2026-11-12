import { expect, test } from 'bun:test';

import { command, localChange } from '@repo/sync/contract/command';
import { poolState, testCommand, testModel } from '@repo/sync/testing/pool-state';
import { renderLive } from '@repo/sync/testing/render-live';
import {
  usePending,
  usePendingCommand,
  useRecord,
  useRecordIds,
} from '@repo/sync/ui/sync-provider';
import { memo } from 'react';

const card = testModel('Card', { id: 'string', title: 'string', rank: 'string' });
const tag = testModel('Tag', { id: 'string', label: 'string' });
const putCard = testCommand(
  'cards/put',
  { id: 'string', title: 'string', rank: 'string' },
  'local',
);
const putCardLocal = localChange(putCard, (draft, input) => draft.put(card, input));
const putTag = testCommand('tags/put', { id: 'string', label: 'string' }, 'local');
const putTagLocal = localChange(putTag, (draft, input) => draft.put(tag, input));
const askServer = command('cards/ask-server', {
  input: { label: 'string' },
  waits: 'server',
  access: 'organization',
  refuses: ['label-taken'],
  tool: 'none',
});
const declared = { records: [card, tag], commands: [putCard, putTag, askServer] };

const state = poolState({
  lastSyncId: 1,
  tables: {
    Card: [
      { id: 'a', title: 'First', rank: '1' },
      { id: 'b', title: 'Second', rank: '2' },
    ],
  },
});

/** A list and its rows, built the way a screen builds them, with a render count for each. */
function counted() {
  const renders = new Map<string, number>();
  const count = (name: string) => renders.set(name, (renders.get(name) ?? 0) + 1);
  function RowView({ id }: { readonly id: string }) {
    count(`row:${id}`);
    return <li>{useRecord(card, id)?.title}</li>;
  }
  const Row = memo(RowView);
  function List() {
    count('list');
    const ids = useRecordIds(card, { by: 'rank', direction: 'asc' });
    return (
      <ul>
        {ids.map((id) => (
          <Row key={id} id={id} />
        ))}
      </ul>
    );
  }
  return { renders, List };
}

test('a rename re-renders only the row that shows the record', async () => {
  const { renders, List } = counted();
  const live = await renderLive(() => <List />, state, [putCardLocal, putTagLocal], declared);
  renders.clear();
  await live.change(() => live.pool.run(putCard, { id: 'a', title: 'Renamed', rank: '1' }));
  expect(Object.fromEntries(renders)).toEqual({ 'row:a': 1 });
  expect(live.container.textContent).toBe('RenamedSecond');
  await live.unmount();
});

test('a change to another model re-renders nothing', async () => {
  const { renders, List } = counted();
  const live = await renderLive(() => <List />, state, [putCardLocal, putTagLocal], declared);
  renders.clear();
  await live.change(() => live.pool.run(putTag, { id: 't', label: 'Urgent' }));
  expect(renders.size).toBe(0);
  await live.unmount();
});

test('a new record re-renders the list once and adds one row', async () => {
  const { renders, List } = counted();
  const live = await renderLive(() => <List />, state, [putCardLocal, putTagLocal], declared);
  renders.clear();
  await live.change(() => live.pool.run(putCard, { id: 'c', title: 'Third', rank: '3' }));
  expect(Object.fromEntries(renders)).toEqual({ list: 1, 'row:c': 1 });
  expect(live.container.textContent).toBe('FirstSecondThird');
  await live.unmount();
});

test('a change that moves a record re-renders the list, and the moved row only', async () => {
  const { renders, List } = counted();
  const live = await renderLive(() => <List />, state, [putCardLocal, putTagLocal], declared);
  renders.clear();
  await live.change(() => live.pool.run(putCard, { id: 'a', title: 'First', rank: '9' }));
  expect(Object.fromEntries(renders)).toEqual({ list: 1, 'row:a': 1 });
  expect(live.container.textContent).toBe('SecondFirst');
  await live.unmount();
});

/** Two controls that each send a command that waits, with a render count for each. */
function pendingControls() {
  const renders = new Map<string, number>();
  function ControlView({ name }: { readonly name: string }) {
    renders.set(name, (renders.get(name) ?? 0) + 1);
    const ask = usePendingCommand(askServer);
    // A branch on a code that `askServer` does not declare would not compile.
    const taken = ask.refused?.code === 'label-taken' ? ':taken' : '';
    return (
      <button type="button" id={name} onClick={() => ask.run({ label: name })}>
        {ask.pending ? `${name}:waiting` : `${name}:idle${taken}`}
      </button>
    );
  }
  const Control = memo(ControlView);
  return { renders, Control };
}

test('a pending command re-renders only its own control, and again when its delta arrives', async () => {
  const { renders, Control } = pendingControls();
  const live = await renderLive(
    () => (
      <>
        <Control name="a" />
        <Control name="b" />
      </>
    ),
    state,
    [],
    declared,
  );
  renders.clear();
  await live.change(() => document.querySelector<HTMLButtonElement>('#a')?.click());
  expect(live.container.textContent).toBe('a:waitingb:idle');
  expect(renders.get('b')).toBeUndefined();
  const [sent] = live.pool.unsent();
  renders.clear();
  await live.change(() =>
    live.pool.applyDeltas([{ syncId: 2, transactionId: sent?.id ?? null, changes: [] }]),
  );
  expect(live.container.textContent).toBe('a:idleb:idle');
  expect(Object.fromEntries(renders)).toEqual({ a: 1 });
  await live.unmount();
});

function NoTransaction() {
  return <p>{usePending() ? 'waiting' : 'idle'}</p>;
}

test('no transaction reads as not waiting', async () => {
  const live = await renderLive(() => <NoTransaction />, state, [], declared);
  expect(live.container.textContent).toBe('idle');
  await live.unmount();
});

test('a refusal shows on the control that sent the command, with its declared code', async () => {
  const { renders, Control } = pendingControls();
  const live = await renderLive(
    () => (
      <>
        <Control name="a" />
        <Control name="b" />
      </>
    ),
    state,
    [],
    declared,
  );
  await live.change(() => document.querySelector<HTMLButtonElement>('#a')?.click());
  const [sent] = live.pool.unsent();
  renders.clear();
  await live.change(() =>
    live.pool.settle([
      {
        transactionId: sent?.id ?? '',
        status: 'rejected',
        syncId: null,
        reason: 'This label is taken.',
        code: 'label-taken',
      },
    ]),
  );
  expect(live.container.textContent).toBe('a:idle:takenb:idle');
  expect(renders.get('b')).toBeUndefined();
  await live.unmount();
});
