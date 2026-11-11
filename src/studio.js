// OpenOutlier – "My account": your own Instagram account through a self-hosted
// chatmany worker (official Instagram API). This file is the pure part: the
// automation form <-> campaign payload, and insights -> library post records.
// No DOM or chrome.* access, so it runs in Node tests too.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelScopeStudio = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PENDING_PREFIX = 'PENDING_';
  var CAPTION_MAX = 600;
  /** chatmany needs this many comparable characters of caption to auto-attach a post. */
  var MIN_CAPTION_MATCH = 15;
  var REWARD_TYPES = ['link', 'code', 'text'];
  /** Counters that only grow; the newest reading of everything else replaces the old one. */
  var GROWING = { views: 1, likes: 1, comments: 1, shares: 1, saves: 1, reach: 1, watchTotalMs: 1, seenAt: 1 };

  var DEFAULT_COPY = {
    opening: 'Hey! Tap below to grab the link 👇',
    opening_button: 'Send it to me',
    follow_gate: "Make sure you're following so you don't miss the next one 🙌 Not following yet? Follow, then tap below.",
    follow_button: '✅ I followed',
    follow_retry: '',
    email_ask: 'Want it in your inbox too? Tap your email or reply with it.',
    delivery: 'Here you go 🎉 {reward}'
  };

  function str(v) { return typeof v === 'string' ? v : ''; }

  /** "a, b\nc" -> ['a', 'b', 'c'] (trimmed, no blanks, no repeats). */
  function splitList(text, lowerDedupe) {
    var seen = {};
    return str(text).split(/[,\n]/).map(function (s) { return s.trim(); }).filter(function (s) {
      var key = lowerDedupe === false ? s : s.toLowerCase();
      if (!s || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /** One per line; commas stay (these are sentences). */
  function splitLines(text) {
    return str(text).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // ---- server link -------------------------------------------------------------
  /** { baseUrl, origin } or { error }. Only http(s); the path is dropped. */
  function normalizeServer(input) {
    var raw = str(input && input.baseUrl).trim();
    var token = str(input && input.token).trim();
    var url = null;
    var scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
    if (!scheme || /^https?$/i.test(scheme[1])) {
      try { url = new URL(scheme ? raw : 'https://' + raw); } catch (e) { url = null; }
    }
    if (!raw || !url || !/^https?:$/.test(url.protocol) || !url.hostname) {
      return { error: 'Enter your chatmany address, e.g. https://chatmany.you.workers.dev' };
    }
    if (!token) return { error: 'Enter the owner token (OWNER_TOKEN of your chatmany worker).' };
    return { baseUrl: url.origin, origin: url.origin, token: token };
  }

  // ---- automations -------------------------------------------------------------
  function isPending(mediaId) { return str(mediaId).indexOf(PENDING_PREFIX) === 0; }

  function slug(s) {
    return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'automation';
  }

  function defaultDraft(mediaId) {
    return {
      campaign_id: '',
      name: '',
      attach: mediaId ? 'post' : 'caption', // 'post' = a published post, 'caption' = wait for one
      media_id: mediaId || '',
      caption_match: '',
      keywords: '',
      match: 'word',
      exclude: '',
      reply_enabled: false,
      reply_texts: 'Sent you a DM! 📩\nCheck your DMs 👀',
      check_follow: false,
      verify_follow: false,
      ask_email: false,
      reward_type: 'link',
      reward_value: '',
      opening: DEFAULT_COPY.opening,
      opening_button: DEFAULT_COPY.opening_button,
      follow_gate: DEFAULT_COPY.follow_gate,
      follow_button: DEFAULT_COPY.follow_button,
      follow_retry: DEFAULT_COPY.follow_retry,
      email_ask: DEFAULT_COPY.email_ask,
      delivery: DEFAULT_COPY.delivery,
      active: true
    };
  }

  /** A saved campaign as editable form values. */
  function draftFromCampaign(c) {
    var d = defaultDraft();
    var copy = c.copy || {};
    var pr = c.public_reply || {};
    d.campaign_id = str(c.campaign_id);
    d.name = str(c.name) || str(c.campaign_id);
    d.attach = isPending(c.media_id) ? 'caption' : 'post';
    d.media_id = str(c.media_id);
    d.caption_match = str(c.caption_match);
    d.keywords = (c.keywords || []).join(', ');
    d.match = c.match === 'exact' ? 'exact' : 'word';
    d.exclude = (c.exclude || []).join(', ');
    d.reply_enabled = pr.enabled === true;
    if (Array.isArray(pr.texts) && pr.texts.length) d.reply_texts = pr.texts.join('\n');
    d.check_follow = !!c.check_follow;
    d.verify_follow = !!c.verify_follow;
    d.ask_email = !!c.ask_email;
    d.reward_type = REWARD_TYPES.indexOf(c.reward && c.reward.type) !== -1 ? c.reward.type : 'link';
    d.reward_value = str(c.reward && c.reward.value);
    // Show what is stored. A text the campaign does not set stays empty, so saving does not
    // replace chatmany's own default wording with ours.
    Object.keys(DEFAULT_COPY).forEach(function (k) { d[k] = str(copy[k]); });
    d.active = c.active !== false;
    return d;
  }

  /**
   * Form values -> the campaign chatmany stores. `base` is the campaign being edited: fields this
   * form does not show are carried over unchanged. Returns { campaign, active } or { error }.
   */
  function campaignFromDraft(d, base, newId) {
    var name = str(d.name).trim();
    var keywords = splitList(d.keywords);
    var replyTexts = splitLines(d.reply_texts);
    var captionMatch = str(d.caption_match).trim();
    var mediaId;

    if (!name) return { error: 'Give the automation a name.' };
    var id = str(d.campaign_id) || str(newId) || slug(name) + '-' + Math.random().toString(36).slice(2, 8);

    if (d.attach === 'post') {
      mediaId = str(d.media_id);
      if (!mediaId || isPending(mediaId)) return { error: 'Choose the post this automation runs on.' };
    } else {
      // Same comparison chatmany makes: letters, digits and single spaces only.
      if (captionMatch.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim().length < MIN_CAPTION_MATCH) {
        return { error: 'Paste the first words of the caption (at least ' + MIN_CAPTION_MATCH + ' characters) so the post can be recognised when it is published.' };
      }
      mediaId = isPending(d.media_id) ? d.media_id : PENDING_PREFIX + id;
    }
    if (!keywords.length) return { error: 'Add at least one keyword people comment.' };
    if (!str(d.opening).trim()) return { error: 'The opening DM cannot be empty.' };
    if (!str(d.delivery).trim()) return { error: 'The delivery message cannot be empty.' };
    if (!str(d.reward_value).trim()) return { error: 'Add the link, code or text people receive.' };
    if (d.reply_enabled && !replyTexts.length) return { error: 'Add at least one public reply, or turn public replies off.' };

    var campaign = Object.assign({}, base || {});
    delete campaign.active;
    delete campaign.archived;
    delete campaign.updated_at;
    campaign.campaign_id = id;
    campaign.name = name;
    campaign.media_id = mediaId;
    campaign.keywords = keywords;
    campaign.match = d.match === 'exact' ? 'exact' : 'word';
    // Kept on an attached campaign too: chatmany leaves it there after auto-attaching, and only
    // reads it while the campaign is waiting.
    if (captionMatch) campaign.caption_match = captionMatch; else delete campaign.caption_match;
    campaign.exclude = splitList(d.exclude);
    campaign.public_reply = { enabled: !!d.reply_enabled, texts: replyTexts };
    campaign.check_follow = !!d.check_follow;
    campaign.verify_follow = !!d.check_follow && !!d.verify_follow;
    campaign.ask_email = !!d.ask_email;
    campaign.reward = { type: REWARD_TYPES.indexOf(d.reward_type) !== -1 ? d.reward_type : 'link', value: str(d.reward_value).trim() };
    var copy = Object.assign({}, (base && base.copy) || {});
    Object.keys(DEFAULT_COPY).forEach(function (k) {
      var v = str(d[k]).trim();
      if (v) copy[k] = v; else delete copy[k];
    });
    campaign.copy = copy;
    return { campaign: campaign, active: d.active !== false };
  }

  /** Where an automation runs: { state: 'attached' | 'waiting' | 'missing', media }. */
  function attachment(campaign, media) {
    if (isPending(campaign.media_id)) return { state: 'waiting', media: null };
    var hit = (media || []).filter(function (m) { return m.id === campaign.media_id; })[0] || null;
    return { state: hit ? 'attached' : 'missing', media: hit };
  }

  // ---- insights -> library records ------------------------------------------------
  function codeOf(permalink) {
    var m = /instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,64})/.exec(str(permalink));
    return m ? m[1] : null;
  }

  function hashtagsOf(caption) {
    var out = [];
    var seen = {};
    var re = /#([\p{L}\p{N}_]+)/gu;
    var m;
    while ((m = re.exec(caption))) {
      var tag = m[1].toLowerCase();
      if (!seen[tag]) { seen[tag] = true; out.push(tag); }
    }
    return out;
  }

  /** Graph writes "+0000"; Date.parse only promises "+00:00". */
  function timeOf(ts) {
    var t = Date.parse(str(ts).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return isFinite(t) ? t : null;
  }

  function n(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /**
   * One row per media of the connected account, joining /api/media (thumbnail, public counts) with
   * /api/insights (views, reach, watch time, skip rate). Newest first.
   */
  function joinMedia(media, insightRows) {
    var byId = {};
    (insightRows || []).forEach(function (r) { byId[r.id] = r; });
    return (media || []).map(function (m) {
      var r = byId[m.id] || {};
      var ins = r.insights || {};
      var reel = (r.media_product_type || m.media_product_type) === 'REELS';
      return {
        id: m.id,
        code: codeOf(m.permalink),
        permalink: m.permalink || null,
        caption: str(m.caption),
        thumb: m.thumbnail_url || (m.media_type === 'IMAGE' ? m.media_url : null) || null,
        // What the viewer plays or shows. Instagram's links expire after a few days; a refresh renews them.
        mediaUrl: m.media_url || null,
        video: m.media_type === 'VIDEO',
        takenAt: timeOf(m.timestamp),
        type: reel ? 'reel' : m.media_type === 'VIDEO' ? 'video' : m.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : 'photo',
        views: n(ins.views),
        reach: n(ins.reach),
        likes: n(ins.likes) !== null ? ins.likes : n(m.like_count),
        comments: n(ins.comments) !== null ? ins.comments : n(m.comments_count),
        saves: n(ins.saved),
        shares: n(ins.shares),
        avgWatchMs: n(ins.ig_reels_avg_watch_time),
        watchTotalMs: n(ins.ig_reels_video_view_total_time),
        skipRate: n(ins.reels_skip_rate),
        error: r.insights ? null : (r.error || null)
      };
    }).sort(function (a, b) { return (b.takenAt || 0) - (a.takenAt || 0); });
  }

  /** A joined row as a library post (same shape src/extract.js writes), plus the insight fields. */
  function toLibraryPost(row, account, now) {
    if (!row.code) return null;
    var caption = row.caption.length > CAPTION_MAX ? row.caption.slice(0, CAPTION_MAX) + '…' : row.caption;
    return {
      code: row.code,
      graphId: row.id,
      url: 'https://www.instagram.com/' + (row.type === 'reel' ? 'reel' : 'p') + '/' + row.code + '/',
      owner: account.username,
      ownerPic: account.pic || null,
      type: row.type,
      takenAt: row.takenAt,
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      saves: row.saves,
      reach: row.reach,
      avgWatchMs: row.avgWatchMs,
      watchTotalMs: row.watchTotalMs,
      skipRate: row.skipRate,
      caption: caption,
      hashtags: hashtagsOf(caption),
      thumb: row.thumb,
      source: 'api',
      seenAt: now
    };
  }

  function mergePost(prev, next) {
    if (!prev) return next;
    var out = {};
    var k;
    for (k in prev) out[k] = prev[k];
    for (k in next) {
      var b = next[k];
      if (b === null || b === undefined || b === '' || (Array.isArray(b) && !b.length)) continue;
      out[k] = GROWING[k] && typeof prev[k] === 'number' && typeof b === 'number' ? Math.max(prev[k], b) : b;
    }
    return out;
  }

  /**
   * Merge the account's rows into its stored library posts ({code: post}). Posts collected from
   * the web keep their extra fields (duration, audio, files); official counts are added on top.
   */
  function mergeIntoLibrary(existing, rows, account, now) {
    var out = {};
    var k;
    for (k in existing || {}) out[k] = existing[k];
    (rows || []).forEach(function (row) {
      var post = toLibraryPost(row, account, now);
      if (post) out[post.code] = mergePost(out[post.code], post);
    });
    return out;
  }

  // ---- publishing ------------------------------------------------------------------
  var MAX_CAPTION = 2200;
  var MAX_CAROUSEL = 20;
  var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  var MAX_VIDEO_BYTES = 95 * 1024 * 1024;
  // 'tiktok' is a draft-only kind: one video sent to TikTok (platform "tiktok" on the worker).
  var KIND_NAMES = { reel: 'Reel', post: 'Post', story: 'Story', tiktok: 'TikTok' };

  /**
   * What a chosen file is to the publisher: { type: 'image' | 'video', convert } or { error }.
   * Instagram takes JPEG, MP4 and MOV; other still images are converted to JPEG before upload.
   */
  function fileInfo(file) {
    var mime = str(file && file.type).toLowerCase();
    var name = str(file && file.name) || 'This file';
    if (mime === 'image/jpeg') return { type: 'image', convert: false };
    if (mime === 'image/png' || mime === 'image/webp') return { type: 'image', convert: true };
    if (mime === 'video/mp4' || mime === 'video/quicktime') {
      if (file.size > MAX_VIDEO_BYTES) return { error: name + ' is ' + Math.ceil(file.size / 1048576) + ' MB; videos can be up to ' + Math.floor(MAX_VIDEO_BYTES / 1048576) + ' MB.' };
      return { type: 'video', convert: false };
    }
    return { error: name + ' cannot be published. Use JPEG, PNG or WebP images and MP4 or MOV videos.' };
  }

  function defaultPostDraft() {
    return { id: '', kind: 'reel', caption: '', media: [], cover_key: '', files: [], cover: null, share_to_feed: true, campaign_id: '', when: 'now', at: '' };
  }

  /** Unix seconds -> the value a <input type="datetime-local"> shows, in local time. */
  function localInputValue(seconds) {
    var d = new Date(seconds * 1000);
    function p(v) { return (v < 10 ? '0' : '') + v; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** A queued post (as /api/posts lists it) as editable form values. */
  function postDraftFromPost(post, nowMs) {
    var d = defaultPostDraft();
    var o = post.options || {};
    d.id = post.id;
    d.kind = post.platform === 'tiktok' ? 'tiktok' : KIND_NAMES[post.kind] ? post.kind : 'reel';
    d.caption = str(post.caption);
    d.media = (post.media || []).map(function (m) { return { key: m.key, type: m.type }; });
    d.cover_key = str(o.cover_key);
    d.share_to_feed = o.share_to_feed !== false;
    d.campaign_id = str(o.campaign_id);
    var future = post.scheduled_at * 1000 > nowMs;
    d.when = future ? 'later' : 'now';
    d.at = future ? localInputValue(post.scheduled_at) : '';
    return d;
  }

  /**
   * The media the post will have: newly chosen files replace the stored ones. Each item is
   * { type } plus either { file } (to upload) or { key } (already on the worker).
   */
  function postItems(d) {
    if (d.files && d.files.length) {
      return d.files.map(function (f) { var info = fileInfo(f); return { type: info.type, file: f, error: info.error || null }; });
    }
    return (d.media || []).map(function (m) { return { type: m.type, key: m.key }; });
  }

  /** Why this draft cannot be published, or null. Checked before anything is uploaded. */
  function postProblem(d, nowMs) {
    var items = postItems(d);
    var bad = items.filter(function (i) { return i.error; })[0];
    if (bad) return bad.error;
    if (!items.length) return 'Choose the ' + (d.kind === 'reel' || d.kind === 'tiktok' ? 'video' : d.kind === 'story' ? 'image or video' : 'images') + ' to publish.';
    if (d.kind === 'reel' && (items.length !== 1 || items[0].type !== 'video')) return 'A reel is exactly one video.';
    if (d.kind === 'tiktok' && (items.length !== 1 || items[0].type !== 'video')) return 'A TikTok post is exactly one video.';
    if (d.kind === 'story' && items.length !== 1) return 'A story is exactly one image or video. Schedule several stories one by one.';
    if (d.kind === 'post') {
      if (items.length > MAX_CAROUSEL) return 'A carousel holds at most ' + MAX_CAROUSEL + ' items.';
      if (items.length === 1 && items[0].type === 'video') return 'A single video is published as a reel. Choose Reel as the type.';
    }
    if (d.kind === 'reel' && d.cover) {
      var c = fileInfo(d.cover);
      if (c.error || c.type !== 'image') return 'The cover must be an image.';
    }
    if (d.kind !== 'story' && str(d.caption).trim().length > MAX_CAPTION) return 'The caption is ' + str(d.caption).trim().length + ' characters; ' + (d.kind === 'tiktok' ? 'TikTok' : 'Instagram') + ' allows ' + MAX_CAPTION + '.';
    if (d.when === 'later') {
      var t = Date.parse(str(d.at));
      if (!isFinite(t)) return 'Choose the date and time to publish.';
      if (t <= nowMs) return 'That time has passed. Choose a later one, or publish now.';
    }
    return null;
  }

  /** The body for POST /api/posts once every file has a key on the worker. */
  function postPayload(d, mediaKeys, coverKey) {
    if (d.kind === 'tiktok') {
      var tt = {
        platform: 'tiktok',
        kind: 'reel',
        caption: str(d.caption).trim(),
        media: mediaKeys.slice(0, 1).map(function (k) { return { key: k }; }),
        options: { tiktok_mode: 'inbox' },
        scheduled_at: d.when === 'later' ? Math.floor(Date.parse(d.at) / 1000) : 0
      };
      if (d.id) tt.id = d.id;
      return tt;
    }
    var body = {
      kind: d.kind,
      caption: d.kind === 'story' ? '' : str(d.caption).trim(),
      media: mediaKeys.map(function (k) { return { key: k }; }),
      options: {},
      scheduled_at: d.when === 'later' ? Math.floor(Date.parse(d.at) / 1000) : 0 // 0 = now
    };
    if (d.id) body.id = d.id;
    if (d.kind === 'reel') {
      body.options.share_to_feed = d.share_to_feed !== false;
      if (coverKey) body.options.cover_key = coverKey;
    }
    if (d.kind !== 'story' && d.campaign_id) body.options.campaign_id = d.campaign_id;
    return body;
  }

  /** "Reel", "Carousel (3)", "Photo", "Story". */
  function postLabel(post) {
    if (post.platform === 'tiktok' || post.kind === 'tiktok') return 'TikTok';
    var n = (post.media || []).length;
    if (post.kind === 'post') return n > 1 ? 'Carousel (' + n + ')' : 'Photo';
    return KIND_NAMES[post.kind] || post.kind;
  }

  /** Fit a w × h image inside max × max, never enlarging. */
  function fitWithin(w, h, max) {
    var k = Math.min(1, max / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
  }

  // ---- formatting ---------------------------------------------------------------------
  function seconds(ms) {
    if (ms === null || ms === undefined) return '–';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + ' s';
    return Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s';
  }

  function percent(v) { return v === null || v === undefined ? '–' : v.toFixed(v < 10 ? 1 : 0) + '%'; }

  /** "12 comments → 10 DMs → 6 clicks → 5 delivered" from /api/dashboard cards. */
  function funnelText(cards) {
    if (!cards) return '';
    if (!cards.comments && !cards.sends) return 'No comments matched yet';
    return [
      cards.comments + (cards.comments === 1 ? ' comment' : ' comments'),
      cards.sends + (cards.sends === 1 ? ' DM' : ' DMs'),
      cards.clicks + (cards.clicks === 1 ? ' click' : ' clicks'),
      cards.delivered + ' delivered'
    ].join(' → ');
  }

  return {
    PENDING_PREFIX: PENDING_PREFIX,
    DEFAULT_COPY: DEFAULT_COPY,
    REWARD_TYPES: REWARD_TYPES,
    splitList: splitList,
    splitLines: splitLines,
    normalizeServer: normalizeServer,
    isPending: isPending,
    defaultDraft: defaultDraft,
    draftFromCampaign: draftFromCampaign,
    campaignFromDraft: campaignFromDraft,
    attachment: attachment,
    codeOf: codeOf,
    joinMedia: joinMedia,
    toLibraryPost: toLibraryPost,
    mergeIntoLibrary: mergeIntoLibrary,
    seconds: seconds,
    percent: percent,
    funnelText: funnelText,
    MAX_CAPTION: MAX_CAPTION,
    MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
    fileInfo: fileInfo,
    defaultPostDraft: defaultPostDraft,
    postDraftFromPost: postDraftFromPost,
    localInputValue: localInputValue,
    postItems: postItems,
    postProblem: postProblem,
    postPayload: postPayload,
    postLabel: postLabel,
    fitWithin: fitWithin
  };
});
