import assert from "node:assert/strict";
import test from "node:test";

import {
  attemptPasses,
  selectPassingAttempt,
} from "../scripts/lighthouse-policy.mjs";

const thresholds = {
  accessibility: 1,
  "best-practices": 0.95,
  performance: 0.95,
  seo: 1,
};

test("accepts a stable retry after a transient cold-start failure", () => {
  const attempts = [
    { accessibility: 1, "best-practices": 0.96, performance: 0.85, seo: 1 },
    { accessibility: 1, "best-practices": 0.96, performance: 0.99, seo: 1 },
  ];

  assert.equal(attemptPasses(attempts[0], thresholds), false);
  assert.equal(attemptPasses(attempts[1], thresholds), true);
  assert.deepEqual(selectPassingAttempt(attempts, thresholds), attempts[1]);
});

test("does not combine category scores from separate failing attempts", () => {
  const attempts = [
    { accessibility: 0.99, "best-practices": 0.96, performance: 1, seo: 1 },
    { accessibility: 1, "best-practices": 0.96, performance: 0.94, seo: 1 },
  ];

  assert.equal(selectPassingAttempt(attempts, thresholds), null);
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
