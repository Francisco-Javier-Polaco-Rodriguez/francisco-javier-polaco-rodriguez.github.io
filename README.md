# WebSitePolanco

Static personal site (EN at `/`, FR at `/fr/`, ES at `/es/`), served by GitHub Pages.

- Edit text and data in `src/content.py` (strings per language, publications, talks, jury).
- Edit layout in `src/template.html`, styles in `assets/css/site.css`, behaviour in `assets/js/site.js`.
- Rebuild: `python build.py` (writes `index.html`, `fr/index.html`, `es/index.html`; fails if a language misses a key).
- Preview: `python -m http.server 8765`, then open http://127.0.0.1:8765/.
- `?burst=<seconds>` freezes the hero animation at that time (screenshots).
- `assets/cv/CV_Polanco-Rodriguez.pdf` is the web CV: built from `CV_PolancoRodriguez/main.tex` without phone and birth date.
- `SITE_URL` in `build.py` is the public address (canonical, hreflang, og:image). Change it there if the site moves, e.g. to a custom domain.
- Publish: commit the built files and push to `main` of the `francisco-javier-polaco-rodriguez.github.io` repository.
- Push from your own terminal: Claude Code's shell has no GitHub credentials, so `git push` fails there.
- If the "pages build and deployment" run ends in `startup_failure` with 0 jobs, it is GitHub-side, not the content: re-run it from the Actions tab, or push an empty commit (`git commit --allow-empty`). Happened once on 2026-11-11; the retry worked.
- Scroll interaction (`site.js`, end of file): elements matching `RV` / `RV_FIG` unfold entering and fold leaving, scrubbed from the scroll position in JS (no IntersectionObserver or CSS scroll timelines, which headless Chromium does not run reliably). Strength is set in `style()`: the 34/48 px offsets, the `.94` scale, the `.3`/`.2` viewport spans. Off with reduced motion, without JS, and in print.
- Screenshots with headless Chromium below ~500 px wide are clipped on the right; it is not real overflow. To check mobile, load the page in a 390 px wide iframe instead.
- Design (branch `redesign`): dark only, deep-space theme; colours are the thesis colour code (tokens at the top of `site.css`). The hero canvas is full-bleed behind the text: the scene uses the lower 70% of the canvas (`TOP` in `site.js`). The "Seen from Earth" panel is a second canvas (`#dynspec`) drawn from the same clock as the burst. Key figures (`stats`) and computing tiles (`compute`) live in `src/content.py`.
