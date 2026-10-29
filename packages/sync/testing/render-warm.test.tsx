import { expect, test } from 'bun:test';

import { poolState, testModel } from '@repo/sync/testing/pool-state';
import { renderWarm } from '@repo/sync/testing/render-warm';
import { useRecord, useRecordIds } from '@repo/sync/ui/sync-provider';

const card = testModel<{ readonly id: string; readonly title: string }>('Card', {
  id: 'string',
  title: 'string',
});
const state = poolState({ lastSyncId: 1, tables: { Card: [{ id: 'a', title: 'Warm' }] } });

function CardItem({ id }: { readonly id: string }) {
  return <li>{useRecord(card, id)?.title}</li>;
}

function Cards() {
  const ids = useRecordIds(card);
  return (
    <ul>
      {ids.map((id) => (
        <CardItem key={id} id={id} />
      ))}
    </ul>
  );
}

function Fetching() {
  void fetch('/api/cards');
  return <p>Loading</p>;
}

test('a screen that reads the pool paints with no request', () => {
  expect(renderWarm(() => <Cards />, state)).toContain('Warm');
});

test('a screen that starts a request fails the warm render', () => {
  expect(() => renderWarm(() => <Fetching />, state)).toThrow('fetch ran during a warm render.');
});
