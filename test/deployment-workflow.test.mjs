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
    /deploy:\s*\n\s+if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}\s*\n\s+environment:/,
  );
  assert.match(workflow, /environment:\s*\n\s+name: production/);
  assert.match(
    workflow,
    /cloudflare\/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0/,
  );
  assert.match(workflow, /wranglerVersion: "4\.122\.0"/);
  assert.match(workflow, /apiToken: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(workflow, /accountId: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(
    workflow,
    /command: pages deploy _site --project-name=maciejlewandowski-dev --branch=main --commit-hash=\$\{\{ github\.sha \}\}/,
  );
  assert.doesNotMatch(workflow, /actions\/upload-pages-artifact@/);
  assert.doesNotMatch(workflow, /actions\/deploy-pages@/);
  assert.doesNotMatch(workflow, /github-pages-fallback/);
  assert.doesNotMatch(workflow, /publish-github-pages/);
  assert.doesNotMatch(workflow, /pages:\s*write/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /name:\s*github-pages/);
});

test("pull request checks avoid duplicating the main deployment work", async () => {
  const workflow = await readFile(
    path.join(projectRoot, ".github", "workflows", "quality.yml"),
    "utf8",
  );

  assert.match(workflow, /on:\s*\n\s+pull_request:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /npm run check/);
  assert.doesNotMatch(workflow, /npm run lighthouse/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
});
