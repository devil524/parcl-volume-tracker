
const WEEK_ANCHOR = Date.UTC(2026, 10, 5, 5, 30);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getPeriods(now = Date.now()) {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const weekIndex = Math.floor(
    (now - WEEK_ANCHOR) / WEEK_MS
  );
  const weekStart = WEEK_ANCHOR + weekIndex * WEEK_MS;

  return {
    now,
    dayStart,
    dayEnd: dayStart + DAY_MS,
    weekStart,
    weekEnd: weekStart + WEEK_MS,
    weekNumber: weekIndex + 1
  };
}

function periodDetails(p) {
  return {
    timezone: "UTC",
    dailyReset: "00:00 UTC",
    weeklyReset: "Thursday 05:30 UTC",
    dailyStart: new Date(p.dayStart).toISOString(),
    dailyEnd: new Date(p.dayEnd).toISOString(),
    weekNumber: p.weekNumber,
    weekStart: new Date(p.weekStart).toISOString(),
    weekEnd: new Date(p.weekEnd).toISOString(),
    nextDailyReset: new Date(p.dayEnd).toISOString(),
    nextWeeklyReset: new Date(p.weekEnd).toISOString()
  };
}

function calculateVolume(trades, now = Date.now()) {
  const p = getPeriods(now);

  let today = 0;
  let week = 0;
  let total = 0;

  let todayTrades = 0;
  let weekTrades = 0;
  let totalTrades = 0;

  for (const trade of trades) {
    const timestamp =
      typeof trade.timestamp === "number"
        ? trade.timestamp
        : Date.parse(trade.timestamp);

    const volume = Number(trade.notionalUSD);

    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(volume) ||
      volume < 0
    ) {
      throw new Error("Invalid trade data");
    }

    if (timestamp > now) continue;

    total += volume;
    totalTrades++;

    if (
      timestamp >= p.dayStart &&
      timestamp < p.dayEnd
    ) {
      today += volume;
      todayTrades++;
    }

    if (
      timestamp >= p.weekStart &&
      timestamp < p.weekEnd
    ) {
      week += volume;
      weekTrades++;
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
    ...periodDetails(p)
  };
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function formatUSD(value) {
  if (!/^\d+$/.test(String(value))) {
    throw new Error("Invalid Parcl volume");
  }

  const units = BigInt(value);
  const dollars = units / 1000000n;
  const cents = (units % 1000000n) / 10000n;

  return (
    dollars.toString() +
    "." +
    cents.toString().padStart(2, "0")
  );
}

async function getPublicAccount(accountId) {
  const response = await fetch(
    `https://validator.v4.parcl.co/v1/accounts/${accountId}`,
    {
      headers: { Accept: "application/json" }
    }
  );


if (!response.ok) {
  return json({
    error: "Parcl account lookup failed",
    parclStatus: response.status,
    accountId,
    message: response.status === 404
      ? "Account not found. Check your account ID."
      : response.status === 403
      ? "Access denied by Parcl API."
      : response.status === 429
      ? "Rate limit reached. Try later."
      : "Parcl API returned an error."
  }, response.status === 404 ? 404 : 502);
}


  const account = await response.json();

  try {
    return json({
      accountId,
      today: null,
      week: null,
      volume30d: formatUSD(account.volume30d),
      lifetime: formatUSD(account.lifetimeVolume),
      currency: "USD",
      dailyWeeklyStatus: "trade_history_required",
      ...periodDetails(getPeriods())
    });
  } catch {
    return json(
      { error: "Unexpected Parcl account data" },
      502
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        status: "ok",
        database: Boolean(env.DB)
      });
    }

    if (url.pathname === "/api/periods") {
      return json(periodDetails(getPeriods()));
    }

    if (url.pathname === "/api/volume") {
      if (request.method !== "GET") {
        return json({ error: "Use GET" }, 405);
      }

      const accountId = url.searchParams.get("accountId");

      if (!accountId || !/^\d{1,20}$/.test(accountId)) {
        return json({ error: "Valid account ID required" }, 400);
      }

      try {
        return await getPublicAccount(accountId);
      } catch {
        return json(
          { error: "Unable to contact Parcl" },
          502
        );
      }
    }

    if (url.pathname === "/api/volume-preview") {
      if (request.method !== "POST") {
        return json({ error: "Use POST" }, 405);
      }

      try {
        const length = Number(
          request.headers.get("content-length") || 0
        );

        if (length > 65536) {
          return json({ error: "Request too large" }, 413);
        }

        const body = await request.text();

        if (body.length > 65536) {
          return json({ error: "Request too large" }, 413);
        }

        const data = JSON.parse(body);

        if (
          !Array.isArray(data.trades) ||
          data.trades.length > 500
        ) {
          return json({ error: "Invalid trades array" }, 400);
        }

        return json(calculateVolume(data.trades));
      } catch {
        return json({ error: "Invalid trade data" }, 400);
      }
    }

    return env.ASSETS.fetch(request);
  }
};


