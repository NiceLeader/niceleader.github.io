import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fallbackDir = path.join(projectRoot, "github-pages-fallback");

test("GitHub Pages fallback contains only a noindex redirect and no post content", async () => {
  const files = (await readdir(fallbackDir)).sort();
  assert.deepEqual(files, ["404.html", "index.html"]);

  const manifest = JSON.parse(
    await readFile(path.join(projectRoot, "content", "posts.json"), "utf8"),
  );

  for (const file of files) {
    const html = await readFile(path.join(fallbackDir, file), "utf8");
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/maciejlewandowski\.dev\/">/);
    assert.match(html, /const target = new URL\("https:\/\/maciejlewandowski\.dev"\)/);
    assert.match(html, /target\.pathname = window\.location\.pathname/);
    assert.match(html, /target\.search = window\.location\.search/);
    assert.match(html, /target\.hash = window\.location\.hash/);
    assert.match(html, /window\.location\.replace\(target\.href\)/);
    assert.doesNotMatch(html, /<form|<iframe|https:\/\/static\.cloudflareinsights\.com/i);

    for (const post of manifest.posts) {
      assert.ok(!html.includes(post.slug));
      assert.ok(!html.includes(post.title));
    }
  }
});
