// Checks js/write-core.js (the file handling of the writing page) against the real posts: reading a
// post and writing it back must not change what the build sees. Run:  npm run test:write
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, 'package.json'));
const matter = require('gray-matter');
const yaml = require('js-yaml');
await import(pathToFileURL(path.join(ROOT, 'js', 'write-core.js')).href);
const Core = globalThis.WriteCore;
assert.ok(Core && Core.parsePost, 'WriteCore loaded');

const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.slice(0, 10) : v);
const norm = (data, name) => {
  const d = { ...data };
  d.date = iso(d.date) || (/^(\d{4}-\d{2}-\d{2})-/.exec(name) || [])[1];
  d.type = d.type || 'article';
  d.topics = [].concat(d.topics || []).map(Core.slugify).filter(Boolean);
  d.tags = [].concat(d.tags || []).map(String);
  if (d.updated) d.updated = iso(d.updated);
  if (typeof d.code === 'string' && !d.code) delete d.code;
  for (const k of Object.keys(d)) if (d[k] === undefined || d[k] === null || d[k] === '' || (Array.isArray(d[k]) && !d[k].length)) delete d[k];
  if (!d.draft) delete d.draft;
  return d;
};

let n = 0;
for (const name of fs.readdirSync(path.join(ROOT, 'posts')).filter((f) => f.endsWith('.md')).sort()) {
  const text = fs.readFileSync(path.join(ROOT, 'posts', name), 'utf8');
  const before = matter(text);
  const doc = Core.parsePost(text, name, yaml.safeLoad);
  const out = Core.serializePost(doc, !doc.published);
  const after = matter(out);
  assert.deepEqual(norm(after.data, name), norm(before.data, name), `${name}: top block changed`);
  assert.equal(after.content.trim(), before.content.trim(), `${name}: text changed`);
  // writing it a second time changes nothing at all
  const again = Core.serializePost(Core.parsePost(out, name, yaml.safeLoad), !doc.published);
  assert.equal(again, out, `${name}: not stable on the second save`);
  n++;
}
console.log(`round trip: ${n} post files unchanged for the build`);

// names and addresses
const d = Core.emptyDoc();
d.fm.title = 'Non-IID data: when clients disagree — Été & façade';
d.fm.date = '2026-12-01';
assert.equal(Core.fileName(d), '2026-12-01-non-iid-data-when-clients-disagree-ete-facade.md');
assert.equal(Core.postUrl(d), '/blog/2026/non-iid-data-when-clients-disagree-ete-facade.html');
d.path = 'posts/2026-01-07-fedprox-paper-review.md';
assert.equal(Core.postUrl(d), '/blog/2026/fedprox-paper-review.html');

// tricky text survives: quotes, backslashes, colons, hashes, emoji, LaTeX
const t = Core.emptyDoc();
t.fm.title = 'A "quoted" title: with \\alpha, #hash and 100%';
t.fm.description = 'Line one\nline two — with "quotes" and a trailing backslash \\';
t.fm.tags = ['C++', 'a, b', 'x: y', '"q"'];
t.fm.topics = ['federated-learning', 'time-series'];
t.fm.series = 'fl-challenges'; t.fm.part = 3;
t.fm.code = 'https://github.com/aouedions11/repo';
t.fm.type = 'paper-review';
t.fm.paper = { title: 'T: a "paper"', authors: 'A. B, C. D', venue: 'ICML 2026', link: 'https://arxiv.org/abs/1' };
t.fm.extra = { featured: true, readTime: 7, slug: 'custom', updated: '2026-02-01', image: '/images/x.png' };
t.body = 'Text with $\\mu \\lVert w \\rVert^2$ and `code`.\n\n```python\nprint("---")\n```\n\n---\n\nAfter a rule.';
const file = Core.serializePost(t, true);
const back = matter(file);
assert.equal(back.data.title, t.fm.title);
assert.equal(back.data.description, 'Line one line two — with "quotes" and a trailing backslash \\');
assert.deepEqual(back.data.tags, t.fm.tags);
assert.deepEqual(back.data.topics, t.fm.topics);
assert.equal(back.data.series, 'fl-challenges'); assert.equal(back.data.part, 3);
assert.equal(back.data.code, t.fm.code);
assert.deepEqual(back.data.paper, t.fm.paper);
assert.equal(back.data.featured, true); assert.equal(back.data.readTime, 7); assert.equal(back.data.slug, 'custom');
assert.equal(back.data.draft, true);
assert.equal(back.content.trim(), t.body);
const re = Core.parsePost(file, 'x.md', yaml.safeLoad);
assert.equal(re.published, false);
assert.equal(re.body, t.body);
assert.deepEqual(re.fm.extra, t.fm.extra);
assert.equal(Core.serializePost(re, true), file);

// "# Title" as first line, no top block
const h = Core.parsePost('# My title\n\nHello.\n', '2026-12-05-my-title.md', yaml.safeLoad);
assert.equal(h.fm.title, 'My title'); assert.equal(h.body, 'Hello.'); assert.equal(h.fm.date, '2026-12-05'); assert.equal(h.published, true);

// checks
const ctx = { types: { article: {}, 'paper-review': {}, 'quick-note': {} }, series: { 'fl-challenges': { parts: new Array(8).fill({}) } }, taken: { 'fl-challenges#3': 'Other post' } };
const v = (doc, extra) => Core.validate(doc, { ...ctx, ...extra }).map((p) => p.field);
assert.deepEqual(v(Core.emptyDoc()), ['title', 'body']);
assert.deepEqual(v(Core.emptyDoc(), { forDraft: true }), ['title']);
assert.deepEqual(v(t), ['part']);                       // part 3 is taken
assert.deepEqual(v(t, { forDraft: true }), []);          // a draft may reuse it
const bad = Core.emptyDoc(); bad.fm.title = 'T'; bad.body = '![x](figure.png)\n\n![y](/images/blog/a.png "c") <img src="https://e.org/i.png">'; bad.fm.code = 'github.com/x';
assert.deepEqual(v(bad), ['code', 'body']);
assert.deepEqual(Core.imagesIn(bad.body).map((i) => [i.src, i.local, i.absolute]), [['figure.png', true, false], ['/images/blog/a.png', true, true], ['https://e.org/i.png', false, false]]);
assert.deepEqual(Core.imagesIn('`![no](/a.png)`\n\n```\n![no](/b.png)\n```'), []);

// base64 with non-Latin text
const s = 'Été — 数学 ✓ $\\alpha$';
assert.equal(Core.base64ToText(Core.textToBase64(s)), s);
assert.equal(Buffer.from(Core.textToBase64(s), 'base64').toString('utf8'), s);
console.log('all core checks passed');
