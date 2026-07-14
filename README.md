# Earning Call Analyzer

A live-search earnings-call event-study tool. Search by ticker or company name to compare realized and benchmark-expected returns, extract transcript-supported event drivers, and generate an eight-quarter analysis report.

The application does not use a prebuilt company allowlist or a bundled earnings-call dataset. Every submitted search resolves the security online and requests current public price, earnings and transcript data. Company names are matched case-insensitively, and exchange-qualified symbols such as `0700.HK`, `000660.KS`, `RELIANCE.NS` and `AIR.PA` are supported through global market lookup.

## Run locally

Requires Node.js 18 or newer.

```bash
npm run dev
```

Open [http://localhost:4173/earnings_call_analyzer.html](http://localhost:4173/earnings_call_analyzer.html).

## Analysis window

- Stocks with more than eight available earnings calls use the latest eight quarters.
- Stocks with eight or fewer available calls use all available quarters.
- Every search bypasses application caching and queries live public providers.
- The server combines Yahoo Finance, Nasdaq, MarketBeat, Macrotrends and public transcript pages, with source availability varying by issuer and market.
- For a newly listed ADR or secondary listing, the analyzer can discover and disclose the same issuer's longer-running primary listing.
- Transcript event extraction is presented as a supported attribution hypothesis, not proof that one event was the sole cause of a stock move.

Public web coverage is not identical for every exchange. Paywalled, licensed, blocked or unpublished transcripts cannot be legally or technically treated as public data; when transcript evidence cannot be verified, the interface reports that limitation instead of inventing a driver or substituting bundled sample data.

Set `OPENAI_API_KEY` before starting the server to enable AI-assisted driver writing. Without it, the application uses its deterministic transcript-event extraction pipeline.
