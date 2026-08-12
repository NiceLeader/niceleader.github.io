# maciejlewandowski.dev

Personal site and engineering notes of Maciej Lewandowski, focused on digital asset
custody, wallet infrastructure and tokenization.

The production output is static HTML and CSS. Node.js is used only at build and test
time to keep publishing deterministic and fail closed when metadata, links or post
statuses drift.

## Local workflow

Requirements: Node.js 22.12 or newer.

```powershell
npm ci
npm run check
npm run lighthouse
```

The generated site is written to `_site/`. It is intentionally ignored by Git.

## Publishing

Post metadata and publication status live in `content/posts.json`:

- `draft` and `scheduled` posts are excluded from `_site/`;
- `published` posts are copied and added to Home, Writing, RSS and the sitemap;
- a missing source for a published post fails the build.

The generated artifact, not the repository root, is the deployable site. The build
also creates `_site/_headers` with a strict, hash-based Content Security Policy and
the remaining production security headers. Inline sources are allowlisted by their
SHA-256 hashes; `unsafe-inline` and `unsafe-eval` are intentionally forbidden.

Cloudflare Pages production settings:

- production branch: `main`;
- build command: `npm run check`;
- build output directory: `_site`;
- Node.js version: `22.22.0`.

`.github/workflows/pages.yml` provides an artifact-only GitHub Pages deployment as a
fallback. It rebuilds and validates the site on `main`, then deploys only `_site/`.
GitHub Pages must remain set to GitHub Actions; the legacy `main:/` source would expose
unpublished source directories.

## Quality gates

`npm run check` runs unit tests with coverage, produces a clean build, validates the
publishing contract and internal links, validates HTML, and audits dependencies.
`npm run lighthouse` enforces performance, accessibility, best-practice and SEO
thresholds on representative routes.
