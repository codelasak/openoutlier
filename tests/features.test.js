// The feature registry (src/features.js): ids and defaults from docs/youtube-niche-plan.md
// section 4 and the user's decisions in section 10, storage fallback, requirements, and
// the chrome.storage side (isOn, set, onChange) with a fake chrome.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const F = require('../src/features.js');

const PLAN_IDS = [
  'card-vph', 'card-outlier', 'card-subs', 'card-velocity',
  'feed-filters', 'hide-shorts', 'channel-sort',
  'channel-stats', 'channel-growth', 'channel-track', 'channel-monetization', 'channel-similar', 'channel-sponsors', 'channel-rpm',
  'video-card', 'video-monetization', 'transcript-tools', 'comment-tools', 'frame-capture', 'title-history', 'swipe-save', 'dislikes',
  'shorts-overlay', 'thumb-compress', 'thumb-preview',
  'tracker', 'breakout-alerts', 'weekly-digest', 'niche-radar', 'own-history', 'own-revenue', 'own-milestones', 'api-retention-30d',
  // Phase 5: keyword ideas (6.6) and the optional providers (8.2).
  'keyword-ideas', 'provider-ryd', 'provider-socialblade', 'provider-dataforseo'
];

test('every feature in the plan is defined once, with TR/EN text, a known group and requirements', () => {
  const ids = F.FEATURES.map((f) => f.id);
  assert.deepEqual([...ids].sort(), [...PLAN_IDS].sort());
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const groups = F.GROUPS.map((g) => g.id);
  const REQ = ['apiKey', 'bridge', 'bridgeKey', 'oauth', 'tracker', 'providerKey'];
  for (const f of F.FEATURES) {
    assert.ok(groups.includes(f.group), f.id + ' group');
    for (const l of ['tr', 'en']) {
      assert.ok(f.label[l] && f.label[l].length > 2, f.id + ' label ' + l);
      assert.ok(f.desc[l] && f.desc[l].length > 10, f.id + ' desc ' + l);
    }
    assert.equal(typeof f.default, 'boolean', f.id);
    f.requires.concat(f.optional).forEach((r) => assert.ok(REQ.includes(r), f.id + ' needs ' + r));
    assert.ok(f.surface.length, f.id + ' surface');
    assert.ok(Number.isInteger(f.phase) && f.phase >= 0 && f.phase <= 5, f.id + ' phase');
  }
  for (const g of F.GROUPS) assert.ok(F.FEATURES.some((f) => f.group === g.id), 'group ' + g.id + ' has features');
});

test('defaults follow the plan and the user\'s decisions (section 10)', () => {
  const d = F.defaults();
  // Decided on: monetization checks, Return YouTube Dislike, revenue.
  assert.equal(d['channel-monetization'], true);
  assert.equal(d['video-monetization'], true);
  assert.equal(d.dislikes, true);
  assert.equal(d['own-revenue'], true);
  // Everything is kept: the 30-day purge stays off.
  assert.equal(d['api-retention-30d'], false);
  // Off in the plan's table.
  for (const id of ['hide-shorts', 'channel-rpm', 'niche-radar']) assert.equal(d[id], false, id);
  // Milestone notifications are optional (plan 3.2: "Bildirim isteğe bağlı").
  assert.equal(d['own-milestones'], false);
  // The rest start on.
  for (const id of PLAN_IDS.filter((x) => !['api-retention-30d', 'hide-shorts', 'channel-rpm', 'niche-radar', 'own-milestones', 'provider-ryd', 'provider-socialblade', 'provider-dataforseo'].includes(x))) assert.equal(d[id], true, id);
  // Phase 5: keyword ideas start on (no quota, rate-limited); every optional provider starts off (budget $0, plan 10).
  assert.equal(d['keyword-ideas'], true);
  for (const id of ['provider-ryd', 'provider-socialblade', 'provider-dataforseo']) assert.equal(d[id], false, id);
  assert.ok(F.get('provider-dataforseo').notes.includes('scraping'), 'DataForSEO is marked scraping-based');
  assert.ok(!F.get('provider-socialblade').notes.includes('scraping'));
  assert.ok(F.get('niche-radar').notes.includes('quota'));
  // The dislike feature credits its source.
  assert.equal(F.get('dislikes').link, 'https://returnyoutubedislike.com/');
  assert.ok(F.get('dislikes').notes.includes('thirdParty'));
  // Phase 0: the 30-day purge; phase 1: niche tracking, the Track button, growth, title history, breakouts, the digest;
  // phase 2: own-channel history; phase 3: the in-page badges and cards; phase 4: the content tools. The rest are "coming soon".
  assert.deepEqual(F.FEATURES.filter((f) => f.available).map((f) => f.id).sort(), [
    'card-vph', 'card-outlier', 'card-subs', 'card-velocity', 'feed-filters', 'hide-shorts', 'channel-sort',
    'channel-stats', 'channel-growth', 'channel-track', 'channel-monetization', 'channel-sponsors', 'video-card', 'video-monetization',
    'transcript-tools', 'comment-tools', 'frame-capture', 'title-history', 'swipe-save', 'dislikes',
    'shorts-overlay', 'thumb-compress', 'thumb-preview', 'tracker', 'breakout-alerts', 'weekly-digest', 'own-history', 'own-revenue', 'own-milestones', 'api-retention-30d']
    .concat(['channel-similar', 'channel-rpm', 'niche-radar', 'keyword-ideas', 'provider-ryd', 'provider-socialblade', 'provider-dataforseo']).sort());
  // Phase 5: nothing is "coming soon" any more.
  assert.deepEqual(F.FEATURES.filter((f) => !f.available).map((f) => f.id), [], 'every feature is built');
  // Subscriber counts work without a key (page data, saved channels); the key adds channels.list.
  assert.deepEqual(F.get('card-subs').requires, []);
  assert.ok(F.get('card-subs').optional.includes('apiKey'));
});

test('the outlier formula is a choice, not a switch: median by default, mean on request', () => {
  assert.deepEqual(F.CHOICES.outlierFormula.values, ['median', 'mean']);
  assert.equal(F.CHOICES.outlierFormula.feature, 'card-outlier');
  assert.equal(F.choiceOf('outlierFormula'), 'median');
  assert.equal(F.choiceOf('outlierFormula', 'mean'), 'mean');
  assert.equal(F.choiceOf('outlierFormula', 'mode'), 'median', 'unknown values fall back');
  assert.equal(F.choiceOf('nope', 'x'), null);
  for (const l of ['tr', 'en']) {
    assert.ok(F.CHOICES.outlierFormula.label[l] && F.CHOICES.outlierFormula.hint[l]);
    for (const v of F.CHOICES.outlierFormula.values) assert.ok(F.CHOICES.outlierFormula.options[v][l], v + ' ' + l);
  }
});

test('stored choices: unknown keys and non-booleans are dropped, missing keys fall back to the default', () => {
  const stored = { 'hide-shorts': true, tracker: false, 'no-such-feature': true, dislikes: 'yes', __proto__: { x: 1 } };
  assert.deepEqual(F.sanitize(stored), { 'hide-shorts': true, tracker: false });
  const r = F.resolve(stored);
  assert.equal(r['hide-shorts'], true);
  assert.equal(r.tracker, false);
  assert.equal(r.dislikes, true, 'a bad value falls back to the default');
  assert.equal(r['no-such-feature'], undefined);
  assert.equal(Object.keys(r).length, PLAN_IDS.length);
  assert.deepEqual(F.resolve(null), F.defaults());
  assert.deepEqual(F.resolve('garbage'), F.defaults());
  assert.equal(F.isOnIn('hide-shorts', stored), true);
  assert.equal(F.isOnIn('nope', stored), false);
});

test('missing requirements: direct, through the tracker, and unknown state is never reported', () => {
  const flags = F.defaults();
  // The sponsor scan reads the tracker's descriptions on the bridge (phase 4): the bridge, not a browser key.
  assert.deepEqual(F.missing('channel-sponsors', { apiKey: false, bridge: true }, flags), []);
  assert.deepEqual(F.missing('channel-sponsors', { bridge: false }, flags), ['bridge']);
  assert.deepEqual(F.missing('channel-sponsors', {}, flags), [], 'unknown is not missing');
  assert.deepEqual(F.missing('card-subs', { apiKey: false }, flags), [], 'optional: works on page data and saved channels');
  assert.deepEqual(F.missing('tracker', { bridge: true, bridgeKey: false }, flags), ['bridgeKey']);
  // A feature that needs the tracker inherits what the tracker misses…
  assert.deepEqual(F.missing('card-velocity', { bridge: false, bridgeKey: false }, flags), ['bridge', 'bridgeKey']);
  // …or says the tracker is off.
  assert.deepEqual(F.missing('card-velocity', { bridge: true, bridgeKey: true }, { ...flags, tracker: false }), ['tracker']);
  assert.deepEqual(F.missing('own-history', { bridge: true, oauth: false }, flags), ['oauth']);
  assert.deepEqual(F.missing('card-vph', { apiKey: false, bridge: false }, flags), []);
  assert.deepEqual(F.missing('nope', {}, flags), []);
});

test('language: a saved choice, then ?hl=, then the page or Chrome language', () => {
  assert.equal(F.lang('tr'), 'tr');
  assert.equal(F.lang('en'), 'en');
  const ctx = (search, docLang, nav, protocol = 'https:') => {
    const sandbox = { self: { location: { search, protocol }, document: { documentElement: { lang: docLang } }, navigator: { language: nav } }, URLSearchParams, Promise, Object, Array, JSON, console };
    vm.runInNewContext(readFileSync(join(__dirname, '..', 'src', 'features.js'), 'utf8'), sandbox);
    return sandbox.self.OpenOutlierFeatures;
  };
  assert.equal(ctx('?hl=tr', 'en', 'en-US').lang(), 'tr');
  assert.equal(ctx('', 'tr-TR', 'en-US').lang(), 'tr', 'YouTube in Turkish');
  assert.equal(ctx('', 'en', 'tr-TR', 'chrome-extension:').lang(), 'tr', 'extension pages follow Chrome');
  assert.equal(ctx('', 'en', 'tr-TR').lang(), 'en', 'a content page follows the page');
  assert.equal(ctx('', '', 'de-DE', 'chrome-extension:').lang(), 'en');
});

/** src/features.js in a sandbox with a fake chrome.storage that fires onChanged like Chrome does. */
function browser(initial = {}) {
  const local = JSON.parse(JSON.stringify(initial));
  const listeners = [];
  const chrome = {
    storage: {
      local: {
        get: async (k) => { const out = {}; for (const x of [].concat(k)) if (x in local) out[x] = JSON.parse(JSON.stringify(local[x])); return out; },
        set: async (o) => {
          const changes = {};
          for (const [k, v] of Object.entries(o)) { changes[k] = { oldValue: local[k], newValue: JSON.parse(JSON.stringify(v)) }; local[k] = JSON.parse(JSON.stringify(v)); }
          setTimeout(() => listeners.forEach((fn) => fn(changes, 'local')), 0);
        }
      },
      onChanged: { addListener: (fn) => listeners.push(fn) }
    }
  };
  const sandbox = { self: { chrome, location: { search: '', protocol: 'chrome-extension:' }, navigator: { language: 'en-US' } }, URLSearchParams, Promise, Object, Array, JSON, console, setTimeout };
  vm.runInNewContext(readFileSync(join(__dirname, '..', 'src', 'features.js'), 'utf8'), sandbox);
  return { F: sandbox.self.OpenOutlierFeatures, local, chrome };
}

test('browser: isOn reads rs:settings.features, set() stores only the choice, onChange fires without a reload', async () => {
  const { F: B, local, chrome } = browser({ 'rs:settings': { agentBridge: true, features: { 'hide-shorts': true, bogus: true } } });
  assert.equal(B.isOn('hide-shorts'), false, 'defaults until storage has loaded');
  await B.ready;
  assert.equal(B.isOn('hide-shorts'), true);
  assert.equal(B.isOn('tracker'), true);
  assert.equal(B.isOn('bogus'), false);

  const seen = [];
  const off = B.onChange((changed, flags) => seen.push({ changed: [...changed], tracker: flags.tracker }));
  await B.set('tracker', false);
  assert.equal(B.isOn('tracker'), false);
  assert.deepEqual({ ...local['rs:settings'].features }, { 'hide-shorts': true, tracker: false }, 'unknown keys are cleaned out on write');
  assert.equal(local['rs:settings'].agentBridge, true, 'other settings are kept');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, [{ changed: [], tracker: false }], 'already applied by set(); listeners still hear about it');

  // A change from another page (the Library, another tab) reaches this one.
  await chrome.storage.local.set({ 'rs:settings': { features: { dislikes: false } } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(B.isOn('dislikes'), false);
  assert.equal(B.isOn('tracker'), true, 'back to the default once the choice is gone');
  assert.deepEqual(seen[1].changed.sort(), ['dislikes', 'hide-shorts', 'tracker']);

  off();
  await B.reset();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen.length, 2, 'unsubscribed');
  assert.equal(local['rs:settings'].features, undefined);
  assert.deepEqual({ ...B.flags() }, { ...B.defaults() });
  assert.equal(await B.set('nope', true), false);
});

test('browser: the outlier formula is stored in rs:settings, reaches other pages and goes back with reset()', async () => {
  const { F: B, local, chrome } = browser({ 'rs:settings': { outlierFormula: 'bogus' } });
  await B.ready;
  assert.equal(B.choice('outlierFormula'), 'median', 'a bad stored value means the default');
  const seen = [];
  B.onChange((changed) => seen.push([...changed]));
  assert.equal(await B.setChoice('outlierFormula', 'mean'), true);
  assert.equal(B.choice('outlierFormula'), 'mean');
  assert.equal(local['rs:settings'].outlierFormula, 'mean');
  assert.equal(await B.setChoice('outlierFormula', 'mode'), false);
  assert.equal(await B.setChoice('nope', 'mean'), false);
  await chrome.storage.local.set({ 'rs:settings': Object.assign({}, local['rs:settings'], { outlierFormula: 'median' }) });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(B.choice('outlierFormula'), 'median');
  assert.ok(seen.some((c) => c.includes('outlierFormula')), 'listeners hear which choice changed');
  await B.setChoice('outlierFormula', 'mean');
  await B.reset();
  assert.equal(B.choice('outlierFormula'), 'median');
  assert.equal(local['rs:settings'].outlierFormula, undefined);
});

test('browser: two quick switches are both kept (writes go one at a time)', async () => {
  const { F: B, local } = browser({ 'rs:settings': {} });
  await B.ready;
  await Promise.all([B.set('card-vph', false), B.set('dislikes', false), B.setChoice('outlierFormula', 'mean'), B.set('hide-shorts', true)]);
  assert.deepEqual({ ...local['rs:settings'].features }, { 'card-vph': false, dislikes: false, 'hide-shorts': true });
  assert.equal(local['rs:settings'].outlierFormula, 'mean');
});

test('browser: env() says what is set up, from the popup key and the bridge state', async () => {
  const key = 'AIza' + 'x'.repeat(35);
  const none = browser({});
  assert.deepEqual({ ...(await none.F.env()) }, { apiKey: false, bridge: false, bridgeKey: undefined, oauth: undefined, providers: undefined, bridgeSettings: false });
  // No bridge: only "bridge" is reported missing, not its key as well.
  assert.deepEqual([...none.F.missing('tracker', await none.F.env(), none.F.defaults())], ['bridge']);
  const older = browser({ 'rs:settings': { youtubeApiKey: key }, 'rs:bridge': { connected: true } });
  const e1 = await older.F.env();
  assert.equal(e1.apiKey, true);
  assert.equal(e1.bridge, true);
  assert.equal(e1.bridgeKey, undefined, 'an older bridge does not report its key');
  const full = browser({ 'rs:settings': { youtubeApiKey: key }, 'rs:bridge': { connected: true, bridgeApiKey: true, oauthConnected: false, settingsAt: 1 } });
  const e2 = await full.F.env();
  assert.equal(e2.bridgeKey, true);
  assert.equal(e2.oauth, false);
  const offSwitch = browser({ 'rs:settings': { agentBridge: false }, 'rs:bridge': { connected: true, bridgeApiKey: true } });
  assert.equal((await offSwitch.F.env()).bridge, false, '"Save to this Mac" off means no bridge');
});

test('phase 5: a provider\'s missing key is reported only when the bridge says so', () => {
  const flags = F.resolve({ 'provider-socialblade': true, 'provider-dataforseo': true });
  assert.deepEqual(F.missing('provider-socialblade', { bridge: true }, flags), [], 'unknown provider state: nothing reported');
  assert.deepEqual(F.missing('provider-socialblade', { bridge: true, providers: { socialblade: { configured: false } } }, flags), ['providerKey']);
  assert.deepEqual(F.missing('provider-dataforseo', { bridge: true, providers: { dataforseo: { configured: true } } }, flags), []);
  assert.deepEqual(F.missing('provider-ryd', { bridge: true, providers: { ryd: { configured: true } } }, flags), []);
  assert.deepEqual(F.missing('niche-radar', { bridge: true, bridgeKey: false }, F.resolve({ 'niche-radar': true })), ['bridgeKey']);
});
