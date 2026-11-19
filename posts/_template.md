---
# Files starting with "_" are ignored by the build. Copy this file, or run:
#   npm run new -- "My post title" --type article
title: "My post title"
date: 2026-01-01                 # YYYY-MM-DD (also used for the /blog/<year>/ folder)
type: article                    # article | paper-review | quick-note
topics: [federated-learning]     # slugs from site.config.json "topics"; drives the topic filter pills
tags: [FedAvg, Tutorial]         # free-form labels shown on the post and used by search
description: "One or two sentences shown in the list of posts, in search, and when the link is shared."
featured: false                  # adds a "Featured" badge in the archive
readTime: 7                      # optional; computed from the word count when omitted
updated: 2026-02-01              # optional; shows "Updated …" and sets dateModified
image: /images/cover.png         # optional; used as the og:image for social previews
slug: custom-url-slug            # optional; defaults to the file name without the date prefix
legacyId: old-anchor             # optional; maps old blog.html#old-anchor links to this post
paper:                           # optional; renders the "Paper reference" box (paper reviews)
  title: "Paper title"
  authors: "Author One, Author Two"
  venue: "Venue 2026"
  link: "https://arxiv.org/abs/..."
draft: true                      # drafts are never built; remove or set to false to publish
---

Write Markdown here.

## A section heading

A contents list ("On this page") is generated automatically when a post has at least two `##`/`###` headings.

A figure: add the image to `images/blog/`, then write `![What it shows](/images/blog/my-plot.png "The caption")` on its own line.

Inline math like $\mu \lVert w - w^t \rVert^2$ and display math:

$$
w^{t+1} = \sum_{k=1}^{K} \frac{n_k}{n}\, w_k^{t+1}
$$

```python
print("fenced code blocks are syntax-highlighted")
```

> **Key takeaways**
>
> - Blockquotes render as highlighted callouts.
