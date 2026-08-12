import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

function createIssue(file, message) {
  return { file: file.replaceAll("\\", "/"), message };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directoryPath, basePath = directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, basePath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(basePath, entryPath));
    }
  }

  return files.sort();
}

function isRedirectPage(source) {
  return /<meta\s+http-equiv=["']refresh["']/i.test(source);
}

function getTitle(source) {
  return source.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
}

function validateDocumentContract(relativePath, source, hasSharedFocusStyle) {
  const issues = [];
  const isNotFoundPage = relativePath.replaceAll("\\", "/") === "404.html";

  if (!/^<!doctype html>/i.test(source.trimStart())) {
    issues.push(createIssue(relativePath, "Missing HTML5 doctype"));
  }
  if (!/<html\s[^>]*lang=["'][a-z]{2}(?:-[A-Z]{2})?["']/i.test(source)) {
    issues.push(createIssue(relativePath, "Missing or invalid html lang attribute"));
  }
  if (!/<meta\s+name=["']viewport["']/i.test(source)) {
    issues.push(createIssue(relativePath, "Missing viewport metadata"));
  }
  if (!/<meta\s+name=["']description["']/i.test(source)) {
    issues.push(createIssue(relativePath, "Missing description metadata"));
  }
  if (!isNotFoundPage && !/<link\s+rel=["']canonical["']/i.test(source)) {
    issues.push(createIssue(relativePath, "Missing canonical URL"));
  }
  if (isNotFoundPage && !/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(source)) {
    issues.push(createIssue(relativePath, "404 page must declare noindex"));
  }
  if ((source.match(/<h1\b/gi) ?? []).length !== 1) {
    issues.push(createIssue(relativePath, "Document must contain exactly one h1"));
  }
  if (!/<main\b/i.test(source)) {
    issues.push(createIssue(relativePath, "Missing main landmark"));
  }
  if (!/<a\s[^>]*class=["'][^"']*skip-link/i.test(source)) {
    issues.push(createIssue(relativePath, "Missing skip link"));
  }
  if (!hasSharedFocusStyle && !/:focus-visible\b/i.test(source)) {
    issues.push(createIssue(relativePath, "Missing explicit focus-visible style"));
  }
  if (/<time(?![^>]*\bdatetime=)[^>]*>/i.test(source)) {
    issues.push(createIssue(relativePath, "Every time element must have a datetime attribute"));
  }
  if (/href=["']data:image\/svg\+xml,/i.test(source)) {
    issues.push(createIssue(relativePath, "Inline data URL favicon is not allowed"));
  }
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(source)) {
    issues.push(createIssue(relativePath, "Google Fonts must not block rendering"));
  }

  return issues;
}

function getInternalLinks(source) {
  return [...source.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => match[1].trim())
    .filter(
      (href) =>
        href !== "" &&
        !href.startsWith("#") &&
        !/^(?:https?:|mailto:|tel:|data:)/i.test(href),
    );
}

function resolveInternalTarget(outputDir, sourceFile, href) {
  const cleanHref = href.split(/[?#]/, 1)[0];
  const decodedHref = decodeURIComponent(cleanHref);
  const relativeTarget = decodedHref.startsWith("/")
    ? decodedHref.slice(1)
    : path.join(path.dirname(sourceFile), decodedHref);
  const normalizedTarget = path.normalize(relativeTarget);

  if (normalizedTarget.startsWith("..") || path.isAbsolute(normalizedTarget)) {
    return null;
  }
  if (decodedHref.endsWith("/") || decodedHref === "/") {
    return path.join(outputDir, normalizedTarget, "index.html");
  }

  return path.join(outputDir, normalizedTarget);
}

async function validateInternalLinks(outputDir, htmlFiles, sourcesByFile) {
  const issues = [];

  for (const relativePath of htmlFiles) {
    const source = sourcesByFile.get(relativePath);
    for (const href of getInternalLinks(source)) {
      const target = resolveInternalTarget(outputDir, relativePath, href);
      if (!target || !(await pathExists(target))) {
        issues.push(createIssue(relativePath, `Broken internal link: ${href}`));
      }
    }
  }

  return issues;
}

async function validatePublishingOutput(outputDir, publishedSlugs, unpublishedSlugs) {
  const issues = [];

  for (const slug of publishedSlugs) {
    const postPath = path.join(outputDir, "blog", slug, "index.html");
    if (!(await pathExists(postPath))) {
      issues.push(createIssue(`blog/${slug}/index.html`, "Published post is missing from output"));
    }
  }
  for (const slug of unpublishedSlugs) {
    const postPath = path.join(outputDir, "blog", slug, "index.html");
    if (await pathExists(postPath)) {
      issues.push(createIssue(`blog/${slug}/index.html`, "Unpublished post is present in output"));
    }
  }

  return issues;
}

function validateUniqueTitles(htmlFiles, sourcesByFile) {
  const issues = [];
  const titleOwners = new Map();

  for (const relativePath of htmlFiles) {
    const source = sourcesByFile.get(relativePath);
    if (isRedirectPage(source)) {
      continue;
    }
    const title = getTitle(source);
    if (title === "") {
      issues.push(createIssue(relativePath, "Missing document title"));
      continue;
    }
    const existingOwner = titleOwners.get(title);
    if (existingOwner) {
      issues.push(createIssue(relativePath, `Duplicate title also used by ${existingOwner}`));
      continue;
    }
    titleOwners.set(title, relativePath.replaceAll("\\", "/"));
  }

  return issues;
}

export async function validateBuiltSite({ outputDir, publishedSlugs, unpublishedSlugs }) {
  const files = await collectFiles(outputDir);
  const htmlFiles = files.filter((file) => file.toLowerCase().endsWith(".html"));
  const cssFiles = files.filter((file) => file.toLowerCase().endsWith(".css"));
  const sourcesByFile = new Map();

  await Promise.all(
    htmlFiles.map(async (relativePath) => {
      const source = await readFile(path.join(outputDir, relativePath), "utf8");
      sourcesByFile.set(relativePath, source);
    }),
  );

  const cssSources = await Promise.all(
    cssFiles.map((relativePath) => readFile(path.join(outputDir, relativePath), "utf8")),
  );
  const hasSharedFocusStyle = cssSources.some((source) => /:focus-visible\b/i.test(source));

  const issues = [];
  for (const relativePath of htmlFiles) {
    const source = sourcesByFile.get(relativePath);
    if (!isRedirectPage(source)) {
      issues.push(...validateDocumentContract(relativePath, source, hasSharedFocusStyle));
    }
  }

  issues.push(...validateUniqueTitles(htmlFiles, sourcesByFile));
  issues.push(...(await validateInternalLinks(outputDir, htmlFiles, sourcesByFile)));
  issues.push(
    ...(await validatePublishingOutput(outputDir, publishedSlugs, unpublishedSlugs)),
  );

  return issues.sort(
    (left, right) => left.file.localeCompare(right.file) || left.message.localeCompare(right.message),
  );
}
