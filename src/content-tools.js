// OpenOutlier – phase 4's content tools, the pure part (docs/youtube-niche-plan.md 4, phase 4):
//
//   transcript   read YouTube's own transcript panel (ytd-transcript-segment-renderer, and the
//                newer transcript-segment-view-model), or a caption track (json3 / srv1 XML);
//                export as plain text, text with timestamps, .srt or Markdown; a ready prompt
//                for Claude (summary, topics, hook, outline).
//   comments     parse the comments YouTube's /next responses carry (the older
//                commentThreadRenderer → commentRenderer, and the entity format:
//                commentViewModel + frameworkUpdates' commentEntityPayload); local filters
//                (questions in TR / EN, a phrase, hide profanity in TR / EN), sorting, CSV / JSON
//                and a ready prompt for Claude (sentiment, likes / dislikes, questions, ideas).
//
// No DOM globals and no chrome.*: the DOM reader takes the element to read, so the content
// script, the Library and Node tests (with a tiny fake DOM) share it. UMD: self.OpenOutlierContentTools.
'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierContentTools = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // ---- time ------------------------------------------------------------------------------------
  /** "1:02:03" → 3723, "0:42" → 42, "42" → 42; null when it isn't a time. */
  function parseClock(s) {
    var m = String(s == null ? '' : s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$|^(\d+)$/);
    if (!m) return null;
    if (m[4] != null) return Number(m[4]);
    return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
  }
  /** 42 → "0:42", 3723 → "1:02:03". */
  function clock(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor(sec / 60) % 60;
    var s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }
  /** 62.5 → "00:01:02,500" (SubRip). */
  function srtTime(sec) {
    var ms = Math.max(0, Math.round((Number(sec) || 0) * 1000));
    var h = Math.floor(ms / 3600000);
    var m = Math.floor(ms / 60000) % 60;
    var s = Math.floor(ms / 1000) % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(ms % 1000).padStart(3, '0');
  }
  function clean(s) {
    return String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;|&#x27;/g, '\'').replace(/&quot;/g, '"').replace(/[​‎‏]/g, '').replace(/\s+/g, ' ').trim();
  }

  // ---- transcript: YouTube's transcript panel (DOM) ---------------------------------------------
  var SEG_OLD = 'ytd-transcript-segment-renderer';
  var SEG_NEW = 'transcript-segment-view-model';
  var TEXT_SEL = ['.ytAttributedStringHost', '.yt-core-attributed-string', '.ytwTranscriptSegmentViewModelBody', '.segment-text', 'yt-formatted-string'];
  var TS_NEW = '.ytwTranscriptSegmentViewModelTimestamp';
  var TS_A11Y = '.ytwTranscriptSegmentViewModelTimestampA11yLabel';

  function textOf(el) { return el ? clean(el.textContent) : ''; }
  function newSegmentText(seg) {
    for (var i = 0; i < TEXT_SEL.length; i++) {
      var t = textOf(seg.querySelector(TEXT_SEL[i]));
      if (t) return t;
    }
    var ts = seg.querySelector(TS_NEW);
    var a11y = seg.querySelector(TS_A11Y);
    var kids = seg.children || [];
    for (var j = 0; j < kids.length; j++) {
      if (kids[j] === ts || kids[j] === a11y) continue;
      var x = textOf(kids[j]);
      if (x) return x;
    }
    return '';
  }

  /**
   * The segments shown in YouTube's transcript panel, from any element that contains them.
   * → [{ start, end, text }] (seconds; end = the next segment's start, the last one +4 s), or [].
   */
  function readTranscriptDom(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return [];
    var pairs = [];
    var old = rootEl.querySelectorAll(SEG_OLD);
    if (old.length) {
      for (var i = 0; i < old.length; i++) {
        pairs.push({ time: textOf(old[i].querySelector('.segment-timestamp')), text: textOf(old[i].querySelector('.segment-text')) || textOf(old[i].querySelector('yt-formatted-string')) });
      }
    } else {
      var nw = rootEl.querySelectorAll(SEG_NEW);
      for (var j = 0; j < nw.length; j++) pairs.push({ time: textOf(nw[j].querySelector(TS_NEW)), text: newSegmentText(nw[j]) });
    }
    return fromPairs(pairs);
  }
  /** [{ time: "0:42", text }] → segments, dropping empty text and unreadable times, in time order. */
  function fromPairs(pairs) {
    var segs = [];
    var seen = {};
    (pairs || []).forEach(function (p) {
      var start = parseClock(p.time);
      var text = clean(p.text);
      if (start == null || !text) return;
      var k = start + '|' + text;
      if (seen[k]) return;
      seen[k] = 1;
      segs.push({ start: start, end: null, text: text });
    });
    segs.sort(function (a, b) { return a.start - b.start; });
    return closeEnds(segs, 4);
  }
  function closeEnds(segs, last) {
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].end == null || !(segs[i].end > segs[i].start)) segs[i].end = i + 1 < segs.length ? Math.max(segs[i + 1].start, segs[i].start) : segs[i].start + last;
    }
    return segs;
  }

  // ---- transcript: caption tracks ---------------------------------------------------------------
  /** YouTube's json3 captions → segments. */
  function parseJson3(json) {
    if (typeof json === 'string') { try { json = JSON.parse(json); } catch (e) { return []; } }
    var out = [];
    ((json && json.events) || []).forEach(function (e) {
      if (!e || !Array.isArray(e.segs) || typeof e.tStartMs !== 'number') return;
      var text = clean(e.segs.map(function (s) { return (s && s.utf8) || ''; }).join(''));
      if (!text) return;
      var start = e.tStartMs / 1000;
      out.push({ start: start, end: typeof e.dDurationMs === 'number' ? start + e.dDurationMs / 1000 : null, text: text });
    });
    // Auto captions repeat a line as it scrolls ("rolling" events): drop exact repeats of the previous line.
    var dedup = out.filter(function (s, i) { return !i || s.text !== out[i - 1].text; });
    return closeEnds(dedup, 4);
  }
  /** srv1 / timedtext XML (<text start="1.2" dur="3.4">…</text>) → segments. */
  function parseCaptionXml(xml) {
    var out = [];
    var re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    var m;
    while ((m = re.exec(String(xml || '')))) {
      var st = /\bstart="([\d.]+)"/.exec(m[1]);
      var du = /\bdur="([\d.]+)"/.exec(m[1]);
      var text = clean(m[2].replace(/&amp;(#?\w+;)/g, '&$1'));
      if (!st || !text) continue;
      var start = Number(st[1]);
      out.push({ start: start, end: du ? start + Number(du[1]) : null, text: text });
    }
    return closeEnds(out, 4);
  }

  /** Bracket-matched JSON value that starts at text[i] ('[' or '{'). */
  function jsonAt(text, i) {
    var depth = 0;
    var inStr = false;
    for (var j = i; j < text.length; j++) {
      var c = text[j];
      if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') {
        depth--;
        if (!depth) { try { return JSON.parse(text.slice(i, j + 1)); } catch (e) { return null; } }
      }
    }
    return null;
  }
  /**
   * The caption tracks a player response lists (any JSON text or object that contains one):
   * → { videoId, tracks: [{ url, lang, name, auto }] } or null.
   */
  function captionTracks(src) {
    var text = typeof src === 'string' ? src : JSON.stringify(src || {});
    var at = text.indexOf('"captionTracks":');
    if (at === -1) return null;
    var start = text.indexOf('[', at);
    var list = start === -1 ? null : jsonAt(text, start);
    if (!Array.isArray(list)) return null;
    var vid = /"videoDetails":\{"videoId":"([A-Za-z0-9_-]{11})"/.exec(text) || /"videoId":"([A-Za-z0-9_-]{11})"/.exec(text);
    return {
      videoId: vid ? vid[1] : null,
      tracks: list.filter(function (t) { return t && typeof t.baseUrl === 'string'; }).map(function (t) {
        var name = t.name && (t.name.simpleText || (t.name.runs || []).map(function (r) { return r.text; }).join('')) || t.languageCode || '';
        return { url: t.baseUrl, lang: t.languageCode || '', name: name, auto: t.kind === 'asr' || /\(auto/i.test(name) };
      })
    };
  }
  /** Which track to read: the wanted language (uploaded before auto), then the first uploaded, then the first. */
  function pickTrack(tracks, wanted) {
    if (!tracks || !tracks.length) return null;
    var base = function (l) { return String(l || '').toLowerCase().split(/[-_]/)[0]; };
    var w = base(wanted);
    var by = function (fn) { return tracks.filter(fn)[0] || null; };
    return (w && (by(function (t) { return base(t.lang) === w && !t.auto; }) || by(function (t) { return base(t.lang) === w; }))) ||
      by(function (t) { return !t.auto; }) || tracks[0];
  }
  /** A track's baseUrl with &fmt=json3 (YouTube's own JSON captions). */
  function json3Url(url) {
    var u = String(url || '');
    return /[?&]fmt=/.test(u) ? u.replace(/([?&]fmt=)[^&]*/, '$1json3') : u + (u.indexOf('?') === -1 ? '?' : '&') + 'fmt=json3';
  }

  // ---- transcript exports ---------------------------------------------------------------------------
  function asText(segs, opts) {
    opts = opts || {};
    if (opts.timestamps) return (segs || []).map(function (s) { return '[' + clock(s.start) + '] ' + s.text; }).join('\n');
    // Plain: sentences flow into paragraphs of ~6 segments (or at a pause of 2.5 s or more).
    var paras = [];
    var cur = [];
    (segs || []).forEach(function (s, i) {
      var gap = i ? s.start - (segs[i - 1].end != null ? segs[i - 1].end : segs[i - 1].start) : 0;
      if (cur.length && (cur.length >= 6 && /[.!?…]$/.test(cur[cur.length - 1]) || gap >= 2.5 || cur.length >= 12)) { paras.push(cur.join(' ')); cur = []; }
      cur.push(s.text);
    });
    if (cur.length) paras.push(cur.join(' '));
    return paras.join('\n\n');
  }
  function toSrt(segs) {
    return (segs || []).map(function (s, i) {
      var end = s.end != null && s.end > s.start ? s.end : s.start + 2;
      return (i + 1) + '\n' + srtTime(s.start) + ' --> ' + srtTime(end) + '\n' + s.text + '\n';
    }).join('\n');
  }
  function videoUrl(id, t) { return 'https://www.youtube.com/watch?v=' + id + (t > 0 ? '&t=' + Math.floor(t) + 's' : ''); }
  /** Markdown: title, channel, link, then one line per ~30 s block with a linked timestamp. */
  function toMarkdown(segs, meta) {
    meta = meta || {};
    var lines = ['# ' + (meta.title || meta.id || 'Transcript'), ''];
    var info = [];
    if (meta.channel) info.push('**' + meta.channel + '**');
    if (meta.id) info.push('[' + videoUrl(meta.id) + '](' + videoUrl(meta.id) + ')');
    if (meta.source) info.push('_' + meta.source + '_');
    if (info.length) lines.push(info.join(' · '), '');
    var block = null;
    var flush = function () { if (block) lines.push((meta.id ? '[' + clock(block.start) + '](' + videoUrl(meta.id, block.start) + ')' : '**' + clock(block.start) + '**') + ' ' + block.text.join(' '), ''); };
    (segs || []).forEach(function (s) {
      if (!block || s.start - block.start >= 30) { flush(); block = { start: s.start, text: [] }; }
      block.text.push(s.text);
    });
    flush();
    return lines.join('\n').replace(/\n+$/, '\n');
  }
  function hookOf(segs, seconds) {
    seconds = seconds || 30;
    return (segs || []).filter(function (s) { return s.start < seconds; }).map(function (s) { return s.text; }).join(' ');
  }

  // ---- prompts for Claude ----------------------------------------------------------------------------
  var MAX_PROMPT_CHARS = 120000;
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '\n…' : s; }
  function transcriptPrompt(segs, meta, lang) {
    meta = meta || {};
    var tr = lang === 'tr';
    var head = tr ? [
      'Aşağıda bir YouTube videosunun transcript\'i var' + (meta.title ? ': "' + meta.title + '"' : '') + (meta.channel ? ' (' + meta.channel + ')' : '') + '.',
      'Lütfen şunları çıkar:',
      '1. 5 maddelik özet.',
      '2. Ana konular ve anahtar kelimeler (başlık ve etiket fikri olarak da).',
      '3. Hook analizi: ilk 30 saniyede ne vaat ediliyor, izleyiciyi tutan ne, nasıl daha güçlü olurdu.',
      '4. Zaman damgalı bölüm taslağı (YouTube bölümleri olarak kullanılabilir).',
      '5. Bu videodan çıkabilecek 3 yeni video fikri.',
      'OpenOutlier MCP bağlıysa `get_transcript` aracıyla (video: ' + (meta.id || '…') + ') daha uzun ya da başka dildeki bir transcript\'i de alabilirsin.'
    ] : [
      'Below is the transcript of a YouTube video' + (meta.title ? ': "' + meta.title + '"' : '') + (meta.channel ? ' (' + meta.channel + ')' : '') + '.',
      'Please give me:',
      '1. A 5-bullet summary.',
      '2. The main topics and keywords (also as title and tag ideas).',
      '3. A hook analysis: what the first 30 seconds promise, what keeps viewers watching, how it could be stronger.',
      '4. An outline with timestamps (usable as YouTube chapters).',
      '5. Three new video ideas that come out of this one.',
      'If the OpenOutlier MCP server is connected, its `get_transcript` tool (video: ' + (meta.id || '…') + ') can fetch the full or another language\'s transcript too.'
    ];
    var url = meta.id ? videoUrl(meta.id) : '';
    var hook = hookOf(segs, 30);
    return head.join('\n') + '\n\n' + (url ? url + '\n' : '') + (hook ? (tr ? 'İlk 30 saniye: ' : 'First 30 seconds: ') + hook + '\n' : '') +
      '\n<transcript>\n' + cut(asText(segs, { timestamps: true }), MAX_PROMPT_CHARS) + '\n</transcript>\n';
  }

  // ---- comments: parsing /next responses ---------------------------------------------------------------
  /** "1.2K" / "3M" (EN), "1,2 B" / "3 Mn" (TR), "842" → number; null when unreadable. */
  function parseCompact(s, lang) {
    s = String(s == null ? '' : s).replace(/ /g, ' ').trim();
    if (!s) return null;
    var m = s.match(/^([\d.,]+)\s*([A-Za-zİıŞşÇçĞğÖöÜü]*)/);
    if (!m) return null;
    var num = m[1];
    var unit = m[2].toLowerCase();
    var tr = lang === 'tr' || /^(b|bn|mn|mr|milyon|milyar|bin)$/.test(unit) && (lang !== 'en' && (/,/.test(num) || unit !== 'b'));
    var mult = 1;
    if (unit) {
      if (tr) mult = /^(b|bn|bin)$/.test(unit) ? 1e3 : /^(mn|milyon)$/.test(unit) ? 1e6 : /^(mr|milyar)$/.test(unit) ? 1e9 : 1;
      else mult = unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : unit === 'b' ? 1e9 : 1;
    }
    var n;
    if (mult > 1) n = Number(num.replace(tr ? /\./g : /,/g, '').replace(',', '.'));
    else n = Number(num.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * mult) : null;
  }
  function runsText(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (t.simpleText != null) return String(t.simpleText);
    if (Array.isArray(t.runs)) return t.runs.map(function (r) { return r.text || ''; }).join('');
    if (t.content != null) return String(t.content);
    return '';
  }
  function walk(o, fn, depth) {
    if (!o || typeof o !== 'object' || (depth || 0) > 60) return;
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], fn, (depth || 0) + 1); return; }
    fn(o);
    for (var k in o) if (o[k] && typeof o[k] === 'object') walk(o[k], fn, (depth || 0) + 1);
  }

  /**
   * Comments in a /next response (or the watch page's ytInitialData). opts.lang: 'en' | 'tr' for the
   * like counts. → [{ id, text, author, authorId, likes, replies, published, reply, parent, pinned, hearted, creator }]
   */
  function parseComments(json, opts) {
    opts = opts || {};
    if (typeof json === 'string') { try { json = JSON.parse(json); } catch (e) { return []; } }
    var out = [];
    var byId = {};
    function add(c) {
      if (!c || !c.id || !c.text) return;
      if (byId[c.id]) { Object.keys(c).forEach(function (k) { if (c[k] != null && c[k] !== false && byId[c.id][k] == null) byId[c.id][k] = c[k]; }); return; }
      byId[c.id] = c;
      out.push(c);
    }
    // Entity format: the text, author and counts live in frameworkUpdates' mutations.
    var ents = {};
    var toolbar = {};
    walk(json && json.frameworkUpdates, function (o) {
      var p = o.payload;
      if (!p) return;
      if (p.commentEntityPayload) { var e = p.commentEntityPayload; var pid = e.properties && e.properties.commentId; if (pid) ents[pid] = e; }
      if (p.engagementToolbarStateEntityPayload && o.entityKey) toolbar[o.entityKey] = p.engagementToolbarStateEntityPayload;
    });
    var meta = {}; // commentId → { pinned, toolbarKey }
    walk(json, function (o) {
      var vm = o.commentViewModel && (o.commentViewModel.commentViewModel || o.commentViewModel);
      if (vm && vm.commentId) meta[vm.commentId] = { pinned: !!vm.pinnedText, toolbarKey: vm.toolbarStateKey || null };
      var cr = o.commentRenderer;
      if (cr && cr.commentId) {
        var parts = String(cr.commentId).split('.');
        add({
          id: cr.commentId, text: runsText(cr.contentText).trim(), author: runsText(cr.authorText).trim() || null,
          authorId: cr.authorEndpoint && cr.authorEndpoint.browseEndpoint && cr.authorEndpoint.browseEndpoint.browseId || null,
          likes: cr.voteCount ? parseCompact(runsText(cr.voteCount), opts.lang) : 0, replies: cr.replyCount != null ? Number(cr.replyCount) || 0 : 0,
          published: runsText(cr.publishedTimeText).replace(/\s*\((edited|düzenlendi)\)\s*$/i, '').trim() || null,
          reply: parts.length > 1, parent: parts.length > 1 ? parts[0] : null, pinned: !!cr.pinnedCommentBadge,
          hearted: !!(cr.actionButtons && JSON.stringify(cr.actionButtons).indexOf('"isHearted":true') !== -1), creator: !!cr.authorIsChannelOwner
        });
      }
    });
    Object.keys(ents).forEach(function (cid) {
      var e = ents[cid];
      var pr = e.properties || {};
      var au = e.author || {};
      var tb = e.toolbar || {};
      var m = meta[cid] || {};
      var st = m.toolbarKey ? toolbar[m.toolbarKey] : null;
      var parts = String(cid).split('.');
      add({
        id: cid, text: runsText(pr.content).trim(), author: au.displayName || null, authorId: au.channelId || null,
        likes: parseCompact(tb.likeCountNotliked || tb.likeCountLiked || '', opts.lang) || 0, replies: parseCompact(tb.replyCount || '', opts.lang) || 0,
        published: String(pr.publishedTime || '').replace(/\s*\((edited|düzenlendi)\)\s*$/i, '').trim() || null,
        reply: (pr.replyLevel || 0) > 0 || parts.length > 1, parent: parts.length > 1 ? parts[0] : null, pinned: !!m.pinned,
        hearted: !!(st && st.heartState === 'TOOLBAR_HEART_STATE_HEARTED'), creator: !!au.isCreator
      });
    });
    return out;
  }
  /** Comments total from the comments header ("234 Comments", "1,2 B yorum"), or null. */
  function commentsTotal(json, opts) {
    var n = null;
    walk(typeof json === 'string' ? (function () { try { return JSON.parse(json); } catch (e) { return null; } })() : json, function (o) {
      if (n != null) return;
      var hr = o.commentsHeaderRenderer;
      if (hr && (hr.countText || hr.commentsCount)) n = parseCompact(runsText(hr.countText || hr.commentsCount).replace(/[^\d.,\sA-Za-zİıŞşÇçĞğÖöÜü]/g, ''), (opts || {}).lang);
    });
    return n;
  }
  /** Merge new comments into a stored list (same id: the newer copy wins), newest capture last. */
  function mergeComments(list, more, max) {
    var by = {};
    var out = [];
    (list || []).concat(more || []).forEach(function (c) {
      if (!c || !c.id) return;
      if (by[c.id] != null) { out[by[c.id]] = Object.assign({}, out[by[c.id]], c); return; }
      by[c.id] = out.length;
      out.push(c);
    });
    return max && out.length > max ? out.slice(out.length - max) : out;
  }

  // ---- comment filters --------------------------------------------------------------------------------
  /** Lower case without Turkish / Latin diacritics: "Şöyle MI?" → "soyle mi?". */
  function fold(s) {
    return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  var Q_EN = /^(how|what|what's|whats|why|when|where|which|who|whom|whose|can|could|would|should|is|are|am|do|does|did|will|have|has|any|anyone|anybody|is there|are there)\b/;
  var Q_TR = /(^|\s)(nasil|neden|niye|nicin|ne zaman|nerede|nereden|nereye|hangi|hangisi|kim|kimin|kac|kacta|acaba|ne yapmali|ne yapmam)(\s|$|[,.!])/;
  var Q_TR_PARTICLE = /(^|\s)(mi|mu|misin|musun|miyim|muyum|midir|mudur|miydi|muydu|misiniz|musunuz|mi\?|mu\?)(\s|$|[?,.!])/;
  // Exclamations that start like questions: "what a video", "how cool is that".
  var NOT_Q = /^(what an?|how (cool|nice|great|amazing|awesome|beautiful|useful|helpful|smart|clever|easy|simple))\b/;
  /** A question in English or Turkish: a question mark, a question word at the start, or a TR question particle. */
  function isQuestion(text) {
    var raw = String(text || '');
    if (/[?？]/.test(raw)) return true;
    var sentences = fold(raw).split(/[.!\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    return sentences.some(function (s) { return (Q_EN.test(s) && !NOT_Q.test(s) && s.split(/\s+/).length >= 3) || Q_TR.test(s) || Q_TR_PARTICLE.test(s); });
  }

  // Profanity, matched on whole words after folding, leetspeak and stretched letters ("fuuuck").
  // `w:` = the word itself (or with the listed suffixes); `s:` = a stem at the start of a word.
  var PROFANITY = {
    en: ['s:fuck', 's:fuk', 's:fck', 's:motherf', 's:shit', 's:bullshit', 's:bitch', 's:asshole', 's:arsehole', 'w:ass', 'w:asses', 'w:dick', 'w:dicks', 's:dickhead', 's:cunt', 's:bastard',
      's:slut', 's:whore', 's:retard', 'w:wtf', 'w:stfu', 'w:piss', 'w:pissed', 's:douche', 'w:twat', 's:wanker', 'w:prick', 'w:cock', 'w:cocks', 's:cocksucker', 's:jackass', 's:dumbass'],
    tr: ['w:amk', 'w:aq', 'w:amq', 's:amina', 's:aminak', 's:amcik', 'w:am', 's:orospu', 's:orosbu', 's:pic', 's:siktir', 's:sikerim', 's:sikeyim', 's:sikim', 'w:sik', 's:sikik', 's:sikis',
      's:yarrak', 's:yarak', 'w:got', 'w:gotu', 'w:gotun', 'w:gotunu', 's:gotveren', 's:gavat', 's:ibne', 's:pezevenk', 's:kahpe', 's:serefsiz', 'w:oc', 'w:mk', 's:kaltak', 's:yavsak', 's:dalyarak']
  };
  // "pic" would also catch "pick", "picture": only the Turkish "piç" (folded) with its own suffixes.
  var STEM_GUARD = { pic: /^pic(lik|ler|in|i|e)?$/, yarak: /^yarak(lar|in|i)?$/, am: null };
  var LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '@': 'a', '$': 's', '5': 's', '7': 't', '!': 'i' };
  function words(text) {
    var t = fold(text).replace(/[01345@$7!](?=[a-z*])|(?<=[a-z*])[01345@$7!]/g, function (c) { return LEET[c] || c; });
    t = t.replace(/([a-z])\1{2,}/g, '$1');
    return t.split(/[^a-z0-9*]+/).map(function (w) { return w.replace(/^\*+|\*+$/g, ''); }).filter(Boolean);
  }
  var LISTS = {};
  function listFor(langs) {
    var key = langs.join(',');
    if (LISTS[key]) return LISTS[key];
    var whole = {};
    var stems = [];
    langs.forEach(function (l) { (PROFANITY[l] || []).forEach(function (e) { if (e[0] === 'w') whole[e.slice(2)] = 1; else stems.push(e.slice(2)); }); });
    LISTS[key] = { whole: whole, stems: stems };
    return LISTS[key];
  }
  function bad(w, L) {
    if (L.whole[w]) return true;
    for (var j = 0; j < L.stems.length; j++) {
      var st = L.stems[j];
      if (w.indexOf(st) !== 0) continue;
      var g = STEM_GUARD[st];
      if (g && !g.test(w)) continue;
      return true;
    }
    return false;
  }
  // "f*ck", "sh*t", "a**hole": each run of stars stands for one letter repeated (a vowel or s).
  function expansions(w) {
    if (w.indexOf('*') === -1) return [w];
    var out = [w.replace(/\*/g, '')];
    'aeious'.split('').forEach(function (c) { out.push(w.replace(/\*+/g, function (run) { return c.repeat(Math.min(run.length, 3)); })); });
    return out;
  }
  /** The first profane word in the text (TR + EN by default), or null. */
  function profane(text, langs) {
    var L = listFor(langs || ['en', 'tr']);
    var ws = words(text);
    for (var i = 0; i < ws.length; i++) {
      var ex = expansions(ws[i]);
      for (var k = 0; k < ex.length; k++) if (ex[k] && bad(ex[k], L)) return ws[i];
    }
    return null;
  }
  /** Phrase match: case- and diacritic-insensitive; several phrases separated by commas = any of them. */
  function matchesPhrase(text, phrase) {
    var qs = String(phrase || '').split(',').map(function (q) { return fold(q).trim(); }).filter(Boolean);
    if (!qs.length) return true;
    var t = fold(text);
    return qs.some(function (q) { return t.indexOf(q) !== -1; });
  }
  /**
   * opts: { questions, phrase, hideProfanity, sort: 'top' | 'likes' | 'replies', replies: true to keep replies }.
   * → { items, hiddenProfane, total }
   */
  function filterComments(list, opts) {
    opts = opts || {};
    var hiddenProfane = 0;
    var items = (list || []).filter(function (c) {
      if (!opts.replies && opts.replies !== undefined && c.reply) return false;
      if (opts.questions && !isQuestion(c.text)) return false;
      if (opts.phrase && !matchesPhrase(c.text + ' ' + (c.author || ''), opts.phrase)) return false;
      if (opts.hideProfanity && profane(c.text)) { hiddenProfane++; return false; }
      return true;
    });
    if (opts.sort === 'likes') items = items.slice().sort(function (a, b) { return (b.likes || 0) - (a.likes || 0); });
    else if (opts.sort === 'replies') items = items.slice().sort(function (a, b) { return (b.replies || 0) - (a.replies || 0); });
    return { items: items, hiddenProfane: hiddenProfane, total: (list || []).length };
  }

  // ---- comment exports --------------------------------------------------------------------------------
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=\t\r]|^[+\-@][\w.]*\(/.test(s)) s = '\'' + s; // a spreadsheet must not run it as a formula
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function commentsCsv(list, videoId) {
    var head = ['id', 'author', 'text', 'likes', 'replies', 'published', 'is_reply', 'pinned', 'hearted', 'by_creator', 'is_question', 'url'];
    var rows = (list || []).map(function (c) {
      return [c.id, c.author, c.text, c.likes || 0, c.replies || 0, c.published, c.reply ? 1 : 0, c.pinned ? 1 : 0, c.hearted ? 1 : 0, c.creator ? 1 : 0, isQuestion(c.text) ? 1 : 0,
        videoId ? 'https://www.youtube.com/watch?v=' + videoId + '&lc=' + c.id : ''].map(csvCell).join(',');
    });
    return '﻿' + [head.join(',')].concat(rows).join('\r\n') + '\r\n';
  }
  function commentsJson(list, meta) {
    meta = meta || {};
    return JSON.stringify({ video: meta.id || null, title: meta.title || null, channel: meta.channel || null, exported_at: new Date(meta.now || Date.now()).toISOString(), count: (list || []).length,
      comments: (list || []).map(function (c) { return { id: c.id, author: c.author, text: c.text, likes: c.likes || 0, replies: c.replies || 0, published: c.published, is_reply: !!c.reply, pinned: !!c.pinned, hearted: !!c.hearted, by_creator: !!c.creator, is_question: isQuestion(c.text) }; }) }, null, 2);
  }
  function commentPrompt(list, meta, lang) {
    meta = meta || {};
    var tr = lang === 'tr';
    var head = tr ? [
      'Aşağıda bir YouTube videosunun yorumları var' + (meta.title ? ': "' + meta.title + '"' : '') + (meta.channel ? ' (' + meta.channel + ')' : '') + '. Her satır: beğeni sayısı, yorum.',
      'Lütfen şunları çıkar:',
      '1. Genel duygu (olumlu / nötr / olumsuz, yaklaşık yüzdelerle) ve tek cümlelik gerekçe.',
      '2. İzleyicilerin en çok beğendikleri (örnek yorumlarla).',
      '3. Beğenmedikleri, şikâyetler ve kafalarını karıştıran yerler.',
      '4. Cevaplanması gereken sorular (en çok beğenilenden başla).',
      '5. Yorumlardan çıkan 5 yeni video fikri (başlık önerisiyle).',
      'OpenOutlier MCP bağlıysa `get_comments` aracı (video: ' + (meta.id || '…') + ') daha fazla yorumu da getirebilir.'
    ] : [
      'Below are the comments on a YouTube video' + (meta.title ? ': "' + meta.title + '"' : '') + (meta.channel ? ' (' + meta.channel + ')' : '') + '. Each line: likes, comment.',
      'Please give me:',
      '1. The overall sentiment (positive / neutral / negative, roughly in percent) and one sentence on why.',
      '2. What viewers liked most (with example comments).',
      '3. What they disliked, complained about or found confusing.',
      '4. Questions worth answering (most-liked first).',
      '5. Five new video ideas that come out of the comments (with a title for each).',
      'If the OpenOutlier MCP server is connected, its `get_comments` tool (video: ' + (meta.id || '…') + ') can fetch more comments.'
    ];
    var body = (list || []).map(function (c) { return '[' + (c.likes || 0) + '] ' + (c.reply ? '↳ ' : '') + String(c.text).replace(/\s+/g, ' '); }).join('\n');
    return head.join('\n') + '\n\n' + (meta.id ? videoUrl(meta.id) + '\n' : '') + '\n<comments count="' + (list || []).length + '">\n' + cut(body, MAX_PROMPT_CHARS) + '\n</comments>\n';
  }

  // ---- thumbnails (Studio's 2 MB limit) ----------------------------------------------------------------
  var THUMB_LIMIT = 2 * 1024 * 1024;
  var THUMB_TARGET = Math.floor(1.95 * 1024 * 1024);
  /**
   * The encodings to try, best first, until one fits under THUMB_TARGET: JPEG at falling quality, then
   * smaller sizes. Never wider than 1920 px (more is wasted on YouTube), never below 1280 px wide
   * (YouTube's recommended size) unless the original is smaller. → [{ w, h, q }]
   */
  function thumbPlan(width, height) {
    width = Math.max(1, Math.round(width || 0));
    height = Math.max(1, Math.round(height || 0));
    var maxW = Math.min(width, 1920);
    var minW = Math.min(maxW, 1280);
    var widths = [maxW];
    [0.85, 0.72].forEach(function (f) { var w = Math.round(maxW * f); if (w >= minW && w < widths[widths.length - 1]) widths.push(w); });
    if (widths[widths.length - 1] > minW) widths.push(minW);
    var out = [];
    widths.forEach(function (w) {
      [0.92, 0.86, 0.8, 0.72, 0.64].forEach(function (q) { out.push({ w: w, h: Math.round(height * w / width), q: q }); });
    });
    return out;
  }
  function fileSize(bytes, lang) {
    var mb = bytes / 1024 / 1024;
    var s = mb >= 1 ? mb.toFixed(mb >= 10 ? 0 : 1) + ' MB' : Math.round(bytes / 1024) + ' KB';
    return lang === 'tr' ? s.replace('.', ',') : s;
  }

  /** A file name from a title: "XLOOKUP vs VLOOKUP" → "xlookup-vs-vlookup". */
  function slug(s, fallback) {
    var x = fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return x || fallback || 'video';
  }

  return {
    parseClock: parseClock, clock: clock, srtTime: srtTime, clean: clean,
    readTranscriptDom: readTranscriptDom, fromPairs: fromPairs, parseJson3: parseJson3, parseCaptionXml: parseCaptionXml,
    captionTracks: captionTracks, pickTrack: pickTrack, json3Url: json3Url,
    asText: asText, toSrt: toSrt, toMarkdown: toMarkdown, hookOf: hookOf, transcriptPrompt: transcriptPrompt, videoUrl: videoUrl,
    parseCompact: parseCompact, parseComments: parseComments, commentsTotal: commentsTotal, mergeComments: mergeComments,
    fold: fold, isQuestion: isQuestion, profane: profane, matchesPhrase: matchesPhrase, filterComments: filterComments,
    commentsCsv: commentsCsv, commentsJson: commentsJson, commentPrompt: commentPrompt, slug: slug, PROFANITY: PROFANITY,
    THUMB_LIMIT: THUMB_LIMIT, THUMB_TARGET: THUMB_TARGET, thumbPlan: thumbPlan, fileSize: fileSize
  };
});
