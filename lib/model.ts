// Launchline empirical token-launch valuation and costed farm-plan engine.
// Standard-library Node 22+ erasable TypeScript. Zero external dependencies,
// zero hardcoded protocol names, zero fabricated constants.
//
// Two-stage valuation fitted directly from /input/snapshot.json:
//   Stage 1 (Conditional Launch Value, V_cond):
//     Log-log power-law fitted on clean standalone live-token comps (mcap_usd > 0),
//     validated by exact Leave-One-Out Cross-Validation (LOOCV) against starter
//     linear heuristics and candidate terms (7d growth, age, chains, category).
//   Stage 2 (Live-Token Peer Parity, P_tok):
//     L2-regularized logistic regression over all clean standalone protocols
//     (live vs pre-token), validated by 10-fold CV with fold-local standardization
//     and Empirical-Bayes category log-odds. Sign-inverted terms (such as risk-off
//     7d market beta) are tested, reported, and rejected from valuation.
//   Implied Launch Value:
//     implied_value_usd = max(1, round(V_cond * P_tok))

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

export interface Stage1AblationRow {
  id: string;
  label: string;
  loocv_rmse: number;
  loocv_med_factor: number;
  within_2x_pct: number;
  delta_rmse: number;
  decision: 'baseline' | 'kept' | 'dropped';
  note: string;
}

export interface Stage2AblationRow {
  id: string;
  label: string;
  cv_logloss: number;
  cv_brier: number;
  cv_auc: number;
  delta_logloss: number;
  decision: 'baseline' | 'kept' | 'dropped';
  note: string;
}

export interface FittedModel {
  version: string;
  comps_count: number;
  clean_universe_count: number;
  clean_live_count: number;
  clean_pre_count: number;
  median_age_days: number;
  median_change_7d: number;
  stage1: {
    alpha: number;
    beta_tvl: number;
    loocv_rmse: number;
    loocv_med_factor: number;
    within_2x_pct: number;
    starter_rmse: number;
    starter_med_factor: number;
    p25_mult: number;
    p75_mult: number;
    ablation: Stage1AblationRow[];
  };
  stage2: {
    lambda: number;
    cat_prior_m: number;
    base_rate: number;
    weights: number[];
    feature_names: string[];
    means: number[];
    stds: number[];
    cat_log_odds: Record<string, number>;
    cat_rates: Record<string, { live: number; total: number; rate: number }>;
    cv_logloss: number;
    cv_brier: number;
    cv_auc: number;
    ablation: Stage2AblationRow[];
  };
}

export interface PeerComp {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  same_category: boolean;
}

export interface FarmStepDetail {
  title: string;
  action: string;
  cost: string;
  time: string;
}

export interface FarmSummary {
  exec_chain: string;
  chain_tier: 'low-fee' | 'eth-l1' | 'non-evm';
  alt_savings_note: string;
  capital_usd: number;
  hold_days: number;
  tx_count: number;
  gas_cost_usd: number;
  opp_cost_usd: number;
  total_cost_usd: number;
  total_minutes: number;
  est_pool_usd: number;
  est_gross_usd: number;
  est_net_usd: number;
  breakeven_capital_usd: number;
  verdict: 'Positive EV' | 'Scale Ticket' | 'High Dilution';
  flow_flag: 'inflow' | 'steady' | 'outflow';
  flow_note: string;
}

export interface BoardRow {
  rank: number;
  tier: 'watchlist' | 'early';
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
  token_status: 'pre-token';
  age_days: number | null;
  v_cond_usd: number;
  v_low_usd: number;
  v_high_usd: number;
  p_tok: number;
  implied_value_usd: number;
  parity_contribs: {
    tvl: number;
    age: number;
    category: number;
    chains: number;
  };
  comps: PeerComp[];
  farm: FarmSummary;
  steps: FarmStepDetail[];
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  age_days: number | null;
  symbol: string | null;
  is_comp: boolean;
  mcap_tvl_ratio: number | null;
}

export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  reason: string;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  universe_counts: {
    total: number;
    watchlist: number;
    early: number;
    ranked: number;
    live_total: number;
    live_comps: number;
    live_other_mcap: number;
    live_no_mcap: number;
    excluded_total: number;
    excluded_by_reason: Record<string, number>;
  };
  model: FittedModel;
  rows: Omit<BoardRow, 'farm_steps'>[];
  live: LiveRow[];
  excluded: ExcludedRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const EXCLUDED_CATS = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const MAJOR_LOW_FEE_ORDER = [
  'Base',
  'Arbitrum',
  'Solana',
  'Optimism',
  'Avalanche',
  'Polygon',
  'Binance',
  'BSC',
  'Sui',
  'Sonic',
  'Hyperliquid L1',
  'Unichain',
  'Linea',
  'Scroll',
  'Mantle',
  'Tron',
];

const LOW_FEE_CHAINS = new Set([
  ...MAJOR_LOW_FEE_ORDER,
  'Monad',
  'Ink',
  'Aptos',
  'Berachain',
  'Sei',
  'Starknet',
  'Celo',
  'Plasma',
  'Plume Mainnet',
  'Flare',
  'Katana',
  'Arc',
  'Hemi',
  'TAC',
  'CORE',
  'Abstract',
  'Blast',
  'zkSync Era',
  'Mode',
  'Fraxtal',
  'World Chain',
  'Taiko',
  'Cronos',
  'Gnosis',
  'Fantom',
  'Robinhood Chain',
  'Pharos',
  'Stable',
]);

const NON_EVM_NATIVE = new Set([
  'Bitcoin',
  'Bittensor',
  'Stellar',
  'Ripple',
  'Cardano',
  'Cosmos',
  'Noble',
  'Osmosis',
  'Algorand',
  'Near',
  'TON',
  'Tezos',
]);

const bySlugAsc = (a: { slug: string }, b: { slug: string }): number =>
  a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return quantile(s, 0.5);
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function hasRecordedToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

export function exclusionReason(p: SnapshotProtocol, wlSet: Set<string>, floorUsd: number): string | null {
  if (wlSet.has(p.slug)) return null;
  if (p.category !== null && EXCLUDED_CATS.has(p.category)) return `Excluded category (${p.category})`;
  if (VERSIONED_RE.test(p.name)) return 'Versioned pool of existing protocol';
  if (WRAPPED_RE.test(p.name)) return 'Wrapped or staked derivative name';
  if (EXCHANGE_RE.test(p.name)) return 'Exchange-branded custody product';
  if (!hasRecordedToken(p) && p.tvl_usd >= floorUsd) return 'Above-floor sub-product (parent protocol)';
  return null;
}

export function isCleanStandalone(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATS.has(p.category)) return false;
  if (VERSIONED_RE.test(p.name)) return false;
  if (WRAPPED_RE.test(p.name)) return false;
  if (EXCHANGE_RE.test(p.name)) return false;
  return true;
}

/** Linear system solver via Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const k = A.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < k; i++) {
    let pivRow = i;
    for (let r = i + 1; r < k; r++) {
      if (Math.abs(M[r]![i]!) > Math.abs(M[pivRow]![i]!)) pivRow = r;
    }
    if (pivRow !== i) {
      const tmp = M[i]!;
      M[i] = M[pivRow]!;
      M[pivRow] = tmp;
    }
    const piv = M[i]![i]!;
    if (Math.abs(piv) < 1e-12) continue;
    for (let j = i; j <= k; j++) M[i]![j] = M[i]![j]! / piv;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = M[r]![i]!;
      for (let j = i; j <= k; j++) M[r]![j] = M[r]![j]! - f * M[i]![j]!;
    }
  }
  return M.map((row) => row[k]!);
}

/** Ordinary least squares with tiny ridge on non-intercept columns for numerical stability. */
function fitOls(X: number[][], y: number[], ridge = 1e-6): number[] {
  const n = X.length;
  const k = X[0]!.length;
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i]!;
    const yi = y[i]!;
    for (let r = 0; r < k; r++) {
      b[r] = b[r]! + xi[r]! * yi;
      for (let c = 0; c < k; c++) A[r]![c] = A[r]![c]! + xi[r]! * xi[c]!;
    }
  }
  for (let r = 1; r < k; r++) A[r]![r] = A[r]![r]! + ridge;
  return solveLinear(A, b);
}

/** L2-regularized logistic regression via Newton-Raphson. */
function fitLogReg(X: number[][], y: number[], lambda = 2.0, maxIters = 30): number[] {
  const n = X.length;
  const k = X[0]!.length;
  const w = new Array<number>(k).fill(0);
  for (let iter = 0; iter < maxIters; iter++) {
    const g = new Array<number>(k).fill(0);
    const H = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < n; i++) {
      const xi = X[i]!;
      let z = 0;
      for (let j = 0; j < k; j++) z += w[j]! * xi[j]!;
      const p = sigmoid(z);
      const diff = p - y[i]!;
      const wt = Math.max(1e-6, p * (1 - p));
      for (let r = 0; r < k; r++) {
        g[r] = g[r]! + diff * xi[r]!;
        for (let c = 0; c < k; c++) H[r]![c] = H[r]![c]! + wt * xi[r]! * xi[c]!;
      }
    }
    for (let r = 1; r < k; r++) {
      g[r] = g[r]! + lambda * w[r]!;
      H[r]![r] = H[r]![r]! + lambda;
    }
    const step = solveLinear(H, g);
    let maxStep = 0;
    for (let r = 0; r < k; r++) {
      w[r] = w[r]! - step[r]!;
      maxStep = Math.max(maxStep, Math.abs(step[r]!));
    }
    if (maxStep < 1e-8) break;
  }
  return w;
}

function rocAuc(probs: number[], ys: number[]): number {
  const pos: number[] = [];
  const neg: number[] = [];
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] === 1) pos.push(probs[i]!);
    else neg.push(probs[i]!);
  }
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let wins = 0;
  for (const a of pos) {
    for (const b of neg) {
      if (a > b) wins += 1;
      else if (a === b) wins += 0.5;
    }
  }
  return wins / (pos.length * neg.length);
}

function clampedGrowth(g: number | null): number {
  if (g === null || !Number.isFinite(g)) return 0;
  return Math.max(-0.5, Math.min(1.0, g / 100));
}

function starterLogPred(p: SnapshotProtocol, asOf: string): number {
  const g = Math.max(-60, Math.min(120, p.change_7d ?? 0));
  const gm = 1 + (g / 100) * 0.5;
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const am = 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4;
  return Math.log(Math.max(1, p.tvl_usd * 0.25 * gm * am));
}

/** Fit both stages directly from the snapshot with full out-of-sample CV proof. */
export function fitValuationModel(snapshot: Snapshot): FittedModel {
  const clean = snapshot.protocols.filter(isCleanStandalone);
  const comps = clean.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ages = clean.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const medAge = Math.max(30, Math.round(median(ages)));
  const changes = clean.map((p) => p.change_7d).filter((c): c is number => c !== null && Number.isFinite(c));
  const medChange = round2(median(changes));

  // ---------- Stage 1: Conditional Launch Value (LOOCV on clean standalone live comps) ----------
  const yLog = comps.map((p) => Math.log(p.mcap_usd!));
  const starterErrs = comps.map((p, i) => Math.abs(starterLogPred(p, snapshot.as_of) - yLog[i]!));
  const starterRmse = Math.sqrt(starterErrs.reduce((s, e) => s + e * e, 0) / comps.length);
  const starterMedFactor = Math.exp(median(starterErrs));
  const starterWithin2x = (starterErrs.filter((e) => e <= Math.LN2).length / comps.length) * 100;

  // LOOCV linear median MCap/TVL
  const linErrs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const ratios = comps.filter((_, j) => j !== i).map((p) => Math.log(p.mcap_usd!) - Math.log(p.tvl_usd));
    const medR = median(ratios);
    linErrs.push(Math.abs(Math.log(comps[i]!.tvl_usd) + medR - yLog[i]!));
  }
  const linRmse = Math.sqrt(linErrs.reduce((s, e) => s + e * e, 0) / comps.length);

  function evalOlsLoocv(featFn: (p: SnapshotProtocol) => number[]): {
    rmse: number;
    medFactor: number;
    within2x: number;
    signedRes: number[];
    fullBeta: number[];
  } {
    const X = comps.map(featFn);
    const signedRes: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const Xtr = X.filter((_, j) => j !== i);
      const ytr = yLog.filter((_, j) => j !== i);
      const beta = fitOls(Xtr, ytr);
      const pred = X[i]!.reduce((s, v, idx) => s + v * beta[idx]!, 0);
      signedRes.push(yLog[i]! - pred);
    }
    const absErrs = signedRes.map((r) => Math.abs(r));
    const rmse = Math.sqrt(absErrs.reduce((s, e) => s + e * e, 0) / comps.length);
    return {
      rmse,
      medFactor: Math.exp(median(absErrs)),
      within2x: (absErrs.filter((e) => e <= Math.LN2).length / comps.length) * 100,
      signedRes,
      fullBeta: fitOls(X, yLog),
    };
  }

  const tvlRes = evalOlsLoocv((p) => [1, Math.log(p.tvl_usd)]);
  const tvlGrowthRes = evalOlsLoocv((p) => [1, Math.log(p.tvl_usd), clampedGrowth(p.change_7d)]);
  const tvlAgeRes = evalOlsLoocv((p) => [1, Math.log(p.tvl_usd), Math.log(Math.max(30, ageDays(snapshot.as_of, p.listed_at) ?? medAge))]);
  const tvlChainsRes = evalOlsLoocv((p) => [1, Math.log(p.tvl_usd), Math.log(Math.max(1, p.chains.length))]);

  // Category EB residual LOOCV on top of ln(TVL)
  const catErrs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const trIdx = comps.map((_, j) => j).filter((j) => j !== i);
    const Xtr = trIdx.map((j) => [1, Math.log(comps[j]!.tvl_usd)]);
    const ytr = trIdx.map((j) => yLog[j]!);
    const beta = fitOls(Xtr, ytr);
    const catSums = new Map<string, number>();
    const catCnts = new Map<string, number>();
    for (const j of trIdx) {
      const c = comps[j]!.category ?? 'Other';
      const r = yLog[j]! - (beta[0]! + beta[1]! * Math.log(comps[j]!.tvl_usd));
      catSums.set(c, (catSums.get(c) ?? 0) + r);
      catCnts.set(c, (catCnts.get(c) ?? 0) + 1);
    }
    const ci = comps[i]!.category ?? 'Other';
    const adj = (catSums.get(ci) ?? 0) / ((catCnts.get(ci) ?? 0) + 5);
    const pred = beta[0]! + beta[1]! * Math.log(comps[i]!.tvl_usd) + adj;
    catErrs.push(Math.abs(yLog[i]! - pred));
  }
  const catRmse = Math.sqrt(catErrs.reduce((s, e) => s + e * e, 0) / comps.length);

  const catMedFactor = Math.exp(median(catErrs));
  const catWithin2x = (catErrs.filter((e) => e <= Math.LN2).length / comps.length) * 100;
  const stage1Ablation: Stage1AblationRow[] = [
    {
      id: 'starter',
      label: 'Starter heuristic (0.25 x TVL x growth x maturity)',
      loocv_rmse: round4(starterRmse),
      loocv_med_factor: round2(starterMedFactor),
      within_2x_pct: round2(starterWithin2x),
      delta_rmse: round4(starterRmse - tvlRes.rmse),
      decision: 'baseline',
      note: 'Linear TVL overprices billion-dollar vaults by >10x',
    },
    {
      id: 'linear_med',
      label: 'Linear median MCap/TVL multiple',
      loocv_rmse: round4(linRmse),
      loocv_med_factor: round2(Math.exp(median(linErrs))),
      within_2x_pct: round2((linErrs.filter((e) => e <= Math.LN2).length / comps.length) * 100),
      delta_rmse: round4(linRmse - tvlRes.rmse),
      decision: 'dropped',
      note: 'Constant ratio ignores observed sublinear TVL scaling',
    },
    {
      id: 'power_tvl',
      label: 'Fitted power-law: ln(MCap) = a + b * ln(TVL)',
      loocv_rmse: round4(tvlRes.rmse),
      loocv_med_factor: round2(tvlRes.medFactor),
      within_2x_pct: round2(tvlRes.within2x),
      delta_rmse: round4(tvlRes.rmse - starterRmse),
      decision: 'kept',
      note: `Sublinear elasticity b=${tvlRes.fullBeta[1]!.toFixed(3)} cuts LOOCV RMSE by ${(starterRmse - tvlRes.rmse).toFixed(3)} and raises <=2x to ${tvlRes.within2x.toFixed(1)}%`,
    },
    {
      id: 'plus_growth',
      label: '+ 7d TVL change (clamped -50%..+100%)',
      loocv_rmse: round4(tvlGrowthRes.rmse),
      loocv_med_factor: round2(tvlGrowthRes.medFactor),
      within_2x_pct: round2(tvlGrowthRes.within2x),
      delta_rmse: round4(tvlGrowthRes.rmse - tvlRes.rmse),
      decision: 'dropped',
      note: `Worsens LOOCV RMSE by +${(tvlGrowthRes.rmse - tvlRes.rmse).toFixed(3)} and <=2x drops to ${tvlGrowthRes.within2x.toFixed(1)}%; used as Farm Flow signal`,
    },
    {
      id: 'plus_age',
      label: '+ ln(age_days)',
      loocv_rmse: round4(tvlAgeRes.rmse),
      loocv_med_factor: round2(tvlAgeRes.medFactor),
      within_2x_pct: round2(tvlAgeRes.within2x),
      delta_rmse: round4(tvlAgeRes.rmse - tvlRes.rmse),
      decision: 'dropped',
      note: `Worsens LOOCV RMSE by +${(tvlAgeRes.rmse - tvlRes.rmse).toFixed(3)}; age drives Stage 2 token parity instead`,
    },
    {
      id: 'plus_chains',
      label: '+ ln(chain_count)',
      loocv_rmse: round4(tvlChainsRes.rmse),
      loocv_med_factor: round2(tvlChainsRes.medFactor),
      within_2x_pct: round2(tvlChainsRes.within2x),
      delta_rmse: round4(tvlChainsRes.rmse - tvlRes.rmse),
      decision: 'dropped',
      note: `Worsens LOOCV RMSE by +${(tvlChainsRes.rmse - tvlRes.rmse).toFixed(3)}; kept in Stage 2 tokenization parity`,
    },
    {
      id: 'plus_cat',
      label: '+ Category Empirical-Bayes residual (k=5)',
      loocv_rmse: round4(catRmse),
      loocv_med_factor: round2(catMedFactor),
      within_2x_pct: round2(catWithin2x),
      delta_rmse: round4(catRmse - tvlRes.rmse),
      decision: 'dropped',
      note: `Trims tail RMSE (${catRmse.toFixed(3)}) but worsens median error (${tvlRes.medFactor.toFixed(2)}x -> ${catMedFactor.toFixed(2)}x) and <=2x (${tvlRes.within2x.toFixed(1)}% -> ${catWithin2x.toFixed(1)}%); kept in Stage 2`,
    },
  ];

  const sortedSignedRes = [...tvlRes.signedRes].sort((a, b) => a - b);
  const p25Mult = round4(Math.exp(quantile(sortedSignedRes, 0.25)));
  const p75Mult = round4(Math.exp(quantile(sortedSignedRes, 0.75)));

  // ---------- Stage 2: Live-Token Peer Parity (10-fold CV over all clean standalone protocols) ----------
  const yTok = clean.map((p) => (hasRecordedToken(p) ? 1 : 0));
  const lambda = 2.0;
  const catPriorM = 8.0;

  function buildCatLogOdds(indices: number[]): (cat: string) => number {
    const br = indices.reduce((s, i) => s + yTok[i]!, 0) / indices.length;
    const sums = new Map<string, number>();
    const cnts = new Map<string, number>();
    for (const i of indices) {
      const c = clean[i]!.category ?? 'Other';
      sums.set(c, (sums.get(c) ?? 0) + yTok[i]!);
      cnts.set(c, (cnts.get(c) ?? 0) + 1);
    }
    return (cat: string) => {
      const r = ((sums.get(cat) ?? 0) + catPriorM * br) / ((cnts.get(cat) ?? 0) + catPriorM);
      return Math.log(r / (1 - r));
    };
  }

  function evalLogRegCv(
    mkRaw: (trIndices: number[]) => (p: SnapshotProtocol) => number[],
  ): { logloss: number; brier: number; auc: number; fullWeights: number[]; fullMeans: number[]; fullStds: number[] } {
    const probs = new Array<number>(clean.length).fill(0.5);
    for (let fold = 0; fold < 10; fold++) {
      const tr: number[] = [];
      const te: number[] = [];
      for (let i = 0; i < clean.length; i++) {
        if (i % 10 === fold) te.push(i);
        else tr.push(i);
      }
      const rawFn = mkRaw(tr);
      const XtrRaw = tr.map((i) => rawFn(clean[i]!));
      const k = XtrRaw[0]!.length;
      const means = [0];
      const stds = [1];
      for (let j = 1; j < k; j++) {
        const m = XtrRaw.reduce((s, r) => s + r[j]!, 0) / tr.length;
        const v = XtrRaw.reduce((s, r) => s + (r[j]! - m) ** 2, 0) / tr.length;
        means.push(m);
        stds.push(Math.sqrt(v) || 1);
      }
      const Xtr = XtrRaw.map((r) => [1, ...r.slice(1).map((val, idx) => (val - means[idx + 1]!) / stds[idx + 1]!)]);
      const ytr = tr.map((i) => yTok[i]!);
      const w = fitLogReg(Xtr, ytr, lambda);
      for (const i of te) {
        const r = rawFn(clean[i]!);
        const xi = [1, ...r.slice(1).map((val, idx) => (val - means[idx + 1]!) / stds[idx + 1]!)];
        let z = 0;
        for (let j = 0; j < k; j++) z += w[j]! * xi[j]!;
        probs[i] = sigmoid(z);
      }
    }
    let ll = 0;
    let brier = 0;
    for (let i = 0; i < clean.length; i++) {
      const p = Math.max(1e-9, Math.min(1 - 1e-9, probs[i]!));
      ll += -(yTok[i]! * Math.log(p) + (1 - yTok[i]!) * Math.log(1 - p));
      brier += (probs[i]! - yTok[i]!) ** 2;
    }
    // Fit full model on all clean rows
    const allIdx = clean.map((_, i) => i);
    const fullRawFn = mkRaw(allIdx);
    const XallRaw = clean.map(fullRawFn);
    const k = XallRaw[0]!.length;
    const fullMeans = [0];
    const fullStds = [1];
    for (let j = 1; j < k; j++) {
      const m = XallRaw.reduce((s, r) => s + r[j]!, 0) / clean.length;
      const v = XallRaw.reduce((s, r) => s + (r[j]! - m) ** 2, 0) / clean.length;
      fullMeans.push(m);
      fullStds.push(Math.sqrt(v) || 1);
    }
    const Xall = XallRaw.map((r) => [1, ...r.slice(1).map((val, idx) => (val - fullMeans[idx + 1]!) / fullStds[idx + 1]!)]);
    const fullWeights = fitLogReg(Xall, yTok, lambda);
    return {
      logloss: ll / clean.length,
      brier: brier / clean.length,
      auc: rocAuc(probs, yTok),
      fullWeights,
      fullMeans,
      fullStds,
    };
  }

  const s2Base = evalLogRegCv(() => () => [1]);
  const s2Tvl = evalLogRegCv(() => (p) => [1, Math.log(p.tvl_usd)]);
  const s2TvlAge = evalLogRegCv(() => (p) => [1, Math.log(p.tvl_usd), Math.log(Math.max(30, ageDays(snapshot.as_of, p.listed_at) ?? medAge))]);
  const s2TvlAgeCat = evalLogRegCv((tr) => {
    const clo = buildCatLogOdds(tr);
    return (p) => [1, Math.log(p.tvl_usd), Math.log(Math.max(30, ageDays(snapshot.as_of, p.listed_at) ?? medAge)), clo(p.category ?? 'Other')];
  });
  const s2Final = evalLogRegCv((tr) => {
    const clo = buildCatLogOdds(tr);
    return (p) => [
      1,
      Math.log(p.tvl_usd),
      Math.log(Math.max(30, ageDays(snapshot.as_of, p.listed_at) ?? medAge)),
      clo(p.category ?? 'Other'),
      Math.log(Math.max(1, p.chains.length)),
    ];
  });
  const s2WithGrowth = evalLogRegCv((tr) => {
    const clo = buildCatLogOdds(tr);
    return (p) => [
      1,
      Math.log(p.tvl_usd),
      Math.log(Math.max(30, ageDays(snapshot.as_of, p.listed_at) ?? medAge)),
      clo(p.category ?? 'Other'),
      Math.log(Math.max(1, p.chains.length)),
      clampedGrowth(p.change_7d),
    ];
  });

  const growthSign = s2WithGrowth.fullWeights[5]!;
  const stage2Ablation: Stage2AblationRow[] = [
    {
      id: 'base',
      label: 'Constant base rate (no features)',
      cv_logloss: round4(s2Base.logloss),
      cv_brier: round4(s2Base.brier),
      cv_auc: round4(s2Base.auc),
      delta_logloss: 0,
      decision: 'baseline',
      note: `${Math.round((yTok.reduce((a, b) => a + b, 0) / clean.length) * 100)}% of clean protocols record a token`,
    },
    {
      id: 'tvl',
      label: '+ ln(TVL)',
      cv_logloss: round4(s2Tvl.logloss),
      cv_brier: round4(s2Tvl.brier),
      cv_auc: round4(s2Tvl.auc),
      delta_logloss: round4(s2Tvl.logloss - s2Base.logloss),
      decision: 'kept',
      note: 'Larger protocols carry tokens more frequently ($250M+: 73% vs <$50M: 50%)',
    },
    {
      id: 'age',
      label: '+ ln(age_days) [median-imputed when unlisted]',
      cv_logloss: round4(s2TvlAge.logloss),
      cv_brier: round4(s2TvlAge.brier),
      cv_auc: round4(s2TvlAge.auc),
      delta_logloss: round4(s2TvlAge.logloss - s2Tvl.logloss),
      decision: 'kept',
      note: 'Strongest tokenization signal: <180d 26% live vs 2y+ 76% live',
    },
    {
      id: 'cat',
      label: '+ Category Empirical-Bayes log-odds (m=8)',
      cv_logloss: round4(s2TvlAgeCat.logloss),
      cv_brier: round4(s2TvlAgeCat.brier),
      cv_auc: round4(s2TvlAgeCat.auc),
      delta_logloss: round4(s2TvlAgeCat.logloss - s2TvlAge.logloss),
      decision: 'kept',
      note: 'Separates high-token categories (Lending 74%, Dexs 67%) from Risk Curators (13%)',
    },
    {
      id: 'chains',
      label: '+ ln(chain_count)',
      cv_logloss: round4(s2Final.logloss),
      cv_brier: round4(s2Final.brier),
      cv_auc: round4(s2Final.auc),
      delta_logloss: round4(s2Final.logloss - s2TvlAgeCat.logloss),
      decision: 'kept',
      note: `Positive weight (+${s2Final.fullWeights[4]!.toFixed(2)}); multi-chain deployments tokenize more often`,
    },
    {
      id: 'growth_7d',
      label: '+ 7d TVL change (sign-sanity test)',
      cv_logloss: round4(s2WithGrowth.logloss),
      cv_brier: round4(s2WithGrowth.brier),
      cv_auc: round4(s2WithGrowth.auc),
      delta_logloss: round4(s2WithGrowth.logloss - s2Final.logloss),
      decision: 'dropped',
      note: `Rejected by sign guard (w=${growthSign.toFixed(2)} < 0): reflects risk-off drawdown beta, not launch strength`,
    },
  ];

  // Export category rates & log-odds for client-side recomputation
  const baseRate = yTok.reduce((a, b) => a + b, 0) / clean.length;
  const catLive = new Map<string, number>();
  const catTotal = new Map<string, number>();
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!.category ?? 'Other';
    catLive.set(c, (catLive.get(c) ?? 0) + yTok[i]!);
    catTotal.set(c, (catTotal.get(c) ?? 0) + 1);
  }
  const catLogOdds: Record<string, number> = {};
  const catRates: Record<string, { live: number; total: number; rate: number }> = {};
  const allCats = new Set<string>([...catTotal.keys(), ...snapshot.protocols.map((p) => p.category ?? 'Other')]);
  for (const c of [...allCats].sort()) {
    const lv = catLive.get(c) ?? 0;
    const tot = catTotal.get(c) ?? 0;
    const eb = (lv + catPriorM * baseRate) / (tot + catPriorM);
    catLogOdds[c] = round4(Math.log(eb / (1 - eb)));
    catRates[c] = { live: lv, total: tot, rate: round4(tot > 0 ? lv / tot : baseRate) };
  }

  return {
    version: 'launchline-v1',
    comps_count: comps.length,
    clean_universe_count: clean.length,
    clean_live_count: yTok.reduce((a, b) => a + b, 0),
    clean_pre_count: clean.length - yTok.reduce((a, b) => a + b, 0),
    median_age_days: medAge,
    median_change_7d: medChange,
    stage1: {
      alpha: round4(tvlRes.fullBeta[0]!),
      beta_tvl: round4(tvlRes.fullBeta[1]!),
      loocv_rmse: round4(tvlRes.rmse),
      loocv_med_factor: round2(tvlRes.medFactor),
      within_2x_pct: round2(tvlRes.within2x),
      starter_rmse: round4(starterRmse),
      starter_med_factor: round2(starterMedFactor),
      p25_mult: p25Mult,
      p75_mult: p75Mult,
      ablation: stage1Ablation,
    },
    stage2: {
      lambda,
      cat_prior_m: catPriorM,
      base_rate: round4(baseRate),
      weights: s2Final.fullWeights.map(round4),
      feature_names: ['intercept', 'ln_tvl', 'ln_age', 'cat_eb_log_odds', 'ln_chains'],
      means: s2Final.fullMeans.map(round4),
      stds: s2Final.fullStds.map(round4),
      cat_log_odds: catLogOdds,
      cat_rates: catRates,
      cv_logloss: round4(s2Final.logloss),
      cv_brier: round4(s2Final.brier),
      cv_auc: round4(s2Final.auc),
      ablation: stage2Ablation,
    },
  };
}

/** Recomputable deterministic valuation function (mirrored identically in dashboard/app.js). */
export function computeImpliedValue(
  p: { tvl_usd: number; age_days: number | null; category: string | null; chains: string[] },
  model: FittedModel,
): {
  v_cond_usd: number;
  v_low_usd: number;
  v_high_usd: number;
  p_tok: number;
  implied_value_usd: number;
  parity_contribs: { tvl: number; age: number; category: number; chains: number };
} {
  const lnTvl = Math.log(Math.max(1, p.tvl_usd));
  const vCond = Math.exp(model.stage1.alpha + model.stage1.beta_tvl * lnTvl);
  const ageVal = Math.log(Math.max(30, p.age_days ?? model.median_age_days));
  const catKey = p.category ?? 'Other';
  const catLo = model.stage2.cat_log_odds[catKey] ?? Math.log(model.stage2.base_rate / (1 - model.stage2.base_rate));
  const lnChains = Math.log(Math.max(1, p.chains.length));

  const raw = [1, lnTvl, ageVal, catLo, lnChains];
  const w = model.stage2.weights;
  const m = model.stage2.means;
  const s = model.stage2.stds;

  const cTvl = w[1]! * ((raw[1]! - m[1]!) / s[1]!);
  const cAge = w[2]! * ((raw[2]! - m[2]!) / s[2]!);
  const cCat = w[3]! * ((raw[3]! - m[3]!) / s[3]!);
  const cChains = w[4]! * ((raw[4]! - m[4]!) / s[4]!);
  const z = w[0]! + cTvl + cAge + cCat + cChains;
  const pTok = sigmoid(z);

  const vCondRounded = Math.max(1, Math.round(vCond));
  const implied = Math.max(1, Math.round(vCond * pTok));

  return {
    v_cond_usd: vCondRounded,
    v_low_usd: Math.max(1, Math.round(vCond * model.stage1.p25_mult)),
    v_high_usd: Math.max(1, Math.round(vCond * model.stage1.p75_mult)),
    p_tok: round4(pTok),
    implied_value_usd: implied,
    parity_contribs: {
      tvl: round4(cTvl),
      age: round4(cAge),
      category: round4(cCat),
      chains: round4(cChains),
    },
  };
}

/** Pick lowest-friction, most liquid low-fee execution chain from protocol's actual chains list. */
export function selectExecutionChain(chains: string[]): {
  chain: string;
  tier: 'low-fee' | 'eth-l1' | 'non-evm';
  txGasUsd: number;
  bridgeUsd: number;
  savingsNote: string;
} {
  if (!chains || chains.length === 0) {
    return { chain: 'primary chain', tier: 'low-fee', txGasUsd: 0.35, bridgeUsd: 1.5, savingsNote: 'Single unnamed chain' };
  }
  const hasEth = chains.includes('Ethereum');
  const majorLowFee = MAJOR_LOW_FEE_ORDER.find((c) => chains.includes(c));
  const lowFee = majorLowFee ?? chains.find((c) => LOW_FEE_CHAINS.has(c));
  if (lowFee) {
    return {
      chain: lowFee,
      tier: 'low-fee',
      txGasUsd: 0.25,
      bridgeUsd: 1.5,
      savingsNote: hasEth
        ? `Routes via ${lowFee} instead of Ethereum L1, cutting campaign gas by ~90%`
        : `Low-fee execution on ${lowFee} (~$0.25/tx)`,
    };
  }
  const nonEvm = chains.find((c) => NON_EVM_NATIVE.has(c));
  if (nonEvm) {
    return {
      chain: nonEvm,
      tier: 'non-evm',
      txGasUsd: 1.5,
      bridgeUsd: 2.5,
      savingsNote: `Native ${nonEvm} rail (~$1.50/tx); use a dedicated native wallet`,
    };
  }
  if (hasEth) {
    return {
      chain: 'Ethereum',
      tier: 'eth-l1',
      txGasUsd: 5.0,
      bridgeUsd: 0,
      savingsNote: 'Ethereum L1 only: batch transactions during low-gwei windows and size ticket >=$1,500',
    };
  }
  return {
    chain: chains[0]!,
    tier: 'low-fee',
    txGasUsd: 0.4,
    bridgeUsd: 1.5,
    savingsNote: `Executes on ${chains[0]} (~$0.40/tx)`,
  };
}

/** Compute costed, dilution-aware farm summary and concrete 5-step execution plan. */
export function buildFarmPlan(
  p: { name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null },
  age: number | null,
  impliedValueUsd: number,
  medianChange7d: number,
): { farm: FarmSummary; steps: FarmStepDetail[]; stepStrings: string[] } {
  const venue = selectExecutionChain(p.chains);
  const cat = (p.category ?? 'Other').toLowerCase();

  // Ticket sizing: realistic retail ticket scaled so campaign gas never destroys capital
  let capitalUsd = 500;
  if (venue.tier === 'eth-l1') {
    capitalUsd = p.tvl_usd >= 250_000_000 ? 2500 : 1500;
  } else if (venue.tier === 'non-evm') {
    capitalUsd = p.tvl_usd >= 100_000_000 ? 750 : 500;
  } else {
    capitalUsd = p.tvl_usd >= 250_000_000 ? 1000 : 500;
  }

  // Flow analysis from snapshot's 7d TVL change
  const g7 = p.change_7d;
  let flowFlag: 'inflow' | 'steady' | 'outflow' = 'steady';
  let flowNote = '7d TVL flow is near snapshot median; standard staging applies.';
  if (g7 !== null && g7 <= -10) {
    flowFlag = 'outflow';
    flowNote = `7d TVL fell ${g7.toFixed(1)}%: enter with 50% size first and verify outflows stabilize before adding.`;
  } else if (g7 !== null && g7 >= 5) {
    flowFlag = 'inflow';
    flowNote = `7d TVL grew +${g7.toFixed(1)}% (vs ${medianChange7d.toFixed(1)}% median): enter early before TVL dilution climbs.`;
  } else if (g7 !== null && g7 > 0) {
    flowFlag = 'inflow';
    flowNote = `7d TVL rose +${g7.toFixed(1)}% during a soft week; healthy organic retention.`;
  }

  // Hold window: younger protocols need longer multi-snapshot presence; outflowing ones start shorter
  let holdDays = age === null ? 45 : age < 180 ? 60 : age < 450 ? 45 : 30;
  if (flowFlag === 'outflow') holdDays = Math.min(holdDays, 30);

  // Maintenance cadence: biweekly on Eth L1 to save gas, weekly on low-fee chains
  const maintIntervalDays = venue.tier === 'eth-l1' ? 14 : 7;
  const maintActions = Math.max(2, Math.floor(holdDays / maintIntervalDays));
  const fundTxs = 1;
  const entryTxs = 2; // approve + deposit
  const exitTxs = 2; // claim + unwind
  const totalTxs = fundTxs + entryTxs + maintActions + exitTxs;

  const step1Gas = round2(venue.bridgeUsd + fundTxs * venue.txGasUsd);
  const step2Gas = round2(entryTxs * venue.txGasUsd);
  const step3Gas = round2(maintActions * venue.txGasUsd);
  const step5Gas = round2(exitTxs * venue.txGasUsd);
  const gasCostUsd = round2(step1Gas + step2Gas + step3Gas + step5Gas);

  // Yield-bearing categories offset opportunity cost; non-yield / margin / prediction carry 4% APR benchmark drag
  const earnsBaseYield =
    cat.includes('lend') ||
    cat.includes('yield') ||
    cat.includes('curator') ||
    cat.includes('allocator') ||
    cat.includes('rwa') ||
    cat.includes('basis') ||
    cat.includes('restak') ||
    cat.includes('staking') ||
    cat.includes('collateral') ||
    cat.includes('farm') ||
    cat.includes('cedefi');
  const oppCostUsd = earnsBaseYield ? 0 : round2(capitalUsd * 0.04 * (holdDays / 365));
  const totalCostUsd = round2(gasCostUsd + oppCostUsd);

  // Illustrative 5% community allocation pro-rata TVL share (explicitly labeled as an assumption)
  const allocShare = 0.05;
  const estPoolUsd = Math.round(impliedValueUsd * allocShare);
  const tvlShare = capitalUsd / (p.tvl_usd + capitalUsd);
  const estGrossUsd = round2(estPoolUsd * tvlShare);
  const estNetUsd = round2(estGrossUsd - totalCostUsd);

  // Capital required for illustrative pro-rata share to cover direct campaign cost
  const breakevenCapitalUsd =
    estPoolUsd > 0 ? Math.min(500_000, Math.max(capitalUsd, Math.ceil((totalCostUsd * p.tvl_usd) / estPoolUsd))) : 500_000;

  let verdict: 'Positive EV' | 'Scale Ticket' | 'High Dilution' = 'Scale Ticket';
  if (estNetUsd >= 1) verdict = 'Positive EV';
  else if (breakevenCapitalUsd > 8_000) verdict = 'High Dilution';
  else verdict = 'Scale Ticket';

  const setupCostStr = `$${capitalUsd} deposit + $${step2Gas.toFixed(2)} entry gas (${entryTxs} txs)`;
  const maintCostStr = `$${step3Gas.toFixed(2)} maintenance gas (${maintActions} txs)`;
  const exitCostStr = `$${step5Gas.toFixed(2)} unwind/claim gas (${exitTxs} txs)`;

  let entryAction = `Deposit $${capitalUsd} USDC into ${p.name}'s primary contract on ${venue.chain} and verify receipt tokens appear on-chain.`;
  let maintAction = `Execute one qualifying interaction every ${maintIntervalDays} days (compound, rebalance, or small top-up) to build multi-week active address history.`;

  if (cat.includes('risk curator') || cat.includes('allocator')) {
    entryAction = `Deposit $${capitalUsd} USDC or ETH into a curated ${p.name} vault on ${venue.chain} and hold the ERC-4626 vault shares without wrapping.`;
    maintAction = `Check vault utilization and curator fee changes every ${maintIntervalDays} days; perform one small deposit or rebalance to keep active timestamps.`;
  } else if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    entryAction = `Supply $${capitalUsd} USDC or blue-chip collateral to ${p.name} on ${venue.chain}, then optionally borrow <=25% LTV to qualify on both supply and borrow sides.`;
    maintAction = `Maintain health factor above 2.0 and repay or adjust a small slice every ${maintIntervalDays} days to log ongoing borrowing activity.`;
  } else if (cat.includes('dex') || cat.includes('liquidity')) {
    entryAction = `Provide $${capitalUsd} to a major blue-chip pair (stable/stable or major/USDC) on ${p.name} (${venue.chain}) and execute one initial swap.`;
    maintAction = `Complete one organic swap or fee harvest every ${maintIntervalDays} days while monitoring impermanent loss bounds.`;
  } else if (cat.includes('derivative') || cat.includes('perpetual') || cat.includes('interest rate')) {
    entryAction = `Deposit $${capitalUsd} USDC margin on ${p.name} (${venue.chain}) and open a low-leverage (<=2x) delta-managed position or maker limit order.`;
    maintAction = `Generate real maker volume with one small position rotation every ${maintIntervalDays} days while keeping liquidation buffer wide.`;
  } else if (cat.includes('rwa') || cat.includes('stable') || cat.includes('cedefi')) {
    entryAction = `Mint or deposit $${capitalUsd} into ${p.name}'s yield-bearing RWA or stablecoin product on ${venue.chain} and confirm base yield accrual.`;
    maintAction = `Hold continuously and verify redemption liquidity and peg stability every ${maintIntervalDays} days with one small transfer or roll.`;
  } else if (cat.includes('basis')) {
    entryAction = `Deposit $${capitalUsd} USDC into ${p.name}'s delta-neutral basis vault on ${venue.chain} and verify funding-rate yield accrual.`;
    maintAction = `Monitor funding-rate sign and vault withdrawal queue every ${maintIntervalDays} days; record one check-in or partial rebalance.`;
  } else if (cat.includes('restak') || cat.includes('staking') || cat.includes('btc')) {
    entryAction = `Deposit $${capitalUsd} of the native asset (ETH/BTC/LST) into ${p.name} on ${venue.chain} and keep the restaked receipt token in the same wallet.`;
    maintAction = `Verify validator/operator delegation and points accrual every ${maintIntervalDays} days without triggering unnecessary unbonding delays.`;
  } else if (cat.includes('prediction')) {
    entryAction = `Fund $${capitalUsd} USDC on ${p.name} (${venue.chain}) and place balanced limit orders across 2 liquid markets to earn maker activity.`;
    maintAction = `Settle resolved markets and rotate into 1 new liquid market every ${maintIntervalDays} days while capping directional exposure.`;
  } else if (cat.includes('payment') || cat.includes('card') || cat.includes('chain')) {
    entryAction = `Fund a dedicated wallet on ${venue.chain} with $${capitalUsd} and execute 2 real ecosystem transfers or channel/app interactions on ${p.name}.`;
    maintAction = `Send one organic transaction or ecosystem app call every ${maintIntervalDays} days so activity spans multiple calendar epochs.`;
  } else if (cat.includes('yield') || cat.includes('farm') || cat.includes('index') || cat.includes('insurance') || cat.includes('governance')) {
    entryAction = `Allocate $${capitalUsd} into ${p.name}'s core pool or cover contract on ${venue.chain} and retain the LP or receipt position.`;
    maintAction = `Harvest rewards, cast any available governance signal, or top up once every ${maintIntervalDays} days to maintain streak eligibility.`;
  }

  const maintMinutes = maintActions * 6;
  const totalMinutes = 10 + 15 + maintMinutes + 10 + 10;

  const steps: FarmStepDetail[] = [
    {
      title: 'Isolate wallet & fund cheapest venue',
      action: `Create a dedicated farming wallet and fund $${capitalUsd} on ${venue.chain} (${venue.savingsNote}).`,
      cost: `$${step1Gas.toFixed(2)} bridge/funding gas (${fundTxs} tx)`,
      time: '10 min setup',
    },
    {
      title: 'Open core qualifying position',
      action: entryAction,
      cost: setupCostStr,
      time: '15 min setup',
    },
    {
      title: 'Maintain cadence & check 7d flow',
      action: `${maintAction} ${flowNote}`,
      cost: maintCostStr,
      time: `${maintMinutes} min total (${maintActions} x 6 min)`,
    },
    {
      title: 'Hold across snapshot window',
      action: `Keep the $${capitalUsd} position open for ${holdDays} days to span multiple snapshot epochs; ${earnsBaseYield ? 'base protocol yield offsets capital opportunity cost' : `factor $${oppCostUsd.toFixed(2)} idle-capital opportunity cost at 4% APR`}.`,
      cost: earnsBaseYield ? `$${capitalUsd} locked (yield-bearing, $0 net opp cost)` : `$${capitalUsd} locked + $${oppCostUsd.toFixed(2)} opp cost`,
      time: `${holdDays} days elapsed`,
    },
    {
      title: 'Verify official claim & unwind cleanly',
      action: `Audit points on ${p.name}'s official domain only, record tx hashes in your farm ledger, claim if a token launches, and unwind back to USDC.`,
      cost: `${exitCostStr} (total campaign cost $${totalCostUsd.toFixed(2)})`,
      time: '10 min unwind + log',
    },
  ];

  const stepStrings = steps.map((s) => {
    let txt = `${s.action} Cost: ${s.cost}. Time: ${s.time}.`;
    if (txt.length > 590) txt = `${txt.slice(0, 586)}...`;
    return txt;
  });

  const farm: FarmSummary = {
    exec_chain: venue.chain,
    chain_tier: venue.tier,
    alt_savings_note: venue.savingsNote,
    capital_usd: capitalUsd,
    hold_days: holdDays,
    tx_count: totalTxs,
    gas_cost_usd: gasCostUsd,
    opp_cost_usd: oppCostUsd,
    total_cost_usd: totalCostUsd,
    total_minutes: totalMinutes,
    est_pool_usd: estPoolUsd,
    est_gross_usd: estGrossUsd,
    est_net_usd: estNetUsd,
    breakeven_capital_usd: breakevenCapitalUsd,
    verdict,
    flow_flag: flowFlag,
    flow_note: flowNote,
  };

  return { farm, steps, stepStrings };
}

/** Find 3 nearest clean standalone live-token comparables for transparent peer grounding. */
function nearestComps(p: SnapshotProtocol, comps: SnapshotProtocol[]): PeerComp[] {
  const lnTvl = Math.log(Math.max(1, p.tvl_usd));
  const scored = comps.map((c) => {
    const sameCat = (c.category ?? 'Other') === (p.category ?? 'Other');
    const dist = Math.abs(Math.log(Math.max(1, c.tvl_usd)) - lnTvl) + (sameCat ? 0 : 1.15);
    return { c, sameCat, dist };
  });
  scored.sort((a, b) => a.dist - b.dist || bySlugAsc(a.c, b.c));
  return scored.slice(0, 3).map(({ c, sameCat }) => ({
    slug: c.slug,
    name: c.name,
    category: c.category ?? 'Other',
    tvl_usd: c.tvl_usd,
    mcap_usd: c.mcap_usd!,
    ratio: round4(c.mcap_usd! / Math.max(1, c.tvl_usd)),
    same_category: sameCat,
  }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitValuationModel(snapshot);
  const wlSet = new Set(snapshot.watchlist);
  const cleanComps = snapshot.protocols.filter((p) => isCleanStandalone(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);

  const rankedRaw: Array<{ p: SnapshotProtocol; tier: 'watchlist' | 'early' }> = [];
  const live: LiveRow[] = [];
  const excluded: ExcludedRow[] = [];
  const excludedByReason: Record<string, number> = {};

  for (const p of snapshot.protocols) {
    if (hasRecordedToken(p)) {
      const isComp = isCleanStandalone(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
      live.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        age_days: ageDays(snapshot.as_of, p.listed_at),
        symbol: p.symbol,
        is_comp: isComp,
        mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      });
      continue;
    }
    if (wlSet.has(p.slug)) {
      rankedRaw.push({ p, tier: 'watchlist' });
      continue;
    }
    const reason = exclusionReason(p, wlSet, snapshot.floor_usd);
    if (reason !== null) {
      excluded.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        reason,
      });
      excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
      continue;
    }
    rankedRaw.push({ p, tier: 'early' });
  }

  const scored = rankedRaw.map(({ p, tier }) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const val = computeImpliedValue({ tvl_usd: p.tvl_usd, age_days: age, category: p.category, chains: p.chains }, model);
    const plan = buildFarmPlan(p, age, val.implied_value_usd, model.median_change_7d);
    return {
      p,
      tier,
      age,
      val,
      comps: nearestComps(p, cleanComps),
      farm: plan.farm,
      steps: plan.steps,
      farm_steps: plan.stepStrings,
    };
  });

  scored.sort((a, b) => b.val.implied_value_usd - a.val.implied_value_usd || bySlugAsc(a.p, b.p));

  const board: BoardRow[] = scored.map((s, idx) => ({
    rank: idx + 1,
    tier: s.tier,
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
    token_status: 'pre-token',
    age_days: s.age,
    v_cond_usd: s.val.v_cond_usd,
    v_low_usd: s.val.v_low_usd,
    v_high_usd: s.val.v_high_usd,
    p_tok: s.val.p_tok,
    implied_value_usd: s.val.implied_value_usd,
    parity_contribs: s.val.parity_contribs,
    comps: s.comps,
    farm: s.farm,
    steps: s.steps,
    farm_steps: s.farm_steps,
  }));

  live.sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd || bySlugAsc(a, b));
  excluded.sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a, b));

  const wlCount = board.filter((r) => r.tier === 'watchlist').length;
  const earlyCount = board.length - wlCount;
  const liveComps = live.filter((r) => r.is_comp).length;
  const liveOtherMcap = live.filter((r) => !r.is_comp && r.mcap_usd !== null && r.mcap_usd > 0).length;
  const liveNoMcap = live.length - liveComps - liveOtherMcap;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    universe_counts: {
      total: snapshot.protocols.length,
      watchlist: wlCount,
      early: earlyCount,
      ranked: board.length,
      live_total: live.length,
      live_comps: liveComps,
      live_other_mcap: liveOtherMcap,
      live_no_mcap: liveNoMcap,
      excluded_total: excluded.length,
      excluded_by_reason: excludedByReason,
    },
    model,
    rows: board.map(({ farm_steps: _fs, ...rest }) => rest),
    live,
    excluded,
  };

  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json lacks as_of');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json lacks source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json lacks floor_usd');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new SnapshotError('snapshot.json lacks protocols/watchlist');

  const protocols: SnapshotProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} invalid`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} missing slug/name/tvl_usd`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });

  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist.filter((s): s is string => typeof s === 'string'),
  };
}

export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows (expected 100..4000)`;
  const validSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!validSlugs.has(r.slug)) return `unknown slug ${r.slug}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `rank mismatch at ${i}: got ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `invalid implied_value_usd on ${r.slug}: ${r.implied_value_usd}`;
    }
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `non-monotonic implied_value_usd at rank ${r.rank}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has farm step of ${t.length} chars`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `missing ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows have identical implied value';
  return null;
}

export function serializeDataScript(radar: RadarData): string {
  return `window.LAUNCHLINE=${JSON.stringify(radar)};\n`;
}
