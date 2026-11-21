// OpenOutlier – sponsor and affiliate scan of video descriptions (docs/youtube-niche-plan.md 6.3).
//
// Rule-based, no model: a description is read for
//   sponsor     "sponsored by X", "thanks to X for sponsoring", "brought to you by X",
//               "in partnership with X"; TR "X sponsorluğunda", "sponsorumuz X", "X iş birliğiyle"
//   code        "use code ABC", "promo code: ABC", TR "ABC kodunu kullan", "indirim kodu: ABC"
//   discount    "20% off", "%20 indirim"
//   affiliate   Amazon links with tag=, amzn.to, and known affiliate networks
//               (ShareASale, Awin, Impact, ClickBank, Rakuten …), ref= / aff= / affiliate= links
//   short-link  bit.ly, geni.us, tinyurl … (where they go isn't visible without opening them)
//   utm         any other link that carries utm_* parameters (a tracked, promoted link)
// plus a disclosure flag ("affiliate links", "#ad", "ortaklık bağlantısı" …). Social and
// platform links (YouTube, Instagram, Discord, Patreon …) never count as a brand.
//
// The bridge runs it over the tracked channels' descriptions (mcp/content.mjs → sponsor_mentions,
// the Niş Takibi list, the channel page card). UMD: self.OpenOutlierSponsors.
'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierSponsors = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Known sponsors and affiliate programs by domain → shown name.
  var BRANDS = {
    'skillshare.com': 'Skillshare', 'skl.sh': 'Skillshare', 'nordvpn.com': 'NordVPN', 'expressvpn.com': 'ExpressVPN', 'surfshark.com': 'Surfshark', 'squarespace.com': 'Squarespace',
    'brilliant.org': 'Brilliant', 'audible.com': 'Audible', 'hellofresh.com': 'HelloFresh', 'notion.so': 'Notion', 'masterclass.com': 'MasterClass',
    'curiositystream.com': 'CuriosityStream', 'ground.news': 'Ground News', 'incogni.com': 'Incogni', 'aura.com': 'Aura', 'betterhelp.com': 'BetterHelp',
    'manscaped.com': 'Manscaped', 'joinhoney.com': 'Honey', 'blinkist.com': 'Blinkist', 'raidshadowlegends.com': 'Raid: Shadow Legends', 'coursera.org': 'Coursera',
    'udemy.com': 'Udemy', 'aka.ms': 'Microsoft', 'datacamp.com': 'DataCamp', 'grammarly.com': 'Grammarly', 'canva.com': 'Canva', 'hostinger.com': 'Hostinger', 'bluehost.com': 'Bluehost',
    'wix.com': 'Wix', 'shopify.com': 'Shopify', 'monday.com': 'monday.com', 'clickup.com': 'ClickUp', 'zapier.com': 'Zapier', 'kutools.com': 'Kutools',
    'extendoffice.com': 'Kutools', 'xelplus.com': 'Xelplus', 'ablebits.com': 'Ablebits', 'simplilearn.com': 'Simplilearn', 'linkedin.com/learning': 'LinkedIn Learning',
    'factor75.com': 'Factor', 'athleticgreens.com': 'AG1', 'drinkag1.com': 'AG1', 'ridge.com': 'Ridge', 'opera.com': 'Opera', 'brave.com': 'Brave'
  };
  var NETWORKS = {
    'shareasale.com': 'ShareASale', 'awin1.com': 'Awin', 'clickbank.net': 'ClickBank', 'hop.clickbank.net': 'ClickBank', 'linksynergy.com': 'Rakuten', 'click.linksynergy.com': 'Rakuten',
    'anrdoezrs.net': 'CJ', 'jdoqocy.com': 'CJ', 'tkqlhce.com': 'CJ', 'dpbolvw.net': 'CJ', 'kqzyfj.com': 'CJ', 'sjv.io': 'Impact', 'pxf.io': 'Impact', 'mvnv.net': 'Impact', '8odi.net': 'Impact',
    'partnerstack.com': 'PartnerStack', 'prf.hn': 'Partnerize', 'go2cloud.org': 'HasOffers', 'refersion.com': 'Refersion', 'impact.com': 'Impact', 'avantlink.com': 'AvantLink'
  };
  var SHORT = ['bit.ly', 'amzn.to', 'geni.us', 'tinyurl.com', 'rebrand.ly', 'cutt.ly', 't.ly', 'ow.ly', 'goo.gl', 'shorturl.at', 'is.gd', 'buff.ly', 'trib.al', 'lnk.to', 'fas.st', 'kit.co', 'tidd.ly', 'rstyle.me', 'shrsl.com', 'howl.me'];
  // Never a brand: the channel's own social presence and the platforms themselves.
  var IGNORE = ['youtube.com', 'youtu.be', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'facebook.com', 'fb.com', 'fb.me', 'linkedin.com', 'discord.gg', 'discord.com',
    't.me', 'telegram.me', 'wa.me', 'whatsapp.com', 'reddit.com', 'threads.net', 'pinterest.com', 'twitch.tv', 'patreon.com', 'ko-fi.com', 'buymeacoffee.com', 'linktr.ee',
    'github.com', 'google.com', 'goo.gle', 'microsoft.com', 'support.microsoft.com', 'apple.com', 'wikipedia.org', 'spotify.com', 'open.spotify.com', 'soundcloud.com', 'gmail.com', 'outlook.com'];

  function fold(s) {
    return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function hostOf(url) {
    var m = /^(?:https?:\/\/)?([^/?#\s]+)/i.exec(String(url || ''));
    return m ? m[1].toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '') : '';
  }
  function inList(host, list) {
    for (var i = 0; i < list.length; i++) if (host === list[i] || host.slice(-(list[i].length + 1)) === '.' + list[i]) return list[i];
    return null;
  }
  function inMap(host, path, map) {
    var full = host + path;
    for (var k in map) {
      if (k.indexOf('/') !== -1) { if (full.indexOf(k) === 0) return map[k]; continue; }
      if (host === k || host.slice(-(k.length + 1)) === '.' + k) return map[k];
    }
    return null;
  }
  /** "skillshare.com" → "Skillshare", "go.nordvpn.net" → "Nordvpn". */
  function nameFromHost(host) {
    var parts = host.split('.');
    var label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (/^(co|com|org|net)$/.test(label) && parts.length >= 3) label = parts[parts.length - 3];
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : host;
  }
  /** The key brands are grouped by: "Skillshare", "skillshare.com" and "SKILLSHARE" are one. */
  function brandKey(name) {
    var n = fold(name).replace(/^(www\.)/, '');
    var host = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(n) ? n : null;
    if (host) { var br = BRANDS[host] || inMap(host, '', BRANDS); if (br) n = fold(br); else n = fold(nameFromHost(host)); }
    return n.replace(/[^a-z0-9]+/g, '');
  }

  var URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+|\b(?:www\.)?(?:bit\.ly|amzn\.to|geni\.us|tinyurl\.com|cutt\.ly)\/[A-Za-z0-9_-]+/gi;
  // Sponsor phrases: the brand is the capitalised words (or a domain) right after / before the phrase.
  // The phrase itself is matched in any case (ci), the brand must start with a capital, a digit or be a domain.
  var WORD = "(?:[A-Z0-9][\\w&+'’-]*(?:\\.(?:com|io|so|org|net|ai|app|co|news)\\b)?|[a-z][\\w-]*\\.(?:com|io|so|org|net|ai|app|co|news)\\b)";
  var BRAND_AFTER = '(' + WORD + '(?: ' + WORD + '){0,3})';
  function ci(src) {
    return src.replace(/(\\.)|([a-zA-Z])/g, function (m, esc, ch) { return esc || '[' + ch.toLowerCase() + ch.toUpperCase() + ']'; });
  }
  function P(pre, post) { return new RegExp(ci(pre) + BRAND_AFTER + ci(post || ''), 'g'); }
  var SPONSOR_EN = [
    P("(?:sponsored|presented|brought to you|made possible|supported) by:?\\s+(?:the (?:folks|team|people) (?:at|from) |our friends (?:at|from) )?"),
    P("thanks? (?:you )?to\\s+(?:our (?:friends|sponsor) (?:at )?)?", "\\s+for (?:sponsoring|supporting|partnering)"),
    P("in (?:paid )?partnership with\\s+"),
    P("today'?s sponsor(?:,|:| is)\\s+"),
    P("sponsor(?:ed)?:\\s+")
  ];
  var SPONSOR_TR = [
    P("", "(?:'|’)?(?:n[iı]n)?\\s+(?:sponsorlu(?:g|ğ)unda|sponsorlu(?:g|ğ)uyla|i(?:s|ş) ?birli(?:g|ğ)iyle|destekleriyle)"),
    P("(?:sponsorumuz|bu videonun sponsoru|videonun sponsoru)(?: olan)?:?\\s+"),
    P("", "(?:'|’)?(?:e|a|ye|ya)\\s+(?:sponsorlu(?:g|ğ)u|deste(?:g|ğ)i) i(?:c|ç)in te(?:s|ş)ekk(?:u|ü)rler")
  ];
  var NOT_SPONSORED = /\b(not|never|isn'?t|is not|no(?:t)? one)\s+(?:been\s+)?(?:sponsored|a sponsor)|sponsorlu de[gğ]il|sponsor(?:u)? yok/i;
  // Codes: an all-caps / digit token (a lower-case word after "use code" is normal prose: "use code below").
  var CODE_RE = [
    /\b(?:use|enter|with|apply)\s+(?:my\s+|our\s+|the\s+)?(?:promo\s+|discount\s+|coupon\s+|special\s+)?code[:\s]+["“'‘]?([A-Z0-9][A-Z0-9_-]{2,23})\b/g,
    /\b(?:promo|discount|coupon|voucher)\s+code[:\s-]+["“'‘]?([A-Z0-9][A-Z0-9_-]{2,23})\b/gi,
    /\bcode\s+["“'‘]?([A-Z][A-Z0-9_-]{2,23})["”'’]?\s+(?:for|to get|at checkout|gets you)\b/g,
    /["“'‘]?([A-Z0-9][A-Z0-9_-]{2,23})["”'’]?\s+(?:kodunu|kodu ile|koduyla|kuponunu)\b/g,
    /\b(?:indirim|kupon|promosyon)\s+kodu[:\s-]+["“'‘]?([A-Z0-9][A-Z0-9_-]{2,23})\b/gi
  ];
  var DISCOUNT_RE = [/\b(\d{1,2})\s?%\s?(?:off|discount)\b/gi, /(?:^|[^\w])%\s?(\d{1,2})\s+(?:indirim|indirimli)/gi, /\b(\d{1,2})\s?%\s+(?:indirim|indirimli)/gi, /\bsave\s+(\d{1,2})\s?%/gi];
  var DISCLOSURE_RE = /\baffiliate links?\b|\bamazon associate\b|\bi (?:may )?earn (?:a small )?(?:commission|from qualifying)|\b(?:#ad|#sponsored|#partner)\b|\bpaid (?:promotion|partnership)\b|\bortakl[ıi]k (?:ba[gğ]lant|link)|\baffiliate ba[gğ]lant|\bkomisyon (?:kazan|al)|\breklam i[cç]erir/i;

  function looksCode(c) {
    return /[A-Z]/.test(c) && c === c.toUpperCase() && !/^(HTTP|HTTPS|WWW|THE|AND|FOR|YOU|CTRL|ALT|SHIFT|VBA|SQL|CSV|PDF|XLSX|HTML|API|FAQ|USD|EUR|TRY|OK|NOW|BELOW|ABOVE)$/.test(c);
  }
  function cleanBrand(b) {
    var x = String(b || '').replace(/[.,:;!?)'’]+$/, '').replace(/\s+(?:and|for|to|on|in|at|with|ve|ile|için)$/i, '').trim();
    // Stop at a lower-case filler the regex let through.
    x = x.split(/\s+(?=(?:and|for|who|which|whose|that|to|is|are|ve|ile|bu)\b)/)[0];
    if (/^(the|this|our|my|a|an|today|youtube|everyone|you|bu|bizim)$/i.test(x) || x.length < 2) return null;
    return x;
  }
  function snippet(text, at, len) {
    var s = Math.max(0, at - 40);
    return (s ? '…' : '') + String(text).slice(s, at + (len || 0) + 60).replace(/\s+/g, ' ').trim() + (at + (len || 0) + 60 < text.length ? '…' : '');
  }

  /**
   * One description → { mentions: [{ kind, brand, key, at, domain?, url?, code?, pct?, text }], disclosure }.
   * kind: sponsor | affiliate | brand-link (a known sponsor's site) | utm | code | discount | short-link.
   * opts.channel: the channel's own name; its own domain doesn't count as a sponsor.
   */
  function scanDescription(text, opts) {
    opts = opts || {};
    text = String(text || '');
    var out = [];
    var seen = {};
    var own = opts.channel ? brandKey(opts.channel) : null;
    function push(m) {
      if (!m.key || (own && m.key === own && m.kind !== 'code' && m.kind !== 'discount')) return;
      var k = m.kind + '|' + m.key + '|' + (m.code || '') + '|' + (m.url || '') + '|' + (m.pct || '');
      if (seen[k]) return;
      seen[k] = 1;
      out.push(m);
    }
    if (!text.trim()) return { mentions: out, disclosure: false };
    var noSponsor = NOT_SPONSORED.test(text);

    // Links first: they name the brand most reliably.
    URL_RE.lastIndex = 0;
    var um;
    while ((um = URL_RE.exec(text))) {
      var raw = um[0];
      var at = um.index;
      var url = raw.replace(/[.,;:!?]+$/, '');
      var host = hostOf(url);
      if (!host) continue;
      var path = url.replace(/^(?:https?:\/\/)?[^/?#]+/i, '');
      var q = /[?&](tag|ref|aff|affiliate|aff_id|affid|ref_id|referral|via|irclickid|clickid)=([^&#\s]*)/i.exec(url);
      var utm = /[?&]utm_(source|medium|campaign|content|term)=/i.test(url);
      var base = { at: at, domain: host, url: url, text: snippet(text, at, raw.length) };
      if (/(^|\.)amazon\.[a-z.]+$/.test(host) || host === 'amzn.to' || host === 'a.co') {
        if (host === 'amzn.to' || host === 'a.co' || (q && /tag/i.test(q[1]))) push(Object.assign({ kind: 'affiliate', brand: 'Amazon', key: 'amazon' }, base));
        continue;
      }
      var net = inMap(host, path, NETWORKS);
      if (net) { push(Object.assign({ kind: 'affiliate', brand: net, key: brandKey(net), network: true }, base)); continue; }
      var known = inMap(host, path, BRANDS);
      if (known) { push(Object.assign({ kind: q ? 'affiliate' : utm ? 'utm' : 'brand-link', brand: known, key: brandKey(known) }, base)); continue; }
      var short = inList(host, SHORT);
      if (short) { push(Object.assign({ kind: 'short-link', brand: short, key: short.replace(/\W/g, '') }, base)); continue; }
      if (inList(host, IGNORE) && !(q && /tag|aff/i.test(q[1]))) continue;
      if (q) { push(Object.assign({ kind: 'affiliate', brand: nameFromHost(host), key: brandKey(host) }, base)); continue; }
      if (utm) push(Object.assign({ kind: 'utm', brand: nameFromHost(host), key: brandKey(host) }, base));
    }

    // Sponsor phrases (skipped when the description says it is not sponsored).
    if (!noSponsor) {
      SPONSOR_EN.concat(SPONSOR_TR).forEach(function (re) {
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(text))) {
          var b = cleanBrand(m[1]);
          // A known domain in the phrase names the brand ("brilliant.org" → Brilliant).
          if (b && /\.[a-z]{2,4}$/i.test(b)) { var kb = inMap(hostOf(b), '', BRANDS); if (kb) b = kb; }
          if (b) push({ kind: 'sponsor', brand: b, key: brandKey(b), at: m.index, text: snippet(text, m.index, m[0].length) });
          if (m[0].length === 0) re.lastIndex++;
        }
      });
    }
    // Codes and discounts belong to the nearest brand before them in the same paragraph (or right after, on the same line).
    var named = function () { return out.filter(function (x) { return x.kind === 'sponsor' || x.kind === 'affiliate' || x.kind === 'brand-link' || x.kind === 'utm'; }); };
    function owner(at) {
      var list = named();
      var para = text.lastIndexOf('\n\n', at);
      var before = list.filter(function (x) { return x.at <= at && x.at > para; }).sort(function (a, b) { return b.at - a.at; })[0];
      if (before) return before;
      var lineEnd = text.indexOf('\n', at);
      return list.filter(function (x) { return x.at > at && (lineEnd === -1 || x.at < lineEnd); }).sort(function (a, b) { return a.at - b.at; })[0] || null;
    }
    var found = [];
    CODE_RE.forEach(function (re) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text))) if (looksCode(m[1])) found.push({ kind: 'code', code: m[1], at: m.index, len: m[0].length });
    });
    DISCOUNT_RE.forEach(function (re) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text))) { var pct = Number(m[1]); if (pct > 0 && pct < 100) found.push({ kind: 'discount', pct: pct, at: m.index, len: m[0].length }); }
    });
    found.sort(function (a, b) { return a.at - b.at; }).forEach(function (f) {
      var o = owner(f.at);
      push({ kind: f.kind, brand: o ? o.brand : f.code || null, key: o ? o.key : f.code ? 'code:' + f.code.toLowerCase() : 'discount', code: f.code, pct: f.pct, at: f.at, text: snippet(text, f.at, f.len) });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return { mentions: out, disclosure: DISCLOSURE_RE.test(text) };
  }

  /** Mentions that name something promoted (not only "a discount" or an unknown short link). */
  function promotes(m) { return m.kind === 'sponsor' || m.kind === 'affiliate' || m.kind === 'brand-link' || m.kind === 'utm' || (m.kind === 'code' && !/^code:/.test(m.key)); }

  /**
   * Many videos → who promotes what, how often.
   * videos: [{ id, channel_id, channel, title, published_at, description }]
   * → { brands: [{ key, brand, kinds, videos, channels: [{ id, name, videos }], codes, domains, first_at, last_at, examples }],
   *     channels: [{ id, name, scanned, with_mentions, disclosure, brands: [{ key, brand, videos }] }], short_links, scanned }
   */
  function aggregate(videos, opts) {
    opts = opts || {};
    var brands = {};
    var chans = {};
    var shortLinks = 0;
    (videos || []).forEach(function (v) {
      if (!v || !v.description) return;
      var cid = v.channel_id || v.channel || '?';
      var ch = chans[cid] || (chans[cid] = { id: cid, name: v.channel || cid, scanned: 0, with_mentions: 0, disclosure: 0, brands: {} });
      ch.scanned++;
      var r = scanDescription(v.description, { channel: v.channel });
      if (r.disclosure) ch.disclosure++;
      var hit = false;
      var perVideo = {};
      r.mentions.forEach(function (m) {
        if (m.kind === 'short-link') { shortLinks++; return; }
        if (m.kind === 'discount' && m.key === 'discount') return;
        if (m.kind === 'code' && /^code:/.test(m.key)) {
          // A code with no brand near it: keep it under the video's sponsor if it has exactly one, else as the code itself.
          var sp = r.mentions.filter(promotes);
          var ks = sp.map(function (x) { return x.key; }).filter(function (k, i, a) { return a.indexOf(k) === i; });
          if (ks.length === 1) m = Object.assign({}, m, { brand: sp[0].brand, key: sp[0].key });
        }
        hit = true;
        var b = brands[m.key] || (brands[m.key] = { key: m.key, brand: m.brand, kinds: {}, videos: 0, channels: {}, codes: {}, domains: {}, first_at: null, last_at: null, examples: [] });
        b.kinds[m.kind] = (b.kinds[m.kind] || 0) + 1;
        if (m.code) b.codes[m.code] = 1;
        if (m.domain) b.domains[m.domain] = 1;
        // Prefer a proper name over a host-derived one ("Skillshare" over "Skl").
        if (m.kind === 'sponsor' && m.brand) b.brand = b.brand && b.kinds.sponsor > 1 ? b.brand : m.brand;
        if (!perVideo[m.key]) {
          perVideo[m.key] = 1;
          b.videos++;
          b.channels[cid] = b.channels[cid] || { id: cid, name: ch.name, videos: 0 };
          b.channels[cid].videos++;
          ch.brands[m.key] = ch.brands[m.key] || { key: m.key, brand: b.brand, videos: 0 };
          ch.brands[m.key].videos++;
          if (v.published_at) {
            b.first_at = b.first_at == null ? v.published_at : Math.min(b.first_at, v.published_at);
            b.last_at = b.last_at == null ? v.published_at : Math.max(b.last_at, v.published_at);
          }
          if (b.examples.length < 3) b.examples.push({ id: v.id, title: v.title || null, channel: ch.name, published_at: v.published_at || null, kind: m.kind, text: m.text, code: m.code || null });
        }
      });
      if (hit) ch.with_mentions++;
    });
    var list = Object.keys(brands).map(function (k) {
      var b = brands[k];
      return { key: b.key, brand: b.brand, kinds: Object.keys(b.kinds), videos: b.videos, channels: Object.keys(b.channels).map(function (c) { return b.channels[c]; }).sort(function (x, y) { return y.videos - x.videos; }),
        codes: Object.keys(b.codes), domains: Object.keys(b.domains), first_at: b.first_at, last_at: b.last_at, examples: b.examples };
    }).sort(function (a, b) { return b.channels.length - a.channels.length || b.videos - a.videos || (b.last_at || 0) - (a.last_at || 0); });
    // Brand names on channel rows follow the final name.
    var nameOf = {};
    list.forEach(function (b) { nameOf[b.key] = b.brand; });
    var channels = Object.keys(chans).map(function (c) {
      var ch = chans[c];
      return { id: ch.id, name: ch.name, scanned: ch.scanned, with_mentions: ch.with_mentions, disclosure: ch.disclosure,
        brands: Object.keys(ch.brands).map(function (k) { return { key: k, brand: nameOf[k] || ch.brands[k].brand, videos: ch.brands[k].videos }; }).sort(function (a, b) { return b.videos - a.videos; }) };
    }).sort(function (a, b) { return b.with_mentions - a.with_mentions || b.scanned - a.scanned; });
    return { brands: list, channels: channels, short_links: shortLinks, scanned: (videos || []).filter(function (v) { return v && v.description; }).length };
  }

  return { scanDescription: scanDescription, aggregate: aggregate, brandKey: brandKey, hostOf: hostOf, promotes: promotes, BRANDS: BRANDS, NETWORKS: NETWORKS, SHORT: SHORT, IGNORE: IGNORE };
});
