import type { OracleInfo, OracleHealth, OracleRiskScore, OracleRiskDimension } from './oracleTypes';
import { gradeFromScore } from './oracleTypes';

// ============================================================
// 5-Dimension Oracle Risk Scoring (0-100 each, weighted)
//
// 1. Freshness     — Is the oracle responding? How fast?
// 2. Reliability   — Oracle type trustworthiness
// 3. Decentralization — How decentralized is the feed?
// 4. Coverage      — Is it a recognized provider with wide coverage?
// 5. Implementation — Is it wrapped via MorphoOracleV2? Push vs pull?
// ============================================================

const DIMENSION_WEIGHTS = {
  freshness: 0.30,
  reliability: 0.25,
  decentralization: 0.20,
  coverage: 0.15,
  implementation: 0.10,
};

export function scoreOracle(
  info: OracleInfo,
  health: OracleHealth | null,
): OracleRiskScore {
  const dimensions: OracleRiskDimension[] = [
    scoreFreshness(health),
    scoreReliability(info),
    scoreDecentralization(info),
    scoreCoverage(info),
    scoreImplementation(info),
  ];

  const overall = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
  );

  return {
    address: info.address,
    chainId: info.chainId,
    overall,
    grade: gradeFromScore(overall),
    dimensions,
    computedAt: Date.now(),
  };
}

// ============================================================
// Dimension Scorers
// ============================================================

function scoreFreshness(health: OracleHealth | null): OracleRiskDimension {
  if (!health) {
    return {
      name: 'Freshness',
      score: 0,
      weight: DIMENSION_WEIGHTS.freshness,
      rationale: 'No health data available',
    };
  }

  if (!health.isResponding) {
    return {
      name: 'Freshness',
      score: 10,
      weight: DIMENSION_WEIGHTS.freshness,
      rationale: `Oracle not responding: ${health.error ?? 'unknown error'}`,
    };
  }

  // Score based on latency
  let score: number;
  let rationale: string;

  if (health.latencyMs < 500) {
    score = 100;
    rationale = `Responding in ${health.latencyMs}ms — excellent`;
  } else if (health.latencyMs < 2000) {
    score = 80;
    rationale = `Responding in ${health.latencyMs}ms — good`;
  } else if (health.latencyMs < 5000) {
    score = 50;
    rationale = `Responding in ${health.latencyMs}ms — slow`;
  } else {
    score = 25;
    rationale = `Responding in ${health.latencyMs}ms — very slow`;
  }

  // Bonus for having a valid price
  if (health.currentPrice && health.currentPrice > 0n) {
    score = Math.min(score + 5, 100);
  }

  return {
    name: 'Freshness',
    score,
    weight: DIMENSION_WEIGHTS.freshness,
    rationale,
  };
}

function scoreReliability(info: OracleInfo): OracleRiskDimension {
  const typeScores: Record<string, { score: number; rationale: string }> = {
    'chainlink-push': { score: 95, rationale: 'Chainlink push aggregator — industry standard' },
    'chainlink-data-streams': { score: 85, rationale: 'Chainlink Data Streams — newer, reliable but less battle-tested' },
    'chainlink-v2': { score: 90, rationale: 'MorphoChainlinkOracleV2 — audited, deterministic' },
    'chainlink-erc4626-hybrid': { score: 82, rationale: 'Chainlink + ERC-4626 vault — more complexity' },
    'erc4626-exchange-rate': { score: 65, rationale: 'ERC-4626 exchange rate — depends on vault implementation' },
    'morpho-oracle-v2': { score: 90, rationale: 'Morpho OracleV2 wrapper — standardized, audited' },
    'morpho-oracle-unknown': { score: 40, rationale: 'Morpho oracle with unknown feed configuration' },
    'pyth': { score: 75, rationale: 'Pyth Network — widely used pull oracle' },
    'redstone': { score: 70, rationale: 'RedStone — growing pull oracle provider' },
    'api3': { score: 65, rationale: 'API3 — first-party oracle, less adoption' },
    'custom': { score: 30, rationale: 'Unknown oracle type — cannot assess reliability' },
    'none': { score: 0, rationale: 'No oracle configured' },
  };

  const entry = typeScores[info.type] ?? typeScores['custom'];
  return {
    name: 'Reliability',
    score: entry.score,
    weight: DIMENSION_WEIGHTS.reliability,
    rationale: entry.rationale,
  };
}

function scoreDecentralization(info: OracleInfo): OracleRiskDimension {
  const typeScores: Record<string, { score: number; rationale: string }> = {
    'chainlink-push': { score: 90, rationale: 'Decentralized node network with multiple data sources' },
    'chainlink-data-streams': { score: 80, rationale: 'DON-based but newer architecture' },
    'chainlink-v2': { score: 85, rationale: 'Inherits Chainlink DON decentralization via audited wrapper' },
    'chainlink-erc4626-hybrid': { score: 78, rationale: 'Chainlink DON + vault dependency adds centralization surface' },
    'erc4626-exchange-rate': { score: 55, rationale: 'Vault exchange rate — single contract dependency' },
    'morpho-oracle-v2': { score: 85, rationale: 'Inherits decentralization from underlying feeds' },
    'morpho-oracle-unknown': { score: 30, rationale: 'Unknown feeds — cannot assess decentralization' },
    'pyth': { score: 75, rationale: 'Multiple first-party data publishers' },
    'redstone': { score: 60, rationale: 'Limited node set, relies on signed data' },
    'api3': { score: 55, rationale: 'First-party operated, single provider risk' },
    'custom': { score: 20, rationale: 'Unknown decentralization — potentially single operator' },
    'none': { score: 0, rationale: 'No oracle' },
  };

  const entry = typeScores[info.type] ?? typeScores['custom'];
  return {
    name: 'Decentralization',
    score: entry.score,
    weight: DIMENSION_WEIGHTS.decentralization,
    rationale: entry.rationale,
  };
}

function scoreCoverage(info: OracleInfo): OracleRiskDimension {
  const typeScores: Record<string, { score: number; rationale: string }> = {
    'chainlink-push': { score: 95, rationale: 'Broadest asset coverage and chain support' },
    'chainlink-data-streams': { score: 80, rationale: 'Growing coverage via Data Streams' },
    'chainlink-v2': { score: 88, rationale: 'Chainlink feeds via Morpho wrapper — broad coverage' },
    'chainlink-erc4626-hybrid': { score: 80, rationale: 'Chainlink + vault — good coverage for yield-bearing assets' },
    'erc4626-exchange-rate': { score: 60, rationale: 'ERC-4626 vault rate — limited to vault-specific pairs' },
    'morpho-oracle-v2': { score: 85, rationale: 'Supports any pair via base/quote composition' },
    'morpho-oracle-unknown': { score: 35, rationale: 'Unknown feeds — coverage cannot be assessed' },
    'pyth': { score: 85, rationale: 'Extensive asset and chain coverage' },
    'redstone': { score: 65, rationale: 'Moderate coverage, focused on DeFi pairs' },
    'api3': { score: 50, rationale: 'Limited coverage compared to major providers' },
    'custom': { score: 15, rationale: 'Unknown coverage — may be a bespoke feed' },
    'none': { score: 0, rationale: 'No oracle' },
  };

  const entry = typeScores[info.type] ?? typeScores['custom'];
  return {
    name: 'Coverage',
    score: entry.score,
    weight: DIMENSION_WEIGHTS.coverage,
    rationale: entry.rationale,
  };
}

function scoreImplementation(info: OracleInfo): OracleRiskDimension {
  let score = 50;
  const reasons: string[] = [];

  // Morpho wrapper bonus
  if (info.isMorphoWrapper) {
    score += 25;
    reasons.push('Uses audited Morpho OracleV2 wrapper');
  }

  // Push model is simpler and more battle-tested
  if (info.model === 'push') {
    score += 15;
    reasons.push('Push model — always on-chain');
  } else if (info.model === 'pull') {
    score += 5;
    reasons.push('Pull model — requires off-chain update');
  }

  // Known type bonus
  if (info.type !== 'custom' && info.type !== 'none') {
    score += 10;
    reasons.push('Recognized oracle type');
  }

  score = Math.min(score, 100);

  return {
    name: 'Implementation',
    score,
    weight: DIMENSION_WEIGHTS.implementation,
    rationale: reasons.join('. ') || 'Unknown implementation',
  };
}
