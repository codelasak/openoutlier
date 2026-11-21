// Phase 4 swipe file (src/swipe.js): items in rs:org.swipe next to the Library's folders and tags,
// clips, updates instead of twins, merging (backup restore), filters and exports.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SW = require('../src/swipe.js');

const T0 = Date.UTC(2026, 10, 21, 12);
const ORG = { folders: [{ id: 'f1', name: 'Hooks' }, { id: 'f2', name: 'Excel' }], accounts: { 'yt/exceldemo': { folder: 'f2', tags: ['competitor'] } }, niches: { folders: ['f2'], tags: [] } };
const VID = { video: 'yTdemo00029', type: 'video', title: 'XLOOKUP vs VLOOKUP in 60 seconds', channel: 'Excel Demo', account: 'yt/exceldemo', channelId: 'UCdemoExcelChannel000000',
  thumb: 'https://i.ytimg.com/vi/yTdemo00029/mqdefault.jpg', views: 801352, duration: 64, publishedAt: Date.UTC(2025, 4, 8) };

test('save: a clean item in rs:org.swipe, the rest of the org untouched', () => {
  const r = SW.save(ORG, Object.assign({}, VID, { folder: 'f1', note: 'Hook in 3 s', tags: ['#Hook', 'B Roll', 'hook', ''], clip: { start: 3.7, end: 18.2 } }), T0);
  assert.equal(r.added, true);
  const it = r.item;
  assert.deepEqual([it.video, it.type, it.folder, it.note, it.tags, it.clip, it.savedAt], ['yTdemo00029', 'video', 'f1', 'Hook in 3 s', ['hook', 'b-roll'], { start: 3, end: 18 }, T0]);
  assert.ok(/^[A-Za-z0-9_-]{4,40}$/.test(it.id));
  assert.equal(r.org.folders, ORG.folders, 'folders, accounts and niches are kept as they are');
  assert.equal(r.org.niches, ORG.niches);
  assert.equal(ORG.swipe, undefined, 'the input org is not changed');
  assert.deepEqual(Object.keys(r.org.swipe), ['v', 'items']);
  assert.equal(SW.url(it), 'https://www.youtube.com/watch?v=yTdemo00029&t=3s');
  assert.equal(SW.clipLabel(it.clip), '0:03–0:18');
});

test('save again: the same video + clip updates, another clip is a second item; unknown folders are dropped', () => {
  let org = SW.save(ORG, Object.assign({}, VID, { clip: { start: 3, end: 18 } }), T0).org;
  const again = SW.save(org, Object.assign({}, VID, { clip: { start: 3, end: 18 }, note: 'better note', folder: 'nope' }), T0 + 1000);
  assert.equal(again.added, false);
  assert.equal(again.item.note, 'better note');
  assert.equal(again.item.folder, null, 'a folder id the org doesn\'t have');
  assert.equal(again.item.savedAt, T0, 'first save time stays');
  assert.equal(again.item.updatedAt, T0 + 1000);
  org = again.org;
  org = SW.save(org, Object.assign({}, VID, { clip: { start: 40, end: 55 } }), T0 + 2000).org;
  org = SW.save(org, Object.assign({}, VID), T0 + 3000).org;
  assert.equal(Object.keys(org.swipe.items).length, 3, 'two clips and the whole video');
  // Update by id (the Library's edit): the clip can be removed.
  const id = Object.values(org.swipe.items).find((x) => x.clip && x.clip.start === 40).id;
  const ed = SW.save(org, { id, video: VID.video, clip: null, tags: 'pacing, retention' }, T0 + 4000);
  assert.equal(ed.added, false);
  assert.equal(ed.item.clip, null);
  assert.deepEqual(ed.item.tags, ['pacing', 'retention']);
  assert.equal(ed.item.title, VID.title, 'fields not given are kept');
  const rm = SW.remove(ed.org, id);
  assert.equal(rm.removed, true);
  assert.equal(Object.keys(rm.org.swipe.items).length, 2);
  assert.equal(SW.remove(rm.org, 'missing').removed, false);
});

test('clips and items: bad input is cleaned or refused', () => {
  assert.deepEqual(SW.normClip({ start: 10 }), { start: 10, end: 40 }, 'no end = 30 s');
  assert.deepEqual(SW.normClip({ start: 50, end: 90 }, 64), { start: 50, end: 64 }, 'clamped to the video');
  assert.equal(SW.normClip({ start: 20, end: 10 }), null);
  assert.equal(SW.normClip({ start: -1, end: 10 }), null);
  assert.equal(SW.normClip(null), null);
  assert.equal(SW.normItem({ video: 'nope' }), null);
  assert.equal(SW.save(ORG, { video: 'x' }, T0).item, null);
  const it = SW.normItem({ video: 'yTdemo00035', type: 'short', thumb: 'javascript:alert(1)', account: 'evil', channelId: 'x', note: 'n'.repeat(5000), tags: Array.from({ length: 30 }, (_, i) => 't' + i) }, T0);
  assert.equal(it.thumb, null);
  assert.equal(it.account, null);
  assert.equal(it.channelId, null);
  assert.equal(it.note.length, 2000);
  assert.equal(it.tags.length, 12);
  assert.equal(SW.url(it), 'https://www.youtube.com/shorts/yTdemo00035', 'a Short without a clip opens as a Short');
  assert.equal(SW.url(Object.assign({}, it, { clip: { start: 4, end: 9 } })), 'https://www.youtube.com/watch?v=yTdemo00035&t=4s');
  assert.equal(SW.normTag('  #Hook Ideas!! '), 'hook-ideas');
  assert.equal(SW.normTag('İçerik'), 'içerik', 'the Library\'s rule: letters of any language stay');
});

test('merge (backup restore): ours win unless theirs is newer; junk dropped', () => {
  const a = SW.save(ORG, Object.assign({}, VID, { note: 'ours' }), T0).org.swipe;
  const id = Object.keys(a.items)[0];
  const theirsOld = { v: 1, items: { [id]: Object.assign({}, a.items[id], { note: 'theirs, older', updatedAt: T0 - 5 }), junk: { video: 'bad' }, sXtra1: Object.assign({}, a.items[id], { id: 'sXtra1', video: 'yTdemo00035' }) } };
  const m1 = SW.merge(a, theirsOld);
  assert.equal(m1.items[id].note, 'ours');
  assert.ok(m1.items.sXtra1);
  assert.equal(Object.keys(m1.items).length, 2);
  const m2 = SW.merge(a, { items: { [id]: Object.assign({}, a.items[id], { note: 'theirs, newer', updatedAt: T0 + 5 }) } });
  assert.equal(m2.items[id].note, 'theirs, newer');
  assert.deepEqual(SW.merge(undefined, undefined), { v: 1, items: {} });
});

test('list, counts and exports', () => {
  let org = ORG;
  const add = (x, t) => { org = SW.save(org, Object.assign({}, VID, x), t).org; };
  add({ video: 'yTdemo00029', folder: 'f1', tags: ['hook'], clip: { start: 0, end: 12 }, views: 801352 }, T0);
  add({ video: 'yTdemo00035', type: 'short', title: 'Ctrl + T in 10 seconds', folder: null, tags: ['hook', 'shorts'], views: 98000 }, T0 + 1);
  add({ video: 'yTdemo00031', title: 'Pivot tables explained', folder: 'f2', note: 'Great thumbnail contrast', tags: ['thumbnail'], views: 5000 }, T0 + 2);
  assert.deepEqual(SW.list(org).map((x) => x.video), ['yTdemo00031', 'yTdemo00035', 'yTdemo00029'], 'newest first');
  assert.deepEqual(SW.list(org, {}, 'views').map((x) => x.video), ['yTdemo00029', 'yTdemo00035', 'yTdemo00031']);
  assert.deepEqual(SW.list(org, {}, 'title').map((x) => x.title), ['Ctrl + T in 10 seconds', 'Pivot tables explained', 'XLOOKUP vs VLOOKUP in 60 seconds']);
  assert.deepEqual(SW.list(org, { folder: 'f1' }).map((x) => x.video), ['yTdemo00029']);
  assert.deepEqual(SW.list(org, { folder: 'none' }).map((x) => x.video), ['yTdemo00035']);
  assert.deepEqual(SW.list(org, { tag: '#Hook' }).map((x) => x.video), ['yTdemo00035', 'yTdemo00029']);
  assert.deepEqual(SW.list(org, { type: 'short' }).map((x) => x.video), ['yTdemo00035']);
  assert.deepEqual(SW.list(org, { clips: true }).map((x) => x.video), ['yTdemo00029']);
  assert.deepEqual(SW.list(org, { q: 'contrast' }).map((x) => x.video), ['yTdemo00031'], 'search covers notes');
  assert.deepEqual(SW.tagCounts(org), { hook: 2, shorts: 1, thumbnail: 1 });
  assert.deepEqual(SW.folderCounts(org), { none: 1, f1: 1, f2: 1 });

  const items = SW.list(org);
  const csv = SW.toCsv(items, org).replace(/^﻿/, '').split('\r\n');
  assert.equal(csv[0], 'title,channel,type,url,clip_start,clip_end,note,tags,folder,views,saved_at');
  assert.equal(csv[3], 'XLOOKUP vs VLOOKUP in 60 seconds,Excel Demo,video,https://www.youtube.com/watch?v=yTdemo00029,0,12,,hook,Hooks,801352,2026-11-21T12:00:00.000Z');
  const md = SW.toMarkdown(items, org, 'Swipe file');
  assert.ok(md.includes('## [XLOOKUP vs VLOOKUP in 60 seconds](https://www.youtube.com/watch?v=yTdemo00029)\nExcel Demo · clip 0:00–0:12 · Hooks\n#hook'));
  assert.ok(md.includes('> Great thumbnail contrast'));
  const js = JSON.parse(SW.toJson(items));
  assert.equal(js.kind, 'swipe-file');
  assert.equal(js.items.length, 3);
});
