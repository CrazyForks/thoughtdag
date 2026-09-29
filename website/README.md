# ThoughtDAG bilingual product story

This is a static, bilingual homepage with problem-led tutorial entry points and
a scroll-driven product story. English is the default language. The build emits
`zh.html` from the existing `data-zh` attributes so Chinese text, metadata, and
links are available without JavaScript. Legacy `?lang=zh` links navigate there.
It keeps ThoughtDAG's own product boundary and visual semantics:

- purple solid edges are full context;
- orange branches are explicit side paths;
- deleting an edge changes the request, not just the diagram;
- the story ends on inspectable context rather than autonomous agents.

It is published with GitHub Pages at:

```text
https://chenxiachan.github.io/thoughtdag/
https://chenxiachan.github.io/thoughtdag/zh.html
https://chenxiachan.github.io/thoughtdag/docs/tutorials/
https://chenxiachan.github.io/thoughtdag/docs/zh/tutorials/
https://chenxiachan.github.io/thoughtdag/stories/context-repair/
https://chenxiachan.github.io/thoughtdag/research/context-repair-pilot-v2/
```

The `product-story-pages.yml` workflow builds and checks `dist/pages`, then
publishes it when website or docs files change on `main`. The live app remains on Cloudflare;
its former `/story/` route permanently redirects here.

Build and validate from the repository root:

```bash
npm run website:build
npm run website:check
```

The output contains the homepage, Chinese homepage, and VitePress docs. Serve
it under `/thoughtdag/` for a local preview, with extensionless `.html` fallback
(as on GitHub Pages). The source HTML alone does not contain the assembled docs.

The three tutorials live in `docs/tutorials/` and `docs/zh/tutorials/`. Their four
illustrated animations live in `docs/public/media/tutorials/`; `provenance.json`
records source files and edits. Pages use compact MP4 players with posters, while
each tutorial offers the approved GIF for download. Update both locales when
changing a tutorial. These animations illustrate workflows; they are not screen
recordings or measured performance evidence.

The page selects the final product film by both language and viewport:

```text
website/assets/thoughtdag-story-en-horizontal.mp4
website/assets/thoughtdag-story-zh-horizontal.mp4
website/assets/thoughtdag-story-en-vertical.mp4
website/assets/thoughtdag-story-zh-vertical.mp4
```

Viewports up to 760px use the 9:16 vertical films. Wider viewports use the
16:9 horizontal films. Switching the page language also switches the film,
poster frame, accessible label, and duration.

Canonical, alternate-language, Open Graph, robots, and sitemap metadata point
to the shared public deployment. `sitemap.xml` indexes `site-sitemap.xml` and the
generated `docs/sitemap.xml`. Submit the index URL in Search Console. A project
path's `robots.txt` cannot replace the host's root robots policy. These changes
support crawlability and discovery; they do not guarantee indexing or AI citations.

The homepage introduces the Context Repair Pilot without turning the product
story into a report. The concise bilingual case study lives under `stories/`,
while the English technical report and reproducibility links live under
`research/`.
