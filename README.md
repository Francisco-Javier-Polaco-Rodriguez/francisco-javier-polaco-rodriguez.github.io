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
