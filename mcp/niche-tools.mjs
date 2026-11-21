// OpenOutlier MCP – niche tracking tools (docs/youtube-niche-plan.md 2.4, phase 1):
// niche_pulse, video_velocity, breakouts, channel_growth, niche_report. Read-only, from
// the measurements the bridge's tracker collects (mcp/niche.mjs).
import { nichePulse, videoVelocity, breakoutList, channelGrowth, nicheReport, trackingSummary } from './niche.mjs';

export { trackingSummary };

export const INSTRUCTIONS = 'Niche tracking (YouTube): the bridge follows tracked channels (folders or tags the user marked as a tracked niche, plus Track-button channels; one may be the user\'s own, "mine") through RSS every 15 min and the Data API on an age schedule. niche_pulse ranks recent uploads by velocity score (views ÷ the channel\'s expected views at the latest checkpoint 1/3/6/12/24/48/72 h, 7/14/30 d; ≥ 3× at 6 h or 24 h is a breakout), video_velocity shows one video\'s curve against its channel\'s, breakouts lists the fast risers, channel_growth the daily subscribers and views, niche_report the weekly digest data. Write the interpretation yourself (what works, topic gaps, how the user\'s videos compare); for similar channels or keyword volume, the NexLev / vidIQ connectors may help if the user connected them.';

export function registerNicheTools(server, { z, json, safe, store }) {
  const niche = z.string().optional().describe('Niche name (the folder or "#tag" marked as a tracked niche); default: the one with the user\'s channel');
  server.registerTool('niche_pulse', {
    title: 'Niche pulse (tracked YouTube niche, last N days)',
    description: 'The last N days of a tracked YouTube niche: uploads ranked by velocity score (views ÷ the channel\'s expected views at the latest checkpoint), with views, VPH (lifetime and last 24 h), views per subscriber at 48 h and the evergreen ratio; how much of 30-day views long videos and Shorts get in 48 h; recent breakouts.',
    inputSchema: { niche, days: z.number().int().min(1).max(90).optional().describe('Default 7'), limit: z.number().int().min(1).max(100).optional() },
    annotations: { readOnlyHint: true }
  }, (args) => safe(() => json(nichePulse(store(), args))));
  server.registerTool('video_velocity', {
    title: 'Velocity curve of one tracked video',
    description: 'One tracked YouTube video: its views at each checkpoint (1/3/6/12/24/48/72 h, 7/14/30 d) next to its channel\'s expected views (the channel\'s median curve, or the niche curve scaled to the channel until it has 5 videos), the score at each, VPH, the measurement series (RSS, Data API and page readings) and its title / thumbnail change log.',
    inputSchema: { video: z.string().describe('YouTube video id or URL') },
    annotations: { readOnlyHint: true }
  }, ({ video }) => safe(() => json(videoVelocity(store(), { video }))));
  server.registerTool('breakouts', {
    title: 'Breakouts (fast risers) in tracked niches',
    description: 'Tracked videos that reached the breakout threshold (default 3× their channel\'s expected views) at 6 h or 24 h, newest first, with the score, views and what was expected.',
    inputSchema: { niche, days: z.number().int().min(1).max(90).optional().describe('Default 7') },
    annotations: { readOnlyHint: true }
  }, (args) => safe(() => json(breakoutList(store(), args))));
  server.registerTool('channel_growth', {
    title: 'Daily growth of tracked channels',
    description: 'Daily subscribers, total views and video count of tracked YouTube channels since tracking started (channels.list once a day), with 7- and 28-day changes. Give channel (yt/handle, @handle, UC… id or name) for its daily series; without it, every tracked channel\'s changes.',
    inputSchema: { channel: z.string().optional(), days: z.number().int().min(1).max(3650).optional().describe('Default 90') },
    annotations: { readOnlyHint: true }
  }, (args) => safe(() => json(channelGrowth(store(), args))));
  server.registerTool('niche_report', {
    title: 'Weekly niche report data',
    description: 'The data of the weekly niche digest (stored every Monday; for the running week it is computed now): uploads of the week ranked by velocity, breakouts, the best upload day / time block by 48 h velocity, subscriber gains, the user\'s own uploads against channels of their size, and the niche\'s growth curves. Numbers only: write the summary and suggestions for the user from it.',
    inputSchema: { niche, week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Monday of the week (YYYY-MM-DD); default: the running week') },
    annotations: { readOnlyHint: true }
  }, ({ niche: n, week }) => safe(() => {
    if (week) {
      const row = store().db.prepare('SELECT data FROM niche_reports WHERE week = ?').get(week);
      if (row) return json({ stored: true, ...JSON.parse(row.data) });
    }
    return json({ stored: false, ...nicheReport(store(), { niche: n, week }) });
  }));
}
