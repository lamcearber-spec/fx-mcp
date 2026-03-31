# fx-mcp

MCP server for AI agents — real-time FX rates, crypto quotes, DeFi yields, and market data.

## Install

```bash
# Claude Code
claude mcp add fx-mcp -- npx fx-mcp

# Manual
npx fx-mcp
```

## 8 Tools

| Tool | Description | Source |
|------|-------------|--------|
| `get_fx_rate` | Real-time FX rate with Wise competitor comparison | ECB + Wise |
| `get_crypto_quote` | Crypto token swap estimate | CoinGecko |
| `estimate_total_cost` | Compare Wise vs bank vs crypto for cross-border payments | Multi |
| `convert_currency` | Quick conversion across 166 fiat currencies | Open Exchange Rates |
| `get_rate_history` | Historical FX rates (up to 90 days) | ECB |
| `get_stablecoin_yields` | Top DeFi yields for USDC, USDT, DAI, EURC | DeFi Llama |
| `get_market_overview` | Market snapshot: ECB rate, fear/greed, gas, FX | Multi |
| `list_supported_pairs` | Available fiat + crypto currencies | — |

## Examples

- "What is the EUR to USD rate right now?"
- "Convert 5000 EUR to Turkish Lira"
- "What is the cheapest way to send 2000 EUR to GBP?"
- "Where can I get the best yield on USDC?"
- "Give me a market overview"
- "Show me EUR/GBP rate history for the last 30 days"
- "Get me a quote to swap 1000 USDC to SOL"

## No API keys required

All data sources are public and free:
- ECB Data API (FX rates, interest rates)
- Wise Comparison API (provider rates)
- CoinGecko (crypto prices)
- DeFi Llama (yields)
- Open Exchange Rates (166 currencies)
- Alternative.me (Fear & Greed Index)

## License

MIT
