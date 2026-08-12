import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  parseSecurityHeaders,
  renderSecurityHeaders,
} from "../scripts/security-headers.mjs";

test("parses the generated global header block for a local audit server", () => {
  const headersSource = renderSecurityHeaders([
    "<html><head><style>body { color: black; }</style></head><body></body></html>",
  ]);

  const headers = parseSecurityHeaders(headersSource);

  assert.match(headers["Content-Security-Policy"], /default-src 'none'/);
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
});

test("rejects a header file that is not a single global rule", () => {
  assert.throws(
    () => parseSecurityHeaders("/blog/*\n  X-Frame-Options: DENY\n"),
    /global \/\* rule/i,
  );
});

test("hashes inline blocks after HTML line-ending normalization", () => {
  const policy = renderSecurityHeaders([
    "<html><head><style>\r\nbody { color: black; }\r\n</style></head></html>",
  ]);
  const browserSource = "\nbody { color: black; }\n";
  const expectedHash = createHash("sha256").update(browserSource).digest("base64");

  assert.ok(policy.includes(`'sha256-${expectedHash}'`));
});

test("does not upgrade the local HTTP audit origin", () => {
  const policy = renderSecurityHeaders(["<html><body></body></html>"]);

  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});
