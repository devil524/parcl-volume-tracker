# Parcl Volume Tracker

Community dashboard (Cloudflare Worker + static page) for Parcl V4 account volume.

## Windows (UTC)
- **Daily:** resets 00:00 UTC.
- **Weekly:** Week 1 = Nov 5 05:30 → Nov 12 05:30 UTC; every week is 7 days (resets Thursday 05:30 UTC).

## Endpoints
- `GET /api/volume?accountId=ID`: trailing-30-day and lifetime volume from the public Parcl account endpoint.
- `GET /api/periods`: current daily and weekly window boundaries.
- `POST /api/volume-preview`: body `{ "trades": [{ "timestamp": ms, "notionalUSD": 123.45 }] }` returns daily/weekly/total volume.
- `GET /api/health`

## Limits
Daily and weekly totals need fill history, which requires an API key. The key can place trades, so it must never go into this site. Compute those totals locally (see the Python tracker script) or paste fills into `/api/volume-preview`. Figures are estimates; official weekly totals are the ones after review.

## Deploy
`npx wrangler deploy` (D1 binding `DB` is configured but not used yet).
