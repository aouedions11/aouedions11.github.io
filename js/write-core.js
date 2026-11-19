/* write-core.js — the parts of the writing page (/write/) that do not touch the screen:
   reading a post file, writing it back, names, addresses and checks.
   Used by js/write.js in the browser; it also loads in Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WriteCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PAPER_KEYS = ['title', 'authors', 'venue', 'link'];
  var KNOWN_KEYS = ['title', 'description', 'date', 'type', 'topics', 'tags', 'series', 'part', 'code', 'paper', 'draft'];

  function pad(n) { return String(n).padStart(2, '0'); }

  /* Same rule as build.mjs, so the address shown here is the address the site uses */
  function slugify(s) {
    return String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isoDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return '';
  }

  function isHttp(u) { return /^https?:\/\/\S+$/i.test(String(u || '').trim()); }

  /* YAML dates become plain "YYYY-MM-DD" text so they can be written back unchanged */
  function plain(v) {
    if (v instanceof Date) return isoDate(v);
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = plain(v[k]); });
      return out;
    }
    return v;
  }

  function emptyDoc() {
    return {
      id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      path: null,          // posts/<file>.md once it exists on GitHub
      sha: null,           // version on GitHub, needed to update the file
      published: false,    // true when the version on GitHub is public (not a draft)
      dirty: false,        // true when this browser has changes GitHub does not have
      updatedAt: 0,
      images: [],          // [{ path, uploaded }] pictures added from this page
      fm: {
        title: '', description: '', date: today(), type: 'article', topics: [], tags: [],
        series: '', part: null, code: '', codeLabel: '',
        paper: { title: '', authors: '', venue: '', link: '' },
        extra: {},         // any other line of the top block, kept as it was
      },
      body: '',
    };
  }

  /* Read a post file. yamlLoad is jsyaml.safeLoad in the browser. */
  function parsePost(text, name, yamlLoad) {
    var doc = emptyDoc();
    var fm = doc.fm;
    var m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
    var data = {};
    var body = text;
    if (m) { data = yamlLoad(m[1]) || {}; body = m[2]; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    body = body.replace(/\r\n/g, '\n').replace(/^\n+/, '');

    // A first line "# Title" is the title when the top block has none (same rule as the build)
    var title = data.title != null ? String(data.title) : '';
    var h1 = /^#[ \t]+(.+?)[ \t]*(?:\n|$)/.exec(body);
    if (h1 && !title) title = h1[1];
    if (h1 && slugify(h1[1]) === slugify(title)) body = body.slice(h1[0].length).replace(/^\n+/, '');

    fm.title = title;
    fm.description = data.description != null ? String(data.description) : '';
    fm.date = isoDate(data.date) || isoDate((/^(\d{4}-\d{2}-\d{2})-/.exec(name || '') || [])[1]) || today();
    fm.type = data.type ? String(data.type) : 'article';
    fm.topics = [].concat(data.topics || []).map(slugify).filter(Boolean);
    fm.tags = [].concat(data.tags || []).map(String);
    fm.series = data.series ? String(data.series) : '';
    fm.part = fm.series && data.part != null && data.part !== '' ? Number(data.part) : null;
    if (data.code && typeof data.code === 'object') {
      fm.code = data.code.link ? String(data.code.link) : '';
      fm.codeLabel = data.code.label ? String(data.code.label) : '';
    } else {
      fm.code = data.code ? String(data.code) : '';
    }
    if (data.paper && typeof data.paper === 'object') {
      PAPER_KEYS.forEach(function (k) { fm.paper[k] = data.paper[k] != null ? String(data.paper[k]) : ''; });
    }
    Object.keys(data).forEach(function (k) {
      if (KNOWN_KEYS.indexOf(k) === -1) fm.extra[k] = plain(data[k]);
    });
    doc.published = !(data.draft === true || /^(true|yes)$/i.test(String(data.draft == null ? '' : data.draft)));
    doc.body = body.replace(/\s+$/, '');
    return doc;
  }

  function hasPaper(fm) {
    return PAPER_KEYS.some(function (k) { return String(fm.paper[k] || '').trim(); });
  }

  /* Write the post file: a small top block, then the text */
  function serializePost(doc, draft) {
    var fm = doc.fm;
    var q = function (v) { return JSON.stringify(String(v)); };
    var lines = [];
    lines.push('title: ' + q(fm.title.trim()));
    lines.push('date: ' + fm.date);
    lines.push('type: ' + (fm.type || 'article'));
    if (fm.topics.length) lines.push('topics: [' + fm.topics.join(', ') + ']');
    if (fm.tags.length) lines.push('tags: [' + fm.tags.map(q).join(', ') + ']');
    if (fm.description.trim()) lines.push('description: ' + q(fm.description.trim().replace(/\s*\n\s*/g, ' ')));
    if (fm.series) {
      lines.push('series: ' + fm.series);
      lines.push('part: ' + fm.part);
    }
    if (fm.code.trim()) {
      lines.push(fm.codeLabel
        ? 'code: { link: ' + q(fm.code.trim()) + ', label: ' + q(fm.codeLabel) + ' }'
        : 'code: ' + q(fm.code.trim()));
    }
    if (hasPaper(fm)) {
      lines.push('paper:');
      PAPER_KEYS.forEach(function (k) {
        if (String(fm.paper[k] || '').trim()) lines.push('  ' + k + ': ' + q(fm.paper[k].trim()));
      });
    }
    Object.keys(fm.extra || {}).forEach(function (k) {
      lines.push(k + ': ' + JSON.stringify(fm.extra[k]));
    });
    if (draft) lines.push('draft: true');
    return '---\n' + lines.join('\n') + '\n---\n\n' + doc.body.replace(/\s+$/, '') + '\n';
  }

  function fileName(doc) {
    if (doc.path) return doc.path.split('/').pop();
    return doc.fm.date + '-' + slugify(doc.fm.title) + '.md';
  }

  /* The address of the post on the site: the year of its date, and the file name without the date */
  function postUrl(doc) {
    var slug = doc.fm.extra && doc.fm.extra.slug
      ? slugify(doc.fm.extra.slug)
      : fileName(doc).replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    return '/blog/' + doc.fm.date.slice(0, 4) + '/' + slug + '.html';
  }

  /* Pictures used in the text: [{ src, local, absolute }] */
  function imagesIn(body) {
    var found = [];
    var seen = {};
    var add = function (src) {
      src = String(src || '').trim();
      if (!src || seen[src]) return;
      seen[src] = true;
      var remote = /^(https?:)?\/\//i.test(src) || /^data:/i.test(src);
      found.push({ src: src, local: !remote, absolute: src.charAt(0) === '/' });
    };
    var text = String(body || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    var re = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
    var m;
    while ((m = re.exec(text))) add(m[1]);
    re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    while ((m = re.exec(text))) add(m[1]);
    return found;
  }

  /* What stops a post from being saved. ctx: { types, series, taken: { "series#part": title }, forDraft } */
  function validate(doc, ctx) {
    var fm = doc.fm;
    var problems = [];
    var add = function (field, message) { problems.push({ field: field, message: message }); };
    if (!fm.title.trim()) add('title', 'Give the post a title.');
    else if (!slugify(fm.title)) add('title', 'The title needs at least one letter or number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date) || isNaN(new Date(fm.date + 'T00:00:00Z').getTime())) add('date', 'Choose a date.');
    if (fm.series) {
      var info = ctx.series && ctx.series[fm.series];
      if (!info) add('series', 'This series does not exist any more. Choose another one, or "Not part of a series".');
      else if (!Number.isInteger(fm.part) || fm.part < 1 || fm.part > info.parts.length) add('part', 'Choose which part of the series this is.');
      else if (!ctx.forDraft && ctx.taken && ctx.taken[fm.series + '#' + fm.part]) {
        add('part', 'Part ' + fm.part + ' of this series is already published ("' + ctx.taken[fm.series + '#' + fm.part] + '"). Choose another part.');
      }
    }
    if (ctx.forDraft) return problems;
    if (!doc.body.trim()) add('body', 'Write some text before publishing.');
    if (ctx.types && !ctx.types[fm.type]) add('type', 'Choose the kind of post.');
    if (fm.code.trim() && !isHttp(fm.code)) add('code', 'The code link must be a full address that starts with https://');
    if (fm.paper.link.trim() && !isHttp(fm.paper.link)) add('paper-link', 'The paper link must be a full address that starts with https://');
    imagesIn(doc.body).forEach(function (img) {
      if (img.local && !img.absolute) add('body', 'The picture "' + img.src + '" needs an address that starts with /images/ (use the Picture button to add it).');
    });
    return problems;
  }

  /* "2026-01-07-fedprox-paper-review.md" -> "Fedprox paper review" (for drafts whose title is not known yet) */
  function prettyName(name) {
    var s = String(name || '').replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function bytesToBase64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }

  function textToBase64(text) { return bytesToBase64(new TextEncoder().encode(text)); }

  function base64ToText(b64) {
    var bin = atob(String(b64 || '').replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  return {
    slugify: slugify, today: today, isoDate: isoDate, isHttp: isHttp, emptyDoc: emptyDoc,
    parsePost: parsePost, serializePost: serializePost, hasPaper: hasPaper,
    fileName: fileName, postUrl: postUrl, imagesIn: imagesIn, validate: validate, prettyName: prettyName,
    bytesToBase64: bytesToBase64, textToBase64: textToBase64, base64ToText: base64ToText,
  };
});
