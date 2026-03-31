/**
 * Crypto price provider using CoinGecko (free, no auth).
 * Jupiter requires auth now, so we use CoinGecko for spot prices
 * and calculate swap estimates from there.
 */
import { TTLCache } from "../cache.js";

const cache = new TTLCache<CryptoQuote>();

// CoinGecko IDs for common tokens
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  EURC: "euro-coin",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
};

// Stablecoins pegged 1:1 to fiat
const STABLECOIN_PEGS: Record<string, string> = {
  USDC: "USD",
  USDT: "USD",
  DAI: "USD",
  EURC: "EUR",
};

export interface CryptoQuote {
  from: string;
  to: string;
  inputAmount: number;
  outputAmount: number;
  rate: number;
  priceImpactEstimate: string;
  source: string;
  timestamp: string;
}

export async function getJupiterQuote(from: string, to: string, amount: number): Promise<CryptoQuote> {
  const key = `${from}-${to}-${amount}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  // Get prices in USD for both tokens
  const fromPrice = await getTokenPriceUSD(fromUpper);
  const toPrice = await getTokenPriceUSD(toUpper);

  if (!fromPrice || !toPrice) {
    throw new Error(`Price not available for ${!fromPrice ? fromUpper : toUpper}`);
  }

  const inputValueUSD = amount * fromPrice;
  // Estimate 0.3% DEX fee + slippage for non-stablecoin swaps
  const isStableSwap = STABLECOIN_PEGS[fromUpper] && STABLECOIN_PEGS[toUpper];
  const feeMultiplier = isStableSwap ? 0.999 : 0.997;
  const outputAmount = (inputValueUSD * feeMultiplier) / toPrice;
  const rate = outputAmount / amount;

  const result: CryptoQuote = {
    from: fromUpper,
    to: toUpper,
    inputAmount: amount,
    outputAmount: Math.round(outputAmount * 1e6) / 1e6,
    rate: Math.round(rate * 1e8) / 1e8,
    priceImpactEstimate: isStableSwap ? "<0.01%" : amount * fromPrice > 10000 ? "0.1-0.5%" : "<0.1%",
    source: "CoinGecko (spot price estimate)",
    timestamp: new Date().toISOString(),
  };

  cache.set(key, result, 30_000); // 30s cache for crypto
  return result;
}

const priceCache = new TTLCache<number>();

async function getTokenPriceUSD(symbol: string): Promise<number | null> {
  // Stablecoins: return peg value
  if (STABLECOIN_PEGS[symbol] === "USD") return 1.0;
  if (STABLECOIN_PEGS[symbol] === "EUR") {
    // Get EUR/USD rate from cache or fetch
    const cached = priceCache.get("EURC");
    if (cached) return cached;
    // Approximate: fetch from CoinGecko
  }

  const cgId = COINGECKO_IDS[symbol];
  if (!cgId) return null;

  const cached = priceCache.get(symbol);
  if (cached) return cached;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`;
  const res = await fetch(url, {
    headers: { "User-Agent": "fx-mcp/0.1.0" },
  });

  if (!res.ok) {
    throw new Error(`CoinGecko API error: ${res.status}`);
  }

  const data = await res.json() as any;
  const price = data[cgId]?.usd;
  if (price) {
    priceCache.set(symbol, price, 30_000);
  }
  return price || null;
}

export function getSupportedTokens(): string[] {
  return Object.keys(COINGECKO_IDS);
}
