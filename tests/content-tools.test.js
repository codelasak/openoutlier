// Phase 4 content tools, the pure part (src/content-tools.js): the transcript readers (YouTube's
// transcript panel in both DOM shapes, json3 and srv1 captions, caption tracks), the exporters,
// the comment parser (entity and renderer formats), the filters and the Studio thumbnail plan.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CT = require('../src/content-tools.js');
const { parse } = require('./helpers/fake-dom.js');

const FX = path.join(__dirname, '..', 'dev', 'youtube', 'content');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');

test('transcript: YouTube\'s panel in the ytd-transcript-segment-renderer layout', () => {
  const segs = CT.readTranscriptDom(parse(read('transcript-panel.html')));
  assert.equal(segs.length, 18, 'section headers and the empty last segment are skipped');
  assert.deepEqual(segs[0], { start: 0, end: 3, text: 'If you still use VLOOKUP, this one\'s for you.' });
  assert.equal(segs[2].text, 'Here\'s a price list: product codes on the left, prices on the right.');
  assert.equal(segs[17].start, 59);
  assert.equal(segs[17].end, 63, 'the last segment gets 4 s');
  assert.ok(segs.every((s, i) => !i || s.start >= segs[i - 1].start));
});

test('transcript: the transcript-segment-view-model layout reads the same lines', () => {
  const a = CT.readTranscriptDom(parse(read('transcript-panel.html')));
  const b = CT.readTranscriptDom(parse(read('transcript-panel-new.html')));
  assert.deepEqual(b, a);
  // The timestamp's a11y label ("3 seconds") never leaks into the text.
  assert.ok(b.every((s) => !/seconds/.test(s.text)));
  assert.deepEqual(CT.readTranscriptDom(parse('<div></div>')), []);
  assert.deepEqual(CT.readTranscriptDom(null), []);
});

test('transcript: json3 and srv1 captions, caption tracks from a player response', () => {
  const j = CT.parseJson3(read('captions.json3.json'));
  const x = CT.parseCaptionXml(read('captions.xml'));
  assert.equal(j.length, 18, 'the window event and the newline-only append are dropped');
  assert.equal(x.length, 18);
  assert.deepEqual(j.map((s) => s.text), x.map((s) => s.text));
  assert.equal(j[0].start, 0.4);
  assert.equal(Math.round(j[0].end * 10) / 10, 3.1);
  assert.equal(x[2].text, 'Here\'s a price list: product codes on the left, prices on the right.');
  assert.deepEqual(CT.parseJson3('not json'), []);
  // The repeated line of rolling auto captions is dropped.
  assert.equal(CT.parseJson3({ events: [{ tStartMs: 0, segs: [{ utf8: 'a b' }] }, { tStartMs: 900, segs: [{ utf8: 'a b' }] }, { tStartMs: 1800, segs: [{ utf8: 'c' }] }] }).length, 2);

  const player = fs.readFileSync(path.join(FX, '..', 'player.json'), 'utf8');
  const tr = CT.captionTracks(player);
  assert.equal(tr.videoId, 'yTdemo00029');
  assert.ok(tr.tracks.length >= 1);
  assert.ok(tr.tracks[0].url.startsWith('https://www.youtube.com/api/timedtext'));
  assert.equal(CT.captionTracks('{"x":1}'), null);
  const tracks = [{ url: 'u1', lang: 'en', auto: true }, { url: 'u2', lang: 'tr', auto: false }, { url: 'u3', lang: 'en-GB', auto: false }];
  assert.equal(CT.pickTrack(tracks, 'en').url, 'u3', 'uploaded before auto in the wanted language');
  assert.equal(CT.pickTrack(tracks, 'tr').url, 'u2');
  assert.equal(CT.pickTrack(tracks, 'de').url, 'u2', 'else the first uploaded');
  assert.equal(CT.pickTrack([], 'en'), null);
  assert.equal(CT.json3Url('https://x/api/timedtext?v=a&lang=en'), 'https://x/api/timedtext?v=a&lang=en&fmt=json3');
  assert.equal(CT.json3Url('https://x/api/timedtext?v=a&fmt=srv3&lang=en'), 'https://x/api/timedtext?v=a&fmt=json3&lang=en');
});

test('transcript exports: text, timestamps, .srt, Markdown and the Claude prompt', () => {
  const segs = CT.readTranscriptDom(parse(read('transcript-panel.html')));
  const ts = CT.asText(segs, { timestamps: true }).split('\n');
  assert.equal(ts.length, 18);
  assert.equal(ts[0], '[0:00] If you still use VLOOKUP, this one\'s for you.');
  const plain = CT.asText(segs);
  assert.ok(!/\[\d/.test(plain));
  assert.ok(plain.split('\n\n').length >= 2, 'paragraphs');

  const srt = CT.toSrt([{ start: 0.4, end: 3.1, text: 'One' }, { start: 3725.25, end: null, text: 'Two' }]);
  assert.equal(srt, '1\n00:00:00,400 --> 00:00:03,100\nOne\n\n2\n01:02:05,250 --> 01:02:07,250\nTwo\n');
  assert.equal(CT.srtTime(62.5), '00:01:02,500');
  assert.equal(CT.clock(3723), '1:02:03');
  assert.equal(CT.parseClock('1:02:03'), 3723);
  assert.equal(CT.parseClock(' 0:42 '), 42);
  assert.equal(CT.parseClock('90'), 90);
  assert.equal(CT.parseClock('1:2'), null);

  const md = CT.toMarkdown(segs, { id: 'yTdemo00029', title: 'XLOOKUP vs VLOOKUP in 60 seconds', channel: 'Excel Demo' });
  assert.ok(md.startsWith('# XLOOKUP vs VLOOKUP in 60 seconds\n\n**Excel Demo** · [https://www.youtube.com/watch?v=yTdemo00029]'));
  assert.ok(md.includes('[0:00](https://www.youtube.com/watch?v=yTdemo00029) If you still use VLOOKUP'));
  assert.ok(md.includes('[0:30](https://www.youtube.com/watch?v=yTdemo00029&t=30s) It looks to the left too'), '30-second blocks with &t= links');

  const p = CT.transcriptPrompt(segs, { id: 'yTdemo00029', title: 'XLOOKUP vs VLOOKUP' }, 'en');
  assert.ok(/summary/.test(p) && /hook/i.test(p) && /outline/i.test(p) && /get_transcript/.test(p));
  assert.ok(p.includes('<transcript>\n[0:00] If you still use VLOOKUP'));
  assert.ok(p.includes('First 30 seconds: If you still use VLOOKUP'));
  const ptr = CT.transcriptPrompt(segs, { id: 'x' }, 'tr');
  assert.ok(/özet/.test(ptr) && /Hook analizi/.test(ptr) && /get_transcript/.test(ptr));
  assert.equal(CT.slug('XLOOKUP vs. VLOOKUP — İçerik Şöyle!'), 'xlookup-vs-vlookup-icerik-soyle');
});

test('comments: the entity format (commentViewModel + frameworkUpdates) and the renderer format', () => {
  const a = CT.parseComments(read('next-comments.json'), { lang: 'en' });
  assert.equal(a.length, 15);
  const pin = a[0];
  assert.deepEqual([pin.id, pin.author, pin.likes, pin.replies, pin.pinned, pin.creator, pin.reply], ['UgxPin0001', '@ExcelDemo', 842, 31, true, true, false]);
  const fan = a.find((c) => c.id === 'UgxA000002');
  assert.equal(fan.likes, 1200);
  assert.equal(fan.hearted, true);
  const reply = a.find((c) => c.reply);
  assert.equal(reply.parent, 'UgxA000003');
  assert.equal(a.find((c) => c.id === 'UgxA000010').likes, 0, 'no like count = 0');
  assert.equal(CT.commentsTotal(read('next-comments.json')), 234);

  const b = CT.parseComments(read('next-comments-old.json'), { lang: 'tr' });
  assert.deepEqual(b.map((c) => [c.id, c.likes, c.pinned, c.hearted, c.reply]), [
    ['UgzOld0001', 1200, true, false, false], ['UgzOld0002', 245, false, true, false], ['UgzOld0003', 88, false, false, false], ['UgzOld0003.9zRep001', 40, false, false, true]]);
  assert.equal(b[2].published, '1 gün önce', '"(düzenlendi)" is dropped');
  assert.equal(CT.commentsTotal(read('next-comments-old.json'), { lang: 'tr' }), 1204);
  assert.deepEqual(CT.parseComments('{}'), []);
  assert.deepEqual(CT.parseComments('nope'), []);

  // Counts: EN and TR abbreviations.
  assert.deepEqual(['1.2K', '3M', '842', '1,234'].map((s) => CT.parseCompact(s, 'en')), [1200, 3000000, 842, 1234]);
  assert.deepEqual(['1,2 B', '12 B', '3,4 Mn', '1.204'].map((s) => CT.parseCompact(s, 'tr')), [1200, 12000, 3400000, 1204]);

  // Merging batches as they load: same id → the newer copy, order kept.
  const m = CT.mergeComments(a.slice(0, 3), [Object.assign({}, a[1], { likes: 1300 })].concat(a.slice(3, 5)));
  assert.equal(m.length, 5);
  assert.equal(m[1].likes, 1300);
  assert.equal(CT.mergeComments(a, [], 4).length, 4);
});

test('comment filters: questions (TR + EN), profanity (TR + EN, no false alarms), phrases, sorting', () => {
  for (const q of ['Does XLOOKUP work on Excel 2016?', 'How do I return two columns at once', 'is there a keyboard shortcut to insert the function faster',
    'Bu formül Mac\'te de çalışıyor mu', 'Neden bende #SPILL! hatası veriyor', 'nasıl yaptın bunu', 'Excel mi daha iyi Sheets mi', 'Could you do a video on pivots']) assert.equal(CT.isQuestion(q), true, q);
  for (const q of ['Great video!', 'Thanks a lot', 'what a video', 'how cool is that', 'Harika anlatım, teşekkürler', 'Who knew', 'Pivot tablo videosu da gelsin lütfen']) assert.equal(CT.isQuestion(q), false, q);

  for (const p of ['this is bullshit marketing', 'what a waste of time, f*ck this', 'a**hole', 'fuuuuck', 'amk ya', 'piç kurusu', 's1kt1r git', 'Mk gibi anlatmış', 'sh*t', 'orospu çocuğu'])
    assert.ok(CT.profane(p), p);
  for (const p of ['Dickens was a great writer', 'I love this class', 'Assessment done', 'götürmek lazım', 'Scunthorpe United', 'pick a picture', 'sikke koleksiyonu', 'Ambar ve amaç', 'assess the class', 'Bu video harika'])
    assert.equal(CT.profane(p), null, p);
  assert.equal(CT.profane('amk', ['en']), null, 'language lists can be chosen');

  assert.equal(CT.matchesPhrase('XLOOKUP çok iyi', 'xlookup'), true);
  assert.equal(CT.matchesPhrase('Çapraz ara', 'capraz'), true, 'accent-insensitive');
  assert.equal(CT.matchesPhrase('INDEX MATCH', 'vba, index'), true, 'comma = any');
  assert.equal(CT.matchesPhrase('INDEX MATCH', 'vba'), false);
  assert.equal(CT.matchesPhrase('anything', ''), true);

  const all = CT.parseComments(read('next-comments.json'), { lang: 'en' });
  const q = CT.filterComments(all, { questions: true });
  assert.deepEqual(q.items.map((c) => c.id), ['UgxPin0001', 'UgxA000003', 'UgxA000004', 'UgxA000005', 'UgxA000008', 'UgxA000012', 'UgxA000014']);
  const clean = CT.filterComments(all, { hideProfanity: true });
  assert.equal(clean.hiddenProfane, 2);
  assert.ok(!clean.items.some((c) => c.id === 'UgxA000006' || c.id === 'UgxA000010'));
  const liked = CT.filterComments(all, { sort: 'likes' }).items;
  assert.equal(liked[0].id, 'UgxA000002');
  assert.ok(liked.every((c, i) => !i || liked[i - 1].likes >= c.likes));
  assert.equal(CT.filterComments(all, { phrase: '2016' }).items.length, 2, 'the question and the creator\'s reply');
  assert.equal(CT.filterComments(all, { replies: false }).items.length, 14);
  assert.equal(CT.filterComments(all, {}).total, 15);
});

test('comment exports: CSV (quoting, formula guard), JSON and the analysis prompt', () => {
  const list = [
    { id: 'c1', author: '@a', text: 'Hello, "world"\nsecond line', likes: 3, replies: 1, published: '1 day ago' },
    { id: 'c2', author: '@b', text: '=HYPERLINK("evil")', likes: 0, replies: 0, published: null, reply: true },
    { id: 'c3', author: '@c', text: 'How does this work?', likes: 9, replies: 0, published: 'now', pinned: true },
    { id: 'c4', author: '@d', text: '@SUM(A1:A9) or -1 or +ADD(1)', likes: 0, replies: 0, published: 'now' }
  ];
  const csv = CT.commentsCsv(list, 'yTdemo00029');
  const rows = csv.replace(/^﻿/, '').split('\r\n');
  assert.equal(rows[0], 'id,author,text,likes,replies,published,is_reply,pinned,hearted,by_creator,is_question,url');
  assert.equal(rows[1], 'c1,@a,"Hello, ""world""\nsecond line",3,1,1 day ago,0,0,0,0,0,https://www.youtube.com/watch?v=yTdemo00029&lc=c1');
  assert.ok(rows[2].startsWith('c2,@b,"\'=HYPERLINK(""evil"")"'), 'a leading = can\'t run as a formula');
  assert.ok(rows[3].includes(',1,0,0,1,'), 'pinned, and a question');
  assert.ok(rows[4].startsWith('c4,@d,\'@SUM(A1:A9)'), '@SUM( is guarded, a plain @handle is not');
  const j = JSON.parse(CT.commentsJson(list, { id: 'yTdemo00029', title: 'T', now: Date.UTC(2026, 10, 21) }));
  assert.equal(j.count, 4);
  assert.equal(j.exported_at, '2026-11-21T00:00:00.000Z');
  assert.equal(j.comments[2].is_question, true);
  const p = CT.commentPrompt(list, { id: 'yTdemo00029', title: 'T' }, 'en');
  assert.ok(/sentiment/.test(p) && /liked/.test(p) && /disliked/.test(p) && /Questions worth answering/.test(p) && /video ideas/.test(p) && /get_comments/.test(p));
  assert.ok(p.includes('<comments count="4">\n[3] Hello, "world" second line\n[0] ↳ =HYPERLINK("evil")'));
  assert.ok(/Genel duygu/.test(CT.commentPrompt(list, {}, 'tr')));
});

test('Studio thumbnails: the compression plan stays ≥ 1280 px wide and never upscales', () => {
  const plan = CT.thumbPlan(3840, 2160);
  assert.deepEqual(plan[0], { w: 1920, h: 1080, q: 0.92 });
  assert.deepEqual([...new Set(plan.map((s) => s.w))], [1920, 1632, 1382, 1280]);
  assert.ok(plan.every((s) => Math.abs(s.w / s.h - 16 / 9) < 0.01));
  assert.deepEqual([...new Set(CT.thumbPlan(1280, 720).map((s) => s.w))], [1280]);
  assert.deepEqual([...new Set(CT.thumbPlan(800, 450).map((s) => s.w))], [800], 'small images keep their size');
  assert.equal(CT.thumbPlan(1280, 720).length, 5);
  assert.equal(CT.THUMB_LIMIT, 2097152);
  assert.ok(CT.THUMB_TARGET < CT.THUMB_LIMIT);
  assert.equal(CT.fileSize(3.4 * 1048576, 'tr'), '3,4 MB');
  assert.equal(CT.fileSize(900 * 1024, 'en'), '900 KB');
});
