/* write.js — the writing page (/write/).

   A form and a Markdown editor with a live preview. The text is saved in this browser while
   you type. "Publish" and "Save as draft" send the post (and its pictures) to the site's
   GitHub repository, where the build workflow turns it into pages.

   GitHub asks for a personal key ("token") to accept changes. The key is kept in this browser
   only and is sent to api.github.com only; the page's Content-Security-Policy forbids anything else.

   On the owner's computer (the site started with scripts/local_server.py) no key is needed: the
   same calls go to that server under /api/github/, which writes the post into the site folder and
   rebuilds the blog at once. The post goes online the next time the site is sent to GitHub.

   Needs js/write-core.js and the libraries in js/vendor/ (copied there by build.mjs). */
(function () {
  'use strict';

  const Core = window.WriteCore;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const KEY = { docs: 'write:docs', current: 'write:current', token: 'write:key', welcome: 'write:welcome-seen' };
  const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  const PAPER_KEYS = ['title', 'authors', 'venue', 'link'];
  const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';
  const FIVE_SECTIONS = [
    '## The challenge', '', 'What goes wrong, in which setting, and why it matters in practice.', '',
    '## The proposed solutions', '', 'The main methods proposed for this challenge, what each one changes, and the papers they come from.', '',
    '## Code', '', 'The code for the baseline and for each solution, with the key lines explained.', '',
    '## Tests', '', 'The experiments that compare them: the setup, the results, and what the numbers show.', '',
    '## What to remember', '', '> **Key takeaways**', '>', '> - Three to five short points the reader should keep from this post.',
  ].join('\n');

  let site = null;          // site.config.json
  let repo = '';            // "owner/name" on GitHub
  let branch = 'main';
  let siteUrl = '';
  let publishedIndex = [];  // search.json: what is online
  let doc = null;           // the post being written
  let token = '';
  let login = '';
  let remoteReady = false;  // GitHub has the build workflow
  let local = false;        // the page runs on the owner's computer (scripts/local_server.py): no key, posts go straight into the site folder
  let runsWithKey = true;
  let busy = '';
  let lastSaved = null;
  let saveFailed = false;
  let watchId = 0;
  let markdown = null;
  let previewTarget = null;
  let saveTimer = 0;
  let previewTimer = 0;
  let confirmResolve = null;
  let connectResolve = null;
  const pending = new Map(); // picture address -> { blob, url } not yet on GitHub
  const yamlLoad = (text) => (window.jsyaml.safeLoad || window.jsyaml.load)(text);

  class Friendly extends Error {}
  class GhError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  /* ------------------------------------------------------------ GitHub */
  async function gh(method, path, options) {
    const opt = options || {};
    const key = opt.key !== undefined ? opt.key : token;
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (opt.auth !== false && key && !local) headers.Authorization = 'Bearer ' + key;
    if (opt.body) headers['Content-Type'] = 'application/json';
    const base = local ? '/api/github' : 'https://api.github.com';
    let response;
    try {
      response = await fetch(base + path, {
        method: method, headers: headers, body: opt.body ? JSON.stringify(opt.body) : undefined, cache: 'no-store',
      });
    } catch (e) {
      throw new GhError(0, 'network');
    }
    let data = null;
    try { data = await response.json(); } catch (e) { data = null; }
    if (!response.ok) throw new GhError(response.status, (data && data.message) || response.statusText || 'error');
    return data;
  }

  async function ghMaybe(path, options) {
    try {
      return await gh('GET', path, options);
    } catch (e) {
      if (e instanceof GhError && e.status === 404) return null;
      throw e;
    }
  }

  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
  const contents = (p) => '/repos/' + repo + '/contents/' + encPath(p);

  function explain(e) {
    if (e instanceof Friendly) return esc(e.message);
    if (!(e instanceof GhError)) return 'Something went wrong: ' + esc(e && e.message ? e.message : e);
    if (local) {
      if (e.status === 0) return 'The site on this computer did not answer. Is the "Start website" window still open? Start it again and retry. Your text stays saved in this browser.';
      if (e.status === 409) return 'This post was changed in your site folder after you opened it here. Open it again from "My posts" to get the newest version, then redo your change.';
      if (e.status === 422) return '<strong>The post could not be saved, so nothing changed.</strong> ' + esc(e.message);
      return 'The site on this computer answered with an error (' + e.status + '): ' + esc(e.message);
    }
    if (e.status === 0) return 'GitHub could not be reached. Check the internet connection and try again.';
    if (e.status === 401) return 'GitHub did not accept the key. It may have expired or been removed. <button type="button" class="link-button" data-action="connect">Connect again</button> with a new key.';
    if (e.status === 403 && /rate limit/i.test(e.message)) return 'GitHub asks to wait a little (too many requests). Try again in a few minutes.';
    if (e.status === 403 || e.status === 404) {
      return 'The key is not allowed to change the site. Create a new key and, on the GitHub page, select the repository <strong>' + esc(repo.split('/')[1] || repo) +
        '</strong> and set <strong>Contents</strong> to <strong>Read and write</strong>. <button type="button" class="link-button" data-action="connect">Connect again</button>';
    }
    if (e.status === 409) return 'This post was changed on GitHub after you opened it here. Open it again from "My posts" to get the newest version, then redo your change.';
    return 'GitHub answered with an error (' + e.status + '): ' + esc(e.message);
  }

  async function siteIsReady() {
    if (remoteReady) return true;
    remoteReady = Boolean(await ghMaybe(contents('.github/workflows/build.yml') + '?ref=' + branch));
    return remoteReady;
  }

  /* ------------------------------------------------------------ storage in this browser */
  function readDocs() {
    try { return JSON.parse(localStorage.getItem(KEY.docs) || '{}') || {}; } catch (e) { return {}; }
  }

  function writeDocs(docs) {
    try { localStorage.setItem(KEY.docs, JSON.stringify(docs)); return true; } catch (e) { return false; }
  }

  function normalize(stored) {
    const base = Core.emptyDoc();
    const out = Object.assign(base, stored);
    out.fm = Object.assign(Core.emptyDoc().fm, stored.fm || {});
    out.fm.paper = Object.assign({ title: '', authors: '', venue: '', link: '' }, (stored.fm && stored.fm.paper) || {});
    out.fm.extra = (stored.fm && stored.fm.extra) || {};
    out.images = Array.isArray(stored.images) ? stored.images : [];
    return out;
  }

  function saveLocal() {
    clearTimeout(saveTimer);
    doc.updatedAt = Date.now();
    const docs = readDocs();
    docs[doc.id] = doc;
    saveFailed = !writeDocs(docs);
    lastSaved = saveFailed ? null : new Date();
    try { localStorage.setItem(KEY.current, doc.id); } catch (e) { /* ignore */ }
    renderStatus();
  }

  const isBlank = (d) => !d.path && !d.fm.title.trim() && !d.body.trim() && !d.fm.description.trim();

  // Pictures wait in the browser's database until they are sent, so a reload does not lose them
  const dbReady = new Promise((resolve) => {
    try {
      const request = indexedDB.open('write', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });

  function imageStore(mode, action) {
    return dbReady.then((db) => {
      if (!db) return undefined;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction('images', mode);
          const request = action(tx.objectStore('images'));
          tx.oncomplete = () => resolve(request ? request.result : undefined);
          tx.onerror = tx.onabort = () => resolve(undefined);
        } catch (e) {
          resolve(undefined);
        }
      });
    });
  }

  const keepImage = (path, blob) => imageStore('readwrite', (s) => s.put(blob, path));
  const readImage = (path) => imageStore('readonly', (s) => s.get(path));
  const forgetImage = (path) => imageStore('readwrite', (s) => s.delete(path));

  async function restoreImages() {
    for (const image of doc.images) {
      if (image.uploaded || pending.has(image.path)) continue;
      const blob = await readImage(image.path);
      if (blob) pending.set(image.path, { blob: blob, url: URL.createObjectURL(blob) });
    }
  }

  /* ------------------------------------------------------------ messages */
  function showNotice(kind, html) {
    const box = $('notice');
    box.className = 'notice notice--' + kind;
    box.innerHTML = html;
    box.hidden = false;
  }

  function hideNotice() {
    $('notice').hidden = true;
    document.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
  }

  function setBusy(message) {
    busy = message || '';
    ['btn-publish', 'btn-draft', 'btn-posts'].forEach((id) => { $(id).disabled = Boolean(busy); });
    renderStatus();
  }

  function renderStatus() {
    if (!doc) return;
    let text;
    if (busy) text = busy;
    else if (!doc.path) text = local ? 'Not in your site yet.' : 'Not on GitHub yet.';
    else if (doc.dirty) text = (doc.published ? 'Published.' : local ? 'Draft.' : 'Draft on GitHub.') + (local ? ' Your new changes are not in your site yet.' : ' Your new changes are not sent yet.');
    else text = doc.published ? 'Published.' : local ? 'Draft.' : 'Draft on GitHub.';
    if (!busy) {
      if (saveFailed) text += ' Could not save in this browser (its storage is full).';
      else if (lastSaved) text += ' Saved in this browser at ' + String(lastSaved.getHours()).padStart(2, '0') + ':' + String(lastSaved.getMinutes()).padStart(2, '0') + '.';
    }
    $('status').textContent = text;
  }

  function confirmBox(title, text, yes) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yes || 'OK';
    $('dlg-confirm').showModal();
    return new Promise((resolve) => { confirmResolve = resolve; });
  }

  /* ------------------------------------------------------------ the form */
  function chips(name, type, values, labelOf) {
    return values.map((v) => '<label class="chip"><input type="' + type + '" name="' + name + '" value="' + esc(v) + '"><span>' + esc(labelOf(v)) + '</span></label>').join('');
  }

  function buildForm() {
    $('f-type').innerHTML = chips('type', 'radio', Object.keys(site.types), (t) => site.types[t].label);
    const series = site.series || {};
    $('f-series').innerHTML = '<option value="">Not part of a series</option>' +
      Object.keys(series).map((s) => '<option value="' + esc(s) + '">' + esc(series[s].title) + '</option>').join('');
    $('connect-repo').textContent = repo.split('/')[1] || repo;
    $('connect-link').href = 'https://github.com/settings/personal-access-tokens/new?name=' + encodeURIComponent('Blog editor') +
      '&description=' + encodeURIComponent('Lets the writing page of my site save posts') + '&expires_in=366&contents=write';
  }

  function grow(el) {
    if (!el.scrollHeight) return;
    const pane = $('pane-form');
    const top = pane.scrollTop;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
    pane.scrollTop = top;
  }

  function takenParts() {
    const mine = doc.path ? doc.path.split('/').pop() : null;
    const taken = {};
    publishedIndex.forEach((e) => {
      if (e.series && e.part && e.file !== mine) taken[e.series + '#' + e.part] = e.title;
    });
    return taken;
  }

  function fillParts() {
    const slug = $('f-series').value;
    const info = slug && site.series[slug];
    $('part-field').hidden = !info;
    $('sections-field').hidden = !info;
    if (!info) { $('f-part').innerHTML = ''; return; }
    const taken = takenParts();
    let chosen = doc.fm.series === slug && doc.fm.part ? doc.fm.part : 0;
    if (!chosen) {
      const free = info.parts.findIndex((p, i) => !taken[slug + '#' + (i + 1)]);
      chosen = free === -1 ? 1 : free + 1;
    }
    $('f-part').innerHTML = info.parts.map((p, i) => {
      const n = i + 1;
      return '<option value="' + n + '"' + (n === chosen ? ' selected' : '') + '>Part ' + n + ': ' + esc(p.title) + (taken[slug + '#' + n] ? ' (published)' : '') + '</option>';
    }).join('');
  }

  // Choosing a part of a series proposes its planned title, unless you already wrote your own
  function suggestTitle() {
    const info = site.series && site.series[$('f-series').value];
    const part = info && info.parts[Number($('f-part').value) - 1];
    if (!part) return;
    const planned = [];
    Object.keys(site.series).forEach((s) => site.series[s].parts.forEach((p) => planned.push(p.title)));
    const current = $('f-title').value.trim();
    if (!current || planned.indexOf(current) !== -1) {
      $('f-title').value = part.title;
      grow($('f-title'));
    }
  }

  function fillForm() {
    const fm = doc.fm;
    $('f-title').value = fm.title;
    $('f-description').value = fm.description;
    document.querySelectorAll('input[name="type"]').forEach((i) => { i.checked = i.value === fm.type; });
    const topics = Object.keys(site.topics).concat(fm.topics.filter((t) => !site.topics[t]));
    $('f-topics').innerHTML = chips('topic', 'checkbox', topics, (t) => site.topics[t] || t);
    document.querySelectorAll('input[name="topic"]').forEach((i) => { i.checked = fm.topics.indexOf(i.value) !== -1; });
    $('f-tags').value = fm.tags.join(', ');
    $('f-date').value = fm.date;
    $('f-series').value = site.series && site.series[fm.series] ? fm.series : '';
    fillParts();
    $('f-code').value = fm.code;
    PAPER_KEYS.forEach((k) => { $('f-paper-' + k).value = fm.paper[k] || ''; });
    $('f-body').value = doc.body;
    refresh();
    [$('f-title'), $('f-description'), $('f-body')].forEach(grow);
  }

  function readForm() {
    const fm = doc.fm;
    fm.title = $('f-title').value.replace(/\s*\n\s*/g, ' ');
    fm.description = $('f-description').value;
    const type = document.querySelector('input[name="type"]:checked');
    if (type) fm.type = type.value;
    fm.topics = Array.from(document.querySelectorAll('input[name="topic"]:checked')).map((i) => i.value);
    fm.tags = $('f-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    if ($('f-date').value) fm.date = $('f-date').value;
    fm.series = $('f-series').value;
    fm.part = fm.series ? Number($('f-part').value) || null : null;
    fm.code = $('f-code').value.trim();
    PAPER_KEYS.forEach((k) => { fm.paper[k] = $('f-paper-' + k).value; });
    doc.body = $('f-body').value;
  }

  function refresh() {
    const fm = doc.fm;
    $('paper-fields').hidden = !(fm.type === 'paper-review' || Core.hasPaper(fm));
    $('address').textContent = doc.path || Core.slugify(fm.title)
      ? 'Address: ' + siteUrl.replace(/^https?:\/\//, '') + Core.postUrl(doc)
      : '';
    $('btn-publish').textContent = doc.published ? 'Publish changes' : 'Publish';
    $('btn-draft').textContent = doc.published ? 'Unpublish' : 'Save as draft';
    renderStatus();
  }

  function onChange() {
    readForm();
    doc.dirty = true;
    refresh();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLocal, 400);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 200);
  }

  function switchTo(next) {
    if (doc) {
      readForm();
      const docs = readDocs();
      if (isBlank(doc) || (doc.path && !doc.dirty)) delete docs[doc.id];
      else docs[doc.id] = doc;
      writeDocs(docs);
    }
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    pending.clear();
    doc = next;
    watchId++;
    hideNotice();
    fillForm();
    saveLocal();
    renderPreview();
    restoreImages().then(renderPreview);
    $('pane-form').scrollTop = 0;
  }

  /* ------------------------------------------------------------ preview */
  function resolveImage(src) {
    const clean = src.split(/[?#]/)[0];
    if (pending.has(clean)) return pending.get(clean).url;
    // sent a moment ago: GitHub has it before the site does
    if (doc.images.some((i) => i.uploaded && i.path === clean)) return 'https://raw.githubusercontent.com/' + repo + '/' + branch + encPath(clean);
    return src;
  }

  function imageTag(token) {
    return '<img src="' + esc(resolveImage(String(token.href || ''))) + '" alt="' + esc(token.text) + '">';
  }

  function createMarkdown() {
    const katex = window.katex;
    return new window.marked.Marked({
      gfm: true,
      renderer: {
        code(token) {
          return '<div class="code-block"><pre><code>' + esc(token.text) + '</code></pre></div>\n';
        },
        paragraph(token) {
          const tokens = token.tokens || [];
          if (!(tokens.length === 1 && tokens[0].type === 'image')) return false;
          const t = tokens[0];
          return '<figure class="post-figure">' + imageTag(t) + (t.title ? '<figcaption>' + esc(t.title) + '</figcaption>' : '') + '</figure>\n';
        },
        image(token) {
          return imageTag(token);
        },
      },
      extensions: [
        {
          name: 'mathBlock',
          level: 'block',
          start(src) { return src.indexOf('$$'); },
          tokenizer(src) {
            const m = /^\$\$\n?([\s\S]+?)\n?\$\$(?:\n+|$)/.exec(src);
            if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
            return undefined;
          },
          renderer(token) {
            return katex.renderToString(token.text, { displayMode: true, throwOnError: false }) + '\n';
          },
        },
        {
          name: 'mathInline',
          level: 'inline',
          start(src) { return src.indexOf('$'); },
          tokenizer(src) {
            if (src.startsWith('$$')) return undefined;
            const m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?![0-9])/.exec(src);
            if (m) return { type: 'mathInline', raw: m[0], text: m[1] };
            return undefined;
          },
          renderer(token) {
            return katex.renderToString(token.text, { displayMode: false, throwOnError: false });
          },
        },
      ],
    });
  }

  function renderPreview() {
    clearTimeout(previewTimer);
    if (!previewTarget || !doc) return;
    const fm = doc.fm;
    const type = site.types[fm.type] ? site.types[fm.type].label : fm.type;
    const date = new Date(fm.date + 'T00:00:00Z');
    const dateText = isNaN(date.getTime()) ? '' : MONTHS[date.getUTCMonth()] + ' ' + date.getUTCDate() + ', ' + date.getUTCFullYear();
    const words = doc.body.replace(/```[\s\S]*?```/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').split(/\s+/).filter(Boolean).length;
    let text;
    try {
      text = markdown.parse(doc.body).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
    } catch (e) {
      text = '<p>' + esc(e.message) + '</p>';
    }
    const series = fm.series && site.series && site.series[fm.series];
    const out = [];
    out.push('<header class="post-header"><p class="post-meta"><span class="post-meta__type">' + esc(type) + '</span>' +
      (dateText ? '<time>' + dateText + '</time>' : '') + '<span>' + Math.max(1, Math.round(words / 200)) + ' min read</span></p>');
    out.push('<h1 class="post-title">' + (fm.title.trim() ? esc(fm.title.trim()) : '<span class="preview-empty">Title of the post</span>') + '</h1>');
    if (fm.description.trim()) out.push('<p class="post-description">' + esc(fm.description.trim()) + '</p>');
    out.push('<p class="post-byline">By <a>' + esc(site.author.name) + '</a></p>');
    if (fm.tags.length) out.push('<ul class="post-tags">' + fm.tags.map((t) => '<li class="post-tag">' + esc(t) + '</li>').join('') + '</ul>');
    out.push('</header>');
    if (series && fm.part) {
      out.push('<nav class="series-box"><p class="series-box__title">' + esc(series.title) + '</p><p class="series-box__part">Part ' + fm.part + ' of ' + series.parts.length + '</p></nav>');
    }
    if (Core.hasPaper(fm)) {
      out.push('<aside class="paper-reference"><h2 class="paper-reference__heading">Paper reference</h2><p class="paper-title">' + esc(fm.paper.title) + '</p>' +
        (fm.paper.authors.trim() ? '<p class="paper-authors">' + esc(fm.paper.authors) + '</p>' : '') +
        (fm.paper.venue.trim() ? '<p class="paper-venue">' + esc(fm.paper.venue) + '</p>' : '') +
        (fm.paper.link.trim() ? '<a class="paper-link">Read the original paper →</a>' : '') + '</aside>');
    }
    if (fm.code.trim()) {
      out.push('<aside class="paper-reference code-reference"><h2 class="paper-reference__heading">Code and tests</h2><a class="paper-link">' + esc(fm.codeLabel || 'Open the code on GitHub →') + '</a></aside>');
    }
    out.push('<div class="post-content">' + (text.trim() ? text : '<p class="preview-empty">Your text appears here while you write.</p>') + '</div>');
    previewTarget.innerHTML = out.join('');
  }

  function syncTheme() {
    const inner = $('preview').contentDocument;
    if (inner) inner.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'light');
  }

  function initPreview() {
    const frame = $('preview');
    frame.addEventListener('load', () => {
      const inner = frame.contentDocument;
      if (!inner) return;
      previewTarget = inner.getElementById('post');
      syncTheme();
      renderPreview();
    });
    // The frame cannot run scripts (sandbox), so text typed or loaded here can never act on the page
    frame.srcdoc = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<link rel="stylesheet" href="' + esc(FONTS) + '"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/css/blog.css"><link rel="stylesheet" href="/css/katex/katex.min.css">' +
      '<style>a{pointer-events:none}.blog-container{padding:28px 24px 56px}.post{margin:0 auto}.preview-empty{color:var(--text-muted)}</style>' +
      '</head><body><main class="blog-container"><article class="post" id="post"></article></main></body></html>';
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ------------------------------------------------------------ formatting buttons */
  const area = () => $('f-body');
  const selected = () => area().value.slice(area().selectionStart, area().selectionEnd);

  function replaceSelection(text, from, to) {
    const ta = area();
    ta.focus();
    const start = ta.selectionStart;
    let done = false;
    try { done = document.execCommand('insertText', false, text); } catch (e) { done = false; }
    if (!done || ta.value.slice(start, start + text.length) !== text) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (from != null) ta.setSelectionRange(start + from, start + to);
  }

  function wrap(before, after, placeholder) {
    const text = selected() || placeholder;
    replaceSelection(before + text + after, before.length, before.length + text.length);
  }

  function prefixLines(prefix, placeholder) {
    const ta = area();
    const value = ta.value;
    const lineStart = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let lineEnd = value.indexOf('\n', ta.selectionEnd);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd) || placeholder;
    const lines = block.split('\n').map((line, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + line.replace(/^(#{1,6}[ \t]+|>[ \t]?|[-*][ \t]+|\d+\.[ \t]+)/, ''));
    ta.setSelectionRange(lineStart, lineEnd);
    const first = typeof prefix === 'function' ? prefix(0) : prefix;
    replaceSelection(lines.join('\n'), first.length, lines.join('\n').length);
  }

  // Puts a block on its own lines, with an empty line before and after
  function insertBlock(text, from, to) {
    const ta = area();
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    const top = !before || /\n\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
    const bottom = !after || /^\n\n/.test(after) ? '' : /^\n/.test(after) ? '\n' : '\n\n';
    replaceSelection(top + text + bottom, top.length + from, top.length + to);
  }

  const TOOLS = {
    h2: () => prefixLines('## ', 'Section title'),
    h3: () => prefixLines('### ', 'Sub-section title'),
    bold: () => wrap('**', '**', 'bold text'),
    italic: () => wrap('*', '*', 'text'),
    link: () => {
      const text = selected() || 'link text';
      replaceSelection('[' + text + '](https://)', text.length + 3, text.length + 11);
    },
    list: () => prefixLines('- ', 'First point'),
    numbers: () => prefixLines((i) => i + 1 + '. ', 'First step'),
    quote: () => prefixLines('> ', '**Key takeaways**'),
    code: () => {
      const text = selected();
      if (text && text.indexOf('\n') === -1) { wrap('`', '`', ''); return; }
      const code = text || 'print("hello")';
      insertBlock('```python\n' + code + '\n```', 10, 10 + code.length);
    },
    math: () => {
      const text = selected();
      if (text && text.indexOf('\n') === -1) { wrap('$', '$', ''); return; }
      const formula = text || 'w^{t+1} = \\sum_{k=1}^{K} \\frac{n_k}{n} \\, w_k^{t+1}';
      insertBlock('$$\n' + formula + '\n$$', 3, 3 + formula.length);
    },
    table: () => insertBlock('| Method | Accuracy |\n|---|---|\n| FedAvg | 81.2 |\n| FedProx | 83.4 |', 2, 8),
    image: () => $('f-image').click(),
  };

  /* ------------------------------------------------------------ pictures */
  // Photos and screenshots are often far larger than a page needs: wide ones are scaled down to 1600px
  async function shrink(file) {
    if (file.type === 'image/gif' || !window.createImageBitmap) return file;
    const bitmap = await createImageBitmap(file);
    const limit = 1600;
    if (bitmap.width <= limit && file.size <= 700 * 1024) return file;
    const scale = Math.min(1, limit / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
    return blob && blob.size < file.size ? blob : file;
  }

  async function addImages(files) {
    readForm();
    if (!Core.slugify(doc.fm.title)) {
      showNotice('error', 'Give the post a title first. Its pictures are stored in a folder named after it.');
      $('f-title').focus();
      return;
    }
    for (const file of files) {
      if (!IMAGE_TYPES[file.type]) {
        showNotice('error', '"' + esc(file.name) + '" is not a picture this page can use. Save it as PNG or JPEG and try again.');
        continue;
      }
      let blob = file;
      try { blob = await shrink(file); } catch (e) { blob = file; }
      if (!doc.imageDir) doc.imageDir = '/images/blog/' + doc.fm.date.slice(0, 4) + '/' + Core.slugify(doc.fm.title).slice(0, 60).replace(/-+$/, '');
      const base = Core.slugify(String(file.name || '').replace(/\.[^.]+$/, '')) || 'picture';
      const ext = IMAGE_TYPES[blob.type] || IMAGE_TYPES[file.type];
      let name = base + '.' + ext;
      for (let n = 2; doc.images.some((i) => i.path === doc.imageDir + '/' + name); n++) name = base + '-' + n + '.' + ext;
      const path = doc.imageDir + '/' + name;
      pending.set(path, { blob: blob, url: URL.createObjectURL(blob) });
      doc.images.push({ path: path, uploaded: false });
      keepImage(path, blob);
      insertBlock('![Describe the picture](' + path + ' "Caption shown under the picture")', 2, 22);
      if (blob.size > 2 * 1024 * 1024) {
        showNotice('info', 'This picture is large (' + (blob.size / 1048576).toFixed(1) + ' MB). The page will load slowly; a smaller version is better.');
      }
    }
    onChange();
  }

  // Before sending: every picture in the text must be waiting here or already on GitHub
  async function checkImages() {
    for (const image of Core.imagesIn(doc.body)) {
      if (!image.local) continue;
      const path = decodeURIComponent(image.src.split(/[?#]/)[0]);
      if (pending.has(path) || doc.images.some((i) => i.uploaded && i.path === path)) continue;
      if (!(await ghMaybe(contents(path.replace(/^\//, '')) + '?ref=' + branch))) {
        throw new Friendly('The picture ' + path + ' is not on your site. Add it again with the Picture button, or remove it from the text.');
      }
    }
  }

  async function uploadImages() {
    const used = Core.imagesIn(doc.body).map((i) => decodeURIComponent(i.src.split(/[?#]/)[0]));
    for (const image of doc.images) {
      if (image.uploaded) continue;
      const item = pending.get(image.path);
      if (!item || used.indexOf(image.path) === -1) continue;
      setBusy('Sending the picture ' + image.path.split('/').pop() + '…');
      const target = image.path.replace(/^\//, '');
      const existing = await ghMaybe(contents(target) + '?ref=' + branch);
      const body = { message: 'Add picture ' + image.path.split('/').pop(), content: Core.bytesToBase64(new Uint8Array(await item.blob.arrayBuffer())), branch: branch };
      if (existing && existing.sha) body.sha = existing.sha;
      await gh('PUT', contents(target), { body: body });
      image.uploaded = true;
      forgetImage(image.path);
    }
    // pictures that were added and then removed from the text are dropped
    doc.images = doc.images.filter((i) => {
      if (i.uploaded || used.indexOf(i.path) !== -1) return true;
      forgetImage(i.path);
      return false;
    });
  }

  /* ------------------------------------------------------------ connect */
  function restoreKey() {
    try { token = sessionStorage.getItem(KEY.token) || localStorage.getItem(KEY.token) || ''; } catch (e) { token = ''; }
    if (!token) return;
    gh('GET', '/user').then((me) => { login = me.login || ''; }).catch((e) => {
      if (e instanceof GhError && e.status === 401) {
        forgetKey();
        showNotice('info', 'The connection to GitHub has ended (the key expired or was removed). You can keep writing; you will be asked to connect again when you publish.');
      }
    });
  }

  function forgetKey() {
    token = '';
    login = '';
    try { sessionStorage.removeItem(KEY.token); localStorage.removeItem(KEY.token); } catch (e) { /* ignore */ }
  }

  function openConnect() {
    $('connect-error').hidden = true;
    $('f-key').value = '';
    $('dlg-connect').showModal();
    return new Promise((resolve) => { connectResolve = resolve; });
  }

  async function submitConnect(event) {
    event.preventDefault();
    const key = $('f-key').value.trim();
    const fail = (html) => { $('connect-error').innerHTML = html; $('connect-error').hidden = false; };
    if (!key) { fail('Paste the key first.'); return; }
    $('connect-go').disabled = true;
    try {
      const me = await gh('GET', '/user', { key: key });
      await gh('GET', '/repos/' + repo, { key: key });
      token = key;
      login = me.login || '';
      try {
        sessionStorage.setItem(KEY.token, key);
        if ($('f-remember').checked) localStorage.setItem(KEY.token, key); else localStorage.removeItem(KEY.token);
      } catch (e) { /* the key still works until the page is closed */ }
      $('f-key').value = '';
      const done = connectResolve;
      connectResolve = null;
      $('dlg-connect').close();
      if (done) done(true);
    } catch (e) {
      if (e instanceof GhError && e.status === 401) fail('GitHub did not accept this key. Copy it again from GitHub: the whole text, starting with <code>github_pat_</code>.');
      else if (e instanceof GhError && e.status === 0) fail('GitHub could not be reached. Check the internet connection and try again.');
      else fail('GitHub answered with an error: ' + esc(e.message));
    } finally {
      $('connect-go').disabled = false;
    }
  }

  /* ------------------------------------------------------------ publish and save */
  function showProblems(problems) {
    const ids = { title: 'f-title', date: 'f-date', series: 'f-series', part: 'f-part', body: 'f-body', code: 'f-code', 'paper-link': 'f-paper-link' };
    showNotice('error', '<p><strong>Almost there.</strong></p><ul>' + problems.map((p) => '<li>' + esc(p.message) + '</li>').join('') + '</ul>');
    let first = null;
    problems.forEach((p) => {
      const el = $(ids[p.field] || '');
      if (!el) return;
      el.classList.add('is-invalid');
      if (!first) first = el;
    });
    if (first) { showView('write'); first.focus(); }
  }

  async function send(asDraft) {
    if (busy) return;
    readForm();
    const problems = Core.validate(doc, { types: site.types, series: site.series || {}, taken: takenParts(), forDraft: asDraft });
    if (problems.length) { showProblems(problems); return; }
    hideNotice();
    // Nothing changed since the last save: do not create an empty change on GitHub
    if (doc.path && !doc.dirty && doc.published === !asDraft) {
      showNotice('info', asDraft
        ? 'Nothing new to save: ' + (local ? 'your site' : 'GitHub') + ' already has this version.'
        : 'Nothing new to publish: this version is already ' + (local ? 'in your site.' : 'online.'));
      return;
    }
    if (!local && !token && !(await openConnect())) return;
    if (!asDraft) {
      const ok = doc.published
        ? await confirmBox('Publish the changes?', local ? 'The post in your site will be replaced by this version.' : 'The post on your site will be replaced by this version in a few minutes.', 'Publish changes')
        : await confirmBox('Publish this post?', local ? 'It is added to your site on this computer straight away. It goes online the next time the site is sent to GitHub.' : 'It will be public on your site in a few minutes.', 'Publish');
      if (!ok) return;
    } else if (doc.published) {
      if (!(await confirmBox('Unpublish this post?', (local ? 'It is published now. It will be removed from your site until you publish it again.' : 'It is public now. It will be removed from your site until you publish it again.') + ' The text is kept as a draft.', 'Unpublish'))) return;
    }
    const saving = local ? 'Saving…' : 'Saving on GitHub…';
    setBusy(asDraft ? saving : 'Publishing…');
    try {
      if (!local && !(await siteIsReady())) {
        throw new Friendly('Your site on GitHub does not have the new blog yet, so it cannot build posts. The new version of the site has to be put online first (the "push"). Your text stays saved in this browser.');
      }
      await checkImages();
      await uploadImages();
      setBusy(asDraft ? saving : 'Publishing…');
      const isNew = !doc.path;
      const path = doc.path || 'posts/' + Core.fileName(doc);
      if (isNew && (await ghMaybe(contents(path) + '?ref=' + branch))) {
        throw new Friendly('A post with the same date and title already exists ' + (local ? 'in your site' : 'on GitHub') + '. Change the title a little, or open that post from "My posts".');
      }
      const wasPublished = doc.published;
      const verb = asDraft ? (wasPublished ? 'Unpublish' : 'Save draft') : isNew || !wasPublished ? 'Publish' : 'Update';
      const body = { message: verb + ': ' + doc.fm.title.trim(), content: Core.textToBase64(Core.serializePost(doc, asDraft)), branch: branch };
      if (doc.sha) body.sha = doc.sha;
      const result = await gh('PUT', contents(path), { body: body });
      doc.path = path;
      doc.sha = result.content.sha;
      doc.published = !asDraft;
      doc.dirty = false;
      saveLocal();
      refresh();
      if (local) await afterLocalSave(result, { asDraft: asDraft, wasPublished: wasPublished });
      else watchBuild(result.commit.sha, { asDraft: asDraft, wasPublished: wasPublished });
    } catch (e) {
      showNotice('error', explain(e));
    } finally {
      setBusy('');
    }
  }

  // On the owner's computer the site is rebuilt before the save returns, so the post is there at once
  async function afterLocalSave(result, info) {
    try {
      const index = await fetch('/search.json', { cache: 'no-store' });
      const list = index.ok ? await index.json() : null;
      if (Array.isArray(list)) publishedIndex = list;
    } catch (e) { /* the list of posts is read again the next time the page opens */ }
    const extra = result && result.note ? ' ' + esc(result.note) : '';
    if (info.asDraft) {
      showNotice('ok', (info.wasPublished
        ? '<strong>The post is unpublished.</strong> It is kept as a draft.'
        : '<strong>Saved as a draft.</strong> Readers cannot see it. Click Publish when it is ready.') + extra);
      return;
    }
    const url = location.origin + Core.postUrl(doc);
    const link = '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url.replace(/^https?:\/\//, '')) + '</a>';
    showNotice('ok', '<strong>' + (info.wasPublished ? 'The changes are in your site:' : 'Published in your site:') + '</strong> ' + link +
      '. It is on this computer for now. It goes online the next time the site is sent to GitHub.' + extra);
  }

  async function findRun(sha) {
    const path = '/repos/' + repo + '/actions/runs?head_sha=' + sha + '&per_page=5';
    let data = null;
    if (runsWithKey && token) {
      try {
        data = await gh('GET', path);
      } catch (e) {
        if (e instanceof GhError && (e.status === 403 || e.status === 404)) runsWithKey = false; else return null;
      }
    }
    if (!data) {
      try { data = await gh('GET', path, { auth: false }); } catch (e) { return null; }
    }
    const runs = (data && data.workflow_runs) || [];
    return runs.find((r) => /build/i.test(r.name || '')) || runs[0] || null;
  }

  async function isOnline(url) {
    try {
      const response = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  // After a save, follow the build on GitHub and say when the post is online
  async function watchBuild(sha, info) {
    const id = ++watchId;
    const url = siteUrl + Core.postUrl(doc);
    const link = '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url.replace(/^https?:\/\//, '')) + '</a>';
    const note = (kind, html) => { if (id === watchId) showNotice(kind, html); };
    if (info.asDraft && !info.wasPublished) {
      note('ok', '<strong>Saved as a draft on GitHub.</strong> Readers cannot see it. Click Publish when it is ready.');
      return;
    }
    note('ok', '<strong>' + (info.asDraft ? 'Saved.' : 'Sent to GitHub.') + '</strong> GitHub is now building the site. This takes a few minutes; you can close this page.');
    let run = null;
    for (let i = 0; i < 40 && id === watchId; i++) {
      await sleep(i < 6 ? 6000 : 15000);
      run = await findRun(sha);
      if (run && run.status === 'completed') break;
    }
    if (id !== watchId) return;
    if (run && run.status === 'completed' && run.conclusion !== 'success') {
      note('error', '<strong>The site could not be built, so nothing changed on your site.</strong> <a href="' + esc(run.html_url) + '" target="_blank" rel="noopener">See the reason on GitHub</a>, correct the post, and publish again.');
      return;
    }
    if (info.asDraft) {
      note('ok', '<strong>The post is unpublished.</strong> It disappears from your site in about a minute. The text is kept as a draft.');
      return;
    }
    if (info.wasPublished) {
      await sleep(45000);
      note('ok', '<strong>The changes are online:</strong> ' + link + ' (reload that page if you still see the old version).');
      return;
    }
    for (let i = 0; i < 30 && id === watchId; i++) {
      if (await isOnline(url)) { note('ok', '<strong>It is online:</strong> ' + link); return; }
      await sleep(8000);
    }
    note('ok', '<strong>Saved on GitHub.</strong> The post should appear here soon: ' + link);
  }

  /* ------------------------------------------------------------ my posts */
  function isOnlineFile(name) {
    return publishedIndex.find((e) => e.file === name || (e.url && e.url.split('/').pop() === name.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '') + '.html')) || null;
  }

  function renderConnection() {
    $('connection').innerHTML = local
      ? 'You are working on this computer: posts are saved straight into your site folder. No GitHub key is needed.'
      : token
      ? 'Connected to GitHub' + (login ? ' as <strong>' + esc(login) + '</strong>' : '') + '. <button type="button" class="link-button" data-action="disconnect">Disconnect</button>'
      : 'Not connected to GitHub yet. <button type="button" class="link-button" data-action="connect">Connect</button>';
  }

  function renderLocal() {
    readForm();
    const docs = readDocs();
    docs[doc.id] = doc;
    const rows = Object.keys(docs).map((id) => docs[id]).filter((d) => !isBlank(d) && (!d.path || d.dirty)).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!rows.length) { $('posts-local').innerHTML = ''; return; }
    $('posts-local').innerHTML = '<h3 class="posts-heading">' + (local ? 'In this browser, not in your site yet' : 'In this browser, not sent yet') + '</h3><ul class="post-rows">' + rows.map((d) => {
      const current = d.id === doc.id;
      return '<li class="post-row"><div class="post-row__main"><span class="post-row__title">' + esc(d.fm.title.trim() || 'Untitled') + '</span>' +
        '<span class="post-row__meta">' + (local ? (d.path ? 'Changes not saved in your site' : 'Not in your site yet') : (d.path ? 'Changes not sent to GitHub' : 'Not on GitHub yet')) + (current ? ' · open now' : '') + '</span></div>' +
        (current ? '' : '<button type="button" class="btn" data-action="open-local" data-id="' + esc(d.id) + '">Open</button>') +
        (current ? '' : '<button type="button" class="btn" data-action="delete-local" data-id="' + esc(d.id) + '">' + (d.path ? 'Discard changes' : 'Delete') + '</button>') + '</li>';
    }).join('') + '</ul>';
  }

  async function renderRemote() {
    const box = $('posts-remote');
    const heading = '<h3 class="posts-heading">' + (local ? 'In your site' : 'On GitHub') + '</h3>';
    box.innerHTML = heading + '<p class="modal__footnote">Loading…</p>';
    let files;
    try {
      files = await ghMaybe(contents('posts') + '?ref=' + branch);
    } catch (e) {
      box.innerHTML = heading + '<p class="modal__footnote">' + explain(e) + '</p>';
      return;
    }
    const posts = (Array.isArray(files) ? files : []).filter((f) => f.type === 'file' && /\.md$/.test(f.name) && f.name.charAt(0) !== '_').sort((a, b) => (a.name < b.name ? 1 : -1));
    if (!posts.length) {
      box.innerHTML = heading + '<p class="modal__footnote">' + (local ? 'Your site has no posts yet. Write one and click Publish.' : 'There are no posts on GitHub yet. They appear here once the new version of the site is online.') + '</p>';
      return;
    }
    box.innerHTML = heading + '<ul class="post-rows">' + posts.map((f) => {
      const online = isOnlineFile(f.name);
      const date = (/^(\d{4}-\d{2}-\d{2})-/.exec(f.name) || [])[1] || '';
      return '<li class="post-row"><div class="post-row__main"><span class="post-row__title">' + esc(online ? online.title : Core.prettyName(f.name)) + '</span>' +
        '<span class="post-row__meta">' + esc(date) + '<span class="state' + (online ? ' state--live' : '') + '">' + (online ? (local ? 'Published' : 'Online') : 'Draft') + '</span></span></div>' +
        '<button type="button" class="btn" data-action="open-remote" data-name="' + esc(f.name) + '">Open</button></li>';
    }).join('') + '</ul>';
  }

  function openPosts() {
    renderLocal();
    renderConnection();
    $('dlg-posts').showModal();
    renderRemote();
  }

  async function openRemote(name, force) {
    const path = 'posts/' + name;
    readForm();
    const docs = readDocs();
    docs[doc.id] = doc;
    const local = Object.keys(docs).map((id) => docs[id]).find((d) => d.path === path && d.dirty);
    // Never replace unsent changes without asking
    if (local && !force) {
      $('dlg-posts').close();
      if (local.id !== doc.id) switchTo(normalize(local));
      showNotice('info', 'This browser has changes for this post that were never ' + (local ? 'saved in your site' : 'sent to GitHub') + '. They are shown here. <button type="button" class="link-button" data-action="reload-remote" data-name="' + esc(name) + '">Discard them and load the version from ' + (local ? 'your site' : 'GitHub') + '</button>');
      return;
    }
    setBusy('Opening the post…');
    try {
      const file = await gh('GET', contents(path) + '?ref=' + branch);
      const next = Core.parsePost(Core.base64ToText(file.content), name, yamlLoad);
      next.path = path;
      next.sha = file.sha;
      if (local) next.id = local.id;
      if ($('dlg-posts').open) $('dlg-posts').close();
      setBusy('');
      switchTo(next);
    } catch (e) {
      if ($('dlg-posts').open) $('dlg-posts').close();
      showNotice('error', explain(e));
    } finally {
      setBusy('');
    }
  }

  function download() {
    readForm();
    if (!Core.slugify(doc.fm.title)) { showProblems([{ field: 'title', message: 'Give the post a title first.' }]); return; }
    const blob = new Blob([Core.serializePost(doc, false)], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = Core.fileName(doc);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function openFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = Core.parsePost(String(reader.result), file.name, yamlLoad);
        next.dirty = true;
        next.published = false;
        $('dlg-posts').close();
        switchTo(next);
      } catch (e) {
        $('dlg-posts').close();
        showNotice('error', 'This file could not be read as a post: ' + esc(e.message));
      }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------ wiring */
  function showView(view) {
    $('main').setAttribute('data-view', view);
    $('tab-write').classList.toggle('is-active', view === 'write');
    $('tab-preview').classList.toggle('is-active', view === 'preview');
    $('tab-write').setAttribute('aria-pressed', String(view === 'write'));
    $('tab-preview').setAttribute('aria-pressed', String(view === 'preview'));
    if (view === 'write') [$('f-title'), $('f-description'), $('f-body')].forEach(grow);
    else renderPreview();
  }

  async function action(name, target) {
    if (name === 'connect') {
      if ($('dlg-posts').open) $('dlg-posts').close();
      if (await openConnect()) showNotice('ok', 'Connected to GitHub' + (login ? ' as <strong>' + esc(login) + '</strong>' : '') + '. You can publish now.');
    } else if (name === 'disconnect') {
      forgetKey();
      renderConnection();
    } else if (name === 'open-local') {
      const stored = readDocs()[target.getAttribute('data-id')];
      $('dlg-posts').close();
      if (stored) switchTo(normalize(stored));
    } else if (name === 'delete-local') {
      const id = target.getAttribute('data-id');
      const docs = readDocs();
      const title = docs[id] ? docs[id].fm.title.trim() || 'Untitled' : '';
      const onGitHub = Boolean(docs[id] && docs[id].path);
      $('dlg-posts').close();
      const sure = onGitHub
        ? await confirmBox('Discard your changes?', 'The changes to "' + title + '" that were not sent will be lost. The version ' + (local ? 'in your site' : 'on GitHub') + ' stays as it is.', 'Discard changes')
        : await confirmBox('Delete this text?', '"' + title + '" is only in this browser. Deleting it cannot be undone.', 'Delete');
      if (sure) {
        const now = readDocs();
        (now[id] && now[id].images ? now[id].images : []).forEach((i) => { if (!i.uploaded) forgetImage(i.path); });
        delete now[id];
        writeDocs(now);
      }
      openPosts();
    } else if (name === 'open-remote') {
      openRemote(target.getAttribute('data-name'), false);
    } else if (name === 'reload-remote') {
      openRemote(target.getAttribute('data-name'), true);
    }
  }

  function bind() {
    $('form').addEventListener('submit', (event) => event.preventDefault());
    $('form').addEventListener('input', (event) => {
      const el = event.target;
      if (el.type === 'file') return;
      if (el.id === 'f-series') { fillParts(); suggestTitle(); }
      if (el.id === 'f-part') suggestTitle();
      if (el.tagName === 'TEXTAREA') grow(el);
      el.classList.remove('is-invalid');
      onChange();
    });
    $('f-title').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); $('f-description').focus(); }
    });
    document.querySelector('.md-toolbar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-md]');
      if (button && TOOLS[button.getAttribute('data-md')]) TOOLS[button.getAttribute('data-md')]();
    });
    area().addEventListener('keydown', (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const tool = { b: 'bold', i: 'italic', k: 'link' }[event.key.toLowerCase()];
      if (tool) { event.preventDefault(); TOOLS[tool](); }
    });
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); readForm(); saveLocal(); }
    });
    $('f-image').addEventListener('change', (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (files.length) addImages(files);
    });
    area().addEventListener('paste', (event) => {
      const files = Array.from((event.clipboardData && event.clipboardData.files) || []).filter((f) => /^image\//.test(f.type));
      if (files.length) { event.preventDefault(); addImages(files); }
    });
    area().addEventListener('dragover', (event) => {
      if (event.dataTransfer && Array.from(event.dataTransfer.types || []).indexOf('Files') !== -1) { event.preventDefault(); area().classList.add('is-dropping'); }
    });
    area().addEventListener('dragleave', () => area().classList.remove('is-dropping'));
    area().addEventListener('drop', (event) => {
      area().classList.remove('is-dropping');
      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []).filter((f) => /^image\//.test(f.type));
      if (files.length) { event.preventDefault(); addImages(files); }
    });
    $('btn-sections').addEventListener('click', () => {
      const ta = area();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      insertBlock(FIVE_SECTIONS, 0, 0);
    });
    $('btn-publish').addEventListener('click', () => send(false));
    $('btn-draft').addEventListener('click', () => send(true));
    $('btn-posts').addEventListener('click', openPosts);
    $('btn-download').addEventListener('click', download);
    $('btn-new').addEventListener('click', () => { $('dlg-posts').close(); switchTo(Core.emptyDoc()); $('f-title').focus(); });
    $('btn-open-file').addEventListener('click', () => $('f-open-file').click());
    $('f-open-file').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) openFile(file);
    });
    $('tab-write').addEventListener('click', () => showView('write'));
    $('tab-preview').addEventListener('click', () => showView('preview'));
    $('welcome-close').addEventListener('click', () => {
      $('welcome').hidden = true;
      try { localStorage.setItem(KEY.welcome, '1'); } catch (e) { /* ignore */ }
    });
    $('connect-form').addEventListener('submit', submitConnect);
    $('dlg-connect').addEventListener('close', () => {
      const done = connectResolve;
      connectResolve = null;
      if (done) done(false);
    });
    $('confirm-yes').addEventListener('click', () => { const done = confirmResolve; confirmResolve = null; $('dlg-confirm').close(); if (done) done(true); });
    $('confirm-no').addEventListener('click', () => $('dlg-confirm').close());
    $('dlg-confirm').addEventListener('close', () => { const done = confirmResolve; confirmResolve = null; if (done) done(false); });
    document.addEventListener('click', (event) => {
      const closer = event.target.closest('[data-close]');
      if (closer) { closer.closest('dialog').close(); return; }
      const actor = event.target.closest('[data-action]');
      if (actor) action(actor.getAttribute('data-action'), actor);
    });
    window.addEventListener('resize', () => [$('f-title'), $('f-description'), $('f-body')].forEach(grow));
  }

  function fatal(message) {
    showNotice('error', esc(message));
    ['btn-publish', 'btn-draft', 'btn-posts'].forEach((id) => { $(id).disabled = true; });
  }

  async function init() {
    if (!Core || !window.marked || !window.katex || !window.jsyaml) {
      fatal('The writing page could not load its tools. Reload the page; if this message stays, the site needs to be built again.');
      return;
    }
    try {
      const config = await fetch('/site.config.json', { cache: 'no-store' });
      if (!config.ok) throw new Error('settings');
      site = await config.json();
    } catch (e) {
      fatal('The settings of the site (site.config.json) could not be loaded. Reload the page.');
      return;
    }
    try {
      const index = await fetch('/search.json', { cache: 'no-store' });
      publishedIndex = index.ok ? await index.json() : [];
      if (!Array.isArray(publishedIndex)) publishedIndex = [];
    } catch (e) {
      publishedIndex = [];
    }
    siteUrl = String(site.url || location.origin).replace(/\/$/, '');
    const host = siteUrl.replace(/^https?:\/\//, '');
    repo = site.repository || (/\.github\.io$/.test(host) ? host.split('.')[0] + '/' + host : '');
    branch = site.branch || 'main';
    markdown = createMarkdown();
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      try {
        const ping = await fetch('/api/local/ping', { cache: 'no-store' });
        const info = ping.ok ? await ping.json() : null;
        local = Boolean(info && info.local);
        if (local && !info.node) showNotice('info', 'Node 20 or newer was not found on this computer, so posts cannot be published from here yet. Install Node 22 from nodejs.org and start the website again. You can keep writing.');
      } catch (e) {
        local = false;
      }
    }
    if (local) { token = 'local'; remoteReady = true; }
    buildForm();

    const docs = readDocs();
    let current = null;
    try { current = localStorage.getItem(KEY.current); } catch (e) { current = null; }
    const newest = Object.keys(docs).map((id) => docs[id]).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    doc = normalize(docs[current] || newest || Core.emptyDoc());
    try { $('welcome').hidden = Boolean(localStorage.getItem(KEY.welcome)); } catch (e) { $('welcome').hidden = false; }

    bind();
    fillForm();
    initPreview();
    restoreImages().then(renderPreview);
    if (!local) restoreKey();
    if (!$('f-title').value) $('f-title').focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
