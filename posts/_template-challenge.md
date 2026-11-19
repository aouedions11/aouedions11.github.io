---
# Template for one post of a series (files starting with "_" are not built). Create a post from it with:
#   npm run new -- "Post title" --series fl-challenges --part 2
# The command fills in title, date, series and part, and drops these comment lines.
title: "Post title"
date: 2026-01-01
type: article
topics: [federated-learning]
tags: []
description: "One or two sentences shown in the list of posts, in search, and when the link is shared."
series: fl-challenges            # a series slug from site.config.json "series"
part: 1                          # position in that series' "parts" list, starting at 1
code: ""                         # https://github.com/... with the code and tests, or { link: "https://...", label: "..." }
draft: true                      # drafts are never built; set to false to publish
---

## The challenge

What goes wrong, in which setting, and why it matters in practice.

## The proposed solutions

The main methods proposed for this challenge, what each one changes, and the papers they come from.

## Code

The code for the baseline and for each solution, with the key lines explained.

## Tests

The experiments that compare them: the setup, the results, and what the numbers show.

## What to remember

> **Key takeaways**
>
> - Three to five short points the reader should keep from this post.
