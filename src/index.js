
const WEEK_ANCHOR = Date.UTC(2026, 10, 5, 5, 30);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function calculateVolume(trades) {
  const now = new Date();
  const nowMs = now.getTime();

  // Daily tracking starts at 00:00 UTC
  const todayStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  // Weekly tracking starts November 5, 2026
  // at 05:30 UTC and repeats every 7 days
  const weekNumber = Math.floor(
    (nowMs - WEEK_ANCHOR) / WEEK_MS
  );

  const weekStart =
    WEEK_ANCHOR + weekNumber * WEEK_MS;

  const weekEnd = weekStart + WEEK_MS;

  let today = 0;
  let week = 0;
  let total = 0;

  let todayTrades = 0;
  let weekTrades = 0;
  let totalTrades = 0;

  for (const trade of trades) {
    const timestamp = Date.parse(trade.timestamp);
    const volume = Number(trade.notionalUSD);

    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(volume) ||
      volume < 0
    ) {
      throw new Error("Invalid trade data");
    }

    // Ignore future trades
    if (timestamp > nowMs) continue;

    // Lifetime volume
    total += volume;
    totalTrades++;

    // Weekly volume
    if (
      timestamp >= weekStart &&
      timestamp < weekEnd
    ) {
      week += volume;
      weekTrades++;
    }

    // Daily volume
    if (timestamp >= todayStart) {
      today += volume;
      todayTrades++;
    }
  }

  return {
    today: Number(today.toFixed(2)),
    week: Number(week.toFixed(2)),
    total: Number(total.toFixed(2)),

    todayTrades,
    weekTrades,
    totalTrades,

    currency: "USD",
    timezone: "UTC",

    dailyReset: "00:00 UTC",
    weeklyReset: "Thursday 05:30 UTC",

    weekStart: new Date(weekStart).toISOString(),
    weekEnd: new Date(weekEnd).toISOString()
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        database: Boolean(env.DB)
      });
    }

    // Daily and weekly volume calculator
    if (url.pathname === "/api/volume-preview") {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Use POST" },
          { status: 405 }
        );
      }

      try {
        const length = Number(
          request.headers.get("content-length") || 0
        );

        if (length > 65536) {
          return Response.json(
            { error: "Request too large" },
            { status: 413 }
          );
        }

        const body = await request.text();

        if (body.length > 65536) {
          return Response.json(
            { error: "Request too large" },
            { status: 413 }
          );
        }

        const data = JSON.parse(body);

        if (
          !Array.isArray(data.trades) ||
          data.trades.length > 500
        ) {
          return Response.json(
            { error: "Invalid trades array" },
            { status: 400 }
          );
        }

        const result = calculateVolume(data.trades);

        return Response.json(result, {
          headers: {
            "Cache-Control": "no-store"
          }
        });
      } catch {
        return Response.json(
          { error: "Invalid trade data" },
          { status: 400 }
        );
      }
    }

    // Serve the website
    return env.ASSETS.fetch(request);
  }
};

