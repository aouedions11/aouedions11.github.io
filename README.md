# aouedions11.github.io

Personal website and research blog of Dr. Ons Aouedi, served by GitHub Pages from the `main` branch.

## Publish a blog post

There are three ways. The first is the simplest.

### On your computer: write, click Publish

1. Double-click **Write a blog post.command** in the site folder. It starts the site on this computer and opens the writing page. (From a terminal: `npm run serve`, then open <http://localhost:8080/write/>.)
2. Type the title and the summary, choose the kind of post and the topics, and write the text. The buttons above the text add section titles, lists, code, formulas, tables and pictures. The result is shown on the right while you type.
3. Click **Publish**.

The post is in your site at once: the page gives its address on this computer, and the home page and the blog list it. No GitHub key is needed. The post goes online the next time the site is sent to GitHub (`git push`).

Behind the button, the small server that shows the site on your computer (`scripts/local_server.py`) writes the post into `posts/`, rebuilds the blog, and records the change as a commit. If a post cannot be built, nothing changes and the page says why. The server listens to this computer only, and the only files the page can write are posts and their pictures.

### From anywhere: the online writing page

Open **<https://aouedions11.github.io/write/>**. It is the same page; here **Publish** sends the post to GitHub, which builds the site and puts the post online a few minutes later. The first time, the page asks you to connect to GitHub (see below).

Good to know:

- **Nothing is lost.** The text is saved in your browser while you type. You can close the page and come back.
- **Save as draft** stores the post without showing it to readers. **My posts** lists every post and draft, to open, change, or unpublish it.
- **Pictures:** use the Picture button, or drop or paste a picture into the text. Large pictures are made smaller automatically.
- **A series:** choose the series and the part; the page proposes the planned title and can add the five section titles.

**Connecting to GitHub (once).** The page saves posts in this repository, and GitHub asks for a personal key to accept that. When the page asks:

1. Follow its link to GitHub. The name and the permission are already filled in.
2. Under **Repository access**, choose **Only select repositories** and pick `aouedions11.github.io`.
3. Under **Permissions**, check that **Contents** is **Read and write**, then click **Generate token**.
4. Copy the key and paste it into the page.

The key is kept in your browser only and is sent to GitHub only. It expires after a year; the page then asks for a new one. "My posts" has a **Disconnect** button that removes it from the browser. If you ever think someone else has the key, delete it on GitHub under Settings → Developer settings → Personal access tokens.

### By hand: one Markdown file

You write one Markdown file in `posts/`.

1. **Create the file** in the `posts/` folder and name it `YYYY-MM-DD-short-title.md`, for example `posts/2026-12-01-fedavg-from-scratch.md`.
   On github.com: open the `posts` folder, then **Add file** → **Create new file**.
2. **Write the post.** The smallest post is:

   ```markdown
   ---
   title: "FedAvg from scratch, in plain PyTorch"
   description: "One or two sentences that say what the post is about."
   topics: [federated-learning]
   ---

   Your text, in Markdown.
   ```

3. **Commit it** to `main`: the green **Commit changes** button on github.com, or `git push` from your computer.

A few minutes later the post is online at `/blog/<year>/short-title.html`. It also appears in the blog archive, on the home page and in search. GitHub runs the build for you ([`.github/workflows/build.yml`](.github/workflows/build.yml)) and adds the generated pages in a commit named "Build the blog".

Good to know:

- **Not ready yet?** Add the line `draft: true` between the `---` lines. The post stays hidden until you delete that line. If the file has a `date:` line, set it to the day you publish.
- **A mistake in the file?** The build stops, the site stays as it was, and GitHub e-mails you the reason (for example "the post needs a title").
- **To change or remove a post**, edit or delete its file in `posts/` the same way.
- **If you also work on your computer**, run `git pull` before you start, because the build adds commits on GitHub.

### Writing

| To get | Write |
|---|---|
| A section (it appears in "On this page") | `## Section title` |
| Code with colours and a Copy button | a fenced block: three backticks and the language (for example `python`), the code, three backticks |
| Math | `$x^2$` inside a sentence, `$$ ... $$` on its own lines |
| A figure with a caption | add the image to `images/blog/`, then put `![What it shows](/images/blog/my-plot.png "The caption")` on its own line. Readers can click it to enlarge it. |
| A highlighted box | start each line with `> ` |
| A table | a normal Markdown table |

### Optional lines at the top of a post

Only `title` is needed (or start the text with `# My title`). The date comes from the file name. Everything else is optional; [`posts/_template.md`](posts/_template.md) shows every field.

| Field         | Meaning                                                                  |
|---------------|--------------------------------------------------------------------------|
| `description` | One or two sentences for the archive, search, and link previews. Without it, the first paragraph is used. |
| `topics`      | Slugs from `site.config.json`, for the "Browse by topic" filter.         |
| `type`        | `article` (default), `paper-review`, or `quick-note`.                    |
| `tags`        | Free-form labels shown on the post and used by search.                   |
| `date`        | `YYYY-MM-DD`, only if the file name has no date.                         |
| `featured`    | `true` adds a "Featured" label in the archive.                           |
| `paper`       | Title / authors / venue / link, for the "Paper reference" box.           |
| `code`        | URL of the code and tests (`code: https://github.com/...`), or `{ link, label }`, for the "Code and tests" box. |
| `series`, `part` | The series slug and the part number (see below).                      |
| `image`       | A wide picture (1200 × 630) for link previews of this post.              |
| `draft`       | `true` keeps the post out of the site.                                   |

### A post in a series

Series are listed in `site.config.json` under `series`, each with its planned `parts`. To add a part, put two lines at the top of the post:

```yaml
series: fl-challenges
part: 2
```

- The post gets a box "Part 2 of 8" with links to the previous and next published parts.
- The blog archive and the home page show a card for the series **once it has a published post**, and list only the parts that exist. Nothing empty is shown. To list the planned parts as well, set `"showPlannedParts": true` under `"blog"` in `site.config.json`.
- The build stops if the series is unknown, if `part` is not a number between 1 and the number of parts, or if two published posts claim the same part.

`posts/_template-challenge.md` is the layout for a series post: *The challenge*, *The proposed solutions*, *Code*, *Tests*, *What to remember*.

### On your computer (optional)

Needs Node 20 or newer (`nvm use` picks the right version) and `npm install` once.

```bash
npm run new -- "My post title"                                   # creates posts/<today>-my-post-title.md
npm run new -- "Paper review: SCAFFOLD" --type paper-review      # with the paper box
npm run new -- "Non-IID data: when clients disagree" --series fl-challenges --part 2   # from the series template
npm run preview                                                  # builds, then serves http://127.0.0.1:8080/blog/
```

New files start with `draft: true`; delete that line when the post is ready. `--series` needs `--part`; an unknown series or a missing or out-of-range `--part` stops with a clear message.

## What the build generates

`build.mjs` reads `posts/*.md` and `site.config.json`. Never edit these outputs by hand; they are rewritten on every build.
(`write/index.html`, `css/write.css`, `js/write.js` and `js/write-core.js` are the writing page; they are written by hand, like the home page.)

| Output                     | Purpose                                                                 |
|----------------------------|-------------------------------------------------------------------------|
| `blog/index.html`          | Archive by year, with topic and type filters.                            |
| `blog/<year>/<slug>.html`  | Post page: contents list, figures, code, share links, "Cite this post", "Read next". |
| `index.html` (one block)   | The latest posts on the home page, between `<!-- BLOG:START … -->` and `<!-- BLOG:END -->`, and the page's date (see below). The rest of `index.html` is hand-written and left untouched; the build stops if the markers are missing. |
| `search.json`              | Index for the search box in the header (press `/`).                      |
| `rss_feed.xml`             | RSS 2.0 feed with full post content, for news-reader apps. No page shows a link to it; reader apps find it by themselves. |
| `sitemap.xml`, `robots.txt`| For search engines.                                                      |
| `llms.txt`, `llms-full.txt`| Index and full text for AI assistants.                                   |
| `404.html`                 | "Page not found" page in the site's design.                              |
| `css/blog-state.css`       | One line that hides "Read the blog" and "All posts" on the home page while no post is published (see below). |
| `blog.html`                | Sends the old blog address (and old `#post-id` links) to the new pages.  |
| `js/vendor/`               | Browser copies of the libraries the writing page uses for its preview (taken from `node_modules`). |

The output depends only on the files in the repository, so building twice gives the same result.

**A blog with no published post.** The Blog section and the Blog link in the menu stay where they are: the home page shows the blog's description, and `/blog/` shows its heading. Only what needs a post is left out: the search box, the filters, and the links marked `class="needs-posts"` in `index.html` ("Read the blog", "All posts"). Publish one post and it all comes back by itself. Drafts (`draft: true`) do not count as published.

Site-wide settings live in `site.config.json`: name, tagline, navigation, links, topics, content types, series, the newsletter link, the share picture (`socialImage`), and the analytics ID.

**Newsletter link.** `newsletter` in `site.config.json` has `label`, `href` and `note`. With an empty `href` nothing is shown. With an address, a button opens it in a new tab on the archive, at the end of each post, and on the home page. It is a plain link: no form and no third-party script.

## The other pages

`index.html` (home) and `video.html` (talks) are written by hand: edit and commit.

The home page shows the date of its latest change in two places: "Latest update: DD/MM/YYYY" under the highlights and "Last updated DD/MM/YYYY" in the footer. When you change the page by hand, change one of the two; the next build copies the later date to the other. Publishing a post moves both forward to the date of the post, so there is nothing to do then.

The home page, from top to bottom: the introduction card with the About text, the portrait and the **highlights card** (each `<article class="spotlight__item">` is one highlight; add or remove one and the arrows and dots follow); research interests; the blog block (generated); selected publications and the full list; experience next to awards; supervision (one card per Ph.D. student); talks next to service; the collaboration band.

The header and the footer exist in three places: `index.html`, `video.html`, and the `layout()` function in `build.mjs` (for the blog). A new menu entry or profile link has to be added in all three; for the blog, the menu and the profile links come from `nav` and `links` in `site.config.json`.

## Design system

`style.css` holds the design tokens (colours, type, radii) for every page; `css/blog.css` adds blog-only components on top of them. The light and dark palettes are defined once, under `:root` and `[data-theme="dark"]`, and `js/theme.js` plus a small inline snippet in each `<head>` switch between them (stored preference first, then the system setting). `js/site.js` adds the menu, the highlights card, search, filters, copy buttons and figure zoom; every page still works without it.

The look: a light grey page, white cards with a thin border and 14px corners, one font (Inter), and a page width of 1180px. Three colour families, each with a soft tint for card corners and icon tiles:

| Token                         | Used for                                                        |
|-------------------------------|-----------------------------------------------------------------|
| `--primary` (blue)            | Links, buttons, dates, the left edge of the main panels.         |
| `--navy` (indigo)             | Small labels, half of the section icons, the talks panel.        |
| `--accent` (amber)            | Awards only: the award cards and the award badges.               |
| `--text`, `--text-muted`      | Headings and body text; secondary lines.                         |
| `--bg`, `--bg-card`, `--border` | The page, the cards, the card outlines.                        |

Building blocks you can reuse on any page: `.section-head` (icon tile + title + optional "see all" link + rule), `.card`, `.btn` / `.btn--primary`, `.more-link`, `.badge`, `.chips`, `.sep-list` (items separated by a dot that never starts or ends a line), `.page-head` (the title block of the talks page and the blog), `.duo` and `.trio` (two or three sections side by side).

Keep new components on the tokens, for example `var(--primary)`, `var(--bg-card)`, `var(--text-secondary)`, so both themes stay consistent. Text is never smaller than 14px and buttons are at least 44px high. `npm run check:contrast` checks every text/background token pair against WCAG AA (4.5:1) in both themes, and reports any colour literal outside the token blocks (the code-highlighting theme in `css/blog.css` is the only exception).

## Repository notes

- `.nojekyll` tells GitHub Pages to publish the files as they are.
- `images/og-card.jpg` is the picture shown when a link to the site is shared (LinkedIn, X, chat apps).
- The visitor counter at the bottom of the home page is a picture from flagcounter.com (the same counter as on the first version of the site, so its numbers continue). It is loaded on every visit, without waiting for the visitor to scroll down, so that every visit is counted.
- `images/blog/<year>/<post>/` holds the pictures added from the writing page.
- The writing page (`/write/`) is not linked from the site and is hidden from search engines. Without your GitHub key it cannot change anything. It only runs its own scripts and only talks to this site and to `api.github.com` (see the Content-Security-Policy line at the top of `write/index.html`).
- The files of the previous single-page blog (`posts.json`, and the local-only `admin.html` and `blog-template.html`) have been removed. `notes/legacy/` keeps private copies on this computer; `notes/` is git-ignored.
