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

## How daily/weekly volume works
No API key is needed. The Worker saves snapshots of an account's public `lifetimeVolume` in D1 (on every lookup, and every 15 minutes via a cron trigger for tracked accounts, up to 25). Today = lifetime now minus lifetime at 00:00 UTC. This week = lifetime now minus lifetime at the week start (Thursday 05:30 UTC).
- Tracking begins the first time an account ID is looked up. Until a snapshot exists at the start of a window, that figure is marked "counting since …".
- Figures are estimates; official weekly totals are the ones after review.
- Never put a trading-enabled API key into this site.

## One-time setup
```bash
npx wrangler d1 execute parcl-tracker-db --remote --file=schema.sql
npx wrangler deploy
```
Then open the site and look up your account ID once; the cron job keeps snapshotting it.
