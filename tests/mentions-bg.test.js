// Runs the real service-worker Mentions checker (src/mentions-bg.js) in a VM
// with a fake chrome.* API, fake reddit.com responses and a fake reddit-watch server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

function atom(entries) {
  return '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>search</title>' + entries.map((e) =>
    `<entry><author><name>/u/${e.author}</name></author><category term="${e.sub}" label="r/${e.sub}"/><content type="html">${e.html}</content>` +
    `<id>${e.id}</id><link href="https://www.reddit.com/r/${e.sub}/comments/${e.id.slice(3)}/x/"/><updated>${new Date(Date.now() - 120000).toISOString()}</updated><title>${e.title}</title></entry>`).join('') + '</feed>';
}
const post = (id, title, sub = 'excel', html = '') => ({ id: 't3_' + id, author: 'a_' + id, sub, title, html });
const comment = (id, text, sub = 'excel') => ({ id: 't1_' + id, author: 'c_' + id, sub, title: `/u/c_${id} on Some thread`, html: `&lt;p&gt;${text}&lt;/p&gt;` });

/** Let the alarm-driven queue run to the end (as if each 61 s alarm had fired). */
async function drain(env) {
  for (let i = 0; i < 20 && (env.store['rs:mentions-state'].rssQueue || []).length; i++) {
    env.store['rs:mentions-state'].rssNextAt = Date.now() - 1;
    await env.bg.pumpRss();
  }
}

/** Build a sandbox. reddit(path) → { status, body }; server(method, url, body) → { status, body } | throws. */
function setup({ storage = {}, reddit, server, granted = true, tab = null, inject = null, existingAlarms = {} } = {}) {
  const store = JSON.parse(JSON.stringify(storage));
  const notifications = [];
  const requests = [];
  const alarms = { ...existingAlarms };
  const alarmCreates = [];
  const listeners = { message: [], changed: [] };
  const chrome = {
    runtime: { id: 'me', getURL: (p) => 'chrome-extension://me/' + p, onMessage: { addListener: (f) => listeners.message.push(f) }, onStartup: { addListener() {} } },
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); });
          return out;
        },
        set: async (o) => { Object.keys(o).forEach((k) => { store[k] = JSON.parse(JSON.stringify(o[k])); }); }
      },
      onChanged: { addListener: (f) => listeners.changed.push(f) }
    },
    alarms: { create: (name, o) => { alarms[name] = o; alarmCreates.push(name); }, get: async (name) => alarms[name], clear: (name) => { delete alarms[name]; }, onAlarm: { addListener() {} } },
    tabs: { query: async () => (tab ? [tab] : []), create() {} },
    scripting: { executeScript: async (o) => inject(o) },
    notifications: { create: (id, o) => notifications.push(o), onClicked: { addListener() {} }, clear() {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    permissions: { contains: async () => granted }
  };
  async function fakeFetch(url, init = {}) {
    requests.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body, signal: init.signal });
    let r;
    if (url.startsWith('https://www.reddit.com/')) r = reddit(url.slice('https://www.reddit.com'.length));
    else r = server(init.method || 'GET', url, init.body && JSON.parse(init.body), init.headers || {});
    const hdrs = r.headers || {};
    return { status: r.status || 200, ok: (r.status || 200) < 300, headers: { get: (n) => (n in hdrs ? String(hdrs[n]) : null) }, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  }
  const sandbox = {
    chrome, fetch: fakeFetch, console, URL, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp, Error,
    AbortSignal: { timeout: (ms) => ({ timeoutMs: ms }) },
    setTimeout: (fn) => setImmediate(fn), clearTimeout() {}
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC('mentions.js'), sandbox);
  vm.runInContext(SRC('mentions-bg.js'), sandbox);
  return { bg: sandbox.ReelScopeMentionsBg, store, notifications, requests, alarms, alarmCreates };
}

const WATCHES = [
  { id: 'w1', query: '"excel formula"', subreddits: ['excel'], exclude: ['hiring'], kinds: ['posts', 'comments'], enabled: true },
  { id: 'w2', query: 'handsonexcel', subreddits: [], exclude: [], kinds: ['posts'], enabled: true }
];

function feeds(p) {
  if (p.startsWith('/r/excel/search.rss')) return { body: atom([post('p1', 'Excel formula help'), post('p2', 'Excel formula job, hiring now'), post('p3', 'Nothing here')]) };
  if (p.startsWith('/r/excel/comments/.rss')) return { body: atom([comment('c1', 'use an Excel formula with LET'), comment('c2', 'unrelated')]) };
  if (p.startsWith('/search.rss?q=handsonexcel')) return { body: atom([post('p9', 'handsonexcel reels are great', 'learnexcel')]) };
  return { status: 404, body: '' };
}

test('a check uses only RSS feeds, one a minute, and stores matches once', async () => {
  const env = setup({ storage: { 'rs:watches': WATCHES }, reddit: feeds });
  const r = await env.bg.runCheck({ manual: true });
  assert.equal(r.jobs, 3);
  assert.equal(r.sent, 1, 'only the first feed right away');
  assert.equal(env.store['rs:mentions-state'].rssQueue.length, 2);
  assert.ok(env.alarms['reelscope-mentions-rss'].when >= Date.now() + 59000, 'next feed ≥ 60 s later');
  assert.equal((await env.bg.pumpRss()).sent, 0, 'nothing before the minute is up');
  await drain(env);
  const urls = env.requests.map((q) => q.url);
  assert.ok(urls.every((u) => /\.rss/.test(u) && !/\.json/.test(u)), 'no .json requests: ' + urls.join(' '));
  assert.ok(urls.includes('https://www.reddit.com/r/excel/search.rss?q=%22excel%20formula%22&restrict_sr=1&sort=new&limit=100'));
  assert.ok(urls.includes('https://www.reddit.com/r/excel/comments/.rss?limit=100'));
  assert.ok(env.requests.every((q) => q.method === 'GET'), 'read-only');
  assert.deepEqual(Object.keys(env.store['rs:mentions'].items).sort(), ['t1_c1', 't3_p1', 't3_p9']);
  const m = env.store['rs:mentions'].items.t3_p1;
  assert.equal(m.source, 'extension');
  assert.equal(m.watchId, 'w1');
  assert.equal(m.score, null);
  assert.equal(m.permalink, 'https://www.reddit.com/r/excel/comments/p1/x/');
  assert.equal(env.store['rs:mentions'].items.t1_c1.title, 'Some thread');
  assert.equal(env.notifications.length, 3, 'one notification per feed with new matches');
  const st = env.store['rs:mentions-state'];
  assert.equal(st.lastError, null);
  assert.equal(st.via, 'direct');

  // The next cycle finds the same items: nothing new, no notification.
  await env.bg.runCheck({});
  await drain(env);
  assert.equal(env.notifications.length, 3);
  assert.equal(Object.keys(env.store['rs:mentions'].items).length, 3);
});

test('queue: no duplicates, removed watches drop their feeds, a stale JSON-era error is cleared', async () => {
  const env = setup({
    storage: { 'rs:watches': WATCHES, 'rs:mentions-state': { lastError: 'Reddit refused the request (HTTP 403). Log in to reddit.com in this browser.', rssNextAt: Date.now() + 50000, rssQueue: [{ key: 'posts:/old', rssPath: '/old.rss', watchIds: ['gone'] }] } },
    reddit: feeds
  });
  await env.bg.runCheck({});
  let st = env.store['rs:mentions-state'];
  assert.equal(st.lastError, null);
  assert.deepEqual(st.rssQueue.map((q) => q.key.split(':')[0]), ['posts', 'comments', 'posts']);
  assert.equal(env.requests.length, 0, 'still inside the 61 s gap');
  await env.bg.runCheck({});
  assert.equal(env.store['rs:mentions-state'].rssQueue.length, 3, 'a second check does not queue the same feeds twice');
});

test('429 waits two minutes and retries the same feed; refused feeds back off', async () => {
  let calls = 0;
  const env = setup({ storage: { 'rs:watches': [WATCHES[1]] }, reddit: () => { calls++; return calls === 1 ? { status: 429, body: '' } : feeds('/search.rss?q=handsonexcel'); } });
  await env.bg.runCheck({ manual: true });
  let st = env.store['rs:mentions-state'];
  assert.equal(st.rssQueue.length, 1, 'kept in the queue');
  assert.ok(st.rssNextAt >= Date.now() + 119000);
  await drain(env);
  assert.ok(env.store['rs:mentions'].items.t3_p9);

  const blocked = setup({ storage: { 'rs:watches': WATCHES }, reddit: () => ({ status: 403, body: '<html>no</html>' }) });
  await blocked.bg.runCheck({ manual: true });
  st = blocked.store['rs:mentions-state'];
  assert.match(st.lastError, /refused its RSS feeds/);
  assert.doesNotMatch(st.lastError, /log in/i);
  assert.ok(st.backoffUntil > Date.now());
  assert.equal(st.rssQueue.length, 0);
  // An alarm-driven check during the backoff makes no Reddit request.
  assert.equal((await blocked.bg.runCheck({})).skipped, 'backoff');
  assert.equal(blocked.requests.length, 1);
});

test('an HTML page instead of a feed counts as refused', async () => {
  const env = setup({ storage: { 'rs:watches': [WATCHES[1]] }, reddit: () => ({ status: 200, body: '<!doctype html><html>blocked</html>' }) });
  await env.bg.runCheck({ manual: true });
  assert.match(env.store['rs:mentions-state'].lastError, /refused/);
});

test('uses the open reddit.com tab through chrome.scripting, falls back when it cannot', async () => {
  const injected = [];
  const viaTab = setup({
    storage: { 'rs:watches': [WATCHES[1]] },
    tab: { id: 7, status: 'complete' },
    inject: async (o) => { injected.push(o); return [{ result: { status: 200, text: atom([post('p9', 'handsonexcel rocks', 'learnexcel')]) } }]; },
    reddit: () => { throw new Error('direct fetch must not be used'); }
  });
  const r = await viaTab.bg.runCheck({ manual: true });
  assert.equal(r.new, 1);
  assert.equal(injected[0].target.tabId, 7);
  assert.match(injected[0].args[0], /^\/search\.rss\?q=handsonexcel/);
  assert.equal(viaTab.store['rs:mentions-state'].via, 'tab');

  const broken = setup({
    storage: { 'rs:watches': [WATCHES[1]] },
    tab: { id: 8, status: 'complete' },
    inject: async () => { throw new Error('Cannot access contents of the page'); },
    reddit: () => ({ body: atom([post('p9', 'handsonexcel rocks', 'learnexcel')]) })
  });
  const r2 = await broken.bg.runCheck({ manual: true });
  assert.equal(r2.new, 1);
  assert.equal(broken.store['rs:mentions-state'].via, 'direct');
  assert.match(broken.store['rs:mentions-state'].tabProblem, /Reload that tab/);
});

test('home server: health, push watches, pull and merge mentions (dedupe by id)', async () => {
  const pushed = [];
  let serverLost = false;
  const serverMentions = [
    { id: 't3_p1', kind: 'post', watchId: 'w1', query: '"excel formula"', title: 'Excel formula help', excerpt: '', subreddit: 'excel', author: 'x', permalink: 'https://www.reddit.com/r/excel/comments/p1/x/', createdAt: Date.now() - 60000, score: 3, foundAt: Date.now() - 1000, source: 'hayati', notify: true },
    { id: 't1_s1', kind: 'comment', watchId: 'w1', query: '"excel formula"', title: 'Thread', excerpt: 'an excel formula', subreddit: 'excel', author: 'y', permalink: 'https://www.reddit.com/r/excel/comments/q/x/s1/', createdAt: Date.now() - 60000, score: 1, foundAt: Date.now() - 500, source: 'hayati' }
  ];
  const env = setup({
    storage: { 'rs:watches': WATCHES, 'rs:mention-server': { enabled: true, baseUrl: 'http://100.64.0.5:8787/', token: 'secret' } },
    reddit: feeds,
    server: (method, url, body, headers) => {
      assert.equal(headers.authorization, 'Bearer secret');
      const u = new URL(url);
      if (u.pathname === '/health') return { body: { app: 'reddit-watch', version: '0.1.0' } };
      if (method === 'PUT' && u.pathname === '/watches') { pushed.push(body); return { body }; }
      if (method === 'GET' && u.pathname === '/watches') return { body: serverLost ? [] : pushed[pushed.length - 1] || [] };
      if (u.pathname === '/mentions') { assert.ok(Number(u.searchParams.get('since')) > 0); return { body: serverMentions }; }
      return { status: 404, body: {} };
    }
  });
  const r = await env.bg.runCheck({ manual: true });
  assert.equal(r.new, 1, 't3_p1 from the first feed');
  assert.equal(r.fromServer, 1, 't3_p1 was already found locally; only t1_s1 is new');
  assert.equal(pushed.length, 1);
  assert.deepEqual(pushed[0].map((w) => w.id), ['w1', 'w2']);
  const items = env.store['rs:mentions'].items;
  assert.equal(items.t3_p1.source, 'extension');
  assert.equal(items.t1_s1.source, 'hayati');
  assert.equal(items.t1_s1.notify, undefined, 'only the shared fields are stored');
  const srv = env.store['rs:mentions-state'].server;
  assert.equal(srv.lastError, null);
  assert.equal(srv.version, '0.1.0');

  // Next cycle: watches unchanged → not pushed again; pull continues from the newest foundAt.
  await env.bg.runCheck({});
  assert.equal(pushed.length, 1);
  const pulls = env.requests.filter((q) => q.url.includes('/mentions?since='));
  assert.equal(Number(new URL(pulls[1].url).searchParams.get('since')), Math.max(...serverMentions.map((m) => m.foundAt)) - 1, 'since = newest foundAt − 1 ms');

  // The server lost its watch list (reinstall): it gets the list again.
  serverLost = true;
  await env.bg.runCheck({});
  assert.equal(pushed.length, 2);
});

test('server mentions are coerced to the shared types and unsafe links dropped', async () => {
  const env = setup({
    storage: { 'rs:watches': WATCHES, 'rs:mention-server': { enabled: true, baseUrl: 'http://100.64.0.5:8787', token: 't' } },
    reddit: () => ({ body: atom([]) }),
    server: (method, url) => {
      const u = new URL(url);
      if (u.pathname === '/health') return { body: { app: 'reddit-watch' } };
      if (u.pathname === '/watches') return { body: WATCHES };
      return { body: [
        { id: 't3_iso1', kind: 'post', watchId: 'w1', query: 'q', title: 'ISO dates', createdAt: '2026-11-09T10:00:00Z', foundAt: String(Date.now() - 1000), score: '12', permalink: 'javascript:alert(1)' },
        { id: 't1_ok1', kind: 'comment', watchId: 'w1', query: 'q', createdAt: Date.now() - 5000, foundAt: Date.now() - 900, score: 'n/a', permalink: 'https://old.reddit.com/r/excel/comments/a/b/ok1/' }
      ] };
    }
  });
  await env.bg.runCheck({ manual: true });
  const items = env.store['rs:mentions'].items;
  assert.equal(items.t3_iso1.createdAt, Date.parse('2026-11-09T10:00:00Z'));
  assert.equal(typeof items.t3_iso1.foundAt, 'number');
  assert.equal(items.t3_iso1.score, 12);
  assert.equal(items.t3_iso1.permalink, null, 'javascript: link dropped');
  assert.equal(items.t1_ok1.score, null);
  assert.equal(items.t1_ok1.permalink, 'https://old.reddit.com/r/excel/comments/a/b/ok1/');
});

test('server down or not permitted: the extension keeps working on its own', async () => {
  const down = setup({
    storage: { 'rs:watches': WATCHES, 'rs:mention-server': { enabled: true, baseUrl: 'http://100.64.0.5:8787', token: 't' } },
    reddit: feeds,
    server: () => { throw new Error('connect ECONNREFUSED'); }
  });
  const r = await down.bg.runCheck({ manual: true });
  assert.equal(r.new, 1);
  assert.match(down.store['rs:mentions-state'].server.lastError, /ECONNREFUSED/);

  const noPerm = setup({
    storage: { 'rs:watches': WATCHES, 'rs:mention-server': { enabled: true, baseUrl: 'http://100.64.0.5:8787', token: 't' } },
    granted: false, reddit: feeds,
    server: () => { throw new Error('must not be called'); }
  });
  await noPerm.bg.runCheck({ manual: true });
  assert.match(noPerm.store['rs:mentions-state'].server.lastError, /no permission/);

  const off = setup({ storage: { 'rs:watches': WATCHES, 'rs:mention-server': { enabled: false, baseUrl: 'http://x', token: 't' } }, reddit: feeds, server: () => { throw new Error('must not be called'); } });
  await off.bg.runCheck({ manual: true });
  assert.equal(off.requests.filter((q) => !q.url.startsWith('https://www.reddit.com')).length, 0);
});

test('the 15-minute alarm is created only when missing (a worker restart keeps the schedule)', async () => {
  const fresh = setup({ storage: {}, reddit: feeds });
  await new Promise((r) => setImmediate(r));
  assert.equal(fresh.alarms['reelscope-mentions'].periodInMinutes, 15);
  const restarted = setup({ storage: {}, reddit: feeds, existingAlarms: { 'reelscope-mentions': { periodInMinutes: 15, scheduledTime: Date.now() + 600000 } } });
  await new Promise((r) => setImmediate(r));
  assert.ok(!restarted.alarmCreates.includes('reelscope-mentions'));
});

test('429: growing wait, Retry-After honoured, the failing feed goes behind the healthy ones', async () => {
  let n = 0;
  const env = setup({
    storage: { 'rs:watches': WATCHES },
    reddit: (p) => {
      if (p.startsWith('/r/excel/search.rss')) { n++; return n <= 2 ? { status: 429, body: '', headers: n === 2 ? { 'retry-after': 600 } : {} } : feeds(p); }
      return feeds(p);
    }
  });
  await env.bg.runCheck({ manual: true });
  let st = env.store['rs:mentions-state'];
  assert.deepEqual(st.rssQueue.map((q) => q.key.split(':')[0]), ['comments', 'posts', 'posts'], 'search feed moved to the back');
  assert.equal(st.rssQueue[2].rssPath.startsWith('/r/excel/search.rss'), true);
  assert.equal(st.strikes, 1);
  assert.ok(st.rssNextAt >= Date.now() + 119000 && st.rssNextAt <= Date.now() + 125000, 'first 429: ~2 min');
  assert.ok(st.backoffUntil >= st.rssNextAt - 5);
  assert.match(st.lastError, /429/);
  // The healthy feeds go next.
  st.rssNextAt = Date.now() - 1;
  await env.bg.pumpRss();
  st = env.store['rs:mentions-state'];
  assert.equal(st.strikes, 0, 'a good request resets the strikes');
  assert.ok(env.store['rs:mentions'].items.t1_c1);
  env.store['rs:mentions-state'].rssNextAt = Date.now() - 1;
  await env.bg.pumpRss(); // handsonexcel
  env.store['rs:mentions-state'].rssNextAt = Date.now() - 1;
  await env.bg.pumpRss(); // search again → 429 with Retry-After: 600
  st = env.store['rs:mentions-state'];
  assert.ok(st.rssNextAt >= Date.now() + 599000, 'Retry-After 600 s honoured');
  // An empty x-ratelimit-remaining after a good response waits for the reset too.
  const slow = setup({ storage: { 'rs:watches': [WATCHES[1]] }, reddit: (p) => ({ ...feeds(p), headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '90' } }) });
  await slow.bg.runCheck({ manual: true });
  assert.ok(slow.store['rs:mentions-state'].rssNextAt >= Date.now() + 90000);
});

test('queue changes are serialized: a check and the pump running together lose nothing', async () => {
  const env = setup({ storage: { 'rs:watches': WATCHES }, reddit: feeds });
  await env.bg.runCheck({ manual: true }); // 1 sent, 2 queued
  env.store['rs:mentions-state'].rssNextAt = Date.now() - 1;
  await Promise.all([env.bg.pumpRss(), env.bg.runCheck({}), env.bg.pumpRss()]);
  const keys = env.store['rs:mentions-state'].rssQueue.map((q) => q.key);
  assert.equal(new Set(keys).size, keys.length, 'no duplicates');
  // The pump sent exactly one more feed (the second waits for the gap); the check re-queued everything else.
  assert.equal(env.requests.length, 2);
  assert.equal(keys.length, 3);
});

test('Reddit requests carry a 20 s timeout', async () => {
  const env = setup({ storage: { 'rs:watches': [WATCHES[1]] }, reddit: feeds });
  await env.bg.runCheck({ manual: true });
  assert.deepEqual(env.requests[0].signal, { timeoutMs: 20000 });
});
