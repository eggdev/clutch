import { expect, test } from 'bun:test';

import { defineCommand } from '@repo/sync/commands/define';
import { defineModel } from '@repo/sync/models/define';
import { renderLive } from '@repo/sync/testing/render-live';
import { useRecord, useRecordIds } from '@repo/sync/ui/sync-provider';
import { memo } from 'react';

type Card = { readonly id: string; readonly title: string; readonly rank: string };
type Tag = { readonly id: string; readonly label: string };
const card = defineModel<Card>('Card');
const tag = defineModel<Tag>('Tag');
const putCard = defineCommand<Card>({
  name: 'cards/put',
  waits: 'local',
  apply: (draft, input) => draft.put(card, input),
});
const putTag = defineCommand<Tag>({
  name: 'tags/put',
  waits: 'local',
  apply: (draft, input) => draft.put(tag, input),
});

const state = {
  lastSyncId: 1,
  tables: {
    Card: [
      { id: 'a', title: 'First', rank: '1' },
      { id: 'b', title: 'Second', rank: '2' },
    ],
  },
  pending: [],
};

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
  const live = await renderLive(() => <List />, state, [putCard, putTag]);
  renders.clear();
  await live.change(() => live.pool.run(putCard, { id: 'a', title: 'Renamed', rank: '1' }));
  expect(Object.fromEntries(renders)).toEqual({ 'row:a': 1 });
  expect(live.container.textContent).toBe('RenamedSecond');
  await live.unmount();
});

test('a change to another model re-renders nothing', async () => {
  const { renders, List } = counted();
  const live = await renderLive(() => <List />, state, [putCard, putTag]);
  renders.clear();
  await live.change(() => live.pool.run(putTag, { id: 't', label: 'Urgent' }));
  expect(renders.size).toBe(0);
  await live.unmount();
});

test('a new record re-renders the list once and adds one row', async () => {
  const { renders, List } = counted();
  const live = await renderLive(() => <List />, state, [putCard, putTag]);
  renders.clear();
  await live.change(() => live.pool.run(putCard, { id: 'c', title: 'Third', rank: '3' }));
  expect(Object.fromEntries(renders)).toEqual({ list: 1, 'row:c': 1 });
  expect(live.container.textContent).toBe('FirstSecondThird');
  await live.unmount();
});

test('a change that moves a record re-renders the list, and the moved row only', async () => {
  const { renders, List } = counted();
  const live = await renderLive(() => <List />, state, [putCard, putTag]);
  renders.clear();
  await live.change(() => live.pool.run(putCard, { id: 'a', title: 'First', rank: '9' }));
  expect(Object.fromEntries(renders)).toEqual({ list: 1, 'row:a': 1 });
  expect(live.container.textContent).toBe('SecondFirst');
  await live.unmount();
});
