// Reads on-chain totalSupply for the euro e-money tokens listed in tokens.json,
// appends one snapshot to content/supply/snapshots.jsonl, rewrites
// content/supply/latest.json and renders eur-stablecoins/index.html.
//
// Facts only: the page shows what the contract returned at a stated block next to
// verbatim, linked quotes from the issuer. No ratios, no verdicts.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..", "..");
const registryPath = path.join(scriptDir, "tokens.json");
const dataDir = path.join(rootDir, "content", "supply");
const snapshotsPath = path.join(dataDir, "snapshots.jsonl");
const latestPath = path.join(dataDir, "latest.json");
const pagePath = path.join(rootDir, "eur-stablecoins", "index.html");

const TOTAL_SUPPLY_SELECTOR = "0x18160ddd";
const SITE_URL = "https://maciejlewandowski.dev";
const PAGE_URL = `${SITE_URL}/eur-stablecoins/`;

const registry = JSON.parse(await readFile(registryPath, "utf8"));
const rpcEndpoints = process.env.SUPPLY_RPC
  ? [process.env.SUPPLY_RPC, ...registry.rpcEndpoints]
  : registry.rpcEndpoints;

async function rpc(method, params) {
  let lastError;
  for (const endpoint of rpcEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        throw new Error(`${endpoint} responded ${response.status}`);
      }
      const payload = await response.json();
      if (payload.error) {
        throw new Error(`${endpoint} returned ${JSON.stringify(payload.error)}`);
      }
      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No RPC endpoint answered");
}

function formatUnits(rawHex, decimals) {
  const value = BigInt(rawHex);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const wholeText = whole.toLocaleString("en-US");
  if (decimals === 0) {
    return { display: wholeText, decimal: whole.toString() };
  }
  const fractionText = fraction.toString().padStart(decimals, "0");
  const shown = fractionText.slice(0, 2);
  return {
    display: `${wholeText}.${shown}`,
    decimal: `${whole.toString()}.${fractionText}`.replace(/\.?0+$/, ""),
  };
}

const latestBlock = await rpc("eth_getBlockByNumber", ["latest", false]);
const blockNumber = Number.parseInt(latestBlock.number, 16);
const blockTime = new Date(Number.parseInt(latestBlock.timestamp, 16) * 1000).toISOString();
const blockTag = latestBlock.number;

const readings = [];
for (const token of registry.tokens) {
  const raw = await rpc("eth_call", [{ to: token.contract, data: TOTAL_SUPPLY_SELECTOR }, blockTag]);
  if (typeof raw !== "string" || !/^0x[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(`Unexpected totalSupply response for ${token.symbol}: ${raw}`);
  }
  const { display, decimal } = formatUnits(raw, token.decimals);
  readings.push({
    symbol: token.symbol,
    contract: token.contract,
    decimals: token.decimals,
    totalSupplyRaw: BigInt(raw).toString(),
    totalSupply: decimal,
    totalSupplyDisplay: display,
  });
}

const snapshot = {
  takenAt: new Date().toISOString(),
  chainId: registry.chain.chainId,
  block: blockNumber,
  blockTime,
  rpc: rpcEndpoints[0],
  readings: readings.map(({ symbol, contract, totalSupplyRaw }) => ({ symbol, contract, totalSupplyRaw })),
};

await mkdir(dataDir, { recursive: true });

// One snapshot per UTC day: a rerun on the same day replaces that day's line.
const today = snapshot.takenAt.slice(0, 10);
let existingLines = [];
try {
  existingLines = (await readFile(snapshotsPath, "utf8"))
    .split("\n")
    .filter(Boolean)
    .filter((line) => JSON.parse(line).takenAt.slice(0, 10) !== today);
} catch {
  existingLines = [];
}
const allLines = [...existingLines, JSON.stringify(snapshot)];
await writeFile(snapshotsPath, `${allLines.join("\n")}\n`, "utf8");

const snapshotCount = allLines.length;
const firstSnapshotDate = JSON.parse(allLines[0]).takenAt.slice(0, 10);

const latest = { ...snapshot, readings, snapshotCount, firstSnapshotDate };
await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderRow(token, reading) {
  const factLines = [
    `          <span class="supply-label">On-chain totalSupply, Ethereum</span>`,
    `          <strong class="supply-number">${escapeHtml(reading.totalSupplyDisplay)}</strong>`,
    `          <span class="supply-fine">block ${blockNumber.toLocaleString("en-US")} · <a href="https://etherscan.io/token/${escapeHtml(token.contract)}" rel="noopener">${escapeHtml(token.contract)}</a> · address from <a href="${escapeHtml(token.contractSource)}" rel="noopener">issuer</a></span>`,
  ];
  if (token.contractNote) {
    factLines.push(`          <p class="supply-fine">${escapeHtml(token.contractNote)}</p>`);
  }
  const quoteLines = [
    `          <span class="supply-label">Issuer statement, verbatim</span>`,
    `          <blockquote><q>${escapeHtml(token.statement.quote)}</q> <a href="${escapeHtml(token.statement.url)}" rel="noopener">source</a></blockquote>`,
    `          <p class="supply-fine"><span class="supply-label">Reserve reporting</span> ${escapeHtml(token.attestation.quote)} <a href="${escapeHtml(token.attestation.url)}" rel="noopener">source</a></p>`,
    `          <p class="supply-fine"><span class="supply-label">Regulatory status</span> ${escapeHtml(token.regulatoryStatus)}</p>`,
  ];
  if (token.notice) {
    quoteLines.push(
      `          <p class="supply-notice"><span class="supply-label">Issuer notice</span> <q>${escapeHtml(token.notice.quote)}</q> <a href="${escapeHtml(token.notice.url)}" rel="noopener">source</a></p>`,
    );
  }
  return [
    `      <article class="supply-row" id="${escapeHtml(token.symbol.toLowerCase())}">`,
    `        <div class="supply-head">`,
    `          <h2>${escapeHtml(token.symbol)} <span class="supply-name">${escapeHtml(token.name)}</span></h2>`,
    `          <p class="supply-issuer">${escapeHtml(token.issuer)}</p>`,
    `        </div>`,
    `        <div class="supply-fact">`,
    ...factLines,
    `        </div>`,
    `        <div class="supply-quote">`,
    ...quoteLines,
    `        </div>`,
    `      </article>`,
  ].join("\n");
}

const rows = registry.tokens
  .map((token) => renderRow(token, readings.find((reading) => reading.symbol === token.symbol)))
  .join("\n");

const updatedDate = snapshot.takenAt.slice(0, 10);
const blockTimeDisplay = blockTime.replace("T", " ").slice(0, 16) + " UTC";

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>Euro Stablecoin Supply</title>
<meta name="description" content="Daily on-chain totalSupply of euro e-money tokens on Ethereum (EURC, EURCV, EURR, EURQ, EURAU, EURe) shown next to each issuer's own reserve statement, quoted verbatim with source.">
<link rel="canonical" href="${PAGE_URL}">
<meta property="og:type" content="website">
<meta property="og:title" content="Euro Stablecoin Supply">
<meta property="og:description" content="On-chain supply of euro e-money tokens next to what their issuers publish. Facts and quotes, no verdicts.">
<meta property="og:url" content="${PAGE_URL}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Euro stablecoin supply monitor by Maciej Lewandowski">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE_URL}/og.png">
<meta name="twitter:image:alt" content="Euro stablecoin supply monitor by Maciej Lewandowski">
<meta name="theme-color" content="#0b0c0e">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/supply.css">
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"92728f4c07bb4620a6b29641e7008b91"}'></script>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="wrap">
  <nav class="site-nav" aria-label="Primary">
    <a class="brand" href="/">Maciej Lewandowski</a>
    <div class="nav-links">
      <a href="/services/">Services</a>
      <a href="/blog/">Writing</a>
      <a href="/eur-stablecoins/" aria-current="page">Supply</a>
      <a href="https://github.com/NiceLeader">GitHub</a>
      <a href="https://www.linkedin.com/in/maciejlewandowsky/">LinkedIn</a>
    </div>
  </nav>

  <main id="main-content">
    <header class="hero">
      <p class="eyebrow">Ethereum mainnet · read daily · facts and quotes only</p>
      <h1>Euro stablecoin supply</h1>
      <p class="lede">Six euro e-money tokens issued under MiCA. For each one: the <code>totalSupply</code>
      the contract returned at a stated block, next to the issuer's own reserve statement quoted word for word,
      with a link to where it was published.</p>
      <p class="proof">Last read <time datetime="${escapeHtml(blockTime)}">${escapeHtml(blockTimeDisplay)}</time>
      at block ${blockNumber.toLocaleString("en-US")}. Snapshots taken daily since
      <time datetime="${escapeHtml(firstSnapshotDate)}">${escapeHtml(firstSnapshotDate)}</time> (${snapshotCount} so far).
      Ethereum only; supply on other chains is not included.</p>
    </header>

    <section class="section supply-list" aria-label="Tokens">
${rows}
    </section>

    <section class="section" aria-labelledby="reading-heading">
      <h2 class="section-label" id="reading-heading">How to read this page</h2>
      <p>The number is what the token contract reports as its total supply on Ethereum at the block shown.
      It is read directly from a public node and stored unchanged. The quote is the issuer's own wording about
      reserves, copied from the linked page on <time datetime="${escapeHtml(registry.statementsCheckedOn)}">${escapeHtml(registry.statementsCheckedOn)}</time>.
      Issuers report reserves for all chains together and on their own schedule, so the two figures are not
      expected to match on any given day. The page does not compare them for you.</p>
      <p>Issuer, and something here is out of date? Write to
      <a href="mailto:contact@maciejlewandowski.dev">contact@maciejlewandowski.dev</a> and it is corrected the same day.</p>
    </section>

    <section class="section" aria-labelledby="scope-heading">
      <h2 class="section-label" id="scope-heading">What this page is not</h2>
      <p class="supply-legal">This page shows on-chain facts only (the <code>totalSupply</code> value read from each contract
      at the stated block) and verbatim quotes from issuers' public statements with links to the source. It is not an
      audit, an attestation, a proof of reserves or an assessment of reserve coverage. It makes no claim about any
      issuer's reserves, solvency or compliance. Contract addresses come from issuer publications; verify them yourself
      before relying on them.</p>
    </section>
  </main>

  <footer class="site-footer">
    <p>Maintained by <a href="/">Maciej Lewandowski</a>. Related notes: <a href="/blog/point-in-time-balances/">point-in-time balances</a>,
    <a href="/blog/deposit-detection/">deposit detection</a>. Data updated <time datetime="${escapeHtml(updatedDate)}">${escapeHtml(updatedDate)}</time>.</p>
  </footer>
</div>
</body>
</html>
`;

await mkdir(path.dirname(pagePath), { recursive: true });
await writeFile(pagePath, page, "utf8");

console.log(`Snapshot at block ${blockNumber} (${blockTime}); ${readings.length} tokens; ${snapshotCount} snapshots total`);
for (const reading of readings) {
  console.log(`  ${reading.symbol.padEnd(6)} ${reading.totalSupplyDisplay}`);
}
