// get_transcript (phase 5): picking a caption track, parsing json3 / VTT, the
// 30-second hook, and the two yt-dlp runs (with a fake yt-dlp): info JSON, then
// --load-info-json with --write-(auto-)subs. Only hasTranscript reaches the library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'openoutlier-tr-test-'));
const home = join(tmp, 'home');
const argLog = join(tmp, 'args.jsonl');
const ID = 'yTdemo00029';
const UC = 'UC' + 'x'.repeat(22);

const JSON3 = { events: [
  { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Stop' }, { utf8: ' using VLOOKUP.' }] },
  { tStartMs: 2000, dDurationMs: 10, aAppend: 1, segs: [{ utf8: '\n' }] },
  { tStartMs: 2100, dDurationMs: 3000, segs: [{ utf8: 'XLOOKUP does it in one step &amp; more.' }] },
  { tStartMs: 31000, dDurationMs: 4000, segs: [{ utf8: 'Now the second part.' }] },
  { tStartMs: 65000, dDurationMs: 4000, segs: [{ utf8: 'Thanks for watching!' }] }
] };

// The fake yt-dlp: run 1 writes the info JSON; run 2 (--load-info-json) writes the chosen subtitle file.
const fake = join(tmp, 'fake-yt-dlp');
writeFileSync(fake, `#!${process.execPath}
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argLog)}, JSON.stringify(a) + '\\n');
if (a[0] === '--version') { console.log(process.env.FAKE_VERSION || '2026.10.26'); process.exit(0); }
const P = a[a.indexOf('-P') + 1];
const load = a.indexOf('--load-info-json');
const url = a[a.length - 1];
const id = load === -1 ? url.split('v=')[1] : JSON.parse(fs.readFileSync(a[load + 1], 'utf8')).id;
if (id === 'bLockedVid0') { console.error('ERROR: [youtube] bLockedVid0: Requested format is not available. YouTube is forcing SABR streaming'); process.exit(1); }
const info = { id, title: 'Lookup tips', channel: 'Demo', channel_id: ${JSON.stringify(UC)}, uploader_id: '@DemoHandle', view_count: 801352, like_count: 13398, timestamp: 1746703848, duration: 592, language: 'en',
  subtitles: {}, automatic_captions: { 'en-orig': [{ ext: 'json3' }], en: [{ ext: 'json3' }], tr: [{ ext: 'json3' }] } };
if (id === 'nOcaptions0') { info.automatic_captions = {}; info.subtitles = {}; }
if (id === 'mAnualSubs0') { info.subtitles = { 'en-US': [{ ext: 'vtt' }], live_chat: [{ ext: 'json' }] }; }
if (load === -1) { fs.writeFileSync(path.join(P, 'tr.info.json'), JSON.stringify(info)); process.exit(0); }
const lang = a[a.indexOf('--sub-langs') + 1];
if (id === 'mAnualSubs0') {
  fs.writeFileSync(path.join(P, 'tr.' + lang + '.vtt'), 'WEBVTT\\n\\n00:00:00.000 --> 00:00:02.500\\nHello <c>there</c>\\n\\n00:00:02.500 --> 00:00:05.000\\nHello there\\nsecond line\\n\\n00:00:40.000 --> 00:00:42.000\\nlater\\n');
} else {
  fs.writeFileSync(path.join(P, 'tr.' + lang + '.json3'), JSON.stringify(${JSON.stringify(JSON3)}));
}
`);
chmodSync(fake, 0o755);

Object.assign(process.env, { OPENOUTLIER_HOME: home, OPENOUTLIER_YTDLP: fake });
delete process.env.OPENOUTLIER_YTDLP_COOKIES;
const TR = await import('../mcp/youtube-transcript.mjs');
const { store, readLibrary } = await import('../mcp/library.mjs');
const runs = () => readFileSync(argLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('track choice: requested language, the video\'s own, then English; uploaded before auto; spoken before translated', () => {
  const info = { language: 'tr', subtitles: { 'en-GB': [{}], live_chat: [{}] }, automatic_captions: { 'tr-orig': [{}], tr: [{}], en: [{}], de: [{}] } };
  assert.deepEqual(TR.pickTrack(info), { key: 'tr-orig', auto: true, language: 'tr', translated: false });
  assert.deepEqual(TR.pickTrack(info, 'en'), { key: 'en-GB', auto: false, language: 'en-GB', translated: false });
  assert.deepEqual(TR.pickTrack(info, 'de'), { key: 'de', auto: true, language: 'de', translated: true });
  assert.equal(TR.pickTrack({ subtitles: { live_chat: [{}] }, automatic_captions: {} }), null);
  // No language in the info: the auto track's "-orig" tells the spoken language.
  assert.equal(TR.pickTrack({ automatic_captions: { 'pt-orig': [{}], pt: [{}], en: [{}] } }).key, 'pt-orig');
});

test('parsing: json3 events and rolling VTT cues, timestamps and the 30-second hook', () => {
  const segs = TR.parseJson3(JSON3);
  assert.deepEqual(segs.map((s) => s.text), ['Stop using VLOOKUP.', 'XLOOKUP does it in one step & more.', 'Now the second part.', 'Thanks for watching!']);
  const out = TR.shape(segs);
  assert.equal(out.text.split('\n')[0], '[0:00] Stop using VLOOKUP.');
  assert.match(out.text, /\[1:05\] Thanks for watching!/);
  assert.equal(out.hook, 'Stop using VLOOKUP. XLOOKUP does it in one step & more.');
  const vtt = TR.parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:02.000 align:start\nfirst <00:00:01.000><c>line</c>\n\n00:00:02.000 --> 00:00:04.000\nfirst line\nnext words\n\n01:00:00.500 --> 01:00:01.000\nan hour in\n');
  assert.deepEqual(vtt.map((s) => s.text), ['first line', 'next words', 'an hour in']);
  assert.equal(vtt[2].start, 3600.5);
  assert.equal(TR.clock(3725), '1:02:05');
  assert.equal(TR.versionAgeDays('2025.06.09', Date.UTC(2026, 10, 18)), 527);
  assert.equal(TR.versionAgeDays('nightly'), null);
});

test('getTranscript: info first, then only the chosen track (no video download); hasTranscript in the library, never the text', async () => {
  store().applySync({ full: false, accounts: { 'yt/demohandle': { platform: 'youtube', updatedAt: Date.now(), posts: {
    [ID]: { code: ID, platform: 'youtube', type: 'video', owner: 'yt/demohandle', views: 801000, viewsApprox: true, files: [] }
  } } } });
  const r = await TR.getTranscript({ id: ID });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.track, 'en-orig');
  assert.equal(r.auto, true);
  assert.equal(r.translated, false);
  assert.equal(r.format, 'json3');
  assert.equal(r.hook, 'Stop using VLOOKUP. XLOOKUP does it in one step & more.');
  const [first, second] = runs().slice(-2);
  for (const a of [first, second]) {
    assert.ok(a.includes('--skip-download'));
    assert.ok(!a.includes('-f') && !a.includes('--merge-output-format'));
  }
  assert.deepEqual(first.slice(-2), ['--', 'https://www.youtube.com/watch?v=' + ID]);
  assert.ok(first.includes('--write-info-json'));
  assert.ok(second.includes('--load-info-json') && second.includes('--write-auto-subs') && !second.includes('--write-subs'));
  assert.equal(second[second.indexOf('--sub-langs') + 1], 'en-orig');
  assert.equal(second[second.indexOf('--sub-format') + 1], 'json3/vtt');
  const saved = readLibrary().accounts['yt/demohandle'].posts[ID];
  assert.equal(saved.hasTranscript, true);
  assert.equal(saved.views, 801352, 'yt-dlp\'s exact stats come along');
  assert.ok(!JSON.stringify(saved).includes('VLOOKUP.'), 'the transcript text is not stored');
  // A requested language that exists only as a machine translation.
  const tr = await TR.getTranscript({ id: ID, lang: 'tr' });
  assert.equal(tr.track, 'tr');
  assert.equal(tr.translated, true);
});

test('getTranscript: uploaded VTT captions; unsaved videos are not added to the library', async () => {
  const r = await TR.getTranscript({ id: 'mAnualSubs0' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.auto, false);
  assert.equal(r.track, 'en-US');
  assert.equal(r.format, 'vtt');
  assert.deepEqual(r.segments.map((s) => s.text), ['Hello there', 'second line', 'later']);
  assert.equal(r.hook, 'Hello there second line');
  const last = runs().pop();
  assert.ok(last.includes('--write-subs') && !last.includes('--write-auto-subs'));
  assert.ok(!Object.values(readLibrary().accounts).some((a) => a.posts && a.posts.mAnualSubs0));
});

test('getTranscript errors: no captions, yt-dlp too old, bad input, missing yt-dlp', async () => {
  const none = await TR.getTranscript({ id: 'nOcaptions0' });
  assert.equal(none.ok, false);
  assert.equal(none.error.code, 'no_captions');
  assert.match(none.error.message, /no captions/);

  process.env.FAKE_VERSION = '2025.06.09';
  try {
    const old = await TR.getTranscript({ id: 'bLockedVid0' });
    assert.equal(old.error.code, 'too_old');
    assert.match(old.error.message, /yt-dlp 2025\.06\.09 is too old/);
    assert.match(old.error.hint, /brew upgrade yt-dlp/);
  } finally { delete process.env.FAKE_VERSION; }
  const recent = await TR.getTranscript({ id: 'bLockedVid0' });
  assert.equal(recent.error.code, 'blocked', 'a current yt-dlp that is blocked is not called old');

  assert.equal((await TR.getTranscript({ id: 'x;rm -rf ~' })).error.code, 'bad_id');
  assert.equal((await TR.getTranscript({ id: ID, lang: 'en; rm' })).error.code, 'bad_request');
  process.env.OPENOUTLIER_YTDLP = join(tmp, 'nope');
  try { assert.equal((await TR.getTranscript({ id: ID })).error.code, 'missing'); } finally { process.env.OPENOUTLIER_YTDLP = fake; }
  assert.ok(!existsSync(join(tmpdir(), 'openoutlier-tr-leftover')));
});
