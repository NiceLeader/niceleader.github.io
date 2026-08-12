import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateBuiltSite } from "../scripts/site-validator.mjs";

async function writeText(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function validPage({ body = "", canonical = "https://example.com/", title = "Example" } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="A useful description for the page.">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>a:focus-visible { outline: 2px solid currentColor; }</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<nav aria-label="Primary"><a href="/">Home</a><a href="/blog/">Writing</a></nav>
<main id="main-content"><h1>${title}</h1>${body}</main>
<footer>Footer</footer>
</body>
</html>`;
}

async function createValidSiteFixture() {
  const outputDir = await mkdtemp(path.join(tmpdir(), "site-validator-"));
  await writeText(
    path.join(outputDir, "index.html"),
    validPage({ body: '<a href="/blog/published/"><time datetime="2026-08-10">Aug 2026</time></a>' }),
  );
  await writeText(
    path.join(outputDir, "blog", "index.html"),
    validPage({ canonical: "https://example.com/blog/", title: "Writing" }),
  );
  await writeText(
    path.join(outputDir, "blog", "published", "index.html"),
    validPage({ canonical: "https://example.com/blog/published/", title: "Published" }),
  );
  await writeText(path.join(outputDir, "favicon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  await writeText(path.join(outputDir, "feed.xml"), "<?xml version=\"1.0\"?><rss></rss>");
  await writeText(
    path.join(outputDir, "sitemap.xml"),
    "<?xml version=\"1.0\"?><urlset><url><loc>https://example.com/</loc></url></urlset>",
  );
  return outputDir;
}

test("valid site passes structural, navigation and publishing checks", async () => {
  const outputDir = await createValidSiteFixture();

  const issues = await validateBuiltSite({
    outputDir,
    publishedSlugs: ["published"],
    unpublishedSlugs: ["draft", "scheduled"],
  });

  assert.deepEqual(issues, []);
});

test("validator reports accessibility and HTML contract regressions", async () => {
  const outputDir = await createValidSiteFixture();
  await writeText(
    path.join(outputDir, "index.html"),
    '<!DOCTYPE html><html lang="en"><head><title>Broken</title>' +
      '<link rel="icon" href="data:image/svg+xml,<svg></svg>">' +
      '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"></head>' +
      '<body><nav><a href="/missing/">Missing</a></nav><h1>Broken</h1>' +
      '<time>Aug 2026</time></body></html>',
  );

  const issues = await validateBuiltSite({
    outputDir,
    publishedSlugs: ["published"],
    unpublishedSlugs: [],
  });
  const messages = issues.map((issue) => issue.message).join("\n");

  assert.match(messages, /missing viewport/i);
  assert.match(messages, /missing description/i);
  assert.match(messages, /missing canonical/i);
  assert.match(messages, /missing main/i);
  assert.match(messages, /missing skip link/i);
  assert.match(messages, /focus-visible/i);
  assert.match(messages, /time.*datetime/i);
  assert.match(messages, /data URL favicon/i);
  assert.match(messages, /Google Fonts/i);
  assert.match(messages, /broken internal link/i);
});

test("validator fails when unpublished posts leak into the deployment output", async () => {
  const outputDir = await createValidSiteFixture();
  await writeText(
    path.join(outputDir, "blog", "draft", "index.html"),
    validPage({ canonical: "https://example.com/blog/draft/", title: "Draft" }),
  );

  const issues = await validateBuiltSite({
    outputDir,
    publishedSlugs: ["published"],
    unpublishedSlugs: ["draft"],
  });

  assert.ok(issues.some((issue) => /unpublished post is present/i.test(issue.message)));
});

test("validator fails when an unpublished legacy redirect leaks into output", async () => {
  const outputDir = await createValidSiteFixture();
  await writeText(
    path.join(outputDir, "blog", "draft.html"),
    validPage({ canonical: "https://example.com/blog/draft/", title: "Draft redirect" }),
  );

  const issues = await validateBuiltSite({
    outputDir,
    publishedSlugs: ["published"],
    unpublishedSlugs: ["draft"],
  });

  assert.ok(
    issues.some(
      (issue) => issue.file === "blog/draft.html" && /unpublished post is present/i.test(issue.message),
    ),
  );
});

test("validator fails when a published post is absent from output", async () => {
  const outputDir = await createValidSiteFixture();

  const issues = await validateBuiltSite({
    outputDir,
    publishedSlugs: ["published", "missing-published"],
    unpublishedSlugs: [],
  });

  assert.ok(issues.some((issue) => /published post is missing/i.test(issue.message)));
});
