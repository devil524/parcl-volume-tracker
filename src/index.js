
// Week 1 starts Thu Nov 5 2026 05:30 UTC (month index 10 = November)
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
    let timestamp =
      typeof trade.timestamp === "number"
        ? trade.timestamp
        : Date.parse(trade.timestamp);

    // Treat small numeric timestamps as Unix seconds, not milliseconds
    if (typeof trade.timestamp === "number" && timestamp < 1e11) {
      timestamp *= 1000;
    }

    const raw = trade.notionalUSD;
    const volume =
      raw === null || raw === undefined || raw === ""
        ? NaN
        : Number(raw);

    if (
      !trade ||
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

const MAX_TRACKED = 25;                  // accounts snapshotted by the cron job
const BASELINE_TOLERANCE_MS = 90 * 1000; // cron fires a few seconds after the boundary
const MAX_BASELINE_GAP_MS = 30 * 60 * 1000;
const RETENTION_MS = 45 * DAY_MS;

async function fetchAccount(accountId) {
  return fetch(`https://validator.v4.parcl.co/v1/accounts/${accountId}`, {
    headers: { Accept: "application/json" }
  });
}

async function saveSnapshot(env, accountId, account, now) {
  if (!env.DB) return;
  const minute = Math.floor(now / 60000) * 60000; // at most one row per minute
  await env.DB.prepare(
    "INSERT OR IGNORE INTO snapshots (account_id, ts, lifetime, volume30d) VALUES (?1, ?2, ?3, ?4)"
  ).bind(accountId, minute, String(account.lifetimeVolume), String(account.volume30d)).run();
}

async function trackAccount(env, accountId, now) {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tracked (account_id, added_at) SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM tracked) < ?3"
  ).bind(accountId, now, MAX_TRACKED).run();
}

// Volume since `startMs` = current lifetime volume minus lifetime volume at the window start.
async function volumeSince(env, accountId, startMs, currentLifetime) {
  if (!env.DB) return { value: null };
  let row = await env.DB.prepare(
    "SELECT ts, lifetime FROM snapshots WHERE account_id = ?1 AND ts <= ?2 ORDER BY ts DESC LIMIT 1"
  ).bind(accountId, startMs + BASELINE_TOLERANCE_MS).first();

  if (!row) {
    row = await env.DB.prepare(
      "SELECT ts, lifetime FROM snapshots WHERE account_id = ?1 AND ts > ?2 ORDER BY ts ASC LIMIT 1"
    ).bind(accountId, startMs).first();
  }
  if (!row) return { value: null };

  const exact =
    row.ts <= startMs + BASELINE_TOLERANCE_MS &&
    row.ts >= startMs - MAX_BASELINE_GAP_MS;
  let delta = BigInt(currentLifetime) - BigInt(row.lifetime);
  if (delta < 0n) delta = 0n;

  return {
    value: formatUSD(delta),
    partial: !exact,
    since: new Date(row.ts).toISOString()
  };
}

async function runSnapshots(env) {
  if (!env.DB) return;
  const now = Date.now();
  const { results } = await env.DB.prepare("SELECT account_id FROM tracked").all();
  for (const { account_id } of results) {
    try {
      const response = await fetchAccount(account_id);
      if (!response.ok) continue;
      await saveSnapshot(env, account_id, await response.json(), now);
    } catch {
      // skip this account; the next run will try again
    }
  }
  await env.DB.prepare("DELETE FROM snapshots WHERE ts < ?1").bind(now - RETENTION_MS).run();
}

async function getPublicAccount(accountId, env) {
  const response = await fetchAccount(accountId);

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
    const now = Date.now();
    const p = getPeriods(now);
    const lifetime = formatUSD(account.lifetimeVolume);
    const volume30d = formatUSD(account.volume30d);

    let today = { value: null };
    let week = { value: null };
    let tracking = "d1_not_configured";

    if (env.DB) {
      try {
        await trackAccount(env, accountId, now);
        await saveSnapshot(env, accountId, account, now);
        today = await volumeSince(env, accountId, p.dayStart, account.lifetimeVolume);
        week = await volumeSince(env, accountId, p.weekStart, account.lifetimeVolume);
        tracking = "snapshots";
      } catch {
        tracking = "d1_error";
      }
    }

    return json({
      accountId,
      today: today.value,
      todayPartial: today.partial ?? null,
      todaySince: today.since ?? null,
      week: week.value,
      weekPartial: week.partial ?? null,
      weekSince: week.since ?? null,
      volume30d,
      lifetime,
      currency: "USD",
      tracking,
      ...periodDetails(p)
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
        return await getPublicAccount(accountId, env);
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
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSnapshots(env));
  }
};


