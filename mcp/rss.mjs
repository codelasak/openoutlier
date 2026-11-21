// OpenOutlier – YouTube channel RSS feeds (docs/youtube-niche-plan.md 2.2).
//
// Each channel has two playlist feeds that need no API key and spend no quota:
//   https://www.youtube.com/feeds/videos.xml?playlist_id=UULF<rest of UC id>  long-form videos
//   https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH<rest of UC id>  Shorts
// Each lists the newest 15 uploads with title, publish time, thumbnail, view count
// (media:statistics views) and like count (media:starRating count).
// The feed is small, regular Atom; a few regular expressions read it (no XML library).

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const FEED = 'https://www.youtube.com/feeds/videos.xml?playlist_id=';

/** { long, short } feed URLs for a UC… channel id (null for anything else). */
export function feedUrls(channelId) {
  if (!CHANNEL_ID_RE.test(String(channelId || ''))) return null;
  const rest = channelId.slice(2);
  return { long: FEED + 'UULF' + rest, short: FEED + 'UUSH' + rest };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescape(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
function tag(xml, name) {
  const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>').exec(xml);
  return m ? unescape(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim() : null;
}
function attr(xml, name, a) {
  const m = new RegExp('<' + name + '\\s[^>]*?\\b' + a + '="([^"]*)"').exec(xml);
  return m ? unescape(m[1]) : null;
}
function int(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Parse one feed. type: 'video' | 'short' (which feed it came from).
 * → { channelId, channelName, entries: [{ video_id, channel_id, title, published_at, updated_at, thumb, views, likes, description, type }] }
 */
export function parseFeed(xml, type = 'video') {
  const text = String(xml || '');
  const head = text.split('<entry>')[0];
  const author = /<author>([\s\S]*?)<\/author>/.exec(head);
  const out = { channelId: tag(head, 'yt:channelId'), channelName: (author && tag(author[1], 'name')) || tag(head, 'title'), entries: [] };
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(text))) {
    const e = m[1];
    const id = tag(e, 'yt:videoId');
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(id || ''))) continue;
    const published = Date.parse(tag(e, 'published') || '');
    const updated = Date.parse(tag(e, 'updated') || '');
    const thumb = attr(e, 'media:thumbnail', 'url');
    out.entries.push({
      video_id: id,
      channel_id: tag(e, 'yt:channelId') || out.channelId,
      title: tag(e, 'media:title') || tag(e, 'title'),
      published_at: Number.isFinite(published) ? published : null,
      updated_at: Number.isFinite(updated) ? updated : null,
      thumb: thumb && /^https:\/\/i[0-9]?\.ytimg\.com\//.test(thumb) ? thumb : null,
      views: int(attr(e, 'media:statistics', 'views')),
      likes: int(attr(e, 'media:starRating', 'count')),
      description: (tag(e, 'media:description') || '').slice(0, 2000),
      type
    });
  }
  return out;
}

/**
 * Fetch and parse both feeds of a channel. A 404 (no Shorts, or no long-form videos)
 * is an empty list, not an error. → { long, short, fetched_at, errors }
 */
export async function fetchFeeds(channelId, { fetch: doFetch = globalThis.fetch, now = Date.now } = {}) {
  const urls = feedUrls(channelId);
  if (!urls) throw new Error('not a channel id: ' + channelId);
  const out = { long: [], short: [], fetched_at: now(), errors: [] };
  for (const [kind, url] of Object.entries(urls)) {
    let res;
    try {
      res = await doFetch(url, { headers: { accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      out.errors.push(kind + ': ' + (e && e.message || e));
      continue;
    }
    if (res.status === 404) continue;
    if (!res.ok) { out.errors.push(kind + ': HTTP ' + res.status); continue; }
    const feed = parseFeed(await res.text(), kind === 'short' ? 'short' : 'video');
    out[kind] = feed.entries;
    if (feed.channelName) out.channelName = feed.channelName;
  }
  if (out.errors.length === 2) throw new Error('RSS: ' + out.errors.join('; '));
  return out;
}
