// OpenOutlier – optional third-party providers (docs/youtube-niche-plan.md 8.2, phase 5).
//
// Every provider is off by default and makes no request unless the user turns its switch on in
// the Features tab (`provider-<id>`, src/features.js) AND, where it needs one, adds a key. The
// budget decision is $0 (plan section 10): this is plumbing for later, not something that runs.
//
// Keys live in ~/.openoutlier/providers.json, mode 600, written atomically. The file is outside
// the database, so the daily backup (mcp/backup.mjs copies the database only) never includes it,
// and no answer from the bridge ever echoes a key back (status() says only whether one is set).
//
// Scraping-based providers (DataForSEO's YouTube results come from scraping YouTube) are marked
// `scraping: true`; the UI says so next to the switch (plan 8: YouTube API policy §III.E.6).
import { readFileSync, writeFileSync, renameSync, chmodSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { HOME } from '../library.mjs';

const Features = createRequire(import.meta.url)('../../src/features.js');

export const FILE_NAME = 'providers.json';
/** What each provider is and what its key looks like (fields: the parts of the key, all required). */
export const PROVIDERS = {
  ryd: { id: 'ryd', feature: 'provider-ryd', name: 'Return YouTube Dislike', fields: [], scraping: false, site: 'https://returnyoutubedislike.com/',
    cost: { en: 'Free (100 requests a minute per client)', tr: 'Bedava (istemci başına dakikada 100 istek)' } },
  socialblade: { id: 'socialblade', feature: 'provider-socialblade', name: 'Social Blade Business API', fields: ['clientId', 'token'], scraping: false, site: 'https://socialblade.com/business-api',
    cost: { en: 'Prepaid credits: 1 per channel for 30 days of history, 2 for a year, 3 for 3 years (100 credits ≈ $50)', tr: 'Önceden ödenen kredi: kanal başına 30 günlük geçmiş 1, bir yıl 2, 3 yıl 3 kredi (100 kredi ≈ $50)' } },
  dataforseo: { id: 'dataforseo', feature: 'provider-dataforseo', name: 'DataForSEO (YouTube SERP)', fields: ['login', 'password'], scraping: true, site: 'https://dataforseo.com/apis/serp-api/youtube-serp-api',
    cost: { en: 'Pay as you go: about $0.002 per keyword check (live mode); $50 minimum top-up that doesn\'t expire', tr: 'Kullandıkça öde: kelime kontrolü başına yaklaşık $0,002 (canlı mod); en az $50 yüklenir, süresi dolmaz' } }
};

export function providersFile(home = HOME) { return join(home, FILE_NAME); }

/** The whole file ({ id: { field: value } }); {} when there is none or it is unreadable. Re-tightens a loose mode. */
export function readKeys(home = HOME) {
  const f = providersFile(home);
  try {
    const st = statSync(f);
    if (st.mode & 0o077) { try { chmodSync(f, 0o600); } catch { /* ignore */ } }
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}

function writeKeys(all, home) {
  mkdirSync(home, { recursive: true });
  const f = providersFile(home);
  const tmp = f + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(all, null, 1) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, f);
}

/** A provider's key ({ field: value }) or null when it isn't complete. */
export function keyOf(id, home = HOME) {
  const p = PROVIDERS[id];
  if (!p || !p.fields.length) return null;
  const k = readKeys(home)[id];
  if (!k || typeof k !== 'object') return null;
  return p.fields.every((f) => typeof k[f] === 'string' && k[f].length) ? k : null;
}

/** Store a key. value: { field: string } with every field the provider needs. → { ok } | { ok: false, error } */
export function saveKey(id, value, home = HOME) {
  const p = PROVIDERS[id];
  if (!p) return { ok: false, error: 'Unknown provider.' };
  if (!p.fields.length) return { ok: false, error: `${p.name} needs no key.` };
  const v = {};
  for (const f of p.fields) {
    const s = value && typeof value[f] === 'string' ? value[f].trim() : '';
    if (!s || s.length > 300 || /[\s"\\]/.test(s)) return { ok: false, error: `${p.name}: "${f}" is missing or not valid.` };
    v[f] = s;
  }
  const all = readKeys(home);
  all[id] = v;
  writeKeys(all, home);
  return { ok: true };
}
export function removeKey(id, home = HOME) {
  const all = readKeys(home);
  if (!(id in all)) return { ok: true, removed: false };
  delete all[id];
  writeKeys(all, home);
  return { ok: true, removed: true };
}

const flagsOf = (store) => Features.resolve(store.getMeta('features', null));

/** Whether a provider may make requests now: its switch is on and (if it needs one) its key is set. */
export function ready(store, id, home = HOME) {
  const p = PROVIDERS[id];
  if (!p || !flagsOf(store)[p.feature]) return false;
  return !p.fields.length || !!keyOf(id, home);
}

/** For the Features tab and bridge_status: never the key itself. */
export function status(store, home = HOME) {
  const flags = flagsOf(store);
  const out = {};
  for (const p of Object.values(PROVIDERS)) {
    out[p.id] = { name: p.name, on: !!flags[p.feature], needs_key: p.fields.length > 0, configured: p.fields.length ? !!keyOf(p.id, home) : true, scraping: p.scraping, fields: p.fields, site: p.site, cost: p.cost };
  }
  return out;
}

/** A provider's calls, for its cost log (credits or USD as that provider counts them). */
export function logCall(store, provider, ref, cost, detail, now = Date.now()) {
  store.db.prepare('INSERT OR REPLACE INTO provider_log (provider, ref, at, cost, detail) VALUES (?, ?, ?, ?, ?)')
    .run(provider, String(ref).slice(0, 200), now, cost ?? null, detail == null ? null : String(detail).slice(0, 500));
}
