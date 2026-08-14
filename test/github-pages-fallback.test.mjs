import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fallbackDir = path.join(projectRoot, "github-pages-fallback");

test("repository contains no deployable GitHub Pages fallback", async () => {
  const files = await readdir(fallbackDir).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  assert.deepEqual(files, []);
});
