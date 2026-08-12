import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_POST_STATUSES = new Set(["draft", "scheduled", "published"]);
const HOME_POSTS_START = "<!-- HOME_POSTS_START -->";
const HOME_POSTS_END = "<!-- HOME_POSTS_END -->";
const BLOG_POSTS_START = "<!-- BLOG_POSTS_START -->";
const BLOG_POSTS_END = "<!-- BLOG_POSTS_END -->";

const STATIC_FILES = [
  "404.html",
  "CNAME",
  "robots.txt",
  "og.png",
  "favicon.svg",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "site.webmanifest",
  "_headers",
];

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function assertIsoDate(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${fieldName} must use YYYY-MM-DD`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function formatMonthYear(date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function replaceGeneratedBlock(source, startMarker, endMarker, generatedContent) {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Missing or invalid generated block: ${startMarker} ... ${endMarker}`);
  }

  const before = source.slice(0, startIndex + startMarker.length);
  const after = source.slice(endIndex);
  return `${before}\n${generatedContent}\n${after}`;
}

function getPublishedPosts(manifest) {
  return manifest.posts
    .filter((post) => post.status === "published")
    .map((post, index) => ({ ...post, manifestOrder: index }))
    .sort((left, right) => {
      const dateOrder = right.date.localeCompare(left.date);
      return dateOrder || left.manifestOrder - right.manifestOrder;
    });
}

function renderHomePosts(posts, limit) {
  return posts
    .slice(0, limit)
    .map(
      (post) =>
        `    <li><a href="/blog/${escapeHtml(post.slug)}/">${escapeHtml(post.title)}</a>` +
        `<time datetime="${post.date}">${formatMonthYear(post.date)}</time></li>`,
    )
    .join("\n");
}

function renderBlogPosts(posts, trackOrder) {
  const groupedPosts = new Map();
  for (const post of posts) {
    const postsForTrack = groupedPosts.get(post.track) ?? [];
    groupedPosts.set(post.track, [...postsForTrack, post]);
  }

  const remainingTracks = [...groupedPosts.keys()].filter((track) => !trackOrder.includes(track));
  const orderedTracks = [...trackOrder, ...remainingTracks];

  return orderedTracks
    .filter((track) => groupedPosts.has(track))
    .map((track) => {
      const renderedPosts = groupedPosts
        .get(track)
        .map(
          (post) => `  <a class="post" href="/blog/${escapeHtml(post.slug)}/">
    <div class="pt">${escapeHtml(post.title)}</div>
    <div class="pd">${escapeHtml(post.description)}</div>
    <time datetime="${post.date}">${formatMonthYear(post.date)}</time>
  </a>`,
        )
        .join("\n");

      return `<section>
  <h2 class="track">${escapeHtml(track)}</h2>
${renderedPosts}
</section>`;
    })
    .join("\n\n");
}

function renderFeed(manifest, posts) {
  const items = posts
    .map((post) => {
      const postUrl = `${manifest.site.url}/blog/${post.slug}/`;
      const publishedAt = new Date(`${post.date}T12:00:00Z`).toUTCString();
      return `  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${escapeXml(postUrl)}</link>
    <guid>${escapeXml(postUrl)}</guid>
    <pubDate>${publishedAt}</pubDate>
    <description>${escapeXml(post.description)}</description>
  </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeXml(manifest.site.feedTitle ?? manifest.site.title)}</title>
  <link>${escapeXml(`${manifest.site.url}/`)}</link>
  <description>${escapeXml(manifest.site.feedDescription ?? manifest.site.description)}</description>
  <language>${escapeXml(manifest.site.language)}</language>
  <atom:link href="${escapeXml(`${manifest.site.url}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;
}

function renderSitemap(manifest, posts) {
  const pageDates = manifest.site.pageDates ?? {};
  const latestPostDate = posts.at(0)?.date ?? pageDates.home ?? "1970-01-01";
  const staticPages = [
    { path: "/", lastModified: pageDates.home ?? latestPostDate, priority: "1.0", frequency: "monthly" },
    {
      path: "/services/",
      lastModified: pageDates.services ?? pageDates.home ?? latestPostDate,
      priority: "0.9",
      frequency: "monthly",
    },
    { path: "/blog/", lastModified: latestPostDate, priority: "0.9", frequency: "weekly" },
  ];
  const articlePages = posts.map((post) => ({
    path: `/blog/${post.slug}/`,
    lastModified: post.modified ?? post.date,
    priority: "0.8",
    frequency: "yearly",
  }));
  const urls = [...staticPages, ...articlePages]
    .map(
      (page) => `  <url>
    <loc>${escapeXml(`${manifest.site.url}${page.path}`)}</loc>
    <lastmod>${page.lastModified}</lastmod>
    <changefreq>${page.frequency}</changefreq>
    <priority>${page.priority}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(sourceDirectory, destinationDirectory) {
  await mkdir(destinationDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }
    if (entry.isFile()) {
      if (entry.name.toLowerCase().endsWith(".html")) {
        const htmlSource = await readFile(sourcePath, "utf8");
        await writeFile(destinationPath, htmlSource.replace(/^\uFEFF/, ""), "utf8");
      } else {
        await copyFile(sourcePath, destinationPath);
      }
    }
  }
}

async function copyFileWhenPresent(rootDir, outputDir, relativePath) {
  const sourcePath = path.join(rootDir, relativePath);
  if (!(await pathExists(sourcePath))) {
    return;
  }

  const destinationPath = path.join(outputDir, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

async function copyLegacyRedirects(rootDir, outputDir) {
  const blogDirectory = path.join(rootDir, "blog");
  const entries = await readdir(blogDirectory, { withFileTypes: true });
  const redirectFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".html") && entry.name !== "index.html",
  );

  for (const redirectFile of redirectFiles) {
    await copyFileWhenPresent(rootDir, outputDir, path.join("blog", redirectFile.name));
  }
}

function assertSafeOutputDirectory(rootDir, outputDir) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedOutput = path.resolve(outputDir);

  if (path.basename(resolvedOutput) !== "_site" || path.dirname(resolvedOutput) !== resolvedRoot) {
    throw new Error("Output directory must be named _site and live directly under the project root");
  }
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be an object");
  }

  const { site, posts } = manifest;
  if (!site || typeof site !== "object") {
    throw new Error("Manifest site settings are required");
  }
  for (const field of ["title", "description", "url", "language"]) {
    assertNonEmptyString(site[field], `site.${field}`);
  }
  if (!site.url.startsWith("https://")) {
    throw new Error("site.url must use HTTPS");
  }
  if (site.pageDates !== undefined) {
    if (!site.pageDates || typeof site.pageDates !== "object") {
      throw new Error("site.pageDates must be an object");
    }
    assertIsoDate(site.pageDates.home, "site.pageDates.home");
    assertIsoDate(site.pageDates.services, "site.pageDates.services");
  }

  if (!Array.isArray(posts)) {
    throw new Error("Manifest posts must be an array");
  }

  const seenSlugs = new Set();
  for (const [index, post] of posts.entries()) {
    for (const field of ["slug", "title", "description", "track", "status"]) {
      assertNonEmptyString(post[field], `posts[${index}].${field}`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) {
      throw new Error(`Invalid post slug: ${post.slug}`);
    }
    if (seenSlugs.has(post.slug)) {
      throw new Error(`Duplicate post slug: ${post.slug}`);
    }
    seenSlugs.add(post.slug);
    assertIsoDate(post.date, `posts[${index}].date`);
    if (post.modified !== undefined) {
      assertIsoDate(post.modified, `posts[${index}].modified`);
    }
    if (!ALLOWED_POST_STATUSES.has(post.status)) {
      throw new Error(`Invalid post status for ${post.slug}: ${post.status}`);
    }
  }

  return manifest;
}

export async function loadManifest(rootDir) {
  const manifestPath = path.join(rootDir, "content", "posts.json");
  const manifestSource = await readFile(manifestPath, "utf8");
  return validateManifest(JSON.parse(manifestSource));
}

export async function buildSite({ rootDir, outputDir }) {
  assertSafeOutputDirectory(rootDir, outputDir);
  const manifest = await loadManifest(rootDir);
  const publishedPosts = getPublishedPosts(manifest);

  for (const post of publishedPosts) {
    const sourcePath = path.join(rootDir, "blog", post.slug, "index.html");
    if (!(await pathExists(sourcePath))) {
      throw new Error(`Missing published post source: blog/${post.slug}/index.html`);
    }
  }

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  const homeSource = await readFile(path.join(rootDir, "index.html"), "utf8");
  const blogSource = await readFile(path.join(rootDir, "blog", "index.html"), "utf8");
  const homeOutput = replaceGeneratedBlock(
    homeSource,
    HOME_POSTS_START,
    HOME_POSTS_END,
    renderHomePosts(publishedPosts, manifest.site.homePostLimit ?? 6),
  );
  const blogOutput = replaceGeneratedBlock(
    blogSource,
    BLOG_POSTS_START,
    BLOG_POSTS_END,
    renderBlogPosts(publishedPosts, manifest.site.trackOrder ?? []),
  );

  await writeFile(path.join(outputDir, "index.html"), homeOutput, "utf8");
  await mkdir(path.join(outputDir, "blog"), { recursive: true });
  await writeFile(path.join(outputDir, "blog", "index.html"), blogOutput, "utf8");
  await writeFile(path.join(outputDir, "feed.xml"), renderFeed(manifest, publishedPosts), "utf8");
  await writeFile(path.join(outputDir, "sitemap.xml"), renderSitemap(manifest, publishedPosts), "utf8");
  await writeFile(path.join(outputDir, ".nojekyll"), "", "utf8");

  await copyDirectory(path.join(rootDir, "services"), path.join(outputDir, "services"));
  if (await pathExists(path.join(rootDir, "assets"))) {
    await copyDirectory(path.join(rootDir, "assets"), path.join(outputDir, "assets"));
  }
  await copyLegacyRedirects(rootDir, outputDir);
  await Promise.all(STATIC_FILES.map((file) => copyFileWhenPresent(rootDir, outputDir, file)));

  for (const post of publishedPosts) {
    await copyDirectory(
      path.join(rootDir, "blog", post.slug),
      path.join(outputDir, "blog", post.slug),
    );
  }

  return { manifest, publishedPosts };
}
