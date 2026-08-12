import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSite } from "./site-builder.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "_site");

const { publishedPosts } = await buildSite({
  rootDir: projectRoot,
  outputDir: outputDirectory,
});

console.log(`Built ${publishedPosts.length} published posts into ${outputDirectory}`);
