// ランタン通りの API。画面（public/）は assets がそのまま配信する
const MAX_STROKES = 300;
const MAX_POINTS = 4000;
const NAME_MAX = 20;
const PAGE = 40;
const POSTS_PER_HOUR = 10;
const HIDE_AT_REPORTS = 3;
const DEFAULT_NAME = '名無しのおばけ';
const DEFAULT_COLOR = '#ff9a2a';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, env, url);
      } catch (e) {
        console.error(e);
        return json({ error: 'server_error' }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};

async function api(req, env, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'lanterns', id?, 'report'?]
  if (parts[1] !== 'lanterns') return json({ error: 'not_found' }, 404);
  const id = parts[2];

  if (!id && req.method === 'GET') return listLanterns(env, url);
  if (!id && req.method === 'POST') return createLantern(req, env);
  if (id && !parts[3] && req.method === 'GET') return getLantern(env, id);
  if (id && parts[3] === 'report' && req.method === 'POST') return reportLantern(req, env, id);
  return json({ error: 'not_found' }, 404);
}

async function listLanterns(env, url) {
  const before = Number(url.searchParams.get('before')) || Date.now() + 1;
  const { results } = await env.DB.prepare(
    'SELECT id, name, strokes, color, created_at FROM lanterns WHERE hidden = 0 AND created_at < ? ORDER BY created_at DESC LIMIT ?'
  ).bind(before, PAGE).all();
  const lanterns = results.map(toLantern);
  const next = lanterns.length === PAGE ? lanterns[lanterns.length - 1].created_at : null;
  return json({ lanterns, next });
}

async function getLantern(env, id) {
  const row = await env.DB.prepare(
    'SELECT id, name, strokes, color, created_at FROM lanterns WHERE id = ? AND hidden = 0'
  ).bind(id).first();
  if (!row) return json({ error: 'not_found' }, 404);
  return json({ lantern: toLantern(row) });
}

async function createLantern(req, env) {
  if (Number(req.headers.get('content-length') || 0) > 200_000) return json({ error: 'too_large' }, 413);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const strokes = cleanStrokes(body?.strokes);
  if (!strokes) return json({ error: 'bad_strokes' }, 400);
  const name = cleanName(body?.name);
  const color = cleanColor(body?.color);

  const ipHash = await hashIp(req, env);
  const now = Date.now();
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM lanterns WHERE ip_hash = ? AND created_at > ?'
  ).bind(ipHash, now - 3600_000).first();
  if (recent.n >= POSTS_PER_HOUR) return json({ error: 'too_many' }, 429);

  const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  await env.DB.prepare(
    'INSERT INTO lanterns (id, name, strokes, color, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, name, JSON.stringify(strokes), color, now, ipHash).run();
  return json({ id }, 201);
}

async function reportLantern(req, env, id) {
  const ipHash = await hashIp(req, env);
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO reports (lantern_id, ip_hash) SELECT id, ? FROM lanterns WHERE id = ?'
  ).bind(ipHash, id).run();
  if (res.meta.changes > 0) {
    await env.DB.prepare(
      'UPDATE lanterns SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?'
    ).bind(HIDE_AT_REPORTS, id).run();
  }
  return json({ ok: true });
}

// 彫った線: [{ m: 'l'(線) | 'f'(塗り), w: 太さ, p: [[x, y], ...] }]（座標は 0〜1）
function cleanStrokes(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_STROKES) return null;
  let total = 0;
  const out = [];
  for (const st of input) {
    if (!st || (st.m !== 'l' && st.m !== 'f') || !Array.isArray(st.p) || st.p.length === 0) return null;
    const w = Number(st.w);
    if (!(w > 0 && w <= 0.1)) return null;
    total += st.p.length;
    if (total > MAX_POINTS) return null;
    const p = [];
    for (const pt of st.p) {
      if (!Array.isArray(pt) || pt.length !== 2) return null;
      const [x, y] = pt.map(Number);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
      p.push([round3(x), round3(y)]);
    }
    out.push({ m: st.m, w: round3(w), p });
  }
  return out;
}

function cleanName(input) {
  const name = String(input ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...name].slice(0, NAME_MAX).join('') || DEFAULT_NAME;
}

// 灯りの色（#rrggbb）。明るさの調整は描画側で行う
function cleanColor(input) {
  const color = String(input ?? '').toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_COLOR;
}

async function hashIp(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const data = new TextEncoder().encode((env.IP_SALT || 'lantern-street') + ip);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function toLantern(row) {
  return { id: row.id, name: row.name, strokes: JSON.parse(row.strokes), color: row.color || DEFAULT_COLOR, created_at: row.created_at };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
