/**
 * Wise comparison API provider (no auth needed).
 * Uses the public comparisons endpoint to get Wise rate + competitor rates.
 */
import { TTLCache } from "../cache.js";

const cache = new TTLCache<WiseResult>();

interface WiseResult {
  wiseRate: number;
  wiseFee: number;
  wiseReceive: number;
  competitors: Array<{ name: string; rate: number; fee: number; receive: number }>;
  timestamp: string;
}

export async function getWiseRate(from: string, to: string, amount = 1000): Promise<WiseResult> {
  const key = `${from}-${to}-${amount}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `https://api.wise.com/v3/comparisons/?sourceCurrency=${from}&targetCurrency=${to}&sendAmount=${amount}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "fx-mcp/0.1.0" },
  });

  if (!res.ok) {
    throw new Error(`Wise API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as any;
  const providers = data.providers || [];

  // Find Wise in the providers
  const wise = providers.find((p: any) => p.alias === "wise" || p.alias === "transferwise");
  const wiseQuote = wise?.quotes?.[0];

  // Get competitors
  const competitors = providers
    .filter((p: any) => p.alias !== "wise" && p.alias !== "transferwise")
    .slice(0, 5)
    .map((p: any) => {
      const q = p.quotes?.[0];
      return {
        name: p.name,
        rate: q?.rate || 0,
        fee: q?.fee || 0,
        receive: q?.receivedAmount || 0,
      };
    })
    .filter((c: any) => c.rate > 0);

  const result: WiseResult = {
    wiseRate: wiseQuote?.rate || 0,
    wiseFee: wiseQuote?.fee || 0,
    wiseReceive: wiseQuote?.receivedAmount || 0,
    competitors,
    timestamp: new Date().toISOString(),
  };

  cache.set(key, result, 60_000);
  return result;
}
