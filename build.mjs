#!/usr/bin/env node
/**
 * build.mjs — static blog generator for aouedions11.github.io
 *
 * Turns the Markdown files in posts/ into:
 *   blog/index.html           year-grouped archive with topic + content-type filters
 *   blog/<year>/<slug>.html   one page per post (contents list, figures, code, "read next")
 *   search.json               index for the client-side search box
 *   rss_feed.xml, sitemap.xml, robots.txt, llms.txt, llms-full.txt
 *   blog.html                 redirect from the old single-page blog (keeps old links alive)
 *   404.html                  "page not found" page in the site's design
 *   index.html                only the blog block between the BLOG:START / BLOG:END markers
 *   js/vendor/                browser copies of the libraries used by the writing page (/write/)
 *
 * Usage:
 *   node build.mjs                                   build everything
 *   node build.mjs --new "Post title" [--type T]     scaffold posts/<date>-<slug>.md
 *                                                    T = article | paper-review | quick-note
 *   node build.mjs --new "Title" --series S --part N scaffold a series post from posts/_template-challenge.md
 *
 * The output depends only on the files in the repository (no clock, no file dates),
 * so building twice gives the same bytes. The GitHub workflow relies on that.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Say clearly what is wrong before the dependencies (which need Node 20+) are loaded
if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(`✖ This site needs Node 20 or newer (this is Node ${process.versions.node}).\n  Run "nvm use 22" and try again, or install Node 22 from https://nodejs.org`);
  process.exit(1);
}
let matter;
let Marked;
let katex;
let hljs;
try {
  ({ default: matter } = await import('gray-matter'));
  ({ Marked } = await import('marked'));
  ({ default: katex } = await import('katex'));
  ({ default: hljs } = await import('highlight.js/lib/common'));
} catch (error) {
  if (error && error.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('✖ The dependencies are missing. Run "npm install" once, then try again.');
    process.exit(1);
  }
  throw error;
}

const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(ROOT, 'posts');
const BLOG_DIR = path.join(ROOT, 'blog');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const longDate = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const shortDate = (d) => `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const absUrl = (p) => SITE.url.replace(/\/$/, '') + p;
const fileHash = (p) => (fs.existsSync(p) ? crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 8) : '0');
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s || '');
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
const warn = (msg) => console.warn(`! ${msg}`);
const typeInfo = (t) => SITE.types[t] || { label: t, plural: t };
const seriesTitle = (p) => (p.series ? SERIES[p.series].title : null);
const topicLabel = (t) => SITE.topics[t] || t.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const isHttp = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim());
// Newest post date. With no published post: the home page's own "Last updated" date, so the output stays the same from build to build
const latestDate = (posts) => (posts.length ? new Date(Math.max(...posts.map((p) => Math.max(+p.date, p.updated ? +p.updated : 0)))) : homeStamp() || new Date(0));
const SERIES = SITE.series || {};
const SHOW_PLANNED = Boolean(SITE.blog && SITE.blog.showPlannedParts);
const NEWSLETTER = SITE.newsletter && String(SITE.newsletter.href || '').trim() ? SITE.newsletter : null;
if (NEWSLETTER && !isHttp(NEWSLETTER.href)) fail(`site.config.json: newsletter.href must be an http(s) URL (got "${NEWSLETTER.href}")`);
const SOCIAL_IMAGE = SITE.socialImage || SITE.author.image;
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';
const INDEX_FILE = path.join(ROOT, 'index.html');
const BLOG_START = '<!-- BLOG:START generated by build.mjs, do not edit by hand -->';
const BLOG_END = '<!-- BLOG:END -->';
const BLOG_STATE_FILE = path.join(ROOT, 'css', 'blog-state.css');

// False while no post is published (set by build()): the blog keeps its place in the menu and on the
// home page, and only what needs a post is left out (the search box, the "All posts" links, the lists)
let HAS_POSTS = true;

// The "Last updated DD/MM/YYYY" date written in the footer of the home page
function homeStamp() {
  const m = fs.existsSync(INDEX_FILE) && /Last updated (\d{2})\/(\d{2})\/(\d{4})/.exec(fs.readFileSync(INDEX_FILE, 'utf8'));
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`) : null;
}

function toDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return null;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// ---------------------------------------------------------------- markdown
function tokensToText(tokens) {
  return (tokens || []).map((t) => (t.tokens ? tokensToText(t.tokens) : (t.text ?? t.raw ?? ''))).join('');
}

// A picture that does not exist would show as a broken image, so the build stops instead
function checkImage(href, ctx) {
  if (/^(https?:)?\/\//i.test(href) || /^data:/i.test(href)) return;
  if (!href.startsWith('/')) {
    fail(`${ctx.file}: the image "${href}" needs a path that starts with "/" (for example /images/blog/my-figure.png) or a full https:// address`);
  }
  const file = path.join(ROOT, decodeURIComponent(href.split(/[?#]/)[0]));
  if (!fs.existsSync(file)) fail(`${ctx.file}: the image ${href} was not found. Add the file to ${path.relative(ROOT, path.dirname(file)) || '.'}/ or correct the path.`);
}

function imgTag(token, ctx, withTitle) {
  const href = String(token.href || '');
  checkImage(href, ctx);
  return `<img src="${esc(href)}" alt="${esc(token.text)}"${withTitle && token.title ? ` title="${esc(token.title)}"` : ''} loading="lazy" decoding="async">`;
}

function createMarkdown(ctx) {
  return new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const plain = tokensToText(tokens).replace(/<[^>]+>/g, '').trim();
        const base = slugify(plain) || 'section';
        let id = base;
        let n = 1;
        while (ctx.ids.has(id)) id = `${base}-${++n}`;
        ctx.ids.add(id);
        if (depth === 2 || depth === 3) ctx.headings.push({ depth, id, text: plain });
        return `<h${depth} id="${id}">${html} <a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = String(lang || '').trim().split(/\s+/)[0];
        ctx.hasCode = true;
        const body = language && hljs.getLanguage(language)
          ? hljs.highlight(text, { language, ignoreIllegals: true }).value
          : esc(text);
        return `<div class="code-block"${language ? ` data-lang="${esc(language)}"` : ''}><pre><code class="hljs${language ? ` language-${esc(language)}` : ''}">${body}</code></pre></div>\n`;
      },
      // An image alone on its line becomes a figure; its "title" is the caption:  ![alt text](/images/blog/x.png "Caption")
      paragraph({ tokens }) {
        if (!(tokens.length === 1 && tokens[0].type === 'image')) return false;
        const t = tokens[0];
        return `<figure class="post-figure"><a class="post-figure__zoom" href="${esc(t.href)}">${imgTag(t, ctx, false)}</a>${t.title ? `<figcaption>${esc(t.title)}</figcaption>` : ''}</figure>\n`;
      },
      image(token) {
        return imgTag(token, ctx, true);
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
        },
        renderer(token) {
          ctx.hasMath = true;
          return `${katex.renderToString(token.text, { displayMode: true, throwOnError: false })}\n`;
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
          ctx.hasMath = true;
          return katex.renderToString(token.text, { displayMode: false, throwOnError: false });
        },
      },
    ],
  });
}

function firstParagraph(markdown) {
  const lines = markdown.split('\n');
  const skip = /^(#|\$\$|>|[-*] |\d+\. |!\[|\||```)/;
  for (const line of lines) {
    const t = line.trim();
    if (t && !skip.test(t)) {
      return truncate(t.replace(/[*_`$]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'), 200);
    }
  }
  return '';
}

// ---------------------------------------------------------------- posts
function loadPosts() {
  if (!fs.existsSync(POSTS_DIR)) fail(`Missing ${path.relative(ROOT, POSTS_DIR)}/ directory`);
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort();
  const posts = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
    const parsed = matter(raw);
    const data = parsed.data;
    let content = parsed.content;
    const series = seriesFields(file, data);  // checked for drafts too, so mistakes show up early
    if (data.draft === true || /^(true|yes)$/i.test(String(data.draft ?? ''))) { console.log(`  · skipping draft ${file}`); continue; }
    // A first line "# Title" can stand in for the title, and is never printed twice
    const h1 = /^\s*#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/.exec(content);
    if (h1 && !data.title) data.title = h1[1];
    if (h1 && slugify(h1[1]) === slugify(data.title)) content = content.slice(h1[0].length);
    if (!data.title) fail(`${file}: the post needs a title. Add a line  title: "My title"  between the --- lines at the top, or start the text with  # My title`);
    const date = toDate(data.date) || (/^(\d{4}-\d{2}-\d{2})-/.test(file) ? toDate(RegExp.$1) : null);
    if (!date) fail(`${file}: the post needs a date. Name the file like 2026-12-01-my-title.md, or add a line  date: 2026-12-01  at the top`);
    const type = data.type || 'article';
    if (!SITE.types[type]) fail(`${file}: unknown type "${type}" (expected ${Object.keys(SITE.types).join(', ')})`);
    const topics = [].concat(data.topics || []).map(slugify).filter(Boolean);
    for (const t of topics) if (!SITE.topics[t]) warn(`${file}: topic "${t}" is not listed in site.config.json topics (it will still work)`);
    const tags = [].concat(data.tags || []).map(String);
    const slug = data.slug ? slugify(data.slug) : file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const ctx = { file, headings: [], ids: new Set(), hasMath: false, hasCode: false };
    const html = createMarkdown(ctx).parse(content)
      .replace(/<table>/g, '<div class="table-wrap"><table>')
      .replace(/<\/table>/g, '</table></div>');
    const words = content.replace(/```[\s\S]*?```/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').split(/\s+/).filter(Boolean).length;
    const year = String(date.getUTCFullYear());
    posts.push({
      file, slug, year, date, type, topics, tags, html, words,
      title: String(data.title),
      description: data.description ? String(data.description) : firstParagraph(content),
      featured: Boolean(data.featured),
      paper: data.paper || null,
      code: codeField(file, data.code),
      series: series ? series.slug : null,
      part: series ? series.part : null,
      legacyId: data.legacyId ? String(data.legacyId) : null,
      updated: toDate(data.updated),
      image: data.image || null,
      readTime: Number(data.readTime) || Math.max(1, Math.round(words / 200)),
      headings: ctx.headings,
      hasMath: ctx.hasMath,
      hasCode: ctx.hasCode,
      markdown: content.trim(),
      url: `/blog/${year}/${slug}.html`,
    });
  }
  posts.sort((a, b) => b.date - a.date || a.title.localeCompare(b.title));
  const seen = new Map();
  for (const p of posts) {
    if (seen.has(p.url)) fail(`${p.file} and ${seen.get(p.url)} both produce ${p.url}; give one of them a different slug`);
    seen.set(p.url, p.file);
  }
  const parts = new Map();
  for (const p of posts.filter((x) => x.series)) {
    const key = `${p.series}#${p.part}`;
    if (parts.has(key)) fail(`${p.file} and ${parts.get(key)} are both part ${p.part} of series "${p.series}"`);
    parts.set(key, p.file);
  }
  return posts;
}

// series: <slug> and part: <n> in the front matter; both or neither
function seriesFields(file, data) {
  const has = data.series !== undefined && data.series !== null && data.series !== '';
  if (!has) {
    if (data.part !== undefined && data.part !== null) fail(`${file}: "part" is set but "series" is missing`);
    return null;
  }
  const slug = String(data.series);
  const info = SERIES[slug];
  if (!info) fail(`${file}: unknown series "${slug}" (expected ${Object.keys(SERIES).join(', ') || 'a series from site.config.json'})`);
  const raw = typeof data.part === 'string' && /^\d+$/.test(data.part.trim()) ? Number(data.part) : data.part;
  if (!Number.isInteger(raw) || raw < 1 || raw > info.parts.length) {
    fail(`${file}: "part" must be an integer between 1 and ${info.parts.length} for series "${slug}" (got ${JSON.stringify(data.part ?? null)})`);
  }
  return { slug, part: raw };
}

// code: "https://..."  or  code: { link: "https://...", label: "..." }
function codeField(file, value) {
  if (value === undefined || value === null || value === '') return null;
  const link = typeof value === 'object' ? value.link : value;
  if (!isHttp(link)) fail(`${file}: "code" must be an http(s) URL, or { link, label } with an http(s) link (got ${JSON.stringify(value)})`);
  const label = typeof value === 'object' && value.label ? String(value.label) : 'Open the code on GitHub →';
  return { link: String(link).trim(), label };
}

// For each series in config order: its parts, each with the published post (or null)
function seriesState(posts) {
  return Object.entries(SERIES).map(([slug, info]) => {
    const parts = info.parts.map((part, i) => ({
      n: i + 1,
      title: part.title,
      label: part.label,
      post: posts.find((p) => p.series === slug && p.part === i + 1) || null,
    }));
    return { slug, title: info.title, description: info.description, parts, total: parts.length, published: parts.filter((x) => x.post).length };
  });
}

// What readers see. Nothing empty: a series appears once it has a published post, and lists only
// its published parts. Set "showPlannedParts": true under "blog" in site.config.json to list every part.
function visibleSeries(posts) {
  return seriesState(posts)
    .filter((s) => SHOW_PLANNED || s.published > 0)
    .map((s) => ({ ...s, shown: SHOW_PLANNED ? s.parts : s.parts.filter((x) => x.post) }));
}

function relatedPosts(post, posts, n = 3) {
  const scored = posts
    .filter((p) => p !== post)
    .map((p) => ({
      p,
      score: (p.series && p.series === post.series ? 3 : 0)
        + p.topics.filter((t) => post.topics.includes(t)).length * 2
        + p.tags.filter((t) => post.tags.includes(t)).length,
    }))
    .sort((a, b) => b.score - a.score || b.p.date - a.p.date);
  return scored.slice(0, n).map((x) => x.p);
}

// ---------------------------------------------------------------- layout
const ASSET = {
  site: fileHash(path.join(ROOT, 'style.css')),
  css: fileHash(path.join(ROOT, 'css', 'blog.css')),
  js: fileHash(path.join(ROOT, 'js', 'site.js')),
  theme: fileHash(path.join(ROOT, 'js', 'theme.js')),
};

const MOON_ICON = '<svg class="theme-icon theme-icon--moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
const SUN_ICON = '<svg class="theme-icon theme-icon--sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
const SEARCH_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

const EXT_ICON = '<svg class="ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"></path></svg>';
const PEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 .8-3.8L15.9 5.1a2.1 2.1 0 0 1 3 3L7.8 19.2 4 20z"></path><path d="m14.2 6.8 3 3"></path></svg>';
const BRAND_MARK = '<svg class="brand__mark" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 17 7.5 8M16 17l9.5-6M16 17l-2.5 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><circle class="brand__node" cx="7.5" cy="8" r="3.2"></circle><circle class="brand__node" cx="25.5" cy="11" r="3.2"></circle><circle class="brand__node" cx="13.5" cy="26.5" r="3.2"></circle><circle cx="16" cy="17" r="4.2" fill="currentColor"></circle></svg>';
const ARROW = '<span class="arrow" aria-hidden="true">→</span>';

function navHtml(pathname) {
  return SITE.nav.map((item) => {
    const current = item.href === pathname || (item.href === '/blog/' && pathname.startsWith('/blog/'));
    return `<a href="${esc(item.href)}"${current ? ' aria-current="page" class="is-current"' : ''}>${esc(item.label)}</a>`;
  }).join('\n      ');
}

// Links to the author's profiles on other sites (everything in "links" that is a web address)
const profiles = () => SITE.links.filter((l) => /^https?:/.test(l.href));
const profileLink = (l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}${EXT_ICON}</a>`;

// The small row above the menu (and the end of the phone menu): profiles, then "Contact"
function utilityLinksHtml(indent) {
  const rows = profiles().map(profileLink);
  if (SITE.author.email) rows.push(`<a class="util-nav__contact" href="mailto:${esc(SITE.author.email)}">Contact</a>`);
  return rows.join(`\n${indent}`);
}

function linksHtml(filter) {
  return SITE.links.filter(filter).map((l) => `<a href="${esc(l.href)}"${/^https?:/.test(l.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}</a>`).join('<span class="dot" aria-hidden="true">·</span>');
}

function layout({ title, description, pathname, body, ogType = 'website', article = null, jsonLd = null, head = '', robots = 'index, follow' }) {
  const canonical = absUrl(pathname);
  const fullTitle = title ? `${title} | ${SITE.title}` : SITE.title;
  const ownImage = article && article.image;
  const image = absUrl(ownImage || SOCIAL_IMAGE);
  const card = ownImage || SITE.socialImage ? 'summary_large_image' : 'summary';
  const ga = SITE.analyticsId
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(SITE.analyticsId)}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(SITE.analyticsId)}');</script>`
    : '';
  const articleMeta = article
    ? [
      `<meta property="article:published_time" content="${isoDate(article.date)}T00:00:00Z">`,
      article.updated ? `<meta property="article:modified_time" content="${isoDate(article.updated)}T00:00:00Z">` : '',
      `<meta property="article:author" content="${esc(SITE.author.name)}">`,
      ...article.tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`),
    ].filter(Boolean).join('\n  ')
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="author" content="${esc(SITE.author.name)}">
  <meta name="robots" content="${esc(robots)}">
  <meta name="theme-color" content="#1d4ed8">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="${esc(SITE.title)}">
  <meta property="og:title" content="${esc(title || SITE.title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${image}">
  <meta name="twitter:card" content="${card}">
  <meta name="twitter:title" content="${esc(title || SITE.title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${image}">
  ${articleMeta}
  <link rel="alternate" type="application/rss+xml" title="${esc(SITE.title)} RSS feed" href="${absUrl('/rss_feed.xml')}">
  <link rel="alternate" type="text/plain" title="LLMs Index" href="${absUrl('/llms.txt')}">
  <link rel="alternate" type="text/plain" title="LLMs Full Index" href="${absUrl('/llms-full.txt')}">
  <link rel="icon" type="image/png" href="/images/favicon-64.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${esc(FONTS_URL)}">
  <link rel="stylesheet" href="/style.css?v=${ASSET.site}">
  <link rel="stylesheet" href="/css/blog.css?v=${ASSET.css}">
  ${head}
  <script>(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  ${ga}
  ${jsonLd ? `<script type="application/ld+json">${safeJson(jsonLd)}</script>` : ''}
</head>
<body id="top">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header" data-site-header>
  <div class="header-util">
    <nav class="util-nav" aria-label="Profiles and contact">
      ${utilityLinksHtml('      ')}
    </nav>
  </div>
  <div class="header-content">
    <a class="brand" href="/">${BRAND_MARK}${esc(SITE.author.shortName)}</a>
    <nav class="site-nav" aria-label="Primary navigation">
      ${navHtml(pathname)}
      <div class="site-nav__extra">
        ${utilityLinksHtml('        ')}
      </div>
    </nav>
    <div class="header-controls">
      ${HAS_POSTS ? `<button type="button" class="icon-button header-search__toggle" data-search-toggle aria-expanded="false" aria-controls="site-search-panel" aria-label="Search the blog" title="Search the blog (press /)">${SEARCH_ICON}</button>
      ` : ''}<button type="button" class="icon-button theme-toggle" data-theme-toggle aria-pressed="false" aria-label="Toggle dark mode" title="Toggle dark mode">${MOON_ICON}${SUN_ICON}</button>
      <button type="button" class="mobile-menu-toggle" aria-label="Toggle navigation menu" aria-expanded="false"><span></span><span></span><span></span></button>
    </div>
  </div>
${HAS_POSTS ? `  <div class="header-search" id="site-search-panel" hidden>
    <form class="header-search__form" role="search" action="/blog/" method="get">
      <label for="site-search-input" class="sr-only">Search posts</label>
      <input id="site-search-input" class="header-search__input" type="search" name="q" placeholder="Search posts by title, tag, or summary…" autocomplete="off" spellcheck="false">
      <button type="submit" class="sr-only">Search</button>
    </form>
    <p class="header-search__status" aria-live="polite"></p>
    <ul class="header-search__results" id="site-search-results"></ul>
  </div>
` : ''}</header>
<main id="main" class="blog-container">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-about">
        <a class="footer-name" href="/">${esc(SITE.author.shortName)}</a>
        <p class="footer-tagline">${esc(SITE.tagline)}</p>${SITE.author.email ? `\n        <p><a href="mailto:${esc(SITE.author.email)}">${esc(SITE.author.email)}</a></p>` : ''}
      </div>
      <nav class="footer-col" aria-label="Blog">
        <h2>${esc(SITE.blog.title)}</h2>
        <ul>
          <li><a href="/blog/">${HAS_POSTS ? 'All posts' : esc(SITE.blog.title)}</a></li>
        </ul>
      </nav>
      <nav class="footer-col" aria-label="Site">
        <h2>Site</h2>
        <ul>
          ${SITE.nav.filter((item) => item.href !== '/blog/').map((item) => `<li><a href="${esc(item.href)}">${esc(item.label)}</a></li>`).join('\n          ')}
        </ul>
      </nav>
    </div>
    <p class="footer-top"><a href="#top">Back to top <span aria-hidden="true">↑</span></a></p>
    <div class="footer-bottom">
      <nav class="footer-social" aria-label="Profiles">
        ${profiles().map(profileLink).join('\n        ')}
      </nav>
      <p class="footer-meta">© ${new Date().getUTCFullYear()} ${esc(SITE.author.shortName)}<span class="dot" aria-hidden="true">·</span>${esc(SITE.footerNote)}</p>
    </div>
  </div>
</footer>
<script src="/js/theme.js?v=${ASSET.theme}" defer></script>
<script src="/js/site.js?v=${ASSET.js}" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- pages
// Newsletter: a plain link (no form, no third-party script); renders nothing without an address
function newsletterHtml(cls) {
  if (!NEWSLETTER) return '';
  const button = `<a class="btn btn--primary" href="${esc(NEWSLETTER.href)}" target="_blank" rel="noopener">${esc(NEWSLETTER.label || 'Subscribe by email')}</a>`;
  return `<p class="newsletter ${cls}">${button}${NEWSLETTER.note ? `<span class="newsletter__note">${esc(NEWSLETTER.note)}</span>` : ''}</p>`;
}

// Archive: one card per series that has started. It sits outside the filtered list, so filters and search never hide it.
function seriesSectionHtml(posts) {
  const all = visibleSeries(posts);
  if (!all.length) return '';
  const partHtml = (x) => (x.post
    ? `<li class="series-part" value="${x.n}"><span class="series-part__label">${esc(x.label)}</span> <a href="${x.post.url}">${esc(x.post.title)}</a></li>`
    : `<li class="series-part is-planned" value="${x.n}"><span class="series-part__label">${esc(x.label)}</span> <span class="series-part__title">${esc(x.title)}</span> <span class="series-part__status">Planned</span></li>`);
  return `<section class="blog-series" aria-labelledby="blog-series-heading">
  <h2 id="blog-series-heading">Series</h2>
  <div class="blog-series__grid">
${all.map((s) => `    <article class="series-card" id="series-${esc(s.slug)}">
      <h3>${esc(s.title)}</h3>
      <p class="series-card__desc">${esc(s.description)}</p>
      <p class="series-card__count">${s.published} of ${s.total} published</p>
      <ol class="series-parts">
        ${s.shown.map(partHtml).join('\n        ')}
      </ol>
    </article>`).join('\n')}
  </div>
</section>
`;
}

// Post page: series title, "Part N of M", previous/next published parts, link to the series card
function seriesBoxHtml(p, posts) {
  if (!p.series) return '';
  const s = seriesState(posts).find((x) => x.slug === p.series);
  const prev = s.parts[p.part - 2] && s.parts[p.part - 2].post;
  const next = s.parts[p.part] && s.parts[p.part].post;
  return `<nav class="series-box" aria-label="Series: ${esc(s.title)}">
    <p class="series-box__title"><a href="/blog/#series-${esc(s.slug)}">${esc(s.title)}</a></p>
    <p class="series-box__part">Part ${p.part} of ${s.total}</p>${prev || next ? `
    <p class="series-box__nav">${prev ? `<a class="series-box__prev" href="${prev.url}">← Part ${p.part - 1}: ${esc(prev.title)}</a>` : ''}${next ? `<a class="series-box__next" href="${next.url}">Part ${p.part + 1}: ${esc(next.title)} →</a>` : ''}</p>` : ''}
    <p class="series-box__all"><a href="/blog/#series-${esc(s.slug)}">All parts of the series</a></p>
  </nav>`;
}

function entryHtml(p) {
  const info = typeInfo(p.type);
  return `<li class="post-entry" data-blog-type="${esc(p.type)}" data-blog-topics="${esc(p.topics.join(' '))}">
      <p class="post-entry__meta">
        <time datetime="${isoDate(p.date)}">${shortDate(p.date)}</time>
        <span class="post-entry__type">${esc(info.label)}</span>
        <span class="post-entry__read">${p.readTime} min read</span>${p.series ? `\n        <span class="post-entry__series">${esc(seriesTitle(p))}, part ${p.part}</span>` : ''}${p.featured ? '\n        <span class="post-featured-badge">Featured</span>' : ''}
      </p>
      <h3 class="post-entry__title"><a class="post-overview-link" href="${p.url}">${esc(p.title)}</a></h3>
      <p class="post-overview-description">${esc(p.description)}</p>
    </li>`;
}

function archivePage(posts) {
  const topicCounts = new Map();
  posts.forEach((p) => p.topics.forEach((t) => topicCounts.set(t, (topicCounts.get(t) || 0) + 1)));
  const topicOrder = [...Object.keys(SITE.topics).filter((t) => topicCounts.has(t)), ...[...topicCounts.keys()].filter((t) => !SITE.topics[t])];
  const typesUsed = Object.keys(SITE.types).filter((t) => posts.some((p) => p.type === t));
  const years = [...new Set(posts.map((p) => p.year))];
  const body = `<div class="blog-archive">
<header class="page-head blog-hero">${SITE.blog.kicker ? `\n  <p class="kicker">${esc(SITE.blog.kicker)}</p>` : ''}
  <h1><span class="mark" aria-hidden="true">${PEN_ICON}</span>${esc(SITE.blog.title)}</h1>
  <p class="page-lead subtitle">${esc(SITE.blog.subtitle)}</p>
  <p class="blog-follow">${linksHtml((l) => l.follow)}</p>${NEWSLETTER ? `\n  ${newsletterHtml('blog-hero__newsletter')}` : ''}
</header>
${seriesSectionHtml(posts)}${posts.length ? `<div class="blog-controls">
  <div class="blog-topics" role="group" aria-label="Filter blog by topic">
    <span class="blog-controls__label">Browse by topic:</span>
    <button type="button" class="topic-pill is-active" data-topic="" aria-pressed="true"><span class="topic-pill__chip">All topics</span></button>
    ${topicOrder.map((t) => `<button type="button" class="topic-pill" data-topic="${esc(t)}" aria-pressed="false"><span class="topic-pill__chip">${esc(topicLabel(t))} <span class="topic-pill__count">${topicCounts.get(t)}</span></span></button>`).join('\n    ')}
  </div>
  <div class="blog-types" role="group" aria-label="Filter blog by content type">
    <span class="blog-controls__label">Show:</span>
    ${typesUsed.map((t) => `<label class="blog-types__option"><input type="checkbox" data-blog-filter="${esc(t)}" checked> ${esc(typeInfo(t).plural)}</label>`).join('\n    ')}
    <span class="blog-count" data-blog-count aria-live="polite">${posts.length} ${posts.length === 1 ? 'entry' : 'entries'} shown.</span>
  </div>
</div>
` : ''}${years.length > 1 ? `<nav class="blog-years" aria-label="Jump to year"><span class="blog-controls__label">Jump to:</span>${years.map((y) => `<a href="#${y}-ref">${y}</a>`).join('')}</nav>\n` : ''}${years.map((y) => `<section class="blog-year" data-blog-year="${y}">
  <h2 id="${y}-ref">${y}</h2>
  <ul class="post-list">
    ${posts.filter((p) => p.year === y).map(entryHtml).join('\n    ')}
  </ul>
</section>`).join('\n')}
${SITE.blog.banner ? `<aside class="callout callout--collab blog-banner"><p>${SITE.blog.banner}</p></aside>\n` : ''}</div>
`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: `${SITE.title} — ${SITE.blog.title}`,
    url: absUrl('/blog/'),
    description: SITE.blog.description,
    author: { '@type': 'Person', name: SITE.author.name, url: absUrl('/') },
    blogPost: posts.slice(0, 20).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: absUrl(p.url), datePublished: isoDate(p.date) })),
  };
  return layout({ title: SITE.blog.title, description: SITE.blog.description, pathname: '/blog/', body, jsonLd });
}

// Contents list: h2 entries, with their h3 entries nested under them
function tocHtml(headings) {
  const items = [];
  for (const h of headings) {
    if (h.depth === 2 || !items.length) items.push({ ...h, children: [] });
    else items[items.length - 1].children.push(h);
  }
  const li = (h) => `<li><a href="#${h.id}">${esc(h.text)}</a>${h.children && h.children.length ? `<ol>${h.children.map(li).join('')}</ol>` : ''}</li>`;
  return `<nav class="article-toc" aria-label="On this page">
    <details open>
      <summary>On this page</summary>
      <ol>${items.map(li).join('')}</ol>
    </details>
  </nav>`;
}

// BibTeX entry for the "Cite this post" box
function bibtex(p) {
  const names = SITE.author.shortName.trim().split(/\s+/);
  const family = names[names.length - 1];
  const given = names.slice(0, -1).join(' ');
  const word = p.slug.split('-').find((w) => w.length > 3) || p.slug.split('-')[0];
  const tex = (s) => String(s).replace(/([&%#_$])/g, '\\$1');
  return `@misc{${slugify(family)}${p.year}${word},
  author       = {${family}, ${given}},
  title        = {{${tex(p.title)}}},
  year         = {${p.year}},
  month        = ${MONTHS[p.date.getUTCMonth()].slice(0, 3).toLowerCase()},
  howpublished = {\\url{${absUrl(p.url)}}},
  note         = {Blog post}
}`;
}

function postPage(p, posts) {
  const info = typeInfo(p.type);
  const related = relatedPosts(p, posts);
  const hasToc = p.headings.length >= 2;
  const link = absUrl(p.url);
  const paper = p.paper
    ? `<aside class="paper-reference">
    <h2 class="paper-reference__heading">Paper reference</h2>
    <p class="paper-title">${esc(p.paper.title)}</p>${p.paper.authors ? `\n    <p class="paper-authors">${esc(p.paper.authors)}</p>` : ''}${p.paper.venue ? `\n    <p class="paper-venue">${esc(p.paper.venue)}</p>` : ''}${p.paper.link ? `\n    <a class="paper-link" href="${esc(p.paper.link)}" target="_blank" rel="noopener">Read the original paper ${ARROW}</a>` : ''}
  </aside>`
    : '';
  const code = p.code
    ? `<aside class="paper-reference code-reference">
    <h2 class="paper-reference__heading">Code and tests</h2>
    <a class="paper-link" href="${esc(p.code.link)}" target="_blank" rel="noopener">${esc(p.code.label)}</a>
  </aside>`
    : '';
  const cite = p.type === 'quick-note'
    ? ''
    : `
    <details class="post-cite">
      <summary>Cite this post</summary>
      <div class="code-block" data-lang="bibtex"><pre><code>${esc(bibtex(p))}</code></pre></div>
    </details>`;
  const body = `<article class="post${hasToc ? ' has-toc' : ''}">
  <header class="post-header">
    <p class="post-meta">
      <span class="post-meta__type">${esc(info.label)}</span>
      <time datetime="${isoDate(p.date)}">${longDate(p.date)}</time>
      <span>${p.readTime} min read</span>${p.updated ? `\n      <span>Updated ${longDate(p.updated)}</span>` : ''}
    </p>
    <h1 class="post-title">${esc(p.title)}</h1>${p.description ? `\n    <p class="post-description">${esc(p.description)}</p>` : ''}
    <p class="post-byline">By <a href="/">${esc(SITE.author.name)}</a></p>${p.tags.length ? `\n    <ul class="post-tags" aria-label="Tags">${p.tags.map((t) => `<li class="post-tag">${esc(t)}</li>`).join('')}</ul>` : ''}
  </header>
  ${seriesBoxHtml(p, posts)}
  ${paper}
  ${code}
  ${hasToc ? tocHtml(p.headings) : ''}
  <div class="post-content">
${p.html}
  </div>
  <footer class="post-footer">
    <div class="post-actions">
      <p class="post-share">
        <span class="post-actions__label">Share</span>
        <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}" target="_blank" rel="noopener">LinkedIn</a><span class="dot" aria-hidden="true">·</span><a href="https://x.com/intent/post?url=${encodeURIComponent(link)}&amp;text=${encodeURIComponent(p.title)}" target="_blank" rel="noopener">X</a><span class="dot" aria-hidden="true" data-copy-link-dot hidden>·</span><button type="button" class="post-share__copy" data-copy-link="${link}" hidden>Copy link</button>
      </p>
      <p class="post-follow">
        <span class="post-actions__label">Follow</span>
        ${linksHtml((l) => l.follow)}
      </p>
    </div>${cite}${NEWSLETTER ? `
    <div class="post-newsletter">
      <p class="post-newsletter__text">Want the next post in your inbox?</p>
      ${newsletterHtml('post-newsletter__cta')}
    </div>` : ''}
    <div class="author-card">
      <img src="${esc(SITE.author.image)}" alt="" width="72" height="72" loading="lazy">
      <div>
        <h2>${esc(SITE.author.name)}</h2>
        <p>${esc(SITE.author.bio)}</p>
        <p class="author-card__links">${linksHtml((l) => !/rss/i.test(l.href))}</p>
      </div>
    </div>${related.length ? `
    <section class="read-next">
      <h2>Read next</h2>
      <div class="read-next__grid">
        ${related.map((r) => `<a class="read-next__card" href="${r.url}">
          <span class="read-next__meta"><time datetime="${isoDate(r.date)}">${shortDate(r.date)}</time><span>${esc(typeInfo(r.type).label)}</span></span>
          <strong>${esc(r.title)}</strong>
          <span class="read-next__desc">${esc(truncate(r.description, 110))}</span>
        </a>`).join('\n        ')}
      </div>
    </section>` : ''}
    <p class="post-nav"><a href="/blog/">← All posts</a></p>
  </footer>
</article>
`;
  const head = p.hasMath ? '<link rel="stylesheet" href="/css/katex/katex.min.css">' : '';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: p.title,
    description: p.description,
    url: link,
    mainEntityOfPage: link,
    datePublished: isoDate(p.date),
    dateModified: isoDate(p.updated || p.date),
    author: { '@type': 'Person', name: SITE.author.name, url: absUrl('/') },
    keywords: [...p.tags, ...p.topics.map(topicLabel)].join(', '),
    image: absUrl(p.image || SOCIAL_IMAGE),
    wordCount: p.words,
  };
  return layout({ title: p.title, description: p.description, pathname: p.url, body, ogType: 'article', article: p, head, jsonLd });
}

// GitHub Pages serves this file for any address that does not exist
function notFoundPage() {
  const body = `<section class="not-found">
  <h1>Page not found</h1>
  <p>This address does not exist, or the page has moved.</p>
  <div class="btn-row">
    <a class="btn btn--primary" href="/blog/">Go to the blog</a>
    <a class="btn" href="/">Home page</a>
  </div>
</section>
`;
  return layout({ title: 'Page not found', description: 'This page does not exist.', pathname: '/404.html', body, robots: 'noindex' });
}

// ---------------------------------------------------------------- feeds & indexes
function cdata(s) { return `<![CDATA[${String(s).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`; }

function rssXml(posts) {
  const items = posts.slice(0, 30).map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${absUrl(p.url)}</link>
      <guid isPermaLink="true">${absUrl(p.url)}</guid>
      <pubDate>${p.date.toUTCString()}</pubDate>
      <description>${esc(p.description)}</description>
      <content:encoded>${cdata(p.html.replace(/(src|href)="\//g, `$1="${SITE.url}/`))}</content:encoded>
${[...p.tags, ...p.topics.map(topicLabel), seriesTitle(p)].filter(Boolean).map((t) => `      <category>${esc(t)}</category>`).join('\n')}
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(SITE.title)} — ${esc(SITE.blog.title)}</title>
    <description>${esc(SITE.blog.description)}</description>
    <link>${absUrl('/blog/')}</link>
    <atom:link href="${absUrl('/rss_feed.xml')}" rel="self" type="application/rss+xml" />
    <language>en</language>
    <lastBuildDate>${latestDate(posts).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function sitemapXml(posts) {
  // The home page carries its own "Last updated DD/MM/YYYY"; it also changes when a post is published
  const stamp = homeStamp();
  const newest = latestDate(posts);
  const home = stamp ? new Date(Math.max(+stamp, +newest)) : newest;
  const urls = [
    { loc: '/', lastmod: isoDate(home), priority: '1.0' },
    { loc: '/blog/', lastmod: isoDate(newest), priority: '0.9' },
    { loc: '/video.html', priority: '0.6' },
    ...posts.map((p) => ({ loc: p.url, lastmod: isoDate(p.updated || p.date), priority: '0.8' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${absUrl(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
}

function robotsTxt() {
  return `# ${SITE.title}: everything is public
# AI-readable indexes: ${absUrl('/llms.txt')} and ${absUrl('/llms-full.txt')}
User-agent: *
Allow: /
Disallow: /write/

Sitemap: ${absUrl('/sitemap.xml')}
`;
}

function searchIndex(posts) {
  return JSON.stringify(posts.map((p) => ({
    title: p.title,
    url: p.url,
    description: p.description,
    tags: [...p.tags, ...p.topics.map(topicLabel), seriesTitle(p)].filter(Boolean).join(', '),
    type: typeInfo(p.type).label,
    date: isoDate(p.date),
    date_label: shortDate(p.date),
    file: p.file,
    ...(p.series ? { series: p.series, part: p.part } : {}),
  })));
}

function llmsTxt(posts) {
  const series = visibleSeries(posts);
  return `# ${SITE.title}

> ${SITE.description} This file lists the pages worth citing or recommending.${posts.length ? ` The full text of every post is in ${absUrl('/llms-full.txt')}.` : ''}

Site: ${SITE.title}
URL: ${SITE.url}
Author: ${SITE.author.name}
Main topics: ${Object.values(SITE.topics).join(', ')}

## Key pages

- ${absUrl('/')} - homepage: about, research interests, publications, experience, awards, supervision and service
- ${absUrl('/blog/')} - blog archive grouped by year, with topic and content-type filters
- ${absUrl('/video.html')} - talks and videos
- ${absUrl('/rss_feed.xml')} - RSS feed of the blog
${series.length ? `
## Series

${series.map((s) => `### ${s.title}

${s.description} ${absUrl(`/blog/#series-${s.slug}`)} (${s.published} of ${s.total} parts published)
${s.parts.filter((x) => x.post).map((x) => `\n- Part ${x.n}: ${absUrl(x.post.url)} - ${x.post.title}`).join('')}`).join('\n\n')}
` : ''}${posts.length ? `
## Blog posts (newest first)

${posts.map((p) => `- ${absUrl(p.url)} - ${p.title} (${typeInfo(p.type).label}, ${isoDate(p.date)}): ${p.description}`).join('\n')}
` : ''}`;
}

function llmsFullTxt(posts) {
  if (!posts.length) return `# ${SITE.title}\n\n${SITE.author.bio}\n\nHome page: ${absUrl('/')}\n`;
  return `# ${SITE.title} — full text of all blog posts

Last updated ${isoDate(latestDate(posts))}. Source: ${absUrl('/blog/')}

${posts.map((p) => `---

# ${p.title}

URL: ${absUrl(p.url)}
Date: ${isoDate(p.date)}
Type: ${typeInfo(p.type).label}
Topics: ${p.topics.map(topicLabel).join(', ') || '—'}
Tags: ${p.tags.join(', ') || '—'}
Summary: ${p.description}

${p.markdown}
`).join('\n')}`;
}

// Read by index.html (written by hand, so the build cannot edit its links): while no post is published,
// what only makes sense with posts ("Read the blog", "All posts") is hidden. The Blog section itself stays.
function blogStateCss(posts) {
  return posts.length
    ? '/* Generated by build.mjs. The blog has published posts, so nothing is hidden. */\n'
    : '/* Generated by build.mjs. No post is published yet, so the links marked "needs-posts" ("Read the blog",\n   "All posts") are hidden. They come back by themselves with the first published post. */\n.needs-posts { display: none !important; }\n';
}

function redirectPage(posts) {
  const map = Object.fromEntries(posts.filter((p) => p.legacyId).map((p) => [p.legacyId, p.url]));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Blog — ${esc(SITE.title)}</title>
  <meta name="robots" content="noindex">
  <link rel="canonical" href="${absUrl('/blog/')}">
  <meta http-equiv="refresh" content="0; url=/blog/">
  <script>(function(){var map=${safeJson(map)};var id=location.hash.replace(/^#/,'');location.replace(map[id]||'/blog/');})();</script>
</head>
<body>
  <p>The blog has moved to <a href="/blog/">${esc(absUrl('/blog/'))}</a>.</p>
</body>
</html>
`;
}

function copyKatexAssets() {
  const src = path.dirname(require.resolve('katex/package.json'));
  const dest = path.join(ROOT, 'css', 'katex');
  fs.mkdirSync(path.join(dest, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(src, 'dist', 'katex.min.css'), path.join(dest, 'katex.min.css'));
  for (const f of fs.readdirSync(path.join(src, 'dist', 'fonts'))) {
    if (f.endsWith('.woff2')) fs.copyFileSync(path.join(src, 'dist', 'fonts', f), path.join(dest, 'fonts', f));
  }
}

// The writing page (/write/) previews posts in the browser with the same libraries the build uses,
// and reads the top block of a post with the YAML reader that gray-matter uses.
function copyEditorLibraries() {
  const dest = path.join(ROOT, 'js', 'vendor');
  fs.mkdirSync(dest, { recursive: true });
  for (const [pkg, file] of [['marked', 'lib/marked.umd.js'], ['katex', 'dist/katex.min.js'], ['js-yaml', 'dist/js-yaml.min.js']]) {
    const src = path.join(ROOT, 'node_modules', pkg, file);
    if (!fs.existsSync(src)) fail(`node_modules/${pkg}/${file} is missing (the writing page needs it). Run "npm install".`);
    fs.copyFileSync(src, path.join(dest, path.basename(file)));
  }
}

// ---------------------------------------------------------------- home-page block
// Replaces only what sits between the BLOG:START and BLOG:END markers in index.html.
// Links are relative, like the page's own navigation.
function homeBlogHtml(posts, indent) {
  if (!posts.length) return `${indent}<p class="section-desc">${esc(SITE.blog.subtitle)}</p>`; // the section stays, ready for the first post
  const rel = (url) => url.replace(/^\//, '');
  const series = visibleSeries(posts);
  const lines = [
    `<p class="section-desc">${esc(SITE.blog.subtitle)}</p>`,
    ...(series.length ? [
      `<div class="grid-2 home-series">`,
      ...series.map((s) => `  <a class="card home-series__card" href="blog/#series-${esc(s.slug)}"><strong>${esc(s.title)}</strong><span>${s.published} of ${s.total} published</span></a>`),
      `</div>`,
      `<h3 class="home-posts__heading">Latest posts</h3>`,
    ] : []),
    `<ul class="post-cards">`,
    ...posts.slice(0, 3).flatMap((p) => [
      `  <li class="post-card">`,
      `    <p class="post-card__meta sep-list"><time datetime="${isoDate(p.date)}">${shortDate(p.date)}</time><span>${esc(typeInfo(p.type).label)}</span></p>`,
      `    <h3 class="post-card__title"><a href="${rel(p.url)}">${esc(p.title)}</a></h3>`,
      `    <p class="post-card__desc">${esc(p.description)}</p>`,
      `  </li>`,
    ]),
    `</ul>`,
    ...(NEWSLETTER ? [
      `<div class="btn-row home-blog__actions">`,
      `  <a class="btn btn--primary" href="${esc(NEWSLETTER.href)}" target="_blank" rel="noopener">${esc(NEWSLETTER.label || 'Subscribe by email')}</a>`,
      `</div>`,
    ] : []),
  ];
  return lines.map((l) => indent + l).join('\n');
}

function readHomeMarkers() {
  if (!fs.existsSync(INDEX_FILE)) fail('index.html not found (needed for the home-page blog block)');
  const html = fs.readFileSync(INDEX_FILE, 'utf8');
  const start = html.indexOf(BLOG_START);
  const end = html.indexOf(BLOG_END);
  if (start === -1 || end === -1 || end < start || html.indexOf(BLOG_START, start + 1) !== -1 || html.indexOf(BLOG_END, end + 1) !== -1) {
    fail(`index.html must contain exactly one pair of markers, in this order:\n    ${BLOG_START}\n    ${BLOG_END}\n  The build writes the home-page blog block between them.`);
  }
  return { html, start, end };
}

function updateHomeBlock(posts) {
  const { html, start, end } = readHomeMarkers();
  const lineStart = html.lastIndexOf('\n', start) + 1;
  const indent = html.slice(lineStart, start).replace(/\S.*$/, '');
  const from = start + BLOG_START.length;
  const block = homeBlogHtml(posts, indent);
  const next = `${html.slice(0, from)}\n${block ? `${block}\n` : ''}${indent}${html.slice(end)}`;
  if (next !== html) fs.writeFileSync(INDEX_FILE, next); // untouched when nothing changed
}

// ---------------------------------------------------------------- scaffold
const NEXT_STEPS = 'Write the post, delete the "draft: true" line when it is ready, then run: npm run preview';

function scaffoldSeries(title, slug, part) {
  const today = isoDate(new Date());
  const file = path.join(POSTS_DIR, `${today}-${slugify(title)}.md`);
  if (fs.existsSync(file)) fail(`${path.relative(ROOT, file)} already exists`);
  const tpl = path.join(POSTS_DIR, '_template-challenge.md');
  if (!fs.existsSync(tpl)) fail(`Missing ${path.relative(ROOT, tpl)}`);
  const set = (text, key, value) => {
    const re = new RegExp(`^${key}:.*$`, 'm');
    if (!re.test(text)) fail(`${path.relative(ROOT, tpl)} has no "${key}:" line`);
    return text.replace(re, `${key}: ${value}`);
  };
  let text = fs.readFileSync(tpl, 'utf8').replace(/^# .*\n/gm, ''); // drop the template's own comment lines
  text = set(text, 'title', JSON.stringify(title));
  text = set(text, 'date', today);
  text = set(text, 'series', slug);
  text = set(text, 'part', String(part));
  write(file, text);
  console.log(`✔ Created ${path.relative(ROOT, file)} (series ${slug}, part ${part} of ${SERIES[slug].parts.length}).\n  ${NEXT_STEPS}`);
}

function scaffold(title, type) {
  const today = isoDate(new Date());
  const file = path.join(POSTS_DIR, `${today}-${slugify(title)}.md`);
  if (fs.existsSync(file)) fail(`${path.relative(ROOT, file)} already exists`);
  const template = `---
title: "${title.replace(/"/g, '\\"')}"
date: ${today}
type: ${type}
topics: [federated-learning]
tags: []
description: "One or two sentences shown in the list of posts, in search, and when the link is shared."${type === 'paper-review' ? `
paper:
  title: ""
  authors: ""
  venue: ""
  link: ""` : ''}
draft: true
---

Start writing here. Use \`## Headings\` for sections (a contents list appears automatically when a post has two or more), \`$...$\` or \`$$...$$\` for math, and fenced code blocks for code.
`;
  write(file, template);
  console.log(`✔ Created ${path.relative(ROOT, file)}.\n  ${NEXT_STEPS}`);
}

// ---------------------------------------------------------------- main
function build() {
  console.log('Building blog…');
  const posts = loadPosts();
  HAS_POSTS = posts.length > 0;
  readHomeMarkers(); // fail before touching any output if index.html lost its markers
  fs.rmSync(BLOG_DIR, { recursive: true, force: true });
  write(path.join(BLOG_DIR, 'index.html'), archivePage(posts));
  write(BLOG_STATE_FILE, blogStateCss(posts));
  for (const p of posts) write(path.join(BLOG_DIR, p.year, `${p.slug}.html`), postPage(p, posts));
  write(path.join(ROOT, 'search.json'), searchIndex(posts));
  write(path.join(ROOT, 'rss_feed.xml'), rssXml(posts));
  write(path.join(ROOT, 'sitemap.xml'), sitemapXml(posts));
  write(path.join(ROOT, 'robots.txt'), robotsTxt());
  write(path.join(ROOT, 'llms.txt'), llmsTxt(posts));
  write(path.join(ROOT, 'llms-full.txt'), llmsFullTxt(posts));
  write(path.join(ROOT, 'blog.html'), redirectPage(posts));
  write(path.join(ROOT, '404.html'), notFoundPage());
  updateHomeBlock(posts);
  copyKatexAssets(); // always: the writing page previews formulas too
  copyEditorLibraries();
  for (const p of posts) console.log(`  ✔ ${p.url}  (${typeInfo(p.type).label}, ${isoDate(p.date)}, ${p.readTime} min${p.hasMath ? ', math' : ''}${p.hasCode ? ', code' : ''})`);
  if (!HAS_POSTS) console.log('  · no published post yet: the Blog section shows its description only');
  console.log(`Done: ${posts.length} posts → blog/, search.json, rss_feed.xml, sitemap.xml, robots.txt, llms.txt, llms-full.txt, blog.html, 404.html, css/blog-state.css, index.html blog block, js/vendor/`);
}

const argv = process.argv.slice(2);
if (argv.includes('--new')) {
  const title = argv[argv.indexOf('--new') + 1];
  if (!title || title.startsWith('--')) fail('Usage: node build.mjs --new "Post title" [--type article|paper-review|quick-note] [--series <slug> --part <n>]');
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  if (argv.includes('--series')) {
    const slug = flag('--series');
    if (!slug || slug.startsWith('--')) fail('--series needs a series slug, for example: --series fl-challenges --part 2');
    if (!SERIES[slug]) fail(`Unknown series "${slug}" (expected ${Object.keys(SERIES).join(', ')})`);
    const n = SERIES[slug].parts.length;
    const partArg = flag('--part');
    if (!argv.includes('--part') || !partArg || partArg.startsWith('--')) fail(`--series needs --part <n> (1 to ${n} for "${slug}")`);
    if (!/^\d+$/.test(partArg) || Number(partArg) < 1 || Number(partArg) > n) fail(`--part must be an integer between 1 and ${n} for "${slug}" (got "${partArg}")`);
    if (argv.includes('--type')) fail('--type cannot be combined with --series (series posts use posts/_template-challenge.md)');
    scaffoldSeries(title, slug, Number(partArg));
  } else {
    if (argv.includes('--part')) fail('--part needs --series <slug>');
    const type = flag('--type') || 'article';
    if (!SITE.types[type]) fail(`Unknown type "${type}" (expected ${Object.keys(SITE.types).join(', ')})`);
    scaffold(title, type);
  }
} else {
  build();
}
