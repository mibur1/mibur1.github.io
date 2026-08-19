# Personal website

Personal academic website. Static HTML generated from markdown through a Python build script.


## Quick start

```bash
pip install -r requirements.txt
python build.py --serve # build and serve at http://localhost:8000
```


## Content

| Path                                  | Content                                   |
| --------------------------------------| ------------------------------------------|
| `site.yaml`                           | Name, role, links, navigation             |
| `content/*.md`                        | Page content — edit these, never the HTML |
| `content/posts/*.md`                  | Blog posts, named `YYYY-MM-DD-slug.md`    |
| `content/publications.json`           | Scraped from Scholar — do not hand-edit   |
| `templates/`                          | Jinja2 templates                          |
| `static/css/tokens.css`               | The entire look of the site               |
| `static/css/site.css`                 | Layout and components                     |
| `static/fonts/`                       | Self-hosted WOFF2                         |
| `static/js/network.js`                | Homepage network — behaviour and `CFG`    |
| `static/img/`                         | Favicon, OG card, grain tiles             |
| `scripts/`                            | One-off generators (see below)            |
| `build.py`                            | The generator                             |


## Common tasks

- **Edit pages**: Change the markdown in `content/`, run `python build.py`.
- **Blog posts**: Create `content/posts/2026-09-01-my-title.md` with frontmatter:

    ```yaml
    ---
    title: "The title"
    date: 2026-09-01
    excerpt: Shown on the blog index and in the RSS feed.
    draft: true # keep out of the build
    ---
    ```

- **Publications**:`python scripts/fetch_publications.py` scrapes Google Scholar
    -Recovers DOIs via Crossref and open-access links via OpenAlex.
    - Run locally and commit the JSON; Scholar blocks CI runners.
- **Design**: `static/css/tokens.css`.
- **Homepage network**: tunables live in the `CFG` block at the top of `static/js/network.js`.
  Which nodes appear is driven by the `nav` list in `site.yaml`, not by the script.
- **Images**: regenerate after changing name or palette — these are committed, not built:
    - `python scripts/make_og_image.py` — the link-preview card
    - `python scripts/make_noise.py` — the paper-grain tiles
- **CV**: `content/cv.md`. Renders to both the CV page and `cv.pdf` (via WeasyPrint).


## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which refreshes
publications, builds, and deploys `_site/` to GitHub Pages through GitHub Actions.

Because the custom domain is configured on this user-site repo, every other
GitHub Pages repo on the account is served under `michaburkhardt.de/<repo>/`.

Other sites like teaching materials are linked with `/repo-name/`, and
page slugs that collide with repository names should be avoided.
