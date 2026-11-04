import { expect, test } from 'bun:test';

import { fakeGitHub, head, png, shots } from '@/testing/fake-github';
import { commentBody, parseVerifyMarker, postShots, readShots, verifyMarker } from '@/verify/post';

test('the marker names the head commit, and a reader finds it again', () => {
  expect(verifyMarker(head)).toBe(`<!-- clutch-verify:${head} -->`);
  expect(parseVerifyMarker(`${verifyMarker(head)}\ntext`)).toBe(head);
  expect(parseVerifyMarker('<!-- clutch-verify:abc -->')).toBeUndefined();
  const body = commentBody({
    repo: 'o/r',
    head,
    note: ' Drove the home screen. ',
    images: [{ name: 'mobile', url: 'https://x/mobile.png' }],
  });
  expect(body).toBe(
    [
      verifyMarker(head),
      `**Verify** checked the head commit [aaaaaaa](https://github.com/o/r/commit/${head}).`,
      '',
      'Drove the home screen.',
      '',
      '**mobile**',
      '',
      '![mobile](https://x/mobile.png)',
      '',
      '`clutch verify post` posted this comment. A new run edits it.',
      '',
    ].join('\n'),
  );
});

test('readShots refuses a file that is not a PNG, a bad name, a second name and no file', async () => {
  await using files = await shots({
    'mobile.png': png('m'),
    'notes.png': Buffer.from('text'),
    'a b.png': png('x'),
  });
  const [mobile, notes, spaced] = files.files;
  expect(await readShots([mobile])).toEqual([{ name: 'mobile', bytes: png('m') }]);
  await expect(readShots([notes])).rejects.toThrow('is not a PNG file');
  await expect(readShots([spaced])).rejects.toThrow('use only letters');
  await expect(readShots([mobile, mobile])).rejects.toThrow('two files have the name mobile');
  await expect(readShots([])).rejects.toThrow('Name at least one PNG file.');
});

test('postShots makes the shots branch, commits each shot under the head and posts one comment', async () => {
  await using files = await shots({
    'mobile.png': png('m'),
    'desktop.png': png('d'),
  });
  const github = fakeGitHub();
  const result = await postShots({
    gh: github.gh,
    repo: 'o/r',
    pr: 7,
    files: files.files,
  });

  const tip = github.state.tip ?? '';
  const commit = github.state.commits.get(tip);
  expect(commit?.parents).toEqual([]);
  expect(commit?.message).toBe('chore(verify): add the screenshots of #7 at aaaaaaa');
  const tree = github.state.trees.get(commit?.tree ?? '') ?? {};
  expect(Object.keys(tree)).toEqual([`7/${head}/mobile.png`, `7/${head}/desktop.png`]);
  expect(github.state.blobs.get(tree[`7/${head}/mobile.png`])).toBe(png('m').toString('base64'));

  expect(result).toEqual({
    head,
    commit: tip,
    images: [
      {
        name: 'mobile',
        url: `https://github.com/o/r/blob/${tip}/7/${head}/mobile.png?raw=true`,
      },
      {
        name: 'desktop',
        url: `https://github.com/o/r/blob/${tip}/7/${head}/desktop.png?raw=true`,
      },
    ],
    comment: { url: 'https://c/1', edited: false },
  });
  expect(github.state.comments).toHaveLength(1);
  expect(github.state.comments[0].body).toBe(
    commentBody({ repo: 'o/r', head, images: result.images }),
  );
});

test('a second run adds to the branch, and edits the one comment with the new head', async () => {
  await using files = await shots({ 'mobile.png': png('m') });
  const github = fakeGitHub();
  const first = await postShots({
    gh: github.gh,
    repo: 'o/r',
    pr: 7,
    files: files.files,
  });
  const newHead = 'b'.repeat(40);
  github.state.head = newHead;
  github.state.comments.unshift({
    id: 99,
    html_url: 'https://c/99',
    body: 'Looks good.',
  });

  const second = await postShots({
    gh: github.gh,
    repo: 'o/r',
    pr: 7,
    files: files.files,
    head: newHead,
    note: 'Again.',
  });
  expect(github.state.commits.get(second.commit)?.parents).toEqual([first.commit]);
  const tree = github.state.trees.get(github.state.commits.get(second.commit)?.tree ?? '') ?? {};
  expect(Object.keys(tree).toSorted()).toEqual([`7/${head}/mobile.png`, `7/${newHead}/mobile.png`]);
  expect(second.comment).toEqual({ url: 'https://c/1', edited: true });
  expect(github.state.comments.map((comment) => parseVerifyMarker(comment.body))).toEqual([
    undefined,
    newHead,
  ]);
  expect(github.state.comments[1].body).toContain('Again.');
});

test('when another run moves the branch first, it commits again on the new tip', async () => {
  await using files = await shots({ 'mobile.png': png('m') });
  const github = fakeGitHub();
  await postShots({ gh: github.gh, repo: 'o/r', pr: 7, files: files.files });
  github.state.refuse = 1;
  const result = await postShots({
    gh: github.gh,
    repo: 'o/r',
    pr: 7,
    files: files.files,
  });
  expect(github.state.tip).toBe(result.commit);
  const refUpdates = github.calls.filter((call) => call.route.endsWith('refs/heads/verify-shots'));
  expect(refUpdates.map((call) => call.method)).toEqual(['PATCH', 'PATCH']);

  github.state.refuse = 3;
  await expect(
    postShots({ gh: github.gh, repo: 'o/r', pr: 7, files: files.files }),
  ).rejects.toThrow('Update is not a fast forward (HTTP 422)');
});

test('a head that the PR moved past posts nothing', async () => {
  await using files = await shots({ 'mobile.png': png('m') });
  const github = fakeGitHub();
  expect(
    postShots({
      gh: github.gh,
      repo: 'o/r',
      pr: 7,
      files: files.files,
      head: 'b'.repeat(40),
    }),
  ).rejects.toThrow('The head of #7 is aaaaaaa, not bbbbbbb.');
  expect(github.calls.map((call) => call.route)).toEqual(['repos/o/r/pulls/7']);
});
