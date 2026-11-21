// OpenOutlier MCP – own-channel history tools (docs/youtube-niche-plan.md 3.2, phase 2):
// my_channel_history, my_video_history, my_search_terms, my_ypp_progress. Read-only, from
// the daily YouTube Analytics copy the bridge keeps (mcp/own-history.mjs); each takes an
// optional channel (UC id, @handle or name) and defaults to the first connected channel.
import { channelHistory, videoHistory, searchTerms, yppProgress, resolveOwn, ownChannels } from './own-history.mjs';
import { channelArg } from './youtube-analytics.mjs';

const NONE = { error: 'No channel history yet.', hint: 'Connect the channel (connect_youtube_channel) with the bridge running; with the "My channel history" feature on (default), the bridge copies the channel\'s YouTube Analytics from its first day within minutes, then every morning.' };

export function registerOwnTools(server, { z, json, safe, store }) {
  const channel = channelArg(z);
  const run = (fn) => safe(() => {
    if (!ownChannels(store(), { all: true }).length) return json(NONE);
    try { return json(fn()); } catch (e) { return json({ ok: false, error: e.message, code: e.code }); }
  });
  server.registerTool('my_channel_history', {
    title: 'My channel history (daily, from YouTube Analytics)',
    description: 'The stored daily history of one of the user\'s own YouTube channels since its first day: views, engaged views, watch hours, subscribers gained/lost and the running subscriber total, likes, comments, shares, thumbnail impressions and CTR, average view % and duration, revenue and RPM once in the Partner Program. By day, week or month, with the last 7/28/90/365 days compared to the period before (pct).',
    inputSchema: { channel, days: z.number().int().min(1).max(7300).optional().describe('How many days back from the last Analytics day (default 90; 7300 = everything)'), granularity: z.enum(['day', 'week', 'month']).optional().describe('Default day') },
    annotations: { readOnlyHint: true }
  }, (args) => run(() => channelHistory(store(), args)));
  server.registerTool('my_video_history', {
    title: 'My videos\' first 48 h / 7 d / 30 d (report card)',
    description: 'One of the user\'s own channels: each upload of the last 90 days with its views in the first 48 hours, 7 days and 30 days, next to the channel\'s median (same format) and the tracked niche\'s median (channels of a similar size), plus watch hours and average view %. Give video for that video\'s daily Analytics rows.',
    inputSchema: { channel, video: z.string().optional().describe('A video id or URL for its daily rows') },
    annotations: { readOnlyHint: true }
  }, (args) => run(() => videoHistory(store(), args)));
  server.registerTool('my_search_terms', {
    title: 'Search terms that found my channel',
    description: 'The YouTube search terms that brought viewers to one of the user\'s own channels (YouTube Analytics, traffic source YT_SEARCH), over the last N weeks, with the latest week against the week before (change, new terms) and a weekly series. Good input for the next video\'s title and tags. YouTube hides rare terms, so a small channel may see few.',
    inputSchema: { channel, weeks: z.number().int().min(1).max(12).optional().describe('Weeks to add up (default 4)') },
    annotations: { readOnlyHint: true }
  }, ({ channel: c, weeks = 4 }) => run(() => {
    const ch = resolveOwn(store(), c);
    return { channel: ch.title, channel_id: ch.channel_id, ...searchTerms(store(), ch.channel_id, { weeks, limit: 50 }) };
  }));
  server.registerTool('my_ypp_progress', {
    title: 'YouTube Partner Program progress and ETA',
    description: 'How far one of the user\'s own channels is from the YouTube Partner Program: subscribers (1,000), watch hours on long-form videos in the last 365 days (4,000) and Shorts views in the last 90 days (10M), each with the current pace and an ETA in days that lets old days drop out of the rolling windows.',
    inputSchema: { channel },
    annotations: { readOnlyHint: true }
  }, (args) => run(() => yppProgress(store(), args)));
}
