import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { attemptPasses } from "../scripts/lighthouse-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const thresholds = {
  accessibility: 1,
  "best-practices": 0.95,
  performance: 0.95,
  seo: 1,
};

test("keeps a measured cold-start threshold failure fail-closed", () => {
  const measuredScores = {
    accessibility: 1,
    "best-practices": 0.96,
    performance: 0.85,
    seo: 1,
  };

  assert.equal(attemptPasses(measuredScores, thresholds), false);
});

test("warms Lighthouse before routes and does not retry threshold failures", async () => {
  const runner = await readFile(
    path.join(projectRoot, "scripts", "lighthouse.mjs"),
    "utf8",
  );

  assert.match(runner, /const warmupResult = await lighthouse/);
  assert.ok(runner.indexOf("const warmupResult") < runner.indexOf("for (const route of ROUTES)"));
  assert.doesNotMatch(runner, /MAX_ROUTE_ATTEMPTS|selectPassingAttempt/);
});

test("requires every configured threshold on the same attempt", () => {
  const passing = {
    accessibility: 1,
    "best-practices": 0.95,
    performance: 0.95,
    seo: 1,
  };

  assert.equal(attemptPasses(passing, thresholds), true);
  assert.equal(
    attemptPasses({ ...passing, "best-practices": 0.949 }, thresholds),
    false,
  );
});
