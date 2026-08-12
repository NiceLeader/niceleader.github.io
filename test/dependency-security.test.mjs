import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function compareReleaseVersions(leftVersion, rightVersion) {
  const leftParts = leftVersion.split(".").map(Number);
  const rightParts = rightVersion.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

test("lockfile excludes extract-zip versions affected by GHSA-jmr9-qjv8-65gv", async () => {
  const lockfile = JSON.parse(
    await readFile(path.join(projectRoot, "package-lock.json"), "utf8"),
  );
  const extractZipVersion = lockfile.packages["node_modules/extract-zip"]?.version;

  assert.ok(
    extractZipVersion === undefined || compareReleaseVersions(extractZipVersion, "2.0.1") > 0,
    `extract-zip ${extractZipVersion} is vulnerable to GHSA-jmr9-qjv8-65gv`,
  );
});
