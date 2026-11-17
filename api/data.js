// Template Count Board API (Vercel serverless function).
// Stores everything in Upstash Redis (add it from Vercel → Storage → Upstash for Redis).
//
// GET  /api/data            -> whole board: settings, designers, logs, holidays, leaves, plus the caller's role
// POST /api/data {ops:[..]} -> apply changes: {op:"set"|"del", coll, id?, value?}
//
// Access (Vercel → Settings → Environment Variables):
//   ADMIN_PIN  full access: designers, targets, holidays, leave, settings
//   TEAM_PIN   designers can log image and video counts only
// With neither set, anyone with the link has full access.

const crypto = require("crypto");

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const P = "tcb:";
const COLLS = ["designers", "logs", "holidays", "leaves"];
const ADMIN_ONLY = new Set(["settings", "designers", "holidays", "leaves"]);
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_OPS = 500;
const MAX_VALUE = 4000;

async function redis(cmds) {
  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Redis HTTP ${r.status}`);
  const out = await r.json();
  for (const o of out) if (o && o.error) throw new Error(o.error);
  return out.map(o => o.result);
}

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function roleFor(pin) {
  const A = process.env.ADMIN_PIN, T = process.env.TEAM_PIN;
  if (A && same(pin, A)) return "admin";
  if (T) return same(pin, T) ? (A ? "team" : "admin") : null;
  return A ? "team" : "admin";
}

const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const fin = v => typeof v === "number" && Number.isFinite(v);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: "not_configured", message: "The database isn't connected. In Vercel, open Storage and add Upstash for Redis to this project, then redeploy." });
  }
  const role = roleFor(req.headers["x-team-pin"] || "");
  if (!role) return res.status(401).json({ error: "pin", message: "Wrong PIN." });

  try {
    if (req.method === "GET") {
      const [s, ...hs] = await redis([["GET", P + "settings"], ...COLLS.map(c => ["HGETALL", P + c])]);
      const out = { role, open: !process.env.ADMIN_PIN && !process.env.TEAM_PIN, settings: s ? parse(s) : null };
      COLLS.forEach((c, i) => {
        const flat = hs[i] || [], o = {};
        for (let j = 0; j < flat.length; j += 2) { const v = parse(flat[j + 1]); if (v) o[flat[j]] = v; }
        out[c] = o;
      });
      return res.status(200).json(out);
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? parse(req.body) : req.body;
      const ops = Array.isArray(body?.ops) ? body.ops : null;
      if (!ops || ops.length > MAX_OPS) return res.status(400).json({ error: "bad_request", message: `Send 1 to ${MAX_OPS} changes at a time.` });

      const cmds = [], teamLogs = [];
      for (const o of ops) {
        const coll = o?.coll;
        if (coll !== "settings" && !COLLS.includes(coll)) return res.status(400).json({ error: "bad_request", message: "Unknown data type." });
        if (ADMIN_ONLY.has(coll) && role !== "admin") return res.status(403).json({ error: "admin_only", message: "Only the manager can change this." });
        if (coll !== "settings" && !ID_RE.test(String(o.id))) return res.status(400).json({ error: "bad_request", message: "Bad id." });
        if (o.op === "set") {
          if (!o.value || typeof o.value !== "object" || Array.isArray(o.value)) return res.status(400).json({ error: "bad_request", message: "Bad value." });
          const v = JSON.stringify(o.value);
          if (v.length > MAX_VALUE) return res.status(400).json({ error: "bad_request", message: "Value too large." });
          if (coll === "settings") cmds.push(["SET", P + "settings", v]);
          else { cmds.push(["HSET", P + coll, o.id, v]); if (coll === "logs" && role !== "admin") teamLogs.push(cmds.length - 1); }
        } else if (o.op === "del") {
          cmds.push(coll === "settings" ? ["DEL", P + "settings"] : ["HDEL", P + coll, o.id]);
        } else return res.status(400).json({ error: "bad_request", message: "Unknown change." });
      }

      // Team members can't change targets: keep the stored target, or the designer's current one.
      if (teamLogs.length) {
        const vals = teamLogs.map(i => parse(cmds[i][3]) || {});
        const dids = vals.map(v => String(v.designerId || "_"));
        const [oldLogs, ds, s] = await redis([
          ["HMGET", P + "logs", ...teamLogs.map(i => cmds[i][2])],
          ["HMGET", P + "designers", ...dids],
          ["GET", P + "settings"],
        ]);
        const st = parse(s) || {};
        teamLogs.forEach((ci, k) => {
          const v = vals[k], old = parse(oldLogs[k]) || {}, d = parse(ds[k]) || {};
          v.imageTarget = fin(old.imageTarget) ? old.imageTarget : fin(d.imageTarget) ? d.imageTarget : fin(st.defImg) ? st.defImg : 10;
          v.videoTarget = fin(old.videoTarget) ? old.videoTarget : fin(d.videoTarget) ? d.videoTarget : fin(st.defVid) ? st.defVid : 0;
          cmds[ci][3] = JSON.stringify(v);
        });
      }

      if (cmds.length) await redis(cmds);
      return res.status(200).json({ ok: true, applied: cmds.length });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method" });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "db", message: "Couldn't reach the database. Try again in a moment." });
  }
};
