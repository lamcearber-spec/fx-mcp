/**
 * DeFi yield provider using DeFi Llama (free, no auth).
 */
import { TTLCache } from "../cache.js";

const cache = new TTLCache<YieldPool[]>();

export interface YieldPool {
  symbol: string;
  project: string;
  chain: string;
  apy: number;
  tvlUsd: number;
  pool: string;
}

export async function getStablecoinYields(symbol?: string): Promise<YieldPool[]> {
  const key = symbol || "all";
  const cached = cache.get(key);
  if (cached) return cached;

  const res = await fetch("https://yields.llama.fi/pools", {
    headers: { "User-Agent": "fx-mcp/0.1.0" },
  });
  if (!res.ok) throw new Error(`DeFi Llama error: ${res.status}`);

  const data = await res.json() as any;
  const stableSymbols = symbol
    ? [symbol.toUpperCase()]
    : ["USDC", "USDT", "DAI", "EURC"];

  const pools: YieldPool[] = data.data
    .filter((p: any) =>
      stableSymbols.includes(p.symbol) &&
      p.tvlUsd > 1_000_000 &&
      p.apy > 0.1
    )
    .map((p: any) => ({
      symbol: p.symbol,
      project: p.project,
      chain: p.chain,
      apy: Math.round(p.apy * 100) / 100,
      tvlUsd: Math.round(p.tvlUsd),
      pool: p.pool,
    }))
    .sort((a: YieldPool, b: YieldPool) => b.apy - a.apy)
    .slice(0, 20);

  cache.set(key, pools, 300_000); // 5 min cache
  return pools;
}
