// Token Radar — the whole entry for the token-radar-01 competition, one file.
//
// It reads a sealed snapshot of DeFi protocols, keeps the ones that record no token, ranks them by an
// implied value if they launched one, and writes the board, the dashboard's data file, a copy of the
// page and its screenshots, and finally the judge's dossier. Node 22+ runs this file as-is: the
// standard library only, erasable TypeScript, no build step and no install.
//
//   node main.ts --input ./snapshot.json --output ./out
//
// The dashboard reads window.RADAR from data.js; every name it reads is written here.

import { buildDossier } from './vendor/makefun-board.ts';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- the model, one definition

// The implied value, in words: take 45% of a protocol's TVL (the 0.45 base multiple), multiply it
// by the seven-day TVL growth factor (1 + change/100 x 1.55, with the change clamped to -50%..+150%),
// and multiply that by the maturity factor, which runs from 0.85 at day 0 up to 1.25 at 1095 days
// (0.85 + min(age, 1095)/1095 x 0.4) and stays there. Round to whole dollars, never below $1. A
// protocol with no listing date is scored at the model's unknown age of 180 days.

/** Every constant the implied value is made of; data.js carries the same numbers for the page. */
const MODEL = {
  base_multiple: 0.45,
  growth_weight: 1.55,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.85,
  maturity_days: 1095,
  maturity_range: 0.4,
  unknown_age_days: 180,
} as const;

/** A version string for the scoring function, shown in the page footer. */
const MODEL_VERSION = 'token-radar/1.1';

/** The board is refused below this many rows: a short board is not a radar. */
const MIN_ROWS = 100;

/** Categories that are never a protocol still waiting on its own token. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Names that carry a wrapped, staked or bridged product of another protocol, as a whole word. */
const EXCLUDED_NAME_WORDS = [
  'wrapped',
  'staked',
  'staking',
  'restaked',
  'canonical',
  'bridged',
  'wbtc',
  'weth',
  'steth',
  'reth',
  'cbeth',
];

const VERSIONED_POOL = /(?<![a-z0-9])v[234](?![a-z0-9])/;
const PLAIN_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_FARM_STEPS = 3;
const MAX_FARM_STEPS = 12;
const MIN_STEP_CHARS = 20;
const MAX_STEP_CHARS = 600;
const MIN_SCREENSHOTS = 3;

// ---------------------------------------------------------------- the shapes the snapshot has

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source?: string;
  floor_usd: number;
  watchlist: string[];
  protocols: Protocol[];
}

interface RowModel {
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: RowModel;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

interface LiveRow {
  name: string;
  mcap_usd: number | null;
  tvl_usd: number;
}

/** Why this run wrote nothing: one message, one stderr line, one non-zero exit. */
class RadarError extends Error {
  readonly code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.name = 'RadarError';
    this.code = code;
  }
}

// ---------------------------------------------------------------- command line

function parseArgs(argv: string[]): { input: string; output: string; verbose: boolean } {
  let input = '/input';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (name === 'verbose') {
      const flag = eq === -1 ? 'true' : arg.slice(eq + 1);
      verbose = flag !== 'false' && flag !== '0';
      continue;
    }
    let value = eq === -1 ? undefined : arg.slice(eq + 1);
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i++;
      }
    }
    if (value === undefined || value === '') continue;
    if (name === 'input') input = value;
    else if (name === 'output') output = value;
  }
  return { input, output, verbose };
}

/** A .json path is the snapshot itself; anything else is a directory holding snapshot.json. */
function resolveSnapshotPath(input: string): string {
  const absolute = resolve(input);
  if (existsSync(absolute)) {
    try {
      if (statSync(absolute).isDirectory()) return join(absolute, 'snapshot.json');
    } catch {
      /* fall through to the path as given */
    }
    return absolute;
  }
  return join(absolute, 'snapshot.json');
}

function loadSnapshot(input: string): Snapshot {
  const path = resolveSnapshotPath(input);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new RadarError(`snapshot not found: ${path}`, 2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new RadarError(`snapshot is not JSON: ${path}: ${(err as Error).message}`, 2);
  }
  const snap = parsed as Partial<Snapshot> | null;
  if (snap === null || typeof snap !== 'object' || !Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new RadarError(`snapshot has no protocols/watchlist: ${path}`, 2);
  }
  if (typeof snap.as_of !== 'string' || typeof snap.floor_usd !== 'number' || !Number.isFinite(snap.floor_usd)) {
    throw new RadarError(`snapshot has no as_of/floor_usd: ${path}`, 2);
  }
  return {
    as_of: snap.as_of,
    source: typeof snap.source === 'string' ? snap.source : `snapshot ${snap.as_of}`,
    floor_usd: snap.floor_usd,
    watchlist: snap.watchlist.filter((s): s is string => typeof s === 'string'),
    protocols: snap.protocols as Protocol[],
  };
}

// ---------------------------------------------------------------- who may be ranked

const wholeWordPattern = (word: string): RegExp => new RegExp(`(?<![a-z0-9])${word}(?![a-z0-9])`);

const EXCLUDED_NAME_PATTERNS = EXCLUDED_NAME_WORDS.map(wholeWordPattern);

/** A protocol records no token when it has neither a CoinGecko id nor a ticker. */
const isPreToken = (p: Protocol): boolean => p.gecko_id === null && p.symbol === null;

/** A protocol is a subject of the board when it is pre-token and not a wrapper, a bridge or a pool version. */
function isRankable(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  const name = String(p.name ?? '').toLowerCase();
  if (EXCLUDED_NAME_PATTERNS.some((re) => re.test(name))) return false;
  if (VERSIONED_POOL.test(name)) return false;
  return true;
}

// ---------------------------------------------------------------- the implied value

function daysBetween(listed_at: string | null, as_of: string): number | null {
  if (listed_at === null) return null;
  const from = Date.parse(`${listed_at}T00:00:00Z`);
  const to = Date.parse(`${as_of}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * implied = max(1, round(tvl * 0.45 * (1 + clamp(change_7d, -50, 150)/100 * 1.55)
 *                              * (0.85 + min(age_days, 1095)/1095 * 0.4)))
 * A protocol with no listing date is scored with the model's unknown age, 180 days.
 */
function score(p: Protocol, as_of: string): { implied: number; model: RowModel } {
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growth = clamp(rawGrowth, MODEL.growth_floor, MODEL.growth_cap);
  const age = daysBetween(p.listed_at, as_of);
  const maturityAge = clamp(age === null ? MODEL.unknown_age_days : age, 0, MODEL.maturity_days);
  const growthMultiplier = 1 + (growth / 100) * MODEL.growth_weight;
  const maturityMultiplier = MODEL.maturity_floor + (maturityAge / MODEL.maturity_days) * MODEL.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * MODEL.base_multiple * growthMultiplier * maturityMultiplier));
  return {
    implied,
    model: {
      base_multiple: MODEL.base_multiple,
      growth_pct: growth,
      growth_multiplier: round4(growthMultiplier),
      maturity_multiplier: round4(maturityMultiplier),
      age_days: age,
    },
  };
}

// ---------------------------------------------------------------- farm steps

/** The capital move that fits the protocol's own category. */
function capitalAction(category: string | null): string {
  switch (category) {
    case 'Dexs':
      return 'Swap $250 of USDC into the deepest pool and keep a $100 LP position in range';
    case 'Lending':
    case 'Collateral Markets':
      return 'Supply $250 of USDC as collateral and borrow $75 of ETH against it';
    case 'Uncollateralized Lending':
      return 'Lend $250 of USDC through the protocol and collect the interest';
    case 'Risk Curators':
      return 'Deposit $250 of USDC into one curated vault the protocol runs';
    case 'Onchain Capital Allocator':
      return 'Allocate $250 to one of the strategies the protocol lists';
    case 'RWA':
      return 'Buy $250 of the protocol\'s tokenised treasury product';
    case 'Yield':
      return 'Deposit $250 into the protocol\'s main yield pool';
    case 'Yield Aggregator':
      return 'Deposit $250 into the highest-TVL vault the aggregator lists';
    case 'Stablecoin Wrapper':
    case 'Dual-Token Stablecoin':
      return 'Mint $250 of the protocol\'s stablecoin against USDC';
    case 'Derivatives':
    case 'Interest Rate Derivatives':
      return 'Post $250 of margin and open one small hedged position';
    case 'Basis Trading':
      return 'Fund $250 and open one spot-versus-perp basis position';
    case 'Chain':
      return 'Bridge $250 of USDC onto the chain and make one swap there';
    case 'Cross Chain Bridge':
      return 'Move $250 of USDC across the bridge once and back once';
    case 'Restaking':
      return 'Deposit $250 of ETH into the protocol\'s restaking pool';
    case 'CDP':
    case 'CDP Manager':
      return 'Open a $250 CDP: lock ETH and mint the protocol\'s stablecoin';
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return 'Mint $250 of the protocol\'s BTC-backed asset against ETH';
    case 'CeDeFi':
      return 'Deposit $250 into the protocol\'s CeDeFi vault';
    case 'OTC Marketplace':
      return 'Place one $250 quote on the protocol\'s order book';
    case 'Insurance':
      return 'Buy $250 of cover on one protocol it insures';
    case 'Payments':
    case 'Crypto Card Issuer':
      return 'Send one $250 payment through the protocol and keep the balance there';
    case 'Governance Incentives':
      return 'Lock $250 of the protocol\'s deposit token for one voting epoch';
    case 'Prediction Market':
      return 'Take one $250 position on a market you already follow';
    case 'Staking Pool':
      return 'Delegate $250 of ETH to the pool and keep the receipt';
    case 'Farm':
      return 'Deposit $250 into the farm\'s main LP pair';
    case 'Liquidity Manager':
      return 'Open one $250 managed liquidity position in range';
    case 'Leveraged Farming':
      return 'Open one $250 farming position at 2x and watch the health factor';
    case 'Options Vault':
      return 'Deposit $250 into one vault and let it sell the covered calls';
    case 'Indexes':
      return 'Mint $250 of the index basket and hold the shares';
    case 'Privacy':
      return 'Shield $250 through the protocol and unshield part of it once';
    default:
      return 'Deposit $250 of USDC into the protocol\'s main pool';
  }
}

/**
 * Three to five concrete steps for this protocol: an account step, a capital step in its own
 * category on its first chain, a weekly step, a check-before-you-add step, and a second-chain step
 * when it runs on more than one chain. Every step ends with its cost and then its time.
 */
function farmSteps(p: Protocol): string[] {
  const name = String(p.name ?? p.slug);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
  const category = p.category;

  const steps: string[] = [
    `Create a fresh wallet that holds only what you farm with ${name}, and write its seed phrase on paper kept offline. Cost: about $2 of gas for the first transaction. Time: 10 minutes.`,
    `${capitalAction(category)} on ${chain}, and keep the position open instead of round-tripping it. Cost: $250 of capital plus about $5 of gas. Time: 20 minutes.`,
    `Repeat one qualifying action every week on ${name} — a deposit, a borrow, a swap or a governance vote — so the wallet keeps a steady record. Cost: about $3 of gas each week. Time: 10 minutes a week.`,
    `Read ${name}'s own site and its official account for a token, points or snapshot announcement before adding another dollar, and stop if the terms change. Cost: no fee to read, and never pay anyone to claim. Time: 10 minutes.`,
  ];

  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    steps.push(
      `Open the same $100 position on ${second}, the protocol's second chain, so the wallet is active on more than one chain. Cost: about $6 of bridge fee and gas. Time: 25 minutes.`,
    );
  }

  return steps;
}

// ---------------------------------------------------------------- the board

function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; live: LiveRow[] } {
  const watchlist = new Set(snapshot.watchlist);
  const asOf = snapshot.as_of;

  const scored = snapshot.protocols.filter(isRankable).map((p) => ({ p, ...score(p, asOf) }));

  // Highest implied value first; equal values break by slug, so two runs always agree.
  scored.sort((a, b) => (b.implied - a.implied) || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const rows: BoardRow[] = scored.map((entry, index) => ({
    rank: index + 1,
    slug: entry.p.slug,
    name: entry.p.name,
    category: entry.p.category,
    chains: Array.isArray(entry.p.chains) ? entry.p.chains.slice() : [],
    tvl_usd: entry.p.tvl_usd,
    change_7d: entry.p.change_7d,
    mcap_usd: entry.p.mcap_usd,
    listed_at: entry.p.listed_at,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(entry.p.slug),
    age_days: entry.model.age_days,
    implied_value_usd: entry.implied,
    model: entry.model,
    growth_multiplier: entry.model.growth_multiplier,
    maturity_multiplier: entry.model.maturity_multiplier,
    farm_steps: farmSteps(entry.p),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p))
    .map((p) => ({ name: p.name, mcap_usd: p.mcap_usd, tvl_usd: p.tvl_usd }))
    .sort((a, b) => {
      const am = a.mcap_usd === null ? -1 : a.mcap_usd;
      const bm = b.mcap_usd === null ? -1 : b.mcap_usd;
      if (bm !== am) return bm - am;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

  return { rows, live };
}

// ---------------------------------------------------------------- the gate before any write

function checkBoard(rows: BoardRow[], watchlist: string[]): void {
  if (rows.length < MIN_ROWS) {
    throw new RadarError(`gate: ${rows.length} rows, fewer than the ${MIN_ROWS} a board needs`);
  }

  const present = new Set(rows.map((r) => r.slug));
  const missing = watchlist.filter((slug) => !present.has(slug));
  if (missing.length > 0) {
    throw new RadarError(`gate: ${missing.length} watchlist slug(s) missing from the board: ${missing.slice(0, 3).join(', ')}`);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.rank !== i + 1) {
      throw new RadarError(`gate: rank ${row.rank} at position ${i + 1} (${row.slug}), ranks must run 1..${rows.length}`);
    }
    if (i > 0 && rows[i - 1]!.implied_value_usd < row.implied_value_usd) {
      throw new RadarError(`gate: implied value rises from rank ${rows[i - 1]!.rank} to ${row.rank} (${row.slug})`);
    }
    const steps = row.farm_steps;
    if (steps.length < MIN_FARM_STEPS || steps.length > MAX_FARM_STEPS) {
      throw new RadarError(`gate: ${row.slug} has ${steps.length} farm steps, needs ${MIN_FARM_STEPS}..${MAX_FARM_STEPS}`);
    }
    for (let s = 0; s < steps.length; s++) {
      const text = steps[s]!;
      if (text.length < MIN_STEP_CHARS || text.length > MAX_STEP_CHARS) {
        throw new RadarError(`gate: ${row.slug} step ${s + 1} is ${text.length} characters, needs ${MIN_STEP_CHARS}..${MAX_STEP_CHARS}`);
      }
      if (!/Cost: .+\. Time: .+\.$/.test(text)) {
        throw new RadarError(`gate: ${row.slug} step ${s + 1} does not end with its cost and its time`);
      }
    }
  }
}

// ---------------------------------------------------------------- writing

/** Copy the plain files of one directory, skipping dot files and directories, in name order. */
function copyFlatFiles(sourceDir: string, targetDir: string, validateName: boolean): string[] {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(sourceDir, { withFileTypes: true });
  } catch {
    return [];
  }
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  const copied: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    if (validateName && !PLAIN_FILE_NAME.test(entry.name)) {
      throw new RadarError(`screenshot name is not a plain file name: ${entry.name}`);
    }
    copyFileSync(join(sourceDir, entry.name), join(targetDir, entry.name));
    copied.push(entry.name);
  }
  return copied;
}

function run(): void {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = loadSnapshot(args.input);
  const { rows, live } = buildBoard(snapshot);

  checkBoard(rows, snapshot.watchlist);

  const outDir = resolve(args.output);
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows })}\n`);

  const earlySize = rows.filter((r) => !r.on_watchlist).length;
  const data = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: earlySize,
    live_size: live.length,
    rows,
    live,
  };
  writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(data)};\n`);

  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const dashboardFiles = copyFlatFiles(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'), true);
  const screenshotFiles = copyFlatFiles(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), true);

  if (screenshotFiles.length < MIN_SCREENSHOTS) {
    throw new RadarError(`only ${screenshotFiles.length} screenshot(s) in screenshots/, need at least ${MIN_SCREENSHOTS}`);
  }

  const dossier = buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  console.log(
    `${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist slugs, ${rows.length} rows, ${earlySize} early, ${live.length} live`,
  );
  console.log(
    `wrote board.json, data.js, ${dashboardFiles.length} dashboard files, ${screenshotFiles.length} screenshots and dossier.json in ${outDir}`,
  );

  if (args.verbose) {
    console.log('top five rows by implied value:');
    for (const row of rows.slice(0, 5)) {
      console.log(
        `  #${row.rank} ${row.name}: implied $${row.implied_value_usd.toLocaleString('en-US')}, growth x${row.growth_multiplier.toFixed(4)}, maturity x${row.maturity_multiplier.toFixed(4)}`,
      );
    }
  }
}

try {
  run();
} catch (err) {
  if (err instanceof RadarError) {
    console.error(err.message);
    process.exit(err.code);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`failed: ${message}`);
  process.exit(1);
}
