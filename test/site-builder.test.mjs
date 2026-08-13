import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSite, validateManifest } from "../scripts/site-builder.mjs";

const HOME_START = "<!-- HOME_POSTS_START -->";
const HOME_END = "<!-- HOME_POSTS_END -->";
const BLOG_START = "<!-- BLOG_POSTS_START -->";
const BLOG_END = "<!-- BLOG_POSTS_END -->";

function sha256Source(source) {
  return `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
}

async function writeText(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function createFixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "site-builder-"));
  const outputDir = path.join(rootDir, "_site");
  const manifest = {
    site: {
      title: "Example site",
      description: "Example description",
      url: "https://example.com",
      language: "en",
    },
    posts: [
      {
        slug: "published-post",
        title: "Published post",
        description: "Visible everywhere",
        date: "2026-08-10",
        track: "Engineering",
        status: "published",
      },
      {
        slug: "draft-post",
        title: "Draft post",
        description: "Must remain private",
        date: "2026-08-11",
        track: "Engineering",
        status: "draft",
      },
      {
        slug: "scheduled-post",
        title: "Scheduled post",
        description: "Must wait for explicit publication",
        date: "2026-08-13",
        track: "Custody engineering",
        status: "scheduled",
      },
    ],
  };

  const inlineScript = '{"@context":"https://schema.org","@type":"WebSite"}';
  const inlineStyle = "body { color: rgb(10 20 30); }";
  const styleAttribute = "color: rgb(40 50 60)";
  await writeText(
    path.join(rootDir, "index.html"),
    `<html><head><script type="application/ld+json">${inlineScript}</script>` +
      `<style>${inlineStyle}</style></head><body style="${styleAttribute}">` +
      `${HOME_START}<p>stale</p>${HOME_END}</body></html>`,
  );
  await writeText(
    path.join(rootDir, "blog", "index.html"),
    `<html><body>${BLOG_START}<p>stale</p>${BLOG_END}</body></html>`,
  );
  await writeText(path.join(rootDir, "services", "index.html"), "<html>services</html>");
  await writeText(path.join(rootDir, "404.html"), "<html>not found</html>");
  await writeText(path.join(rootDir, "CNAME"), "example.com\n");
  await writeText(path.join(rootDir, "robots.txt"), "User-agent: *\nAllow: /\n");
  await writeText(path.join(rootDir, "og.png"), "image-placeholder");
  await writeText(
    path.join(rootDir, "content", "posts.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  for (const post of manifest.posts) {
    const postUrl = `https://example.com/blog/${post.slug}/`;
    const structuredData = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      author: {
        "@type": "Person",
        name: "Example Author",
        url: "https://example.com/",
      },
      datePublished: post.date,
      headline: post.title,
      mainEntityOfPage: postUrl,
      publisher: { "@type": "Person", name: "Example Author" },
    });
    await writeText(
      path.join(rootDir, "blog", post.slug, "index.html"),
      `<html><head><title>${post.title}</title>` +
        `<script type="application/ld+json">${structuredData}</script></head>` +
        `<body><article>${post.title}</article></body></html>`,
    );
    await writeText(
      path.join(rootDir, "blog", `${post.slug}.html`),
      `<html><head><title>${post.title} redirect</title></head></html>`,
    );
  }

  return { inlineScript, inlineStyle, manifest, outputDir, rootDir, styleAttribute };
}

function readJsonLd(source) {
  const matches = [
    ...source.matchAll(
      /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi,
    ),
  ];
  assert.equal(matches.length, 1, "page must contain one JSON-LD graph");
  return JSON.parse(matches[0][1]);
}

async function listFiles(directoryPath, basePath = directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath, basePath)));
      continue;
    }
    files.push(path.relative(basePath, entryPath).replaceAll("\\", "/"));
  }

  return files.sort();
}

test("build publishes one post consistently and excludes drafts and scheduled posts", async () => {
  const { outputDir, rootDir } = await createFixture();

  await buildSite({ rootDir, outputDir });

  const home = await readFile(path.join(outputDir, "index.html"), "utf8");
  const blog = await readFile(path.join(outputDir, "blog", "index.html"), "utf8");
  const feed = await readFile(path.join(outputDir, "feed.xml"), "utf8");
  const sitemap = await readFile(path.join(outputDir, "sitemap.xml"), "utf8");
  const files = await listFiles(outputDir);

  for (const aggregate of [home, blog, feed]) {
    assert.match(aggregate, /Published post/);
    assert.doesNotMatch(aggregate, /Draft post/);
    assert.doesNotMatch(aggregate, /Scheduled post/);
  }
  assert.match(sitemap, /blog\/published-post\//);
  assert.doesNotMatch(sitemap, /blog\/draft-post\//);
  assert.doesNotMatch(sitemap, /blog\/scheduled-post\//);
  assert.ok(files.includes("blog/published-post/index.html"));
  assert.ok(files.includes("blog/published-post.html"));
  assert.ok(!files.includes("blog/draft-post/index.html"));
  assert.ok(!files.includes("blog/draft-post.html"));
  assert.ok(!files.includes("blog/scheduled-post/index.html"));
  assert.ok(!files.includes("blog/scheduled-post.html"));
});

test("build output is deterministic", async () => {
  const { outputDir, rootDir } = await createFixture();

  await buildSite({ rootDir, outputDir });
  const firstFiles = await listFiles(outputDir);
  const firstContents = await Promise.all(
    firstFiles.map((file) => readFile(path.join(outputDir, file), "utf8")),
  );

  await buildSite({ rootDir, outputDir });
  const secondFiles = await listFiles(outputDir);
  const secondContents = await Promise.all(
    secondFiles.map((file) => readFile(path.join(outputDir, file), "utf8")),
  );

  assert.deepEqual(secondFiles, firstFiles);
  assert.deepEqual(secondContents, firstContents);
});

test("build omits the provider-specific GitHub Pages CNAME file", async () => {
  const { outputDir, rootDir } = await createFixture();

  await buildSite({ rootDir, outputDir });

  const files = await listFiles(outputDir);
  assert.ok(!files.includes("CNAME"));
});

test("build generates strict security headers for every inline source", async () => {
  const { inlineScript, inlineStyle, outputDir, rootDir, styleAttribute } =
    await createFixture();

  await buildSite({ rootDir, outputDir });

  const headers = await readFile(path.join(outputDir, "_headers"), "utf8");

  assert.match(headers, /^\/\*$/m);
  assert.match(headers, /Content-Security-Policy: default-src 'none';/);
  assert.ok(headers.includes(sha256Source(inlineScript)));
  assert.ok(headers.includes(sha256Source(inlineStyle)));
  assert.ok(headers.includes(sha256Source(styleAttribute)));
  assert.doesNotMatch(headers, /'unsafe-inline'|'unsafe-eval'/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(headers, /Permissions-Policy:/);
});

test("build connects article metadata and related notes to published content", async () => {
  const { manifest, outputDir, rootDir } = await createFixture();
  const publishedPost = manifest.posts.find((post) => post.slug === "published-post");
  const relatedPost = manifest.posts.find((post) => post.slug === "draft-post");
  publishedPost.modified = "2026-08-12";
  publishedPost.related = [relatedPost.slug];
  relatedPost.status = "published";
  relatedPost.related = [publishedPost.slug];
  await writeText(
    path.join(rootDir, "content", "posts.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await buildSite({ rootDir, outputDir });

  const article = await readFile(
    path.join(outputDir, "blog", publishedPost.slug, "index.html"),
    "utf8",
  );
  const structuredData = readJsonLd(article);
  const entitiesById = new Map(
    structuredData["@graph"].map((entity) => [entity["@id"], entity]),
  );
  const articleUrl = `https://example.com/blog/${publishedPost.slug}/`;
  const personId = "https://example.com/#person";
  const articleEntity = entitiesById.get(`${articleUrl}#article`);
  const breadcrumb = entitiesById.get(`${articleUrl}#breadcrumb`);

  assert.deepEqual(articleEntity.author, { "@id": personId });
  assert.deepEqual(articleEntity.publisher, { "@id": personId });
  assert.deepEqual(articleEntity.mainEntityOfPage, { "@id": articleUrl });
  assert.equal(articleEntity.dateModified, publishedPost.modified);
  assert.deepEqual(
    breadcrumb.itemListElement.map(({ item, name, position }) => ({ item, name, position })),
    [
      { item: "https://example.com/blog/", name: "Writing", position: 1 },
      { item: articleUrl, name: publishedPost.title, position: 2 },
    ],
  );
  assert.match(article, /<h2[^>]*>Related field notes<\/h2>/);
  assert.match(article, /href="\/blog\/draft-post\/"/);
  assert.match(article, /Draft post/);
  assert.doesNotMatch(article, /href="\/blog\/scheduled-post\/"/);
});

test("build keeps manifest text from terminating the JSON-LD script", async () => {
  const { manifest, outputDir, rootDir } = await createFixture();
  const publishedPost = manifest.posts.find((post) => post.slug === "published-post");
  publishedPost.title = "Safe title </script><script>alert(1)</script>";
  await writeText(
    path.join(rootDir, "content", "posts.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await buildSite({ rootDir, outputDir });

  const article = await readFile(
    path.join(outputDir, "blog", publishedPost.slug, "index.html"),
    "utf8",
  );
  assert.doesNotMatch(article, /<script>alert\(1\)<\/script>/);
  assert.match(article, /\\u003c\/script\\u003e\\u003cscript\\u003ealert\(1\)/);
  assert.equal(readJsonLd(article)["@graph"][0].headline, publishedPost.title);
});

test("manifest validation rejects duplicate slugs", () => {
  const duplicatePost = {
    slug: "duplicate",
    title: "Duplicate",
    description: "Duplicate post",
    date: "2026-08-10",
    track: "Engineering",
    status: "published",
  };

  assert.throws(
    () =>
      validateManifest({
        site: {
          title: "Example",
          description: "Example",
          url: "https://example.com",
          language: "en",
        },
        posts: [duplicatePost, { ...duplicatePost }],
      }),
    /duplicate post slug/i,
  );
});

test("manifest validation rejects impossible calendar dates", () => {
  assert.throws(
    () =>
      validateManifest({
        site: {
          title: "Example",
          description: "Example",
          url: "https://example.com",
          language: "en",
        },
        posts: [
          {
            slug: "impossible-date",
            title: "Impossible date",
            description: "Must fail instead of rolling into March",
            date: "2026-02-31",
            track: "Engineering",
            status: "published",
          },
        ],
      }),
    /YYYY-MM-DD/,
  );
});

test("manifest validation rejects unsafe related-post relationships", async () => {
  const { manifest } = await createFixture();
  const publishedPost = manifest.posts.find((post) => post.slug === "published-post");

  publishedPost.related = [publishedPost.slug];
  assert.throws(() => validateManifest(manifest), /cannot reference itself/i);

  publishedPost.related = ["missing-post"];
  assert.throws(() => validateManifest(manifest), /unknown post/i);

  publishedPost.related = ["draft-post"];
  assert.throws(() => validateManifest(manifest), /must reference a published post/i);

  publishedPost.related = ["draft-post", "draft-post"];
  assert.throws(() => validateManifest(manifest), /duplicate related post/i);
});

test("build fails closed when a published source file is missing", async () => {
  const { manifest, outputDir, rootDir } = await createFixture();
  manifest.posts.push({
    slug: "missing-post",
    title: "Missing post",
    description: "This source does not exist",
    date: "2026-08-12",
    track: "Engineering",
    status: "published",
  });
  await writeText(
    path.join(rootDir, "content", "posts.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await assert.rejects(() => buildSite({ rootDir, outputDir }), /missing published post source/i);
});

test("build rejects an output directory outside the conventional generated folder", async () => {
  const { rootDir } = await createFixture();

  await assert.rejects(
    () => buildSite({ rootDir, outputDir: rootDir }),
    /output directory must be named _site/i,
  );
});
