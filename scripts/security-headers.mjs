import { createHash } from "node:crypto";

const MAX_HEADER_VALUE_LENGTH = 2_000;
const CLOUDFLARE_ANALYTICS_CONNECT_ORIGIN = "https://cloudflareinsights.com";
const CLOUDFLARE_ANALYTICS_SCRIPT_ORIGIN = "https://static.cloudflareinsights.com";

function sha256Source(source) {
  const browserNormalizedSource = source.replace(/\r\n?/g, "\n");
  return `'sha256-${createHash("sha256").update(browserNormalizedSource).digest("base64")}'`;
}

function collectHashes(htmlSources, extractSources) {
  const hashes = new Set();
  for (const htmlSource of htmlSources) {
    for (const inlineSource of extractSources(htmlSource)) {
      if (inlineSource !== "") {
        hashes.add(sha256Source(inlineSource));
      }
    }
  }
  return [...hashes].sort();
}

function extractInlineScripts(htmlSource) {
  return [...htmlSource.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]))
    .map((match) => match[2]);
}

function extractInlineStyles(htmlSource) {
  return [...htmlSource.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
    (match) => match[1],
  );
}

function extractStyleAttributes(htmlSource) {
  return [...htmlSource.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)].map(
    (match) => match[2],
  );
}

function directive(name, sources = []) {
  return [name, ...sources].join(" ");
}

export function renderContentSecurityPolicy(htmlSources) {
  const scriptHashes = collectHashes(htmlSources, extractInlineScripts);
  const styleHashes = collectHashes(htmlSources, extractInlineStyles);
  const styleAttributeHashes = collectHashes(htmlSources, extractStyleAttributes);
  const styleAttributeSources =
    styleAttributeHashes.length === 0
      ? ["'none'"]
      : ["'unsafe-hashes'", ...styleAttributeHashes];
  const policy = [
    directive("default-src", ["'none'"]),
    directive("base-uri", ["'none'"]),
    directive("connect-src", [CLOUDFLARE_ANALYTICS_CONNECT_ORIGIN]),
    directive("font-src", ["'self'"]),
    directive("form-action", ["'none'"]),
    directive("frame-ancestors", ["'none'"]),
    directive("img-src", ["'self'"]),
    directive("manifest-src", ["'self'"]),
    directive("object-src", ["'none'"]),
    directive("script-src", [
      "'self'",
      CLOUDFLARE_ANALYTICS_SCRIPT_ORIGIN,
      ...scriptHashes,
    ]),
    directive("script-src-attr", ["'none'"]),
    directive("style-src", ["'self'", ...styleHashes]),
    directive("style-src-attr", styleAttributeSources),
  ].join("; ");

  if (policy.length > MAX_HEADER_VALUE_LENGTH) {
    throw new Error(
      `Generated Content-Security-Policy is ${policy.length} characters; ` +
        `Cloudflare Pages allows at most ${MAX_HEADER_VALUE_LENGTH} per header value`,
    );
  }

  return policy;
}

export function renderSecurityHeaders(htmlSources) {
  const contentSecurityPolicy = renderContentSecurityPolicy(htmlSources);
  return `/*
  Content-Security-Policy: ${contentSecurityPolicy}
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
`;
}

export function parseSecurityHeaders(headersSource) {
  const lines = headersSource.trimEnd().split(/\r?\n/);
  if (lines.shift()?.trim() !== "/*") {
    throw new Error("Security headers must use a single global /* rule");
  }

  const headers = Object.create(null);
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    if (!/^\s/.test(line)) {
      throw new Error("Security headers must use a single global /* rule");
    }

    const separatorIndex = line.indexOf(":");
    const headerName = line.slice(0, separatorIndex).trim();
    const headerValue = line.slice(separatorIndex + 1).trim();
    if (
      separatorIndex < 1 ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName) ||
      headerValue === ""
    ) {
      throw new Error(`Invalid security header line: ${line.trim()}`);
    }
    if (Object.hasOwn(headers, headerName)) {
      throw new Error(`Duplicate security header: ${headerName}`);
    }
    headers[headerName] = headerValue;
  }

  return headers;
}
