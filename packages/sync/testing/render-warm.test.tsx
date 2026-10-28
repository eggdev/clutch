import { expect, test } from 'bun:test';

import { defineModel } from '@repo/sync/models/define';
import { renderWarm } from '@repo/sync/testing/render-warm';
import { useRecords } from '@repo/sync/ui/sync-provider';

const card = defineModel<{ readonly id: string; readonly title: string }>('Card');
const state = { lastSyncId: 1, tables: { Card: [{ id: 'a', title: 'Warm' }] }, pending: [] };

function Cards() {
  const cards = useRecords(card);
  return (
    <ul>
      {cards.map((item) => (
        <li key={item.id}>{item.title}</li>
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
