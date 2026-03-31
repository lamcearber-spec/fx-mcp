#!/usr/bin/env node
/**
 * fx-mcp — MCP server for AI agents
 * Real-time FX rates, crypto quotes, and cross-border payment routing.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getECBRate, getECBHistory } from "./providers/ecb.js";
import { getWiseRate } from "./providers/wise.js";
import { getJupiterQuote, getSupportedTokens } from "./providers/jupiter.js";
import { getStablecoinYields } from "./providers/yields.js";
import { getECBInterestRate, getFearGreedIndex, getAllFXRates, getEthGasPrice } from "./providers/macro.js";

const server = new McpServer({
  name: "fx-mcp",
  version: "0.1.0",
});

// ── Tool 1: get_fx_rate ──────────────────────────────────────
server.tool(
  "get_fx_rate",
  "Get real-time FX rate from ECB and Wise for a currency pair",
  {
    from: z.string().describe("Source currency (ISO 4217, e.g. EUR, USD, GBP)"),
    to: z.string().describe("Target currency (ISO 4217, e.g. USD, GBP, JPY)"),
  },
  async ({ from, to }) => {
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();
    const lines: string[] = [
      `${fromUpper} → ${toUpper} Exchange Rate`,
      `─────────────────────────────`,
    ];

    // ECB rate
    try {
      const ecb = await getECBRate(fromUpper, toUpper);
      lines.push(`ECB rate:    1 ${fromUpper} = ${ecb.rate} ${toUpper} (${ecb.date})`);
    } catch (e: any) {
      lines.push(`ECB:         ${e.message}`);
    }

    // Wise rate
    try {
      const wise = await getWiseRate(fromUpper, toUpper);
      if (wise.wiseRate) {
        lines.push(`Wise rate:   1 ${fromUpper} = ${wise.wiseRate} ${toUpper} (fee: ${wise.wiseFee} ${fromUpper})`);
      }
      if (wise.competitors.length > 0) {
        lines.push(`\nCompetitor rates (for 1000 ${fromUpper}):`);
        for (const c of wise.competitors.slice(0, 3)) {
          lines.push(`  ${c.name}: rate ${c.rate}, fee ${c.fee}, receive ${c.receive} ${toUpper}`);
        }
      }
    } catch (e: any) {
      lines.push(`Wise:        ${e.message}`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool 2: get_crypto_quote ─────────────────────────────────
server.tool(
  "get_crypto_quote",
  "Get a crypto swap quote for token pairs (uses CoinGecko spot prices)",
  {
    from: z.string().describe("Source token symbol (e.g. USDC, SOL, ETH)"),
    to: z.string().describe("Target token symbol (e.g. SOL, USDC, BTC)"),
    amount: z.number().positive().describe("Amount of source token to swap"),
  },
  async ({ from, to, amount }) => {
    try {
      const quote = await getJupiterQuote(from, to, amount);
      const lines = [
        `${quote.from} → ${quote.to} Quote`,
        `─────────────────────────────`,
        `Input:        ${quote.inputAmount} ${quote.from}`,
        `Output:       ${quote.outputAmount} ${quote.to}`,
        `Rate:         1 ${quote.from} = ${quote.rate} ${quote.to}`,
        `Price impact: ${quote.priceImpactEstimate}`,
        `Source:       ${quote.source}`,
        `Note:         Estimate based on spot price. Actual DEX swap may vary.`,
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Crypto quote failed: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool 3: estimate_total_cost ──────────────────────────────
server.tool(
  "estimate_total_cost",
  "Compare total cost of sending money via Wise, bank transfer, or crypto",
  {
    from: z.string().describe("Source currency (ISO 4217, e.g. EUR)"),
    to: z.string().describe("Target currency (ISO 4217, e.g. USD)"),
    amount: z.number().positive().describe("Amount in source currency"),
  },
  async ({ from, to, amount }) => {
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();
    const lines: string[] = [
      `Cost Comparison: ${amount} ${fromUpper} → ${toUpper}`,
      `═══════════════════════════════════════`,
    ];

    // Get ECB mid rate as baseline
    let midRate = 0;
    try {
      const ecb = await getECBRate(fromUpper, toUpper);
      midRate = ecb.rate;
      lines.push(`Mid-market rate: 1 ${fromUpper} = ${midRate} ${toUpper}`);
      lines.push(``);
    } catch {
      lines.push(`Could not fetch mid-market rate\n`);
    }

    // Wise
    try {
      const wise = await getWiseRate(fromUpper, toUpper, amount);
      if (wise.wiseRate) {
        const costPct = midRate > 0
          ? (((midRate * amount - wise.wiseReceive) / (midRate * amount)) * 100).toFixed(2)
          : "?";
        lines.push(`💚 Wise`);
        lines.push(`  Rate:    ${wise.wiseRate}`);
        lines.push(`  Fee:     ${wise.wiseFee} ${fromUpper}`);
        lines.push(`  Receive: ${wise.wiseReceive} ${toUpper}`);
        lines.push(`  Cost:    ~${costPct}%`);
        lines.push(`  Speed:   Seconds to 1 business day`);
        lines.push(``);
      }
    } catch (e: any) {
      lines.push(`Wise: ${e.message}\n`);
    }

    // Bank estimate (1.5-2.5% spread + flat fee)
    if (midRate > 0) {
      const bankSpread = 0.02; // 2% typical
      const bankFlatFee = 15; // EUR typical SEPA international
      const bankRate = midRate * (1 - bankSpread);
      const bankReceive = (amount - bankFlatFee) * bankRate;
      const bankCostPct = (((midRate * amount - bankReceive) / (midRate * amount)) * 100).toFixed(2);
      lines.push(`🏦 Traditional Bank (estimate)`);
      lines.push(`  Rate:    ~${bankRate.toFixed(4)} (2% spread)`);
      lines.push(`  Fee:     ~${bankFlatFee} ${fromUpper}`);
      lines.push(`  Receive: ~${bankReceive.toFixed(2)} ${toUpper}`);
      lines.push(`  Cost:    ~${bankCostPct}%`);
      lines.push(`  Speed:   1-3 business days`);
      lines.push(``);
    }

    // Crypto route estimate (if stablecoin path exists)
    const stablecoinPairs: Record<string, string> = { USD: "USDC", EUR: "EURC" };
    const fromStable = stablecoinPairs[fromUpper];
    const toStable = stablecoinPairs[toUpper];
    if (fromStable && midRate > 0) {
      // Estimate: on-ramp fee (1%) + DEX swap (0.3%) + off-ramp (1%)
      const onRampFee = 0.01;
      const swapFee = 0.003;
      const offRampFee = 0.01;
      const totalCryptoFee = onRampFee + swapFee + offRampFee;
      const cryptoReceive = amount * midRate * (1 - totalCryptoFee);
      const cryptoCostPct = (totalCryptoFee * 100).toFixed(1);
      lines.push(`🔗 Crypto Route (${fromStable}→${toStable || "USDC"}→off-ramp)`);
      lines.push(`  On-ramp:  ~1% (fiat→${fromStable})`);
      lines.push(`  Swap:     ~0.3% (DEX)`);
      lines.push(`  Off-ramp: ~1% (${toStable || "USDC"}→fiat)`);
      lines.push(`  Receive:  ~${cryptoReceive.toFixed(2)} ${toUpper}`);
      lines.push(`  Cost:     ~${cryptoCostPct}%`);
      lines.push(`  Speed:    5-30 minutes (+ off-ramp time)`);
      lines.push(`  Note:     Requires crypto wallet + on/off-ramp account`);
      lines.push(``);
    }

    if (midRate > 0) {
      lines.push(`───────────────────────────────────────`);
      lines.push(`Best value at mid-market: ${(midRate * amount).toFixed(2)} ${toUpper}`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool 4: list_supported_pairs ─────────────────────────────
server.tool(
  "list_supported_pairs",
  "List all supported fiat currencies and crypto tokens",
  {},
  async () => {
    const fiat = [
      "EUR", "USD", "GBP", "CHF", "PLN", "SEK", "NOK", "DKK",
      "CZK", "HUF", "JPY", "AUD", "CAD", "TRY", "BRL", "INR",
    ];
    const crypto = getSupportedTokens();
    const stablecoins: Record<string, string[]> = {
      USD: ["USDC", "USDT", "DAI"],
      EUR: ["EURC"],
    };

    const lines = [
      `Supported Currencies`,
      `═════════════════════`,
      ``,
      `Fiat (via ECB + Wise):`,
      `  ${fiat.join(", ")}`,
      ``,
      `Crypto (via CoinGecko):`,
      `  ${crypto.join(", ")}`,
      ``,
      `Stablecoins:`,
      ...Object.entries(stablecoins).map(([currency, tokens]) =>
        `  ${currency}: ${tokens.join(", ")}`
      ),
      ``,
      `Note: FX rates sourced from ECB (daily) and Wise (real-time).`,
      `Crypto prices from CoinGecko (30s cache).`,
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool 5: get_rate_history ─────────────────────────────────
server.tool(
  "get_rate_history",
  "Get historical FX rates for a currency pair (up to 90 days)",
  {
    from: z.string().describe("Source currency (ISO 4217)"),
    to: z.string().describe("Target currency (ISO 4217)"),
    days: z.number().int().min(1).max(90).describe("Number of days of history (max 90)"),
  },
  async ({ from, to, days }) => {
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();

    try {
      const history = await getECBHistory(fromUpper, toUpper, days);

      if (history.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No historical data available for ${fromUpper}/${toUpper}` }],
        };
      }

      const rates = history.map((h) => h.rate);
      const min = Math.min(...rates);
      const max = Math.max(...rates);
      const avg = rates.reduce((a, b) => a + b, 0) / rates.length;

      const lines = [
        `${fromUpper}/${toUpper} — Last ${days} days`,
        `─────────────────────────────`,
        `Min:  ${min.toFixed(4)} (${history.find((h) => h.rate === min)?.date})`,
        `Max:  ${max.toFixed(4)} (${history.find((h) => h.rate === max)?.date})`,
        `Avg:  ${avg.toFixed(4)}`,
        `Current: ${rates[rates.length - 1]?.toFixed(4)}`,
        ``,
        `Daily rates:`,
        ...history.map((h) => `  ${h.date}: ${h.rate.toFixed(4)}`),
      ];

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `History failed: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Start server ─────────────────────────────────────────────

// ── Tool 6: get_stablecoin_yields ────────────────────────────
server.tool(
  "get_stablecoin_yields",
  "Get top DeFi yields for stablecoins (USDC, USDT, DAI, EURC) from DeFi Llama",
  {
    symbol: z.string().optional().describe("Filter by token symbol (e.g. USDC, EURC). Omit for all stablecoins."),
  },
  async ({ symbol }) => {
    try {
      const pools = await getStablecoinYields(symbol);
      if (pools.length === 0) {
        return { content: [{ type: "text" as const, text: "No yields found for " + (symbol || "stablecoins") }] };
      }
      const lines = [
        `Stablecoin Yields${symbol ? ` (${symbol.toUpperCase()})` : ""}`,
        "═══════════════════════════════════════",
        ...pools.map(p =>
          `${p.symbol.padEnd(8)} ${p.project.slice(0,20).padEnd(20)} ${p.chain.slice(0,14).padEnd(14)} ${(p.apy.toFixed(2) + "%").padStart(8)} ${("$" + (p.tvlUsd / 1e6).toFixed(1) + "M").padStart(12)}`
        ),
        "",
        "Source: DeFi Llama (pools with >$1M TVL)",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: "Yields error: " + e.message }], isError: true };
    }
  }
);

// ── Tool 7: get_market_overview ──────────────────────────────
server.tool(
  "get_market_overview",
  "Get a financial market snapshot: ECB interest rate, crypto fear/greed, ETH gas, top FX rates",
  {},
  async () => {
    const lines: string[] = [
      "Market Overview",
      "═══════════════════════════════════════",
    ];
    try {
      const ecb = await getECBInterestRate();
      lines.push(`ECB Main Refi Rate:  ${ecb.rate}% (${ecb.date})`);
    } catch (e: any) { lines.push("ECB Rate: " + e.message); }
    try {
      const fng = await getFearGreedIndex();
      lines.push(`Crypto Fear & Greed: ${fng.value}/100 — ${fng.classification}`);
    } catch (e: any) { lines.push("Fear & Greed: " + e.message); }
    try {
      const gas = await getEthGasPrice();
      lines.push(`ETH Gas (Gwei):      slow ${gas.slow} | std ${gas.standard} | fast ${gas.fast}`);
    } catch (e: any) { lines.push("ETH Gas: " + e.message); }
    try {
      const fx = await getAllFXRates("EUR");
      lines.push("");
      lines.push("Key EUR Rates:");
      for (const p of ["USD", "GBP", "CHF", "JPY", "PLN", "SEK", "NOK", "DKK", "CZK", "TRY"]) {
        if (fx.rates[p]) lines.push(`  EUR/${p}: ${fx.rates[p].toFixed(4)}`);
      }
    } catch (e: any) { lines.push("FX rates: " + e.message); }
    lines.push("");
    lines.push("Sources: ECB, Alternative.me, Etherscan, Open Exchange Rates");
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool 8: convert_currency ─────────────────────────────────
server.tool(
  "convert_currency",
  "Quick currency conversion using live rates (supports 166 fiat currencies)",
  {
    from: z.string().describe("Source currency code (e.g. EUR, USD, BRL, INR)"),
    to: z.string().describe("Target currency code (e.g. GBP, JPY, TRY)"),
    amount: z.number().positive().describe("Amount to convert"),
  },
  async ({ from, to, amount }) => {
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();
    try {
      const fx = await getAllFXRates(fromUpper);
      const rate = fx.rates[toUpper];
      if (!rate) {
        return { content: [{ type: "text" as const, text: `Currency ${toUpper} not found.` }], isError: true };
      }
      const result = amount * rate;
      const text = `${amount} ${fromUpper} = ${result.toFixed(2)} ${toUpper}\nRate: 1 ${fromUpper} = ${rate} ${toUpper}\nSource: Open Exchange Rates`;
      return { content: [{ type: "text" as const, text }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: "Conversion error: " + e.message }], isError: true };
    }
  }
);


// ── Telemetry (anonymous install counter) ────────────────────
async function pingTelemetry() {
  try {
    await fetch("https://radom.group/fx-ping", {
      method: "GET",
      headers: { "User-Agent": "fx-mcp/0.2.0" },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Silent fail — telemetry is optional
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("fx-mcp server running on stdio");
  pingTelemetry();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
