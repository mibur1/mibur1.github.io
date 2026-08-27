#!/usr/bin/env python3
"""
Static site generator for michaburkhardt.de

Renders markdown from content/ through Jinja2 templates in templates/ into
_site/. No client-side rendering: every page is complete HTML on arrival, so
it works without JavaScript and is indexable by search engines and Scholar.

    python build.py            build into _site/
    python build.py --serve    build, then serve (see --port, default 8000)
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path

import markdown
import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
TEMPLATES = ROOT / "templates"
STATIC = ROOT / "static"
OUT = ROOT / "_site"

MD_EXTENSIONS = ["extra", "sane_lists", "smarty", "toc", "attr_list"]


# ---------------------------------------------------------------- helpers
def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Split a leading `---` YAML block off a markdown file."""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.DOTALL)
    if not m:
        return {}, text
    return yaml.safe_load(m.group(1)) or {}, m.group(2)


def render_md(text: str) -> str:
    return markdown.Markdown(extensions=MD_EXTENSIONS).convert(text)


def excerpt_from(html: str, limit: int = 200) -> str:
    """First prose from a rendered body, for cards and feed summaries.

    Badge rows, figures and code blocks are stripped first — their text is
    labels and captions, which reads as gibberish in a one-line summary
    (e.g. "paperImaging Neuroscience GitHubmibur1/comet ...").
    """
    for pattern in (r"<p class=\"badges\">.*?</p>",
                    r"<figure\b.*?</figure>",
                    r"<pre\b.*?</pre>",
                    r"<h[1-6]\b.*?</h[1-6]>"):
        html = re.sub(pattern, " ", html, flags=re.S)
    plain = re.sub(r"<[^>]+>", "", html)
    plain = re.sub(r"\s+", " ", plain).strip()
    return plain[:limit].rstrip() + "…" if len(plain) > limit else plain


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


# ---------------------------------------------------------------- content
def load_site() -> dict:
    return yaml.safe_load((ROOT / "site.yaml").read_text(encoding="utf-8"))


def load_publications() -> tuple[list[dict], str]:
    """Merge generated publications.json with the hand-written overrides."""
    pub_file = CONTENT / "publications.json"
    if not pub_file.exists():
        return [], "never"

    data = json.loads(pub_file.read_text(encoding="utf-8"))
    pubs = data.get("publications", [])
    fetched = data.get("fetched", "unknown")

    ov_file = CONTENT / "publications.overrides.yml"
    overrides = {}
    if ov_file.exists():
        overrides = yaml.safe_load(ov_file.read_text(encoding="utf-8")) or {}
    overrides = {str(k).lower(): (v or {}) for k, v in overrides.items()}

    by_doi = {(p.get("doi") or "").lower(): p for p in pubs if p.get("doi")}

    # Pass 1: resolve `superseded_by` before anything is copied, so a preprint
    # can attach itself to a target that appears earlier in the list.
    folded: set[str] = set()
    for pub in pubs:
        doi = (pub.get("doi") or "").lower()
        target_doi = (overrides.get(doi, {}).get("superseded_by") or "").lower()
        if not target_doi:
            continue
        target = by_doi.get(target_doi)
        if target is not None:
            target["preprint_doi"] = pub.get("doi")
            folded.add(doi)

    # Pass 2: apply the remaining overrides and emit entries.
    result = []
    for pub in pubs:
        doi = (pub.get("doi") or "").lower()
        ov = overrides.get(doi, {})

        if ov.get("hide") or doi in folded:
            continue

        entry = dict(pub)

        # Plain overrides, applied as-is.
        for key in ("title", "venue", "year", "citations", "type",
                    "code_url", "data_url", "note", "pin", "url"):
            if key in ov:
                entry[key] = ov[key]

        # Friendlier aliases for the link fields.
        if "pdf_url" in ov:
            entry["oa_url"] = ov["pdf_url"]
        if "preprint_url" in ov:
            entry["preprint_url"] = ov["preprint_url"]
        if "preprint_doi" in ov:
            entry["preprint_doi"] = ov["preprint_doi"]

        # The title always resolves to the version of record, never to a
        # preprint or a repository copy. Override `url:` to change that.
        if not entry.get("url") and entry.get("doi"):
            entry["url"] = f"https://doi.org/{entry['doi']}"
        result.append(entry)

    # Newest year first; within a year, newest publication date first, matching
    # Google Scholar's "sort by year" view. Papers with no exact date fall back
    # to the order Scholar returned them in. `pin` overrides both.
    result.sort(key=lambda e: (
        -(e.get("year") or 0),
        e.get("pin", 100),
        -int((e.get("date") or "0000-00-00").replace("-", "")),
        e.get("order", 0),
    ))
    return result, fetched


def load_gallery(album: str) -> list[dict]:
    """Return [{full, thumb}] for static/img/<album>/, natural-sorted.

    Thumbnails come from static/img/<album>/thumbs/ when present (see
    scripts/make_thumbs.py); otherwise the full image is used for both, so the
    page still works before thumbnails have been generated.
    """
    src = STATIC / "img" / album
    if not src.is_dir():
        return []

    exts = {".webp", ".jpg", ".jpeg", ".png"}

    def natural(path: Path):
        # vacation2 must sort before vacation10
        return [int(t) if t.isdigit() else t.lower()
                for t in re.split(r"(\d+)", path.stem)]

    images = []
    for f in sorted((f for f in src.iterdir()
                     if f.is_file() and f.suffix.lower() in exts), key=natural):
        thumb = src / "thumbs" / (f.stem + ".webp")
        images.append({
            "full": f"/static/img/{album}/{f.name}",
            "thumb": f"/static/img/{album}/thumbs/{thumb.name}" if thumb.exists()
                     else f"/static/img/{album}/{f.name}",
        })
    return images


def load_projects() -> list[dict]:
    """Research projects: one markdown file each in content/projects/.

    Each becomes its own page at /research/<slug>/ and a card on the Research
    index, so adding a project is dropping in a file — no template edits.
    """
    projects = []
    d = CONTENT / "projects"
    if not d.exists():
        return projects

    for path in sorted(d.glob("*.md")):
        meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        if meta.get("draft"):
            continue
        slug = meta.get("slug") or path.stem
        html = render_md(body)
        projects.append({
            **meta,
            "slug": slug,
            "url": f"/research/{slug}/",
            "html": html,
            "title": meta.get("title", slug),
            "summary": meta.get("summary") or meta.get("description") or excerpt_from(html, 180),
            "og_type": "article",
        })

    # `order` pins position; otherwise newest-titled last-added first
    projects.sort(key=lambda p: (p.get("order", 100), p["title"]))
    return projects


def load_posts() -> list[dict]:
    posts = []
    posts_dir = CONTENT / "posts"
    if not posts_dir.exists():
        return posts

    for path in sorted(posts_dir.glob("*.md"), reverse=True):
        meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        if meta.get("draft"):
            continue

        # Date from frontmatter, else from a leading YYYY-MM-DD in the filename
        raw_date = meta.get("date")
        if isinstance(raw_date, str):
            dt = datetime.fromisoformat(raw_date)
        elif hasattr(raw_date, "year"):
            dt = datetime(raw_date.year, raw_date.month, raw_date.day)
        else:
            m = re.match(r"(\d{4}-\d{2}-\d{2})", path.stem)
            dt = datetime.fromisoformat(m.group(1)) if m else datetime.now()
        dt = dt.replace(tzinfo=timezone.utc)

        slug = meta.get("slug") or re.sub(r"^\d{4}-\d{2}-\d{2}-", "", path.stem)
        html = render_md(body)

        posts.append(
            {
                "title": meta.get("title", slug),
                "sub": meta.get("sub"),
                "slug": slug,
                "url": f"/blog/{slug}/",
                "html": html,
                "excerpt": meta.get("excerpt") or excerpt_from(html),
                "date": dt,
                "date_iso": dt.strftime("%Y-%m-%d"),
                "date_display": dt.strftime("%-d %B %Y"),
                "date_rfc822": format_datetime(dt),
                "description": meta.get("description"),
                "og_type": "article",
            }
        )

    posts.sort(key=lambda p: p["date"], reverse=True)
    return posts


# ---------------------------------------------------------------- build
def build(serve: bool = False, port: int = 8000) -> None:
    site = load_site()
    publications, _pubs_fetched = load_publications()
    posts = load_posts()
    projects = load_projects()
    now = datetime.now(timezone.utc)

    env = Environment(
        loader=FileSystemLoader(TEMPLATES),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    by_year: dict[int, list] = {}
    for p in publications:
        by_year.setdefault(p.get("year") or 0, []).append(p)
    publications_by_year = sorted(by_year.items(), reverse=True)

    ctx = {
        "site": site,
        "posts": posts,
        "projects": projects,
        "publications": publications,
        "publications_by_year": publications_by_year,
        "total_citations": sum(p.get("citations") or 0 for p in publications),
        "build_rfc822": format_datetime(now),
    }

    urls = []

    # --- home ---
    write(OUT / "index.html", env.get_template("index.html").render(
        page={"title": site["name"], "slug": "", "url": "/"}, **ctx))
    urls.append({"loc": "/", "lastmod": now.strftime("%Y-%m-%d")})

    # --- nav pages ---
    for item in site["nav"]:
        slug = item["slug"]
        page = {"title": item["title"], "slug": slug, "url": f"/{slug}/"}

        if item.get("file"):
            src = CONTENT / item["file"]
            meta, body = parse_frontmatter(src.read_text(encoding="utf-8"))
            page.update(meta)
            page["html"] = render_md(body)
            if page.get("gallery"):
                page["gallery_images"] = load_gallery(page["gallery"])
            template = item.get("template", "page.html")
        else:
            template = item["template"]
            if slug == "cv":
                meta, body = parse_frontmatter((CONTENT / "cv.md").read_text(encoding="utf-8"))
                page.update(meta)
                page["html"] = render_md(body)
                page["title"] = item["title"]

        write(OUT / slug / "index.html", env.get_template(template).render(page=page, **ctx))
        urls.append({"loc": f"/{slug}/", "lastmod": now.strftime("%Y-%m-%d")})

    # --- research projects ---
    for proj in projects:
        write(OUT / "research" / proj["slug"] / "index.html",
              env.get_template("project.html").render(page=proj, **ctx))
        urls.append({"loc": proj["url"], "lastmod": now.strftime("%Y-%m-%d")})

    # --- blog posts ---
    for post in posts:
        write(OUT / "blog" / post["slug"] / "index.html",
              env.get_template("post.html").render(page=post, **ctx))
        urls.append({"loc": post["url"], "lastmod": post["date_iso"]})

    # --- feeds and robots ---
    write(OUT / "blog" / "feed.xml", env.get_template("feed.xml").render(**ctx))
    write(OUT / "feed.xsl", env.get_template("feed.xsl").render(**ctx))
    write(OUT / "sitemap.xml", env.get_template("sitemap.xml").render(urls=urls, **ctx))
    write(OUT / "robots.txt",
          f"User-agent: *\nAllow: /\n\nSitemap: {site['url']}/sitemap.xml\n")
    write(OUT / "404.html", env.get_template("404.html").render(
        page={"title": "Page not found", "slug": "404", "url": "/404.html"}, **ctx))

    # --- BibTeX ---
    write(OUT / "publications.bib", make_bibtex(publications, site))

    # --- static assets ---
    shutil.copytree(STATIC, OUT / "static")
    if (ROOT / "CNAME").exists():
        shutil.copy(ROOT / "CNAME", OUT / "CNAME")
    # .nojekyll stops GitHub Pages running Jekyll over our output
    (OUT / ".nojekyll").touch()

    # --- CV PDF ---
    build_cv_pdf(env, site, ctx)

    print(f"Built {len(urls)} pages into {OUT.relative_to(ROOT)}/")

    if serve:
        import http.server
        import socketserver

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw):
                super().__init__(*a, directory=str(OUT), **kw)

            def end_headers(self):
                # Never cache during development — otherwise the browser keeps
                # serving a stale CSS/JS file after a rebuild and it looks like
                # the change did not apply.
                self.send_header("Cache-Control", "no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                super().end_headers()

            def log_message(self, *a):  # quieter output
                pass

        # Threaded: a single-threaded server serialises every request, so a
        # page with a gallery of images stalls while the browser waits for one
        # connection at a time.
        class Server(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True

        try:
            httpd = Server(("127.0.0.1", port), Handler)
        except OSError as exc:
            print(f"Cannot bind port {port}: {exc}\nTry: python build.py --serve --port 8787")
            raise SystemExit(1) from exc

        with httpd:
            print(f"Serving on http://localhost:{port}  (Ctrl-C to stop)")
            httpd.serve_forever()


def make_bibtex(publications: list[dict], site: dict) -> str:
    """Serialize the curated list to BibTeX."""
    out = [
        "% Publications of " + site["name"],
        "% Generated from Google Scholar, curated via publications.overrides.yml",
        "% " + site["url"] + "/publications.bib",
        "",
    ]
    for p in publications:
        year = p.get("year") or "n.d."
        authors = " and ".join(a["name"] for a in p.get("authors") or []) or "Unknown"
        first = (p.get("authors") or [{"name": "unknown"}])[0]["name"].split()[-1].lower()
        key = re.sub(r"[^a-z0-9]", "", f"{first}{year}")
        out.append(f"@article{{{key},")
        out.append(f"  author  = {{{authors}}},")
        out.append(f"  title   = {{{p.get('title', '')}}},")
        if p.get("venue"):
            out.append(f"  journal = {{{p['venue']}}},")
        out.append(f"  year    = {{{year}}},")
        if p.get("doi"):
            out.append(f"  doi     = {{{p['doi']}}},")
        if p.get("oa_url"):
            out.append(f"  url     = {{{p['oa_url']}}},")
        out.append("}")
        out.append("")
    return "\n".join(out)


def build_cv_pdf(env, site: dict, ctx: dict) -> None:
    """Render content/cv.md to _site/cv.pdf using the same markdown source."""
    cv_src = CONTENT / "cv.md"
    if not cv_src.exists():
        return
    try:
        from weasyprint import HTML
    except ImportError:
        print("  · WeasyPrint not installed — skipping cv.pdf")
        return

    meta, body = parse_frontmatter(cv_src.read_text(encoding="utf-8"))
    page = {**meta, "title": "CV", "slug": "cv", "url": "/cv.pdf", "html": render_md(body)}
    html = env.get_template("cv_pdf.html").render(
        page=page, fonts=(STATIC / "fonts").as_uri(), **ctx
    )

    # A PDF has no base URL, so root-relative hrefs like /teaching/ resolve
    # against the filesystem and end up as dead file:// links. Rewrite them to
    # absolute site URLs so they work wherever the PDF is opened.
    base = site["url"].rstrip("/")
    html = re.sub(r'href="/(?!/)', f'href="{base}/', html)
    try:
        HTML(string=html, base_url=str(ROOT)).write_pdf(OUT / "cv.pdf")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! cv.pdf failed: {exc}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--serve", action="store_true", help="serve _site/ after building")
    ap.add_argument("--port", type=int, default=8000, help="port for --serve (default 8000)")
    build(**vars(ap.parse_args()))
