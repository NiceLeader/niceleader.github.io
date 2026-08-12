import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("production workflow deploys only the verified artifact to Cloudflare Pages", async () => {
  const workflow = await readFile(
    path.join(projectRoot, ".github", "workflows", "pages.yml"),
    "utf8",
  );

  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm run lighthouse/);
  assert.match(
    workflow,
    /cloudflare\/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd/,
  );
  assert.match(workflow, /wranglerVersion: "4\.122\.0"/);
  assert.match(workflow, /apiToken: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(workflow, /accountId: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(
    workflow,
    /command: pages deploy _site --project-name=maciejlewandowski-dev --branch=main --commit-hash=\$\{\{ github\.sha \}\}/,
  );
  assert.doesNotMatch(workflow, /actions\/deploy-pages|actions\/upload-pages-artifact/);
  assert.doesNotMatch(workflow, /pages:\s*write|id-token:\s*write/);
});
