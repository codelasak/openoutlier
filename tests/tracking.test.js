// src/tracking.js: the niche tracking list in rs:org (tracked folders / tags, the Track
// button, mine, what the bridge should track) and the one-click Excel suggestion.
const test = require('node:test');
const assert = require('node:assert/strict');
const TR = require('../src/tracking.js');

const UC = 'UCdemoExcelChannel000001';
const org = () => ({ folders: [{ id: 'f1', name: 'Food' }, { id: 'f2', name: 'Excel' }], accounts: { 'yt/kevinstratvert': { folder: 'f2', tags: [] }, 'yt/cooking': { folder: 'f1', tags: ['excel'] }, 'yt/loose': { folder: null, tags: [] } } });

test('a folder or a tag marked as niche tracks its YouTube channels', () => {
  const o = org();
  assert.equal(TR.status(o, 'yt/kevinstratvert').on, false);
  TR.setNiche(o, 'folder', 'f2', true);
  assert.deepEqual(TR.status(o, 'yt/kevinstratvert'), { on: true, via: 'niche', niche: 'Excel', mine: false, excluded: false });
  assert.equal(TR.isNiche(o, 'folder', 'f2'), true);
  TR.setNiche(o, 'tag', 'excel', true);
  assert.equal(TR.status(o, 'yt/cooking').niche, '#excel');
  TR.setNiche(o, 'folder', 'f2', false);
  assert.equal(TR.status(o, 'yt/kevinstratvert').on, false);
  assert.deepEqual(TR.niches(o), { folders: [], tags: ['excel'] });
});

test('the Track button: on, off, and off for a niche member (excluded) and back', () => {
  const o = org();
  TR.toggle(o, 'yt/loose', { channelId: UC, name: 'Loose' }, 1);
  assert.deepEqual(o.tracked['yt/loose'], { on: true, at: 1, channelId: UC, name: 'Loose' });
  assert.equal(TR.status(o, 'yt/loose').via, 'button');
  TR.toggle(o, 'yt/loose', null, 2);
  assert.equal(o.tracked['yt/loose'], undefined, 'a button-only channel is forgotten when switched off');
  TR.setNiche(o, 'folder', 'f2', true);
  TR.toggle(o, 'yt/kevinstratvert', null, 3);
  assert.deepEqual(TR.status(o, 'yt/kevinstratvert'), { on: false, via: null, niche: 'Excel', mine: false, excluded: true });
  TR.toggle(o, 'yt/kevinstratvert', null, 4);
  assert.equal(TR.status(o, 'yt/kevinstratvert').on, true);
  // Instagram accounts are never tracked.
  TR.toggle(o, 'someone', null, 5);
  assert.equal((o.tracked || {}).someone, undefined);
});

test('desired: everything that should be tracked, mine joins the biggest niche', () => {
  const o = org();
  TR.setNiche(o, 'folder', 'f2', true);
  TR.setMine(o, 'yt/handsonexcel', true, { name: 'Hands on Excel' }, 1);
  TR.toggle(o, 'yt/UCdemoExcelChannel000001', null, 2);
  const d = TR.desired(o, ['yt/kevinstratvert', 'yt/cooking', 'yt/loose', 'insta.account']);
  assert.deepEqual(d.map((x) => [x.account_id, x.niche, x.mine, x.channelId]), [
    ['yt/kevinstratvert', 'Excel', false, null],
    ['yt/handsonexcel', 'Excel', true, null],
    ['yt/UCdemoExcelChannel000001', null, false, UC]
  ]);
});

test('suggest: preselects the Excel channels and Hands on Excel; apply puts them in one tracked folder', () => {
  const saved = [
    { id: 'yt/simonsezit', name: 'Simon Sez IT', handle: 'simonsezit' },
    { id: 'yt/kevinstratvert', name: 'Kevin Stratvert', handle: 'KevinStratvert' },
    { id: 'yt/technologyforteachersandstudents', name: 'Technology for Teachers and Students', handle: 'TechnologyforTeachersandStudents' },
    { id: 'yt/myonlinetraininghub', name: 'MyOnlineTrainingHub', handle: 'MyOnlineTrainingHub' },
    { id: 'yt/excelchampsofficial', name: 'Excel Champs', handle: 'excelchampsofficial' },
    { id: 'yt/starterstory', name: 'Starter Story', handle: 'starterstory' },
    { id: 'yt/jaketrinder', name: 'Jake Trinder', handle: 'jaketrinder' },
    { id: 'yt/handsonexcel', name: 'Hands on Excel', handle: 'handsonexcel' }
  ];
  const sug = TR.suggest(saved, org());
  const picked = sug.items.filter((i) => i.picked).map((i) => i.id);
  assert.deepEqual(picked.sort(), ['yt/excelchampsofficial', 'yt/handsonexcel', 'yt/kevinstratvert', 'yt/myonlinetraininghub', 'yt/simonsezit', 'yt/technologyforteachersandstudents']);
  assert.equal(sug.items[0].mine, true, 'mine first');
  assert.equal(sug.mine, null, 'Hands on Excel is saved, so no extra entry');
  assert.ok(sug.missing.includes('Leila Gharani'));
  assert.ok(!sug.items.find((i) => i.id === 'yt/starterstory').picked);
  // Not saved yet: offered separately.
  assert.deepEqual(TR.suggest(saved.slice(0, 2), org()).mine, TR.MINE);

  const o = org();
  const r = TR.applySuggestion(o, { folder: 'Excel', picked: ['yt/simonsezit', 'yt/kevinstratvert'], mine: 'yt/handsonexcel' }, 100);
  assert.equal(r.folder.id, 'f2', 'an existing "Excel" folder is reused');
  assert.equal(o.accounts['yt/simonsezit'].folder, 'f2');
  assert.deepEqual(TR.niches(o).folders, ['f2']);
  assert.deepEqual(TR.status(o, 'yt/handsonexcel'), { on: true, via: 'niche', niche: 'Excel', mine: true, excluded: false });
  const o2 = { folders: [], accounts: {} };
  TR.applySuggestion(o2, { folder: 'Excel', picked: ['yt/a'], mine: null }, 200);
  assert.equal(o2.folders[0].name, 'Excel');
  assert.equal(TR.status(o2, 'yt/a').niche, 'Excel');
});
