import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://maciejlewandowski.dev/";
const personId = `${siteUrl}#person`;
const profilePageId = `${siteUrl}#profile`;
const websiteId = `${siteUrl}#website`;

async function readHomepageStructuredData() {
  const homepage = await readFile(path.join(projectRoot, "index.html"), "utf8");
  const matches = [
    ...homepage.matchAll(
      /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi,
    ),
  ];

  assert.equal(matches.length, 1, "homepage must expose one JSON-LD graph");
  return JSON.parse(matches[0][1]);
}

async function readContentManifest() {
  const source = await readFile(path.join(projectRoot, "content", "posts.json"), "utf8");
  return JSON.parse(source);
}

test("homepage connects the website and profile page to Maciej Lewandowski", async () => {
  const structuredData = await readHomepageStructuredData();

  assert.equal(structuredData["@context"], "https://schema.org");
  assert.ok(Array.isArray(structuredData["@graph"]));

  const entitiesById = new Map(
    structuredData["@graph"].map((entity) => [entity["@id"], entity]),
  );
  const person = entitiesById.get(personId);
  const profilePage = entitiesById.get(profilePageId);
  const website = entitiesById.get(websiteId);

  assert.deepEqual(
    {
      name: website?.name,
      publisher: website?.publisher,
      type: website?.["@type"],
      url: website?.url,
    },
    {
      name: "Maciej Lewandowski",
      publisher: { "@id": personId },
      type: "WebSite",
      url: siteUrl,
    },
  );
  assert.deepEqual(
    {
      isPartOf: profilePage?.isPartOf,
      mainEntity: profilePage?.mainEntity,
      type: profilePage?.["@type"],
      url: profilePage?.url,
    },
    {
      isPartOf: { "@id": websiteId },
      mainEntity: { "@id": personId },
      type: "ProfilePage",
      url: siteUrl,
    },
  );
  assert.deepEqual(
    {
      name: person?.name,
      sameAs: person?.sameAs,
      type: person?.["@type"],
      url: person?.url,
    },
    {
      name: "Maciej Lewandowski",
      sameAs: [
        "https://www.linkedin.com/in/maciejlewandowsky/",
        "https://github.com/NiceLeader",
      ],
      type: "Person",
      url: siteUrl,
    },
  );
});

test("content metadata covers the homepage identity update and curates published links", async () => {
  const manifest = await readContentManifest();
  const publishedPosts = manifest.posts.filter((post) => post.status === "published");

  assert.ok(
    manifest.site.pageDates.home >= "2026-08-13",
    "home lastmod must include the significant identity graph update",
  );
  for (const post of publishedPosts) {
    assert.ok(Array.isArray(post.related), `${post.slug} must define related posts`);
    assert.ok(post.related.length >= 1, `${post.slug} must link to related content`);
    assert.ok(post.related.length <= 3, `${post.slug} must keep related content focused`);
  }
});
