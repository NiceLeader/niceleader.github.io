import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

import { parseSecurityHeaders } from "./security-headers.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "_site");
const reportDirectory = path.join(projectRoot, ".lighthouseci");
const host = "127.0.0.1";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".xml", "application/xml; charset=utf-8"],
]);

const ROUTES = [
  { path: "/", reportName: "home" },
  { path: "/services/", reportName: "services" },
  { path: "/blog/", reportName: "blog" },
  { path: "/blog/rust-money-types/", reportName: "article" },
  { path: "/blog/point-in-time-balances/", reportName: "article-point-in-time" },
  {
    path: "/404.html",
    reportName: "not-found",
    thresholds: { accessibility: 1, "best-practices": 0.95, performance: 0.95 },
  },
];

const SCORE_THRESHOLDS = {
  accessibility: 1,
  "best-practices": 0.95,
  performance: 0.95,
  seo: 1,
};

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://${host}`).pathname);
  const relativePath = pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
  const resolvedPath = path.resolve(outputDirectory, relativePath || "index.html");
  const outputBoundary = `${outputDirectory}${path.sep}`;

  if (resolvedPath !== outputDirectory && !resolvedPath.startsWith(outputBoundary)) {
    return null;
  }
  return resolvedPath;
}

function createStaticServer(securityHeaders) {
  return createServer(async (request, response) => {
    try {
      const requestedPath = resolveRequestPath(request.url ?? "/");
      if (!requestedPath || !(await pathExists(requestedPath)) || !(await stat(requestedPath)).isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        ...securityHeaders,
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES.get(path.extname(requestedPath).toLowerCase()) ?? "application/octet-stream",
      });
      createReadStream(requestedPath).pipe(response);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Internal server error");
      console.error(error);
    }
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const securityHeaders = parseSecurityHeaders(
  await readFile(path.join(outputDirectory, "_headers"), "utf8"),
);
const server = createStaticServer(securityHeaders);
const address = await listen(server);
if (!address || typeof address === "string") {
  throw new Error("Static audit server did not expose a TCP port");
}

await mkdir(reportDirectory, { recursive: true });
const chrome = await launch({
  chromeFlags: ["--headless=new", "--disable-gpu", "--no-sandbox"],
});

const failures = [];
try {
  for (const route of ROUTES) {
    const routeThresholds = route.thresholds ?? SCORE_THRESHOLDS;
    const url = `http://${host}:${address.port}${route.path}`;
    const result = await lighthouse(url, {
      logLevel: "error",
      onlyCategories: Object.keys(SCORE_THRESHOLDS),
      output: "json",
      port: chrome.port,
    });
    if (!result) {
      throw new Error(`Lighthouse returned no result for ${route.path}`);
    }

    await writeFile(
      path.join(reportDirectory, `${route.reportName}.json`),
      result.report,
      "utf8",
    );

    const scores = Object.fromEntries(
      Object.entries(SCORE_THRESHOLDS).map(([category]) => [
        category,
        result.lhr.categories[category].score ?? 0,
      ]),
    );
    console.log(
      `${route.path} ${Object.entries(scores)
        .map(([category, score]) => `${category}=${Math.round(score * 100)}`)
        .join(" ")}`,
    );

    for (const [category, threshold] of Object.entries(routeThresholds)) {
      if (scores[category] < threshold) {
        failures.push(
          `${route.path} ${category} score ${scores[category]} is below ${threshold}`,
        );
      }
    }
  }
} finally {
  await chrome.kill();
  await closeServer(server);
}

if (failures.length > 0) {
  throw new Error(`Lighthouse quality gate failed:\n${failures.join("\n")}`);
}
