import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSite, validateManifest } from "../scripts/site-builder.mjs";

const HOME_START = "<!-- HOME_POSTS_START -->";
const HOME_END = "<!-- HOME_POSTS_END -->";
const BLOG_START = "<!-- BLOG_POSTS_START -->";
const BLOG_END = "<!-- BLOG_POSTS_END -->";

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

  await writeText(
    path.join(rootDir, "index.html"),
    `<html><body>${HOME_START}<p>stale</p>${HOME_END}</body></html>`,
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
    await writeText(
      path.join(rootDir, "blog", post.slug, "index.html"),
      `<html><head><title>${post.title}</title></head><body>${post.title}</body></html>`,
    );
  }

  return { manifest, outputDir, rootDir };
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
  assert.ok(!files.includes("blog/draft-post/index.html"));
  assert.ok(!files.includes("blog/scheduled-post/index.html"));
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
