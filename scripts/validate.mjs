import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest } from "./site-builder.mjs";
import { validateBuiltSite } from "./site-validator.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "_site");
const manifest = await loadManifest(projectRoot);
const publishedSlugs = manifest.posts
  .filter((post) => post.status === "published")
  .map((post) => post.slug);
const unpublishedSlugs = manifest.posts
  .filter((post) => post.status !== "published")
  .map((post) => post.slug);

const issues = await validateBuiltSite({
  outputDir: outputDirectory,
  publishedSlugs,
  unpublishedSlugs,
});

if (issues.length > 0) {
  for (const issue of issues) {
    console.error(`${issue.file}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Validated ${publishedSlugs.length} published posts with no site contract issues`);
}
