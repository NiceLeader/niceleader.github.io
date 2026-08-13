import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderSecurityHeaders } from "./security-headers.mjs";

const ALLOWED_POST_STATUSES = new Set(["draft", "scheduled", "published"]);
const ALLOWED_ARTICLE_TYPES = new Set(["Article", "BlogPosting", "TechArticle"]);
const HOME_POSTS_START = "<!-- HOME_POSTS_START -->";
const HOME_POSTS_END = "<!-- HOME_POSTS_END -->";
const BLOG_POSTS_START = "<!-- BLOG_POSTS_START -->";
const BLOG_POSTS_END = "<!-- BLOG_POSTS_END -->";

const STATIC_FILES = [
  "404.html",
  "robots.txt",
  "og.png",
  "favicon.svg",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "site.webmanifest",
];

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function assertIsoDate(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  const parsedDate = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsedDate.valueOf()) ||
    parsedDate.toISOString().slice(0, 10) !== value
  ) {
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

function serializeJsonForHtml(value) {
  return JSON.stringify(value, null, 2)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
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

function getSiteRootUrl(siteUrl) {
  return `${siteUrl.replace(/\/+$/, "")}/`;
}

function readArticleStructuredData(source, post) {
  const scriptPattern = /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi;
  const matches = [...source.matchAll(scriptPattern)];
  if (matches.length !== 1) {
    throw new Error(`Published post ${post.slug} must contain exactly one JSON-LD script`);
  }

  let sourceData;
  try {
    sourceData = JSON.parse(matches[0][1]);
  } catch (error) {
    throw new Error(`Published post ${post.slug} contains invalid JSON-LD`, { cause: error });
  }

  if (!ALLOWED_ARTICLE_TYPES.has(sourceData["@type"])) {
    throw new Error(`Published post ${post.slug} must use Article structured data`);
  }
  if (!sourceData.author || typeof sourceData.author !== "object") {
    throw new Error(`Published post ${post.slug} must define its author`);
  }
  assertNonEmptyString(sourceData.author.name, `post ${post.slug} author.name`);
  assertNonEmptyString(sourceData.author.url, `post ${post.slug} author.url`);

  return { matchedScript: matches[0][0], sourceData };
}

function createArticleEntity({ articleType, manifest, personId, post, postUrl, siteRootUrl }) {
  return {
    "@type": articleType,
    "@id": `${postUrl}#article`,
    url: postUrl,
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    ...(post.modified ? { dateModified: post.modified } : {}),
    inLanguage: manifest.site.language,
    author: { "@id": personId },
    publisher: { "@id": personId },
    mainEntityOfPage: { "@id": postUrl },
    isPartOf: { "@id": `${siteRootUrl}#website` },
  };
}

function createBreadcrumbEntity(post, postUrl, siteRootUrl) {
  return {
    "@type": "BreadcrumbList",
    "@id": `${postUrl}#breadcrumb`,
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Writing",
        item: `${siteRootUrl}blog/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: post.title,
        item: postUrl,
      },
    ],
  };
}

function createArticleStructuredData(manifest, post, sourceData) {
  const siteRootUrl = getSiteRootUrl(manifest.site.url);
  const postUrl = `${siteRootUrl}blog/${post.slug}/`;
  const personId = `${siteRootUrl}#person`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      createArticleEntity({
        articleType: sourceData["@type"],
        manifest,
        personId,
        post,
        postUrl,
        siteRootUrl,
      }),
      {
        "@type": "Person",
        "@id": personId,
        name: sourceData.author.name,
        url: sourceData.author.url,
      },
      createBreadcrumbEntity(post, postUrl, siteRootUrl),
    ],
  };
}

function replaceArticleStructuredData(source, manifest, post) {
  const { matchedScript, sourceData } = readArticleStructuredData(source, post);
  const structuredData = createArticleStructuredData(manifest, post, sourceData);
  const replacement = `<script type="application/ld+json">\n${serializeJsonForHtml(structuredData)}\n</script>`;

  return source.replace(matchedScript, replacement);
}

function renderRelatedPosts(post, publishedPostsBySlug) {
  if (!post.related || post.related.length === 0) {
    return "";
  }

  const items = post.related
    .map((slug) => publishedPostsBySlug.get(slug))
    .map(
      (relatedPost) =>
        `  <li><a href="/blog/${escapeHtml(relatedPost.slug)}/">${escapeHtml(relatedPost.title)}</a>` +
        ` — ${escapeHtml(relatedPost.description)}</li>`,
    )
    .join("\n");

  return `<section class="related-notes" aria-labelledby="related-notes-heading">
<h2 id="related-notes-heading">Related field notes</h2>
<ul>
${items}
</ul>
</section>`;
}

function insertBeforeClosingArticle(source, generatedContent, post) {
  if (generatedContent === "") {
    return source;
  }

  const closingTags = [...source.matchAll(/<\/article>/gi)];
  if (closingTags.length !== 1) {
    throw new Error(`Published post ${post.slug} must contain exactly one closing article tag`);
  }

  return source.replace(closingTags[0][0], `${generatedContent}\n\n${closingTags[0][0]}`);
}

function renderPublishedPost(source, manifest, post, publishedPostsBySlug) {
  const withStructuredData = replaceArticleStructuredData(source, manifest, post);
  return insertBeforeClosingArticle(
    withStructuredData,
    renderRelatedPosts(post, publishedPostsBySlug),
    post,
  );
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

async function collectHtmlSources(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nestedSources = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return collectHtmlSources(entryPath);
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        return [await readFile(entryPath, "utf8")];
      }
      return [];
    }),
  );
  return nestedSources.flat();
}

async function copyLegacyRedirects(rootDir, outputDir, publishedPosts) {
  const blogDirectory = path.join(rootDir, "blog");
  const entries = await readdir(blogDirectory, { withFileTypes: true });
  const publishedSlugs = new Set(publishedPosts.map((post) => post.slug));
  const redirectFiles = entries.filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".html") &&
      publishedSlugs.has(path.basename(entry.name, ".html")),
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
    if (post.related !== undefined) {
      if (!Array.isArray(post.related)) {
        throw new Error(`posts[${index}].related must be an array`);
      }
      if (post.related.length > 3) {
        throw new Error(`Post ${post.slug} cannot define more than 3 related posts`);
      }
      const seenRelatedSlugs = new Set();
      for (const [relatedIndex, relatedSlug] of post.related.entries()) {
        assertNonEmptyString(relatedSlug, `posts[${index}].related[${relatedIndex}]`);
        if (relatedSlug === post.slug) {
          throw new Error(`Post ${post.slug} cannot reference itself as related content`);
        }
        if (seenRelatedSlugs.has(relatedSlug)) {
          throw new Error(`Duplicate related post for ${post.slug}: ${relatedSlug}`);
        }
        seenRelatedSlugs.add(relatedSlug);
      }
    }
  }

  const postsBySlug = new Map(posts.map((post) => [post.slug, post]));
  for (const post of posts) {
    for (const relatedSlug of post.related ?? []) {
      const relatedPost = postsBySlug.get(relatedSlug);
      if (!relatedPost) {
        throw new Error(`Post ${post.slug} references unknown post: ${relatedSlug}`);
      }
      if (post.status === "published" && relatedPost.status !== "published") {
        throw new Error(
          `Published post ${post.slug} related link must reference a published post: ${relatedSlug}`,
        );
      }
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
  const publishedPostsBySlug = new Map(publishedPosts.map((post) => [post.slug, post]));

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
  await copyLegacyRedirects(rootDir, outputDir, publishedPosts);
  await Promise.all(STATIC_FILES.map((file) => copyFileWhenPresent(rootDir, outputDir, file)));

  for (const post of publishedPosts) {
    const sourceDirectory = path.join(rootDir, "blog", post.slug);
    const destinationDirectory = path.join(outputDir, "blog", post.slug);
    await copyDirectory(sourceDirectory, destinationDirectory);
    const source = await readFile(path.join(sourceDirectory, "index.html"), "utf8");
    await writeFile(
      path.join(destinationDirectory, "index.html"),
      renderPublishedPost(source.replace(/^\uFEFF/, ""), manifest, post, publishedPostsBySlug),
      "utf8",
    );
  }

  const htmlSources = await collectHtmlSources(outputDir);
  await writeFile(
    path.join(outputDir, "_headers"),
    renderSecurityHeaders(htmlSources),
    "utf8",
  );

  return { manifest, publishedPosts };
}
