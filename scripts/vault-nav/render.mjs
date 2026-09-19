// Renders vault-nav/index.html from the daily series CSVs in content/vault-nav/series/.
// The CSVs are produced locally by the vault-nav tool (one pinned block per UTC day, 2-of-N RPC quorum)
// and copied here unchanged; this script only draws them. Facts only: the vault's own reported price
// next to an independent recomputation from chain state, with the gap in basis points. No verdicts.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..", "..");
const seriesDir = path.join(rootDir, "content", "vault-nav", "series");
const registryPath = path.join(scriptDir, "vaults.json");
const latestPath = path.join(rootDir, "content", "vault-nav", "latest.json");
const pagePath = path.join(rootDir, "vault-nav", "index.html");
const SITE_URL = "https://maciejlewandowski.dev";
const PAGE_URL = `${SITE_URL}/vault-nav/`;

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') { quoted = false; }
      else { field += c; }
    } else if (c === '"') { quoted = true; }
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") { field += c; }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtPrice = (s) => Number(s).toFixed(6);
const fmtBps = (s) => { const n = Number(s); return `${n > 0 ? "+" : ""}${n.toFixed(1)}`; };
const fmtInt = (s) => Number(s).toLocaleString("en-US");
const median = (xs) => { const a = [...xs].sort((p, q) => p - q); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function chart(rows) {
  // Two panels in one SVG: prices on top, gap in bps below. Presentation attributes only (CSP forbids style attributes).
  const W = 920, PAD_L = 62, PAD_R = 16, TOP_H = 250, GAP_H = 130, PAD_T = 18, MID = 34, PAD_B = 44;
  const H = PAD_T + TOP_H + MID + GAP_H + PAD_B;
  const n = rows.length;
  const x = (i) => PAD_L + (n === 1 ? 0 : (i * (W - PAD_L - PAD_R)) / (n - 1));
  const rep = rows.map((r) => Number(r.reported)), par = rows.map((r) => Number(r.par)), fee = rows.map((r) => Number(r.feeds));
  const all = [...rep, ...par, ...fee];
  let lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(hi - lo, 0.0005); lo -= span * 0.08; hi += span * 0.08;
  const y = (v) => PAD_T + TOP_H - ((v - lo) / (hi - lo)) * TOP_H;
  const line = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const pb = rows.map((r) => Number(r.par_bps)), fb = rows.map((r) => Number(r.feeds_bps));
  const bMax = Math.max(10, ...pb.map(Math.abs), ...fb.map(Math.abs));
  const gTop = PAD_T + TOP_H + MID, gZero = gTop + GAP_H / 2;
  const yb = (v) => gZero - (v / bMax) * (GAP_H / 2);
  const bw = Math.max(1.5, Math.min(6, ((W - PAD_L - PAD_R) / n) * 0.36));
  const ticks = 4;
  let g = "";
  for (let t = 0; t <= ticks; t += 1) {
    const v = lo + ((hi - lo) * t) / ticks, yy = y(v);
    g += `<line class="vn-grid" x1="${PAD_L}" x2="${W - PAD_R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`;
    g += `<text class="vn-tick" x="${PAD_L - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${v.toFixed(4)}</text>`;
  }
  for (const v of [-bMax, 0, bMax]) {
    const yy = yb(v);
    g += `<line class="${v === 0 ? "vn-zero" : "vn-grid"}" x1="${PAD_L}" x2="${W - PAD_R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`;
    g += `<text class="vn-tick" x="${PAD_L - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${v > 0 ? "+" : ""}${Math.round(v)}</text>`;
  }
  const step = Math.max(1, Math.ceil(n / 6));
  for (let i = 0; i < n - Math.ceil(step / 2); i += step) {
    g += `<text class="vn-tick" x="${x(i).toFixed(1)}" y="${H - PAD_B + 18}" text-anchor="middle">${rows[i].date.slice(5)}</text>`;
  }
  g += `<text class="vn-tick" x="${x(n - 1).toFixed(1)}" y="${H - PAD_B + 18}" text-anchor="middle">${rows[n - 1].date.slice(5)}</text>`;
  let bars = "";
  rows.forEach((_, i) => {
    const xx = x(i);
    for (const [vals, cls, off] of [[pb, "vn-bar-par", -bw / 2 - 0.5], [fb, "vn-bar-feeds", 0.5]]) {
      const v = vals[i], y0 = yb(Math.max(v, 0)), hgt = Math.abs(yb(v) - yb(0));
      bars += `<rect class="${cls}" x="${(xx + off - (off < 0 ? 0 : 0)).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(hgt, 0.5).toFixed(1)}"/>`;
    }
  });
  return `<svg class="vn-chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t-${rows[0].vault}" preserveAspectRatio="xMidYMid meet">
<title id="t-${rows[0].vault}">${escapeHtml(rows[0].vault)}: reported price and recomputed NAV per share, then the gap in basis points, one point per UTC day</title>
${g}
<path class="vn-line-par" d="${line(par)}"/>
<path class="vn-line-feeds" d="${line(fee)}"/>
<path class="vn-line-rep" d="${line(rep)}"/>
${bars}
<text class="vn-axis" x="${PAD_L}" y="${PAD_T - 6}">${escapeHtml(rows[0].numeraire)} per share</text>
<text class="vn-axis" x="${PAD_L}" y="${gTop - 8}">recomputed minus reported, bps</text>
</svg>`;
}

function vaultSection(v, rows) {
  const last = rows[rows.length - 1];
  const pb = rows.map((r) => Number(r.par_bps)), fb = rows.map((r) => Number(r.feeds_bps));
  const maxAbs = (xs) => xs.reduce((m, c) => (Math.abs(c) > Math.abs(m) ? c : m), 0);
  const worstPar = maxAbs(pb), worstDay = rows[pb.indexOf(worstPar)].date;
  const limits = (() => { try { return JSON.parse(last.limitations); } catch { return null; } })();
  const excluded = limits?.excluded ?? [];
  return `      <article class="vn-vault" id="${escapeHtml(v.id)}">
        <div class="vn-head">
          <h2>${escapeHtml(v.id)} <span class="supply-name">${escapeHtml(v.name)}</span></h2>
          <p class="supply-issuer">${escapeHtml(v.operator)} · ${escapeHtml(v.kind)}</p>
          <p class="supply-fine"><a href="https://etherscan.io/address/${escapeHtml(last.vault_address)}" rel="noopener">${escapeHtml(last.vault_address)}</a></p>
        </div>
        <div class="vn-facts">
          <div class="vn-fact"><span class="supply-label">Reported price, ${escapeHtml(last.date)}</span><strong class="supply-number">${fmtPrice(last.reported)}</strong><span class="supply-fine">block ${fmtInt(last.block)} · pushed ${Math.round(Number(last.reported_age_seconds) / 60)} min before the block</span></div>
          <div class="vn-fact"><span class="supply-label">Recomputed, debt at par</span><strong class="supply-number">${fmtPrice(last.par)}</strong><span class="supply-fine">${fmtBps(last.par_bps)} bps vs reported</span></div>
          <div class="vn-fact"><span class="supply-label">Recomputed, Chainlink feeds</span><strong class="supply-number">${fmtPrice(last.feeds)}</strong><span class="supply-fine">${fmtBps(last.feeds_bps)} bps vs reported</span></div>
        </div>
        ${chart(rows)}
        <p class="vn-legend"><span class="vn-key vn-key-rep">reported price</span> <span class="vn-key vn-key-par">recomputed, debt at par</span> <span class="vn-key vn-key-feeds">recomputed, Chainlink feeds</span></p>
        <p class="supply-fine">${rows.length} daily points, ${escapeHtml(rows[0].date)} to ${escapeHtml(last.date)}. Median gap ${fmtBps(median(pb))} bps (par), ${fmtBps(median(fb))} bps (feeds). Largest gap ${fmtBps(worstPar)} bps (par) on ${escapeHtml(worstDay)}.
        Not counted in the recomputation: ${excluded.map(escapeHtml).join("; ") || "see the evidence pack"}.
        <a href="/vault-nav/series/${escapeHtml(v.id)}.csv">Download the series (CSV)</a>.</p>
      </article>`;
}

const registry = JSON.parse(await readFile(registryPath, "utf8"));
const files = (await readdir(seriesDir)).filter((f) => f.endsWith(".csv"));
const sections = [];
const latest = { generatedAt: new Date().toISOString(), vaults: {} };
for (const v of registry.vaults) {
  const file = `series-${v.id}.csv`;
  if (!files.includes(file)) continue;
  const rows = parseCsv(await readFile(path.join(seriesDir, file), "utf8")).filter((r) => r.vault === v.id);
  if (!rows.length) continue;
  const last = rows[rows.length - 1];
  latest.vaults[v.id] = { date: last.date, block: Number(last.block), reported: last.reported, par: last.par, feeds: last.feeds, par_bps: last.par_bps, feeds_bps: last.feeds_bps, points: rows.length };
  sections.push(vaultSection(v, rows));
  await mkdir(path.join(rootDir, "vault-nav", "series"), { recursive: true });
  await writeFile(path.join(rootDir, "vault-nav", "series", `${v.id}.csv`), await readFile(path.join(seriesDir, file)));
}
const dates = Object.values(latest.vaults).map((x) => x.date).sort();
const lastDate = dates[dates.length - 1];
const totalPoints = Object.values(latest.vaults).reduce((s, x) => s + x.points, 0);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>Vault NAV Check</title>
<meta name="description" content="Daily independent recomputation of the net asset value of curated DeFi vaults on Ethereum (Gauntlet vaults used by Sky Yield+ and Grove) next to the price each vault reports, with the gap in basis points and downloadable evidence.">
<link rel="canonical" href="${PAGE_URL}">
<meta property="og:type" content="website">
<meta property="og:title" content="Vault NAV Check">
<meta property="og:description" content="Reported vault price next to an independent recomputation from chain state, every day, with the gap in basis points. Facts only.">
<meta property="og:url" content="${PAGE_URL}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Vault NAV check by Maciej Lewandowski">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE_URL}/og.png">
<meta name="twitter:image:alt" content="Vault NAV check by Maciej Lewandowski">
<meta name="theme-color" content="#0b0c0e">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/supply.css">
<link rel="stylesheet" href="/assets/vaultnav.css">
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
      <a href="/eur-stablecoins/">Supply</a>
      <a href="/vault-nav/" aria-current="page">Vault NAV</a>
      <a href="https://github.com/NiceLeader">GitHub</a>
      <a href="https://www.linkedin.com/in/maciejlewandowsky/">LinkedIn</a>
    </div>
  </nav>

  <main id="main-content">
    <header class="hero">
      <p class="eyebrow">Ethereum mainnet · one pinned block per UTC day · chain state only</p>
      <h1>Vault NAV check</h1>
      <p class="lede">Curated DeFi vaults publish a price per share. This page recomputes that price independently from what is on
      chain at the same block (Morpho Blue positions with interest accrued, sUSDS conversion, idle balances) and shows both numbers
      side by side, with the difference in basis points. Two valuations of the debt leg: at par, and with Chainlink USD feeds.</p>
      <p class="proof">Last point <time datetime="${lastDate}">${lastDate}</time>. ${Object.keys(latest.vaults).length} vaults,
      ${totalPoints} daily points so far. Every point comes from a 2-of-4 quorum of public RPC endpoints and leaves a canonical
      input set with a SHA-256 manifest, so anyone can re-derive it at the same block.</p>
    </header>

    <section class="section vn-list" aria-label="Vaults">
${sections.join("\n")}
    </section>

    <section class="section" aria-labelledby="reading-heading">
      <h2 class="section-label" id="reading-heading">How to read this page</h2>
      <p>The reported price is what the vault contract returned from its own state at the block shown, with the time since the
      operator last pushed it. The recomputed values are built from the vault's positions at that block: for each Morpho Blue
      market, supply and borrow shares converted to assets after accruing interest to the block; sUSDS converted to USDS through the
      contract's own rate; idle token balances at face value. Equity divided by total supply gives the price per share.
      A positive gap means the recomputation is above the reported price; negative means below.</p>
      <p>The two valuations differ only in how the borrowed asset is priced: at par (1 USDS = 1 USDT = 1 USDC) or with the
      Chainlink USD feeds read at the same block. On days when a vault holds only its own numeraire, all three numbers are identical
      to the last digit, which is the method's built-in sanity check.</p>
      <p>Operator of one of these vaults, or holder of a vault that should be here? Write to
      <a href="mailto:contact@maciejlewandowski.dev">contact@maciejlewandowski.dev</a>. A check for a new vault takes a day to set up.</p>
    </section>

    <section class="section" aria-labelledby="scope-heading">
      <h2 class="section-label" id="scope-heading">What this page is not</h2>
      <p class="supply-legal">This page reads chain state only. It does not see assets held outside the vault address (for example
      pending provisioner requests), accrued but unclaimed fees, or anything off chain, and those items are listed under each vault.
      A gap is a question for the operator, not a finding. Nothing here is a statement about solvency, about the quality of a
      strategy, or a recommendation to deposit or withdraw. Addresses come from the operators' public documentation and are recorded
      with their source in the evidence packs.</p>
    </section>
  </main>

  <footer class="site-footer">
    <p>Maciej Lewandowski · <a href="/eur-stablecoins/">Euro stablecoin supply</a> · <a href="https://github.com/NiceLeader">GitHub</a></p>
  </footer>
</div>
</body>
</html>
`;

await mkdir(path.dirname(pagePath), { recursive: true });
await writeFile(pagePath, html, "utf8");
await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
console.log(`rendered ${pagePath}: ${Object.keys(latest.vaults).length} vaults, ${totalPoints} points, last ${lastDate}`);
