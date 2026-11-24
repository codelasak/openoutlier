// Phase 4 X draft checks (src/x-composer.js): twitter-text weighted counting, the hook and the
// "Show more" cut, engagement-bait patterns (TR + EN) with spans, trigram similarity, link and AI notes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/x-composer.js');

const W = (t) => C.weightedLength(t).weighted;

test('weightedLength: twitter-text v3 weights', () => {
  assert.equal(W('Hello'), 5);
  assert.equal(W('çğışöü İ'), 8, 'Turkish letters weigh 1');
  assert.equal(W('你好'), 4, 'CJK weighs 2');
  assert.equal(W('こんにちは'), 10);
  assert.equal(W('😀'), 2);
  assert.equal(W('👨‍👩‍👧‍👦'), 2, 'a ZWJ family is one emoji');
  assert.equal(W('👍🏽'), 2, 'skin tone modifier joins the emoji');
  assert.equal(W('🇹🇷'), 2, 'a flag is one emoji');
  assert.equal(W('#️⃣'), 2, 'keycap');
  assert.equal(W('❤️'), 2);
  assert.equal(W('©'), 1, 'text-style © without VS16 weighs 1');
  assert.equal(W('—'), 1, 'em dash is in the 8208–8223 range');
  assert.equal(W('€'), 2, 'U+20AC is outside the light ranges');
  assert.equal(W(''), 0);
});

test('weightedLength: every URL counts as 23', () => {
  assert.equal(W('https://example.com/a/very/long/path/that/goes/on?x=1&y=2'), 23);
  assert.equal(W('see example.com.'), 4 + 23 + 1, 'bare domain; the final dot is not part of the URL');
  assert.equal(W('https://a.co'), 23, 'short URLs still count 23');
  assert.equal(W('two https://a.com and https://b.com'), 4 + 23 + 5 + 23);
  assert.equal(W('user@example.com'), 16, 'an e-mail address is not a URL');
});

test('weightedLength: the 280 limit and the remaining count', () => {
  const ok = C.weightedLength('a'.repeat(280));
  assert.deepEqual([ok.weighted, ok.valid, ok.remaining], [280, true, 0]);
  const over = C.weightedLength('a'.repeat(281));
  assert.deepEqual([over.weighted, over.valid, over.remaining], [281, false, -1]);
  assert.equal(C.weightedLength('你'.repeat(140)).valid, true);
  assert.equal(C.weightedLength('你'.repeat(141)).valid, false);
  assert.equal(C.weightedLength('   ').valid, false, 'only spaces is not a post');
});

test('links: external vs x.com, trailing punctuation, parentheses', () => {
  const ls = C.links('Read https://x.com/user/status/123 and (https://en.wikipedia.org/wiki/Excel_(software)) or handsonexcel.com!');
  assert.deepEqual(ls.map((l) => [l.url, l.external]), [
    ['https://x.com/user/status/123', false],
    ['https://en.wikipedia.org/wiki/Excel_(software)', true],
    ['handsonexcel.com', true]
  ]);
  const s = 'go to t.co/abc now';
  const [l] = C.links(s);
  assert.equal(s.slice(l.start, l.end), 't.co/abc');
  assert.equal(l.external, false);
});

test('hook: the first line and what the timeline shows before "Show more"', () => {
  const short = C.hook('\n  Most people use VLOOKUP wrong.\n\nHere is why.');
  assert.equal(short.firstLine, 'Most people use VLOOKUP wrong.');
  assert.equal(short.firstLineWeighted, 30);
  assert.equal(short.firstLineWords, 5);
  assert.equal(short.lines, 2);
  assert.equal(short.truncated, false);
  assert.equal(short.hidden, 0);

  const long = 'Hook line\n' + 'word '.repeat(100);
  const h = C.hook(long);
  assert.equal(h.truncated, true);
  assert.ok(W(h.visible) <= 280);
  assert.ok(W(h.visible) > 270, 'cuts close to 280');
  assert.ok(/word$/.test(h.visible), 'cut at a word boundary');
  assert.equal(h.hidden, W(long) - W(h.visible));
});

test('findBait: English patterns with spans', () => {
  const s = 'Like this if you agree! RT if you love Excel. Follow me for more tips. Comment below. Tag a friend who needs this. Like & RT.';
  const hits = C.findBait(s);
  assert.deepEqual(hits.map((h) => h.id), ['en-like-if', 'en-rt-if', 'en-follow-more', 'en-comment-below', 'en-tag-friend', 'en-like-rt']);
  for (const h of hits) assert.equal(s.slice(h.start, h.end), h.text);
  assert.ok(hits.every((h) => h.level === 'warn'));
  assert.deepEqual(C.findBait('LIKE IF you agree').map((h) => h.text), ['LIKE IF'], 'upper case');
  assert.deepEqual(C.findBait('Bookmark this for later').map((h) => h.level), ['info'], 'a softer CTA is info');
});

test('findBait: Turkish patterns, imperative only (no false hits on past tense)', () => {
  const s = "RT'leyin, çok kişiye ulaşsın. Beğenirseniz takip edin! Yorumlara yaz. Arkadaşını etiketle. Beni takip et.";
  assert.deepEqual(C.findBait(s).map((h) => h.text), ["RT'leyin", 'çok kişiye ulaşsın', 'Beğenirseniz', 'takip edin', 'Yorumlara yaz', 'Arkadaşını etiketle', 'takip et']);
  const clean = 'Bu kitabı çok beğendim. Onu yıllardır takip ettim, takip etmek kolay. Yorumları okudum. RTX 4090 aldım.';
  assert.deepEqual(C.findBait(clean), [], 'past tense / infinitive / RTX are not bait');
  const spans = C.findBait('İyi akşamlar, beğenin!');
  assert.equal('İyi akşamlar, beğenin!'.slice(spans[0].start, spans[0].end), 'beğenin', 'İ keeps indexes aligned');
});

test('similarity: trigram Jaccard flags near copies and ranks top matches', () => {
  const swipe = [
    { id: 's1', text: 'Most people use VLOOKUP wrong. Here is the one trick that fixes 90% of errors: use XLOOKUP with exact match.', url: 'https://x.com/a/status/1' },
    'I quit my job to build an Excel course. Month 1 revenue: $0. Month 6: $12k. Here is what changed.',
    'Pivot tables are the most underrated feature in Excel.'
  ];
  const draft = 'Most people use VLOOKUP wrong. Here is the one trick that fixes 90% of the errors: XLOOKUP with an exact match.';
  const r = C.similarity(draft, swipe, { source: 'swipe' });
  assert.equal(r.top[0].id, 's1');
  assert.equal(r.top[0].level, 'warn');
  assert.ok(r.top[0].jaccard > 0.7);
  assert.equal(r.flagged.length, 1);
  assert.equal(r.top.length, 3);

  const own = C.similarity('I built a tool that scores tweets against the author median views. Free and local.', swipe);
  assert.equal(own.flagged.length, 0);
  assert.ok(own.top[0].jaccard < 0.2);

  // A short excerpt copied out of a long post: Jaccard is low, containment catches it.
  const long = 'Thread on dashboards. ' + 'Start with the question the reader asks, then pick one chart per question and cut everything else. '.repeat(1) + 'Colours: two at most. Fonts: one. Numbers: rounded. Titles: say the takeaway.';
  const excerpt = 'Start with the question the reader asks, then pick one chart per question and cut everything else.';
  const ex = C.similarity(excerpt, [long]);
  assert.equal(ex.top[0].level, 'warn');
  assert.ok(ex.top[0].containment >= 0.8);

  assert.deepEqual(C.similarity('hey', ['hey']).flagged, [], 'very short drafts are not compared');
  assert.equal(C.similarity('I built a tool that scores tweets against the author median views. Free and local.', swipe, { threshold: 0.05 }).flagged[0].level, 'warn', 'custom Jaccard threshold');
});

test('checkDraft: all findings with severity, TR + EN messages', () => {
  const swipe = ['Most people use VLOOKUP wrong. Here is the one trick that fixes 90% of errors: use XLOOKUP with exact match.'];
  const draft = 'Most people use VLOOKUP wrong. Here is the one trick that fixes 90% of the errors: XLOOKUP with an exact match. Like if you agree! https://handsonexcel.com';
  const r = C.checkDraft(draft, { swipe, media: [{ type: 'image', ai: true }], premium: false });
  assert.equal(r.ok, false);
  const ids = r.findings.map((f) => f.id);
  assert.deepEqual(ids.slice().sort(), ['ai-disclosure', 'bait', 'hook-long', 'link', 'similar']);
  assert.ok(r.findings.every((f) => f.tr && f.en && ['error', 'warn', 'info'].includes(f.severity)));
  assert.deepEqual(r.findings.map((f) => f.severity), ['warn', 'warn', 'warn', 'info', 'info'], 'sorted by severity');
  const bait = r.findings.find((f) => f.id === 'bait');
  assert.equal(draft.slice(bait.span.start, bait.span.end), 'Like if');
  assert.equal(r.findings.find((f) => f.id === 'link').spans.length, 1);
  assert.equal(r.similar.swipe[0].level, 'warn');
  assert.equal(r.count.urls, 1);

  assert.equal(C.checkDraft('A clean post about pivot tables.\n\nThree tips below.').ok, true);
  assert.deepEqual(C.checkDraft('Look at x.com/a/status/1').findings.filter((f) => f.id === 'link'), [], 'x.com links are not "links out"');
  assert.deepEqual(C.checkDraft('pic', { media: [{ type: 'image', ai: true }], aiDisclosed: true }).findings.filter((f) => f.id === 'ai-disclosure'), []);
  assert.deepEqual(C.checkDraft('pic', { media: [{ type: 'image' }] }).findings.filter((f) => f.id === 'ai-disclosure'), []);
});

test('checkDraft: long posts and Premium', () => {
  const long = 'Hook\n' + 'word '.repeat(80);
  assert.deepEqual(C.checkDraft(long, { premium: false }).findings.map((f) => [f.id, f.severity]), [['length-over', 'error']]);
  assert.deepEqual(C.checkDraft(long, { premium: true }).findings.map((f) => [f.id, f.severity]), [['long-post', 'info']]);
  const unknown = C.checkDraft(long);
  assert.deepEqual(unknown.findings.map((f) => [f.id, f.severity]), [['long-post', 'warn']], 'unknown Premium: a warning');
  assert.match(unknown.findings[0].en, /Needs Premium/);
  assert.equal(unknown.findings[0].hidden, unknown.hook.hidden);
  assert.deepEqual(C.checkDraft('a'.repeat(25001), { premium: true }).findings.map((f) => f.id), ['length-over', 'hook-long']);
});
