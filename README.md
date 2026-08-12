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

Cloudflare Pages production contract:

- project: `maciejlewandowski-dev`;
- production branch: `main`;
- deployable directory: `_site`;
- Node.js version: `22.22.0`.

`.github/workflows/pages.yml` rebuilds and validates the site on `main`, runs the
Lighthouse gates with the generated headers active, and deploys only `_site/` to
Cloudflare Pages through the official Wrangler action. It requires the
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` secrets in the GitHub
`production` environment. That environment accepts deployments only from `main`,
and the token is limited to Cloudflare Pages edit access for the production
account. The deploy job also rejects a manual run from any non-`main` ref.

GitHub Pages is not a production target and must not own the custom domain. GitHub
does not allow Pages to be disabled for a user-site repository named
`NiceLeader.github.io`, so the workflow publishes only the minimal, `noindex`
redirect in `github-pages-fallback/` there. It never publishes the repository root
or the full site to that fallback. The `github-pages` environment accepts only
`main`, and its `pages: write` and `id-token: write` permissions exist only on the
isolated fallback job.

A provider-specific root `CNAME` file is intentionally absent from both the
repository and the generated Cloudflare artifact. The legacy GitHub Pages `main:/`
source would expose unpublished source directories and must never be re-enabled.

## Quality gates

`npm run check` runs unit tests with coverage, produces a clean build, validates the
publishing contract and internal links, validates HTML, and audits dependencies.
`npm run lighthouse` enforces performance, accessibility, best-practice and SEO
thresholds on representative routes.
