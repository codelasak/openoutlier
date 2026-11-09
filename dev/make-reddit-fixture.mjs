// Generates dev/reddit/excel-top.json: two pages of fake listing JSON shaped
// like Reddit's /r/<sub>/top.json (Listing → t3 children), used by the unit
// tests, the MCP test and dev/reddit-demo.html. All posts and numbers are made up.
//   node dev/make-reddit-fixture.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [title, flair, type, reach multiplier]
const QUESTIONS = [
  ['How do I make XLOOKUP return a blank instead of #N/A?', 'solved', 'text', 2.6],
  ['XLOOKUP returns #N/A even though the value is clearly there', 'unsolved', 'text', 2.2],
  ['Why does my VLOOKUP break when I insert a column?', 'solved', 'text', 1.8],
  ['Is there a way to sum by color without VBA?', 'Waiting on OP', 'text', 1.5],
  ['Pivot table keeps losing its formatting on refresh', 'unsolved', 'text', 1.6],
  ['How to remove duplicates but keep the latest date?', 'solved', 'text', 1.4],
  ['Dates turned into numbers after importing a CSV, help', 'solved', 'text', 1.7],
  ['What is the best way to learn Power Query?', 'Discussion', 'text', 1.2],
  ['Conditional formatting is slow on 50k rows, any fix?', 'unsolved', 'text', 1.1],
  ['#SPILL! error when my FILTER formula hits a merged cell', 'solved', 'image', 1.9]
];
const STATEMENTS = [
  ['I built a budget tracker with LAMBDA functions', 'Show and Tell', 'image', 0.9],
  ['Pro tip: Ctrl + E (Flash Fill) saves hours', 'Pro Tip', 'text', 1.3],
  ['My monthly sales dashboard', 'Show and Tell', 'image', 0.8],
  ['Excel World Championship highlights', 'Discussion', 'video', 0.7],
  ['A cheat sheet of the 20 functions I use daily', 'Pro Tip', 'image', 1.0],
  ['Microsoft announces new Copilot features in Excel', 'Discussion', 'link', 0.6],
  ['Our team switched from Google Sheets back to Excel', 'Discussion', 'text', 0.5]
];

function listingPages(sub, seed, count, scale) {
  const rnd = mulberry32(seed);
  const now = Date.UTC(2026, 10, 8, 12);
  const children = [];
  for (let i = 0; i < count; i++) {
    const isQ = rnd() < 0.55;
    const [title, flair, type, mult] = (isQ ? QUESTIONS : STATEMENTS)[Math.floor(rnd() * (isQ ? QUESTIONS.length : STATEMENTS.length))];
    const d = new Date(now - (i * 2.9 + rnd() * 2) * 864e5);
    // Weekday mornings (US) do better in this fake subreddit.
    const hour = rnd() < 0.6 ? 13 + Math.floor(rnd() * 4) : Math.floor(rnd() * 24);
    d.setUTCHours(hour, Math.floor(rnd() * 60));
    const boost = d.getUTCDay() >= 1 && d.getUTCDay() <= 4 && hour >= 13 && hour < 17 ? 1.4 : 0.9;
    const outlier = rnd() < 0.08 ? 3 + rnd() * 5 : 1;
    const score = Math.max(1, Math.round(Math.exp(Math.log(60 * scale) + (rnd() - 0.5) * 1.4) * mult * boost * outlier));
    const comments = Math.round(score * (isQ ? 0.35 + rnd() * 0.5 : 0.05 + rnd() * 0.15));
    const id = (seed * 7919 + i * 104729).toString(36).slice(-7);
    const variant = i % 3 === 0 ? '' : i % 3 === 1 ? ' (Excel 365)' : ' in Excel';
    const fullTitle = title.replace(/([?]?)$/, variant + '$1');
    const isSelf = type === 'text';
    children.push({
      kind: 't3',
      data: {
        id,
        name: 't3_' + id,
        title: fullTitle,
        selftext: isSelf ? 'I have a table with ' + (100 + i) + ' rows and the formula works for some rows but not others.' : '',
        author: 'user_' + Math.floor(rnd() * 900 + 100),
        subreddit: sub,
        subreddit_name_prefixed: 'r/' + sub,
        score,
        ups: score,
        upvote_ratio: Math.round((0.75 + rnd() * 0.24) * 100) / 100,
        num_comments: comments,
        num_crossposts: rnd() < 0.1 ? 1 : 0,
        created_utc: Math.floor(d.getTime() / 1000),
        permalink: `/r/${sub}/comments/${id}/${fullTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}/`,
        url: isSelf ? `https://www.reddit.com/r/${sub}/comments/${id}/` : type === 'image' ? `https://i.redd.it/${id}.png` : type === 'video' ? `https://v.redd.it/${id}` : 'https://techcommunity.example.com/excel-news',
        domain: isSelf ? 'self.' + sub : type === 'image' ? 'i.redd.it' : type === 'video' ? 'v.redd.it' : 'techcommunity.example.com',
        is_self: isSelf,
        is_video: type === 'video',
        post_hint: type === 'image' ? 'image' : type === 'video' ? 'hosted:video' : type === 'link' ? 'link' : undefined,
        link_flair_text: flair,
        over_18: false,
        stickied: false,
        thumbnail: isSelf ? 'self' : 'default',
        preview: type === 'image' ? { images: [{ source: { url: `https://preview.redd.it/${id}.png?width=640&amp;format=png&amp;s=abc`, width: 640, height: 480 } }] } : undefined
      }
    });
  }
  const half = Math.ceil(children.length / 2);
  return [
    { kind: 'Listing', data: { after: 't3_' + children[half - 1].data.id, dist: half, children: children.slice(0, half) } },
    { kind: 'Listing', data: { after: null, dist: children.length - half, children: children.slice(half) } }
  ];
}

const out = {
  excel: listingPages('excel', 11, 90, 1),
  spreadsheets: listingPages('spreadsheets', 23, 40, 0.3)
};
mkdirSync(join(here, 'reddit'), { recursive: true });
writeFileSync(join(here, 'reddit', 'listings.json'), JSON.stringify(out, null, 1));
console.log('wrote dev/reddit/listings.json:', Object.entries(out).map(([k, v]) => `r/${k} ${v[0].data.children.length + v[1].data.children.length} posts`).join(', '));
