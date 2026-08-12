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
  assert.match(
    workflow,
    /actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9/,
  );
  assert.match(workflow, /path: github-pages-fallback/);
  assert.match(
    workflow,
    /publish-github-pages-fallback:\s*\n\s+if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}\s*\n\s+needs: deploy[\s\S]*?permissions:\s*\n\s+pages: write\s*\n\s+id-token: write[\s\S]*?environment:\s*\n\s+name: github-pages/,
  );
  assert.match(
    workflow,
    /actions\/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128/,
  );
  assert.equal(workflow.match(/pages:\s*write/g)?.length, 1);
  assert.equal(workflow.match(/id-token:\s*write/g)?.length, 1);
});
