// Phase 4 sponsor scan (src/sponsors.js): fixture descriptions with true and false positives,
// brand grouping, codes and discounts tied to their brand, and the niche-wide aggregate.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SP = require('../src/sponsors.js');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dev', 'youtube', 'content', 'descriptions.json'), 'utf8'));

test('every fixture description: the brands it promotes, its codes, nothing in the false positives', () => {
  for (const d of FIX) {
    const r = SP.scanDescription(d.text, { channel: d.channel });
    const keys = [...new Set(r.mentions.filter(SP.promotes).map((m) => m.key))].sort();
    assert.deepEqual(keys, d.brands.slice().sort(), d.id + ': ' + d.text.slice(0, 60));
    assert.deepEqual(r.mentions.filter((m) => m.kind === 'code').map((m) => m.code), d.codes, d.id + ' codes');
    if (d.disclosure) assert.equal(r.disclosure, true, d.id + ' discloses');
    if (d.short) assert.equal(r.mentions.filter((m) => m.kind === 'short-link').length, d.short, d.id + ' short links');
  }
});

test('kinds, discounts and which brand a code belongs to', () => {
  const nord = SP.scanDescription(FIX.find((d) => d.id === 'sp02').text);
  assert.deepEqual(nord.mentions.map((m) => [m.kind, m.brand]), [['sponsor', 'NordVPN'], ['discount', 'NordVPN'], ['brand-link', 'NordVPN'], ['code', 'NordVPN']]);
  assert.equal(nord.mentions.find((m) => m.kind === 'discount').pct, 68);
  const tr = SP.scanDescription(FIX.find((d) => d.id === 'sp05').text);
  assert.deepEqual(tr.mentions.map((m) => [m.kind, m.brand]), [['sponsor', 'Kutools'], ['discount', 'Kutools'], ['code', 'Kutools'], ['affiliate', 'Kutools']]);
  // A link's host names the brand: skl.sh is Skillshare's, a utm link names its domain.
  const sk = SP.scanDescription(FIX.find((d) => d.id === 'sp01').text, { channel: 'Excel Demo' });
  assert.deepEqual(sk.mentions.map((m) => [m.kind, m.brand]), [['sponsor', 'Skillshare'], ['utm', 'Skillshare']]);
  // The channel's own site with utm tags is not a sponsor; social links never are.
  assert.deepEqual(SP.scanDescription(FIX.find((d) => d.id === 'fp04').text, { channel: 'Cell Craft' }).mentions, []);
  assert.equal(SP.scanDescription(FIX.find((d) => d.id === 'fp04').text).mentions.length, 1, 'without the channel name it would count');
  assert.deepEqual(SP.scanDescription('').mentions, []);
  assert.equal(SP.brandKey('Skillshare'), SP.brandKey('skillshare.com'));
  assert.equal(SP.brandKey('skl.sh'), 'skillshare');
  assert.equal(SP.hostOf('https://www.Amazon.com/dp/1?tag=x'), 'amazon.com');
});

test('aggregate: who promotes what, how often, across channels', () => {
  const vids = FIX.map((d, i) => ({ id: 'v' + i, channel_id: 'UC' + d.channel.replace(/\W/g, '').padEnd(22, 'x').slice(0, 22), channel: d.channel, title: d.id, published_at: Date.UTC(2026, 9, 1 + i), description: d.text }));
  // A second channel with NordVPN, and a code on its own line after the sponsor.
  vids.push({ id: 'v99', channel_id: 'UCPivotPointxxxxxxxxxxxx', channel: 'Pivot Point', title: 'nord', published_at: Date.UTC(2026, 10, 2), description: 'Sponsored by NordVPN.\n\nGet the deal with code PIVOT at https://nordvpn.com/pivot' });
  vids.push({ id: 'v100', channel_id: 'UCPivotPointxxxxxxxxxxxx', channel: 'Pivot Point', title: 'empty', published_at: Date.UTC(2026, 10, 3), description: '' });
  const r = SP.aggregate(vids);
  assert.equal(r.scanned, FIX.length + 1, 'empty descriptions are not counted');
  assert.equal(r.brands[0].key, 'nordvpn', 'two channels first');
  assert.deepEqual(r.brands[0].channels.map((c) => c.name).sort(), ['Excel Demo', 'Pivot Point']);
  assert.equal(r.brands[0].videos, 2);
  assert.deepEqual(r.brands[0].codes.sort(), ['EXCELDEMO', 'PIVOT']);
  assert.equal(r.brands[0].last_at, Date.UTC(2026, 10, 2));
  assert.ok(r.brands[0].examples.length >= 1);
  const keys = r.brands.map((b) => b.key).sort();
  assert.deepEqual(keys, ['ablebits', 'amazon', 'brilliant', 'hostinger', 'kutools', 'nordvpn', 'notion', 'skillshare']);
  assert.equal(r.short_links, 1);
  const fo = r.channels.find((c) => c.name === 'Formül Okulu');
  assert.deepEqual(fo.brands.map((b) => b.key).sort(), ['hostinger', 'kutools']);
  assert.equal(fo.scanned, 3);
  assert.equal(r.channels.find((c) => c.name === 'Pivot Point').disclosure, 1);
});
