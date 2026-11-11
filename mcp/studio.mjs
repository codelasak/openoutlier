// OpenOutlier MCP – "My account": the user's own Instagram account through their
// self-hosted chatmany worker (official Instagram API). Insights, comment → DM
// automations, and publishing or scheduling reels, posts and stories.
//
// Unlike the rest of this server, these tools leave the computer: they call the
// worker the user configured, with its owner token, and the write tools change
// what runs and what gets posted on their Instagram account.
//
// Settings: OPENOUTLIER_CHATMANY_URL + OPENOUTLIER_CHATMANY_TOKEN, or the file
// <home>/chatmany.json = { "baseUrl": "https://…workers.dev", "token": "…" }.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { resolveHome, setting } from './env.mjs';

const require = createRequire(import.meta.url);
export const S = require('../src/studio.js');
const run = promisify(execFile);

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };
const STATS_DAYS = 3650;

export const CONFIG_FILE = join(resolveHome(), 'chatmany.json');

/** { baseUrl, token }, or throws with how to set it up. */
export function loadConfig() {
  let baseUrl = setting('CHATMANY_URL');
  let token = setting('CHATMANY_TOKEN');
  if ((!baseUrl || !token) && existsSync(CONFIG_FILE)) {
    try {
      const f = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
      baseUrl = baseUrl || f.baseUrl;
      token = token || f.token;
    } catch (e) {
      throw new Error(`${CONFIG_FILE} is not valid JSON: ${e.message}`);
    }
  }
  const res = S.normalizeServer({ baseUrl, token });
  if (res.error) {
    throw new Error(`My account is not set up for this MCP server. Create ${CONFIG_FILE} with {"baseUrl": "https://<your chatmany worker>", "token": "<its OWNER_TOKEN>"} (or set OPENOUTLIER_CHATMANY_URL and OPENOUTLIER_CHATMANY_TOKEN), then restart the server.`);
  }
  return { baseUrl: res.baseUrl, token: res.token };
}

async function call(cfg, path, init) {
  let res;
  try {
    res = await fetch(cfg.baseUrl + path, { ...init, headers: { authorization: 'Bearer ' + cfg.token, ...(init && init.headers) }, signal: AbortSignal.timeout(init && init.timeout || 60000) });
  } catch (e) {
    throw new Error(`Could not reach ${cfg.baseUrl} (${e.message}).`);
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401) throw new Error('The chatmany worker did not accept the owner token.');
  if (!res.ok) throw new Error((body && body.error) || `The chatmany worker answered HTTP ${res.status}.`);
  return body || {};
}
const get = (cfg, path) => call(cfg, path);
const post = (cfg, path, body) => call(cfg, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const iso = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : null);
const oneLine = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---- reads ---------------------------------------------------------------------
export async function account(cfg, { days = 7 } = {}) {
  const st = await get(cfg, '/api/status');
  if (!st.connected) return { connected: false, note: 'The chatmany worker has no Instagram account connected. Open it in the browser and choose Connect Instagram.' };
  const [totals, queue] = await Promise.all([
    get(cfg, '/api/insights/account?days=' + days).catch((e) => ({ error: e.message })),
    get(cfg, '/api/posts').catch(() => null)
  ]);
  const pollError = st.comment_poll_error || st.poll_error;
  return {
    connected: true,
    username: st.username,
    account_type: st.account_type,
    instagram_login_expires_in_days: st.expires_in_days,
    automations_running: st.poll_healthy !== false && !st.token_expired,
    automations_problem: st.token_expired ? 'The Instagram login expired; reconnect it in chatmany.' : st.poll_healthy === false ? ((pollError && pollError.message) || 'The worker has not checked for comments recently.') : undefined,
    totals: totals.error ? undefined : { days: totals.days, ...totals.totals },
    totals_unavailable: totals.error || (totals.errors && Object.keys(totals.errors).length ? totals.errors : undefined),
    publishing: queue ? { ready: queue.storage !== false, api_posts_used_today: queue.limit ? queue.limit.used : null, api_posts_allowed: queue.limit ? queue.limit.total : null } : undefined
  };
}

export async function postInsights(cfg, { limit = 25 } = {}) {
  const [media, ins] = await Promise.all([get(cfg, '/api/media'), get(cfg, '/api/insights?limit=' + limit)]);
  const rows = S.joinMedia(media.media, ins.media).slice(0, limit);
  return {
    count: rows.length,
    note: ins.hint || 'avg_watch_s = average seconds watched per view. skip_rate_pct = share of viewers who swiped away in the first seconds. Numbers come from Instagram and can lag by hours.',
    posts: rows.map((p) => ({
      media_id: p.id,
      code: p.code,
      url: p.permalink,
      type: p.type,
      posted_at: p.takenAt ? new Date(p.takenAt).toISOString() : null,
      views: p.views,
      reach: p.reach,
      avg_watch_s: p.avgWatchMs === null ? null : Math.round(p.avgWatchMs / 100) / 10,
      total_watch_s: p.watchTotalMs === null ? null : Math.round(p.watchTotalMs / 1000),
      skip_rate_pct: p.skipRate,
      likes: p.likes,
      comments: p.comments,
      saves: p.saves,
      shares: p.shares,
      caption: oneLine(p.caption, 200),
      insights_error: p.error || undefined
    }))
  };
}

async function allCampaigns(cfg) {
  const [live, archived] = await Promise.all([get(cfg, '/api/campaigns'), get(cfg, '/api/campaigns?archived=1')]);
  return { live: live.campaigns || [], archived: archived.campaigns || [] };
}

function automationOut(c, media, cards) {
  const a = S.attachment(c, media);
  return {
    automation_id: c.campaign_id,
    name: c.name || c.campaign_id,
    state: c.archived ? 'archived' : c.active ? 'running' : 'paused',
    keywords: c.keywords,
    match: c.match === 'exact' ? 'whole comment is the keyword' : 'keyword anywhere in the comment',
    runs_on: a.state === 'waiting' ? { waiting_for_caption_starting: c.caption_match || null }
      : { media_id: c.media_id, post: a.media ? oneLine(a.media.caption, 80) : 'an older post' },
    sends: { type: c.reward && c.reward.type, value: c.reward && c.reward.value },
    steps: [c.check_follow ? (c.verify_follow ? 'checks they follow' : 'asks them to follow') : null, c.ask_email ? 'asks for email' : null, c.public_reply && c.public_reply.enabled ? 'replies publicly' : null].filter(Boolean),
    funnel: cards ? { comments: cards.comments, dms_sent: cards.sends, button_clicks: cards.clicks, follows: cards.follows, emails: cards.emails, delivered: cards.delivered } : undefined
  };
}

export async function automations(cfg, { include_archived = false, details = false } = {}) {
  const [{ live, archived }, media] = await Promise.all([allCampaigns(cfg), get(cfg, '/api/media').then((m) => m.media || [], () => [])]);
  const stats = {};
  await Promise.all(live.map((c) => get(cfg, `/api/dashboard?campaign_id=${encodeURIComponent(c.campaign_id)}&days=${STATS_DAYS}`).then((d) => { stats[c.campaign_id] = d.cards; }, () => {})));
  const list = live.concat(include_archived ? archived : []);
  return {
    count: list.length,
    running: live.filter((c) => c.active).length,
    archived_hidden: include_archived ? undefined : archived.length || undefined,
    automations: list.map((c) => ({ ...automationOut(c, media, stats[c.campaign_id]), messages: details ? c.copy : undefined, public_replies: details && c.public_reply ? c.public_reply.texts : undefined, exclude: details ? c.exclude : undefined }))
  };
}

function queuedOut(p) {
  return {
    post_id: p.id,
    platform: p.platform || 'instagram',
    type: S.postLabel(p),
    status: p.status === 'working' ? 'publishing now' : p.platform === 'tiktok' && p.status === 'published' && !p.permalink ? 'in TikTok inbox' : p.status,
    publish_at: iso(p.scheduled_at),
    published_at: iso(p.published_at) || undefined,
    url: p.permalink || undefined,
    caption: oneLine(p.caption, 200),
    files: (p.media || []).length,
    attaches_automation: (p.options && p.options.campaign_id) || undefined,
    error: p.error || undefined
  };
}

export async function scheduledPosts(cfg, { include_published = false } = {}) {
  const r = await get(cfg, '/api/posts');
  const posts = (r.posts || []).filter((p) => include_published || p.status !== 'published');
  return {
    publishing_ready: r.storage !== false,
    api_posts_used_today: r.limit ? r.limit.used : null,
    api_posts_allowed: r.limit ? r.limit.total : null,
    tiktok_connected: Boolean(r.tiktok && r.tiktok.connected),
    count: posts.length,
    posts: posts.map(queuedOut)
  };
}

// ---- automations: writes ---------------------------------------------------------
const DRAFT_FIELDS = {
  name: 'name', match: 'match', reward_type: 'reward_type', reward_value: 'reward_value',
  opening_message: 'opening', opening_button: 'opening_button', delivery_message: 'delivery',
  follow_message: 'follow_gate', follow_button: 'follow_button', follow_retry_message: 'follow_retry',
  email_message: 'email_ask', ask_follow: 'check_follow', verify_follow: 'verify_follow', ask_email: 'ask_email', active: 'active'
};

/** Create an automation, or change the given fields of an existing one. */
export async function saveAutomation(cfg, input) {
  const { live, archived } = await allCampaigns(cfg);
  let base = null;
  let d;
  if (input.automation_id) {
    base = live.concat(archived).find((c) => c.campaign_id === input.automation_id);
    if (!base) throw new Error(`There is no automation "${input.automation_id}". Use list_automations for the ids.`);
    d = S.draftFromCampaign(base);
  } else {
    d = S.defaultDraft(input.media_id || '');
  }
  for (const [k, key] of Object.entries(DRAFT_FIELDS)) if (input[k] !== undefined) d[key] = input[k];
  if (input.keywords !== undefined) d.keywords = input.keywords.join(', ');
  if (input.exclude !== undefined) d.exclude = input.exclude.join(', ');
  if (input.public_replies !== undefined) {
    d.reply_enabled = input.public_replies.length > 0;
    if (input.public_replies.length) d.reply_texts = input.public_replies.join('\n');
  }
  if (input.media_id) { d.attach = 'post'; d.media_id = input.media_id; }
  if (input.caption_starts_with) {
    d.attach = 'caption';
    d.caption_match = input.caption_starts_with;
    if (!S.isPending(d.media_id)) d.media_id = ''; // leave the post it was on and wait for the new one
  }
  const res = S.campaignFromDraft(d, base);
  if (res.error) throw new Error(res.error);
  await post(cfg, '/api/campaigns', { campaign: res.campaign, active: res.active });
  return { ok: true, created: !base, automation: automationOut({ ...res.campaign, active: res.active, archived: base ? base.archived : false }, []) };
}

const STATE_CALLS = {
  pause: (id) => ['/api/campaigns/status', { campaign_id: id, active: false }],
  resume: (id) => ['/api/campaigns/status', { campaign_id: id, active: true }],
  archive: (id) => ['/api/campaigns/archive', { campaign_id: id, archived: true }],
  restore: (id) => ['/api/campaigns/archive', { campaign_id: id, archived: false }],
  delete: (id) => ['/api/campaigns/delete', { campaign_id: id }]
};

export async function setAutomationState(cfg, { automation_id, action }) {
  const { live, archived } = await allCampaigns(cfg);
  const c = live.concat(archived).find((x) => x.campaign_id === automation_id);
  if (!c) throw new Error(`There is no automation "${automation_id}". Use list_automations for the ids.`);
  const [path, body] = STATE_CALLS[action](automation_id);
  await post(cfg, path, body);
  return { ok: true, automation_id, name: c.name || automation_id, done: action };
}

// ---- publishing: writes ------------------------------------------------------------
async function describeFile(path) {
  if (!isAbsolute(path)) throw new Error(`Give the full path of ${path}.`);
  let st;
  try { st = await fs.stat(path); } catch { throw new Error(`${path} does not exist.`); }
  if (!st.isFile()) throw new Error(`${path} is not a file.`);
  return { path, name: basename(path), type: MIME[extname(path).toLowerCase()] || '', size: st.size };
}

/** Instagram only takes JPEG: convert other images (and oversized JPEGs) with macOS sips. */
async function asJpeg(file) {
  if (process.platform !== 'darwin') throw new Error(`${file.name} must be a JPEG under 8 MB (automatic conversion needs macOS).`);
  const out = join(tmpdir(), `openoutlier-${randomUUID()}.jpg`);
  try {
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', '-Z', '2160', file.path, '--out', out]);
  } catch (e) {
    throw new Error(`Could not convert ${file.name} to JPEG: ${e.message}`);
  }
  return out;
}

async function uploadFile(cfg, file) {
  const info = S.fileInfo(file);
  if (info.error) throw new Error(info.error);
  let path = file.path;
  let type = file.type;
  let temp = null;
  if (info.type === 'image' && (info.convert || file.size > S.MAX_IMAGE_BYTES)) {
    temp = path = await asJpeg(file);
    type = 'image/jpeg';
  }
  try {
    const bytes = await fs.readFile(path);
    const r = await call(cfg, '/api/uploads', { method: 'POST', headers: { 'content-type': type }, body: bytes, timeout: 10 * 60000 });
    if (!r.key) throw new Error('The upload returned no file key.');
    return r.key;
  } finally {
    if (temp) await fs.unlink(temp).catch(() => {});
  }
}

/**
 * Queue a reel, post or story (or change one that is still waiting). Nothing goes out unless a
 * time is given or publish_now is true.
 */
export async function schedulePost(cfg, input, nowMs = Date.now()) {
  let d;
  if (input.post_id) {
    const current = ((await get(cfg, '/api/posts')).posts || []).find((p) => p.id === input.post_id);
    if (!current) throw new Error(`There is no queued post "${input.post_id}". Use list_scheduled_posts for the ids.`);
    if (current.status !== 'scheduled' && current.status !== 'failed') throw new Error(`That post is already ${current.status === 'working' ? 'being published' : current.status}.`);
    d = S.postDraftFromPost(current, nowMs);
  } else {
    d = S.defaultPostDraft();
    if (!input.kind) throw new Error('Say what to publish: kind = reel, post, story or tiktok.');
    if (input.kind === 'tiktok') {
      const r = await get(cfg, '/api/posts');
      if (!(r.tiktok && r.tiktok.connected)) throw new Error('TikTok is not connected to the worker. Connect it from the worker (/auth/tiktok/authorize) first.');
    }
  }
  if (input.kind) d.kind = input.kind;
  if (input.caption !== undefined) d.caption = input.caption;
  if (input.show_in_grid !== undefined) d.share_to_feed = input.show_in_grid;
  if (input.automation_id !== undefined) d.campaign_id = input.automation_id || '';
  if (input.files && input.files.length) d.files = await Promise.all(input.files.map(describeFile));
  if (input.cover_file) d.cover = await describeFile(input.cover_file);

  if (input.publish_now && input.publish_at) throw new Error('Give either publish_at or publish_now, not both.');
  if (input.publish_now) { d.when = 'now'; d.at = ''; }
  else if (input.publish_at) {
    if (!isFinite(Date.parse(input.publish_at))) throw new Error('publish_at must be a date and time, e.g. 2026-11-12T18:00:00+03:00.');
    d.when = 'later';
    d.at = input.publish_at;
  } else if (!input.post_id) {
    throw new Error('Say when: publish_at (a date and time) or publish_now: true.');
  } else if (d.when === 'now') {
    throw new Error('That post is past its time. Give a new publish_at, or publish_now: true.');
  }

  const problem = S.postProblem(d, nowMs);
  if (problem) throw new Error(problem);
  if (d.campaign_id) {
    const { live } = await allCampaigns(cfg);
    if (!live.some((c) => c.campaign_id === d.campaign_id)) throw new Error(`There is no automation "${d.campaign_id}" to attach. Use list_automations for the ids.`);
  }

  const items = S.postItems(d);
  const keys = [];
  for (const item of items) keys.push(item.key || await uploadFile(cfg, item.file));
  const coverKey = d.kind === 'reel' && d.cover ? await uploadFile(cfg, d.cover) : d.cover_key;
  const r = await post(cfg, '/api/posts', S.postPayload(d, keys, coverKey));
  const saved = ((await get(cfg, '/api/posts')).posts || []).find((p) => p.id === r.id);
  return {
    ok: true,
    ...(saved ? queuedOut(saved) : { post_id: r.id }),
    note: d.kind === 'tiktok'
      ? `${d.when === 'now' ? 'Queued' : 'Scheduled'}. At that time the worker sends the video to the user's TikTok inbox as a draft; they post it from the TikTok app with one tap (paste the caption there: TikTok drafts arrive without one).`
      : d.when === 'now' ? 'Queued to publish now: the worker posts it within a minute (videos take longer while Instagram processes them). Check list_scheduled_posts for the result.' : 'Scheduled. The worker publishes it at that time even if this computer is off.'
  };
}

export async function cancelPost(cfg, { post_id }) {
  await post(cfg, '/api/posts/delete', { id: post_id });
  return { ok: true, post_id, done: 'removed from the queue (nothing already on Instagram is deleted)' };
}

// ---- tool registration ----------------------------------------------------------------
export const INSTRUCTIONS = 'My account tools (my_account, my_post_insights, list_automations, list_scheduled_posts, save_automation, set_automation_state, schedule_post, cancel_scheduled_post) work on the user\'s OWN Instagram account through their chatmany worker, with the official Instagram API. my_post_insights has what only the owner sees: reach, average watch time and skip rate. The write tools act on the live account: schedule_post really publishes to Instagram, and deleting an automation cannot be undone. State what you are about to do and get the user\'s go-ahead before publishing now, deleting, or changing a running automation\'s messages.';

export function registerStudioTools(server, { z, json, safe }) {
  const withConfig = (fn) => (args) => safe(async () => json(await fn(loadConfig(), args || {})));

  server.registerTool('my_account', {
    title: 'My Instagram account',
    description: 'The user\'s own Instagram account (connected through their chatmany worker): username, whether the comment → DM automations are running, account totals for the last N days (views, reach, accounts engaged, interactions, link taps), and today\'s publishing quota.',
    inputSchema: { days: z.number().int().min(1).max(30).optional().describe('Default 7') },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, withConfig(account));

  server.registerTool('my_post_insights', {
    title: 'My post insights',
    description: 'Official Instagram insights for the user\'s own recent posts, newest first: views, reach, average watch time, total watch time, skip rate, likes, comments, saves and shares. Use this (not top_reels) for the user\'s own account when watch time or skip rate matters; competitors only have public counts.',
    inputSchema: { limit: z.number().int().min(1).max(25).optional().describe('Default 25') },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, withConfig(postInsights));

  server.registerTool('list_automations', {
    title: 'List comment → DM automations',
    description: 'The user\'s comment → DM automations: keyword, the post each runs on (or the caption it is waiting for), what it sends, whether it is running, and its funnel (comments → DMs sent → button clicks → delivered).',
    inputSchema: {
      include_archived: z.boolean().optional().describe('Default false'),
      details: z.boolean().optional().describe('Also return every message text. Default false.')
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, withConfig(automations));

  server.registerTool('list_scheduled_posts', {
    title: 'List scheduled posts',
    description: 'Reels, posts and stories queued to be published on the user\'s Instagram account, with their time and status (scheduled, publishing now, failed with Instagram\'s reason, published with link).',
    inputSchema: { include_published: z.boolean().optional().describe('Also list the ones already published from the queue. Default false.') },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, withConfig(scheduledPosts));

  server.registerTool('save_automation', {
    title: 'Create or change an automation',
    description: 'Create a comment → DM automation, or change fields of an existing one (give automation_id and only what changes). It takes effect on the live Instagram account immediately. A new one needs: name, keywords, reward_value, and either media_id (a published post, from my_post_insights) or caption_starts_with (a post not published yet; it attaches when that post goes live).',
    inputSchema: {
      automation_id: z.string().optional().describe('Change this automation. Omit to create a new one.'),
      name: z.string().optional(),
      media_id: z.string().optional().describe('Run on this published post (media_id from my_post_insights)'),
      caption_starts_with: z.string().optional().describe('Instead of media_id: the first line of the caption of a post that is not published yet (at least 15 characters)'),
      keywords: z.array(z.string()).optional().describe('Words people comment, e.g. ["PRACTICE"]'),
      match: z.enum(['word', 'exact']).optional().describe('word = keyword anywhere in the comment (default); exact = the whole comment is the keyword'),
      exclude: z.array(z.string()).optional().describe('Never answer comments containing these'),
      opening_message: z.string().optional().describe('First DM'),
      opening_button: z.string().optional().describe('Button under the first DM'),
      reward_type: z.enum(['link', 'code', 'text']).optional().describe('Default link'),
      reward_value: z.string().optional().describe('The link, code or text people receive'),
      delivery_message: z.string().optional().describe('Final DM; {reward} is replaced with reward_value'),
      ask_follow: z.boolean().optional().describe('Ask them to follow before delivering'),
      verify_follow: z.boolean().optional().describe('With ask_follow: check that they really follow'),
      follow_message: z.string().optional(),
      follow_button: z.string().optional(),
      follow_retry_message: z.string().optional(),
      ask_email: z.boolean().optional(),
      email_message: z.string().optional(),
      public_replies: z.array(z.string()).optional().describe('Public replies to the comment, one picked at random. [] turns them off.'),
      active: z.boolean().optional().describe('false = save it paused. Default: running for a new one, unchanged for an existing one.')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, withConfig(saveAutomation));

  server.registerTool('set_automation_state', {
    title: 'Pause, resume, archive or delete an automation',
    description: 'pause / resume an automation, archive it (stops it, keeps it), restore it from the archive, or delete it. Delete cannot be undone; prefer archive.',
    inputSchema: {
      automation_id: z.string(),
      action: z.enum(['pause', 'resume', 'archive', 'restore', 'delete'])
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }, withConfig(setAutomationState));

  server.registerTool('schedule_post', {
    title: 'Publish or schedule a reel, post, story or TikTok draft',
    description: 'Publish to the user\'s Instagram account: a reel (one MP4/MOV video), a post (one image, or a carousel of up to 20 images and videos) or a story (one image or video). kind "tiktok" sends one video to the user\'s TikTok inbox as a draft at that time instead (TikTok does not let this app post publicly; the user posts the draft from the TikTok app). Files are local paths on this computer; they are uploaded to the worker, which publishes at publish_at even if this computer is off. Nothing is published unless publish_at is given or publish_now is true. To change a post that is still waiting, give post_id and only what changes. No music can be added; videos up to 95 MB; PNG/WebP are converted to JPEG.',
    inputSchema: {
      post_id: z.string().optional().describe('Change this queued post (from list_scheduled_posts). Omit for a new one.'),
      kind: z.enum(['reel', 'post', 'story', 'tiktok']).optional().describe('Required for a new post. tiktok = one video to the TikTok inbox as a draft.'),
      files: z.array(z.string()).optional().describe('Full local paths, in order. Required for a new post.'),
      caption: z.string().optional().describe('Up to 2200 characters. Stories have none.'),
      cover_file: z.string().optional().describe('Reels: full path of a cover image'),
      show_in_grid: z.boolean().optional().describe('Reels: also show in the profile grid. Default true.'),
      automation_id: z.string().optional().describe('Attach this automation to the post once it is published (not for stories). "" removes it.'),
      publish_at: z.string().optional().describe('When to publish, ISO 8601 with offset, e.g. 2026-11-12T18:00:00+03:00'),
      publish_now: z.boolean().optional().describe('true = publish within a minute. Only with the user\'s explicit go-ahead.')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, withConfig((cfg, args) => schedulePost(cfg, args)));

  server.registerTool('cancel_scheduled_post', {
    title: 'Cancel a scheduled post',
    description: 'Remove a post from the publishing queue so it is not published (or clear a failed or published entry from the list). It does not delete anything already on Instagram, and it cannot stop a post that is being published at this moment.',
    inputSchema: { post_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }, withConfig(cancelPost));
}
