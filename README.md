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

The generated artifact, not the repository root, is the deployable site.

## Quality gates

`npm run check` runs unit tests with coverage, produces a clean build, validates the
publishing contract and internal links, validates HTML, and audits dependencies.
`npm run lighthouse` enforces performance, accessibility, best-practice and SEO
thresholds on representative routes.
