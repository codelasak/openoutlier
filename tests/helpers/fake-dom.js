// A tiny DOM for tests: parses well-formed HTML fixtures into elements with tagName, attributes,
// children, textContent, and querySelector / querySelectorAll for tag, .class, tag.class, [attr]
// selectors, comma lists and the descendant combinator. Enough for src/content-tools.js's reader.
'use strict';

const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'wbr']);

class Node {
  constructor(tag, attrs, parent) {
    this.tagName = tag ? tag.toUpperCase() : null;
    this.attrs = attrs || {};
    this.parentNode = parent || null;
    this.childNodes = [];
    this.text = null; // text node
  }
  get children() { return this.childNodes.filter((c) => c.tagName); }
  get textContent() { return this.text != null ? this.text : this.childNodes.map((c) => c.textContent).join(''); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  get className() { return this.attrs.class || ''; }
  matches(sel) { return sel.split(',').some((s) => matchChain(this, s.trim().split(/\s+/))); }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function matchOne(el, simple) {
  const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(simple);
  if (!m) throw new Error('fake-dom: unsupported selector ' + simple);
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  const classes = (el.attrs.class || '').split(/\s+/);
  for (const c of (m[2] || '').split('.').filter(Boolean)) if (!classes.includes(c)) return false;
  for (const a of (m[3] || '').match(/\[[^\]]+\]/g) || []) {
    const [, k, v] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a) || [];
    if (!k || !(k in el.attrs) || (v != null && el.attrs[k] !== v)) return false;
  }
  return true;
}
function matchChain(el, parts) {
  if (!matchOne(el, parts[parts.length - 1])) return false;
  let rest = parts.slice(0, -1);
  let p = el.parentNode;
  while (rest.length && p && p.tagName) {
    if (matchOne(p, rest[rest.length - 1])) rest = rest.slice(0, -1);
    p = p.parentNode;
  }
  return !rest.length;
}

function decode(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&'); }

/** HTML text → a root node (its children are the top-level elements). */
function parse(html) {
  const root = new Node('#root', {}, null);
  let cur = root;
  const re = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { // close
      let n = cur;
      while (n && n.tagName !== m[1].toUpperCase()) n = n.parentNode;
      if (n) cur = n.parentNode;
    } else if (m[2]) {
      const attrs = {};
      (m[3] || '').replace(/([\w-]+)(?:="([^"]*)")?/g, (_, k, v) => { attrs[k] = v != null ? decode(v) : ''; });
      const el = new Node(m[2], attrs, cur);
      cur.childNodes.push(el);
      if (!m[4] && !VOID.has(m[2].toLowerCase())) cur = el;
    } else if (m[5]) {
      const t = new Node(null, {}, cur);
      t.text = decode(m[5]);
      cur.childNodes.push(t);
    }
  }
  return root;
}

module.exports = { parse };
