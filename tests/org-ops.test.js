// src/org-ops.js: the organize_library edits the service worker applies to rs:org.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/org-ops.js');

const base = () => ({ folders: [{ id: 'fexcel', name: 'Excel' }], accounts: { 'yt/a': { folder: 'fexcel', tags: [] }, ig1: { folder: null, tags: ['old'] } },
  niches: { folders: ['fexcel'], tags: [] }, tracked: { 'yt/mine': { on: true, mine: true } }, swipe: { v: 1, items: {} } });

test('org ops: folders by name (created once), moves, tags in the Library\'s form, niches, tracking; nothing else touched', () => {
  const org = base();
  const r = O.apply(org, [
    { op: 'folder', name: 'Excel · Instagram' },
    { op: 'move', account: 'ig1', folder: 'excel · instagram' },
    { op: 'move', account: 'yt/b', folder: 'Excel' },
    { op: 'move', account: 'tt/x', folder: 'Excel · TikTok' },
    { op: 'move', account: 'tt/y', folder: 'Excel · TikTok' },
    { op: 'tag', account: 'yt/a', add: ['10K-Altı', '#Shorts Ağırlıklı', ''], remove: ['nope'] },
    { op: 'tag', account: 'ig1', remove: ['old'] },
    { op: 'niche', folder: 'Excel' },
    { op: 'track', account: 'yt/getexcelready', channelId: 'UCP9f7Wyu3sjDUTDGjbo9-rQ', name: 'ExcelReady', niche: 'Excel' },
    { op: 'track', account: 'ig1' },
    { op: 'explode' }
  ], 1795370000000);
  const o = r.org;
  assert.deepEqual(o.folders.map((f) => f.name), ['Excel', 'Excel · Instagram', 'Excel · TikTok'], 'matched case-insensitively, created once');
  assert.equal(new Set(o.folders.map((f) => f.id)).size, 3);
  assert.equal(o.accounts.ig1.folder, o.folders[1].id);
  assert.equal(o.accounts['tt/y'].folder, o.folders[2].id);
  assert.equal(o.accounts['yt/b'].folder, 'fexcel');
  assert.deepEqual(o.accounts['yt/a'].tags, ['10k-altı', 'shorts-ağırlıklı']);
  assert.deepEqual(o.accounts.ig1.tags, []);
  assert.deepEqual(o.niches.folders, ['fexcel'], 'already a niche: unchanged');
  assert.deepEqual(o.tracked['yt/getexcelready'], { on: true, at: 1795370000000, channelId: 'UCP9f7Wyu3sjDUTDGjbo9-rQ', name: 'ExcelReady', niche: 'Excel' });
  assert.deepEqual(o.tracked['yt/mine'], { on: true, mine: true }, 'other tracking entries stay');
  assert.deepEqual(o.swipe, { v: 1, items: {} }, 'the swipe file stays');
  assert.deepEqual(r.errors, ['#10 track: track needs a yt/ account', '#11 explode: unknown op']);
  assert.ok(r.changes.includes('yt/getexcelready tracked'));
  assert.deepEqual(org, base(), 'the input is not mutated');
  // Running the same ops again changes nothing.
  const again = O.apply(o, [{ op: 'move', account: 'ig1', folder: 'Excel · Instagram' }, { op: 'tag', account: 'yt/a', add: ['10k-altı'] }], 1795370000001);
  assert.deepEqual(again.changes, []);
});

test('org ops: an empty record, null folder, a niche switched off', () => {
  const r = O.apply(undefined, [{ op: 'move', account: 'x', folder: 'New' }, { op: 'move', account: 'x', folder: null }, { op: 'niche', folder: 'New' }, { op: 'niche', folder: 'New', on: false }]);
  assert.equal(r.org.accounts.x.folder, null);
  assert.deepEqual(r.org.niches.folders, []);
  assert.equal(r.errors.length, 0);
});
