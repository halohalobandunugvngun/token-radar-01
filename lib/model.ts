// radar-2 — a token launch radar scored from a single sealed snapshot.
//
// The input is one DefiLlama protocol index: 758 protocols, a 40-slug
// watchlist, a $50M floor. The output is a ranked board of pre-token
// protocols with an implied value and a farm plan each.
//
// The watchlist is the floor, not the ceiling: every watchlist slug is
// ranked, and the board adds every pre-token protocol below the floor —
// the early rows are the point of the radar. A protocol counts as
// pre-token when the snapshot records no token for it at all: no market
// cap, no CoinGecko id, no symbol. Protocols that already trade are kept
// off the board; they do a different job, as the comparables the model
// is priced from.
//
// Every number in the model is computed from this snapshot at run time.
// No protocol name is ever special-cased and no multiple is hard-coded:
//
//   multiple   median(mcap / tvl) over live tokens in the same category,
//              needing at least 3 of them, else the whole-market median;
//              clamped to [0.05, 0.60]. A $0 cap is not a valuation.
//   growth     change_7d clamped to [-60, 120]
//   growth x   1 + growth / 100 * 0.5
//   maturity   0.6 + min(age, 1095) / 1095 * 0.4, unknown age counts as 365 days
//   chains x   1 + min(max(chains - 1, 0), 4) * 0.03
//   implied    max(1, round(tvl * multiple * growth x * maturity * chains x))
//
// Pricing by category instead of one flat number is the whole model.
// Live tokens do not trade at one multiple of TVL: in this snapshot
// Lending sits near 0.13x, Dexs near 0.34x, RWA near 0.27x, while Bridge
// and Basis Trading sit near 0.56x and 0.65x. One flat 0.25x would
// overvalue a lending protocol twofold and undervalue a bridge threefold.
// Where a category has fewer than three live comparables — Risk Curators
// has exactly one, and it is 12 of the 40 watchlist rows — the model
// falls back to the whole market's median rather than inventing one.

export type TokenStatus = 'pre-token';

export interface SnapshotProtocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_comparables: number;
  chain_step: number;
  chain_max_bonus: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 0.6,
  min_comparables: 3,
  chain_step: 0.03,
  chain_max_bonus: 4,
};

export const MODEL_VERSION = 'radar-2';

// The early radar carries every pre-token protocol below the floor, so
// the cap sits above the 186 that exist there.
export const EARLY_ROWS = 1000;

// The dashboard's Live token view carries the biggest live tokens.
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface ComparableRow {
  category: string;
  comparables: number;
  median_multiple: number;
  multiple: number;
  fallback: boolean;
}

export interface CategoryMultiples {
  overall_multiple: number;
  overall_comparables: number;
  byCategory: Map<string, number>;
  table: ComparableRow[];
}

export interface BoardRow {
  rank: number;
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
  token_status: TokenStatus;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  overall_multiple: number;
  comparables: ComparableRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) if (typeof item === 'string') out.push(item);
  return out;
}

// Whole days from the listing date to the snapshot date, never negative;
// null when the listing date is missing or unparsable.
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

function medianOf(numbers: number[]): number {
  const ordered = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle]!;
  return (ordered[middle - 1]! + ordered[middle]!) / 2;
}

// A protocol with no token recorded anywhere in its entry.
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// A name ending in a version marker is a pool of another protocol,
// not a protocol of its own.
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// Rankable means pre-token, not an exchange, and not a versioned pool.
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED_NAME.test(p.name);
}

// The multiples, priced from the snapshot's own live-token protocols.
// A live protocol only counts as a comparable when it trades (a market
// cap is recorded), the cap is above zero, and its TVL is above zero.
// A category with too few comparables falls back to the market median.
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryMultiples {
  const perCategory = new Map<string, number[]>();
  const market: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd == null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    market.push(ratio);
    const key = p.category ?? 'Unknown';
    const bucket = perCategory.get(key);
    if (bucket === undefined) perCategory.set(key, [ratio]);
    else bucket.push(ratio);
  }
  const overall = clamp(medianOf(market), model.multiple_floor, model.multiple_cap);
  const byCategory = new Map<string, number>();
  const table: ComparableRow[] = [];
  const categories = [...perCategory.keys()].sort();
  for (const category of categories) {
    const ratios = perCategory.get(category)!;
    const med = medianOf(ratios);
    if (ratios.length >= model.min_comparables) {
      const multiple = clamp(med, model.multiple_floor, model.multiple_cap);
      byCategory.set(category, multiple);
      table.push({ category, comparables: ratios.length, median_multiple: med, multiple, fallback: false });
    } else {
      byCategory.set(category, overall);
      table.push({ category, comparables: ratios.length, median_multiple: med, multiple: overall, fallback: true });
    }
  }
  // Multiples stay at full precision: the dashboard recomputes each row
  // from these numbers and checks it against board.json, so rounding
  // here would make the check miss by a few dollars. The page rounds
  // only for display.
  return { overall_multiple: overall, overall_comparables: market.length, byCategory, table };
}

export interface Scored {
  implied: number;
  categoryMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
}

function growthMultiplier(pct: number, model: ModelConstants): number {
  return 1 + (pct / 100) * model.growth_weight;
}

function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = age ?? model.unknown_age_days;
  return model.maturity_floor + (clamp(days, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
}

function chainMultiplier(chains: string[], model: ModelConstants): number {
  const extra = clamp(chains.length - 1, 0, model.chain_max_bonus);
  return 1 + extra * model.chain_step;
}

// One protocol's score under the model: its category multiple, its
// three multipliers, and the implied value they produce.
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: CategoryMultiples,
): Scored {
  const age = ageDays(asOf, protocol.listed_at);
  const categoryMultiple = multiples.byCategory.get(protocol.category ?? 'Unknown') ?? multiples.overall_multiple;
  const growthPct = clamp(asNumber(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = growthMultiplier(growthPct, model);
  const maturityMult = maturityMultiplier(age, model);
  const chainMult = chainMultiplier(protocol.chains, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMultiple * growthMult * maturityMult * chainMult));
  return { implied, categoryMultiple, growthPct, growthMult, maturityMult, chainMult, age };
}

function compareScored(a: { implied: number; slug: string }, b: { implied: number; slug: string }): number {
  if (b.implied !== a.implied) return b.implied - a.implied;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function compareTvl(a: SnapshotProtocol, b: SnapshotProtocol): number {
  if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

// The ranked board: every watchlist slug, plus every rankable protocol
// below the floor, strongest implied value first, ranks 1..n.
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const bySlug = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) bySlug.set(p.slug, p);
  const picked = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  const belowFloor = snapshot.protocols
    .filter((p) => !picked.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort(compareTvl)
    .slice(0, EARLY_ROWS);
  for (const p of belowFloor) picked.set(p.slug, p);

  const scored: Array<{ p: SnapshotProtocol } & Scored> = [];
  for (const p of picked.values()) {
    scored.push({ p, ...impliedValue(p, snapshot.as_of, model, multiples) });
  }
  scored.sort((a, b) => compareScored({ implied: a.implied, slug: a.p.slug }, { implied: b.implied, slug: b.p.slug }));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as TokenStatus,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision, same reason as the comparables table: the
      // dashboard recomputes the row from these numbers and checks it
      // against this board, so rounding here would make the check miss
      // by a few dollars. The page rounds only for display.
      category_multiple: s.categoryMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

// One step as a single string: action, cost, time, inside 20..600 chars.
export function stepText(step: FarmStep): string {
  const joined = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (joined.length > 600) return `${joined.slice(0, 596)}...`;
  if (joined.length < 20) return `${joined} Hold the position and check the protocol's own page.`;
  return joined;
}

function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

// What one transaction costs on a chain, as a rough band.
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum' || c === 'tron' || c === 'binance') return 'about $8 of gas on a high-fee chain';
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'hyperliquid l1') return 'under $1 of gas';
  return 'about $1 of gas on a cheap chain';
}

// The category's main action, written so a farmer can follow it.
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

// A second qualifying action, different from the first, so the wallet
// shows real use instead of one deposit.
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $20 against the supply on ${name} and repay it the same week, so the wallet shows both sides of the market.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $20 through ${name}'s pool on ${chain} once, so the wallet is a trader as well as a liquidity provider.`;
  if (c.includes('bridge')) return `Use the bridged funds in a second app on ${chain}, for example a swap or a deposit, instead of bridging them straight back.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards once and restake them through ${name}, so the position compounds.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge and open one more small position the following week, so the account stays active.`;
  if (c.includes('prediction')) return `Settle the first position and place a second one on a different market on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $20 into a second ${name} vault on a different chain, so the wallet is diversified.`;
  if (c.includes('stable')) return `Use the minted stable asset once, for example a swap or a payment, instead of leaving it idle.`;
  if (c.includes('rwa')) return `Check the yield asset's redemption terms on ${name} and redeem a $20 test amount once.`;
  if (c.includes('insurance')) return `File a test claim inquiry on ${name} so you know the process before you ever need it.`;
  return `Make one more qualifying action on ${name}, such as a swap or a vote, within the same week.`;
}

// A farm plan: seven steps, each an action with a cost and a time.
// The plan is derived from the protocol's own record — category, chains,
// TVL, age — never from a hand-written list of names.
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $20 of capital and ${gas}`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `If the protocol's TVL falls by half or its points page goes silent for two weeks, unwind the position and move on. Write the wallet, the dates and every transaction in a farm log.`,
      cost: `the $${capital} returns to your wallet`,
      time: '15 minutes to unwind',
    },
  ];
}

// The live-token protocols, biggest market cap first, for the
// dashboard's Live token view.
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  live.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return live.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

// A board row's compact form for data.js; the farm plan is generated
// in the page from the same inputs.
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

// Everything the dashboard renders, built from the snapshot.
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = categoryMultiples(snapshot, model);
  const live = liveRows(snapshot);
  let early = 0;
  for (const r of board) if (!snapshot.watchlist.includes(r.slug)) early++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    overall_multiple: multiples.overall_multiple,
    comparables: multiples.table,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

function fail(message: string): never {
  throw new SnapshotError(message);
}

function needObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${what} is not an object`);
  return value as Record<string, unknown>;
}

// The snapshot out of a file's text, refused unless it is the shape
// the model scores: a date, a source, a floor, protocols, a watchlist.
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('snapshot.json is not JSON');
  }
  const doc = needObject(raw, 'snapshot.json');
  const asOf = asString(doc.as_of);
  if (asOf === null || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail('snapshot.json has no as_of date');
  const source = asString(doc.source);
  if (source === null) fail('snapshot.json has no source');
  const floor = doc.floor_usd;
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor <= 0) fail('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) fail('snapshot.json has no protocols array');
  const watchlist = doc.watchlist;
  if (!Array.isArray(watchlist) || watchlist.some((s) => typeof s !== 'string')) fail('snapshot.json has no watchlist of slugs');
  const protocols: SnapshotProtocol[] = [];
  for (let i = 0; i < doc.protocols.length; i++) {
    const entry = needObject(doc.protocols[i], `snapshot.json's protocol ${i}`);
    const slug = asString(entry.slug);
    const name = asString(entry.name);
    const tvl = entry.tvl_usd;
    if (slug === null || name === null || typeof tvl !== 'number' || !Number.isFinite(tvl)) {
      fail(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    protocols.push({
      slug,
      name,
      category: asString(entry.category),
      chains: asStringList(entry.chains),
      tvl_usd: tvl,
      change_7d: typeof entry.change_7d === 'number' && Number.isFinite(entry.change_7d) ? entry.change_7d : null,
      mcap_usd: typeof entry.mcap_usd === 'number' && Number.isFinite(entry.mcap_usd) ? entry.mcap_usd : null,
      listed_at: asString(entry.listed_at),
      gecko_id: asString(entry.gecko_id),
      symbol: asString(entry.symbol),
    });
  }
  return { as_of: asOf, source, floor_usd: floor, protocols, watchlist: watchlist as string[] };
}

// Why a board is not one the gate will take, or null when it is:
// watchlist coverage, ranks 1..n in order, one shared value, farm steps.
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const onBoard = new Set<string>();
  for (const r of board) onBoard.add(r.slug);
  const missing: string[] = [];
  for (const s of snapshot.watchlist) if (!onBoard.has(s)) missing.push(s);
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

// The dashboard's whole dataset as one script: no fetch, no network.
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
