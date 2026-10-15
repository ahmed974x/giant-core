# site-landing (draft)

Static NABD landing page, Arabic (`index.html`, RTL) and English (`en.html`), one shared `style.css`.
Plain HTML + CSS, no framework, no scripts, no external requests; works on GitHub Pages as-is.
**Draft only (ADR-071): not published, GitHub Pages not enabled, no form embedded.**

Preview locally: `python -m http.server 8000 -d site-landing` then open http://127.0.0.1:8000.

Open items are marked `TODO` in the pages (`grep -n TODO site-landing/*.html`).
