import assert from "node:assert/strict";
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
