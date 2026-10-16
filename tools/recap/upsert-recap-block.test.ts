import { expect, test } from 'bun:test';

import { endMarker, mergeRecapBlock, startMarker } from '@tools/recap/upsert-recap-block';

const block = (text: string) => `${startMarker}\n${text}\n${endMarker}`;

test('the block replaces only the text between the markers', () => {
  const body = `## Intent\n\nShip it.\n\n${block('old recap')}\n\n## Verification\n\nGreen.\n`;
  expect(mergeRecapBlock(body, `${block('new recap')}\n`)).toBe(
    `## Intent\n\nShip it.\n\n${block('new recap')}\n\n## Verification\n\nGreen.\n`,
  );
});

test('a body with no markers gets the block at the end', () => {
  expect(mergeRecapBlock('## Intent\n\nShip it.\n\n', block('recap'))).toBe(
    `## Intent\n\nShip it.\n\n${block('recap')}\n`,
  );
  expect(mergeRecapBlock('', block('recap'))).toBe(`${block('recap')}\n`);
});

test('a block without both markers is rejected', () => {
  expect(() => mergeRecapBlock('body', 'recap')).toThrow('must start with');
  expect(() => mergeRecapBlock('body', `${startMarker}\nrecap`)).toThrow('must start with');
  expect(() => mergeRecapBlock('body', block(block('nested')))).toThrow('no other marker');
});

test('a body with broken markers is left alone and the error names the fix', () => {
  for (const body of [
    `${startMarker}\nhalf`,
    `${endMarker}\n${startMarker}`,
    `${block('one')}\n${block('two')}`,
  ]) {
    expect(() => mergeRecapBlock(body, block('recap'))).toThrow('Fix the markers');
  }
});
