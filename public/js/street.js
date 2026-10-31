import { buildLantern, lanternAt, drawLanternAt, flicker, flameColors, rgba } from './lantern.js';
import { Ears, nextLight, clamp } from './sound.js';

const scene = document.getElementById('scene');
const screenCtx = scene.getContext('2d');
let sc = screenCtx; // 描き先（道を取っておくときだけ一時的に切り替える）
const msg = document.getElementById('msg');
const earsBtn = document.getElementById('ears');
const panel = document.getElementById('focus');
const reportBtn = document.getElementById('report');

// 通りの寸法（ワールド座標。x: 左右、y: 高さ、z: 奥行き）
const ROAD = 1.1;      // 道の半分の幅
const CAM_H = 1.05;    // 目の高さ
const SPACING = 1.4;   // ランタンの間隔（左右交互に置く）
const FIRST_Z = 3.2;   // 一番手前のランタン
const SIZE = 1.15;     // ランタンの大きさ
// スマホなど指で触る端末は軽い設定にする。どちらも重ければ下の adapt() でさらに下げる
const LITE = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('lite'); // ?lite で試せる
const SPRITE = 300;    // ランタン1つを作る解像度
const SPRITE_HI = 720; // 近くで見るとき
const RENDERS_PER_FRAME = LITE ? 2 : 3; // 1フレームで向きを描き直すランタンの数
const FAR = 45;                         // これより奥は描かない
let frameMs = 0;                        // 重いときだけ 32（30fps）にする
const NEAR = 0.3;      // これより手前は描かない（カメラからの奥行き）

const ears = new Ears();
const shown = []; // { data, x, z, lantern, hi, rgb, light, seed, band, box }
let next = null;
let loading = false;
let W = 0, H = 0, dpr = 1;
let resScale = 1; // 画面の解像度の倍率（重いと下がる）
let vignetteCache = null;

// カメラ（今の位置と、向かう先）。yaw は右を向くほど大きい
const cam = { x: 0, z: 0, h: CAM_H, yaw: 0 };
const target = { ...cam };
let focused = null; // 近づいて見ているランタン
const VIEW_DIST = 2.0; // 近づいたときのランタンまでの距離

// 座標から決まる、毎回同じになるばらつき
const jitter = (i) => {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2) * resScale;
  W = scene.width = Math.round(scene.clientWidth * dpr);
  H = scene.height = Math.round(scene.clientHeight * dpr);
  vignetteCache = null;
}
new ResizeObserver(resize).observe(scene);

const focal = () => Math.min(W, H * 1.2) * 0.9;
const horizon = () => H * 0.36;

// ワールド座標 → カメラから見た座標（x: 右、y: 高さ、z: 奥行き）
function toCam(x, y, z) {
  const dx = x - cam.x, dz = z - cam.z;
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  return [dx * c - dz * s, y, dx * s + dz * c];
}

function screenOf([x, y, z]) {
  const s = focal() / z;
  return { sx: W / 2 + x * s, sy: horizon() + (cam.h - y) * s, s, dz: z };
}

function project(x, y, z) {
  const p = toCam(x, y, z);
  return p[2] < NEAR ? null : screenOf(p);
}

async function load(before) {
  const q = before ? `?before=${before}` : '';
  const res = await fetch(`/api/lanterns${q}`);
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

function addLanterns(list) {
  for (const data of list) {
    const i = shown.length;
    const side = i % 2 === 0 ? -1 : 1;
    // 顔の向き: 道の方と、通りの入口側を斜めに向く（少しずつばらつかせる）
    const turn = 0.6 + (jitter(i + 300) - 0.5) * 0.5;
    shown.push({
      nx: -side * Math.sin(turn),
      nz: -Math.cos(turn),
      data,
      x: side * (ROAD + 0.55 + jitter(i) * 0.5),
      z: FIRST_Z + i * SPACING + jitter(i + 99) * 0.4,
      lantern: null, // 近づいたときに作る
      hi: null,
      rgb: flameColors(data.color).base,
      glow: null, // 足元の光（光だまりと光の筋に使う）
      light: 0.5,
      seed: i * 1.7,
      band: i,
      box: null,
    });
  }
}

const lastZ = () => (shown.length ? shown[shown.length - 1].z : FIRST_Z);
const maxCamZ = () => Math.max(0, lastZ() - 2.5);

async function loadMore() {
  if (loading || !next) return;
  loading = true;
  try {
    const page = await load(next);
    addLanterns(page.lanterns);
    next = page.next;
  } finally {
    loading = false;
  }
}

// ---- 歩く ----
function walk(dz) {
  if (focused) unfocus();
  target.z = clamp(target.z + dz, 0, maxCamZ());
  if (target.z > maxCamZ() - 12) loadMore();
}

scene.addEventListener('wheel', (e) => {
  e.preventDefault();
  walk(e.deltaY * 0.01);
}, { passive: false });

let drag = null;
scene.addEventListener('pointerdown', (e) => {
  scene.setPointerCapture(e.pointerId);
  drag = { y: e.clientY, x: e.clientX, moved: 0, dx: 0, dy: 0 };
});
scene.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.dx += dx;
  drag.dy += dy;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.moved < 8) return;
  // 近づいているときの横向きのドラッグでは、通りに戻らない
  if (focused && Math.abs(drag.dx) > Math.abs(drag.dy)) return;
  walk(dy * 0.03); // 上に引くと奥へ（手前の地面をたぐり寄せる感じ）
});
scene.addEventListener('pointerup', (e) => {
  if (drag && drag.moved < 8) pick(e);
  drag = null;
});
scene.addEventListener('pointercancel', () => { drag = null; });

scene.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'w') walk(SPACING * 2);
  else if (e.key === 'ArrowDown' || e.key === 's') walk(-SPACING * 2);
  else return;
  e.preventDefault();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && focused) unfocus();
});
document.getElementById('forward').addEventListener('click', () => walk(SPACING * 4));
document.getElementById('back').addEventListener('click', () => walk(-SPACING * 4));

// 押した位置のランタン（手前を優先）。何もないところを押したら通りに戻る
function pick(e) {
  const r = scene.getBoundingClientRect();
  const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
  const hit = shown
    .filter((it) => it.box)
    .sort((a, b) => toCam(a.x, 0, a.z)[2] - toCam(b.x, 0, b.z)[2])
    .find(({ box }) => px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h);
  if (hit) focus(hit);
  else if (focused) unfocus();
}

// ---- 1つのランタンに近づく ----
function focus(it) {
  focused = it;
  it.hi ??= buildLantern(it.data.strokes, SPRITE_HI, it.data.color);
  target.h = 0.78;
  aimAt(it);

  panel.querySelector('h2').textContent = it.data.name;
  panel.querySelector('.meta').textContent = new Date(it.data.created_at).toLocaleString('ja-JP', {
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) + ' に灯されたランタン';
  reportBtn.disabled = false;
  reportBtn.textContent = '通報する';
  panel.hidden = false;
}

// ランタンの顔の正面に立ち、ランタンの方を向く
function aimAt(it) {
  target.x = it.x + it.nx * VIEW_DIST;
  target.z = it.z + it.nz * VIEW_DIST;
  target.yaw = Math.atan2(it.x - target.x, it.z - target.z);
}

// カメラから見て、ランタンの顔がどれだけ横を向いているか（右向きが正）
function viewAngle(it) {
  const p = toCam(it.x, 0, it.z);
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  const nx = it.nx * c - it.nz * s, nz = it.nx * s + it.nz * c;
  const len = Math.hypot(p[0], p[2]) || 1;
  const ax = -p[0] / len, az = -p[2] / len;
  return Math.atan2(ax * nz - az * nx, ax * nx + az * nz);
}

function unfocus() {
  focused = null;
  target.x = 0;
  target.h = CAM_H;
  target.yaw = 0;
  target.z = clamp(target.z, 0, maxCamZ());
  panel.hidden = true;
}

document.getElementById('unfocus').addEventListener('click', () => {
  unfocus();
  scene.focus();
});

reportBtn.addEventListener('click', async () => {
  if (!focused) return;
  reportBtn.disabled = true;
  const res = await fetch(`/api/lanterns/${focused.data.id}/report`, { method: 'POST' });
  reportBtn.textContent = res.ok ? '通報しました' : '通報できませんでした';
});

earsBtn.addEventListener('click', async () => {
  if (ears.on) {
    ears.stop();
    earsBtn.setAttribute('aria-pressed', 'false');
    return;
  }
  try {
    await ears.start();
    earsBtn.setAttribute('aria-pressed', 'true');
  } catch {
    earsBtn.textContent = '🎙 マイクを使えませんでした';
  }
});

// ---- 描く ----
const ROW = 0.32, STONE = 0.27, GAP = 0.03; // 車道の石畳
const SLAB = 0.85;                           // 歩道の敷石
const CURB_H = 0.09, CURB_W = 0.14;          // 縁石
const WALK_W = 2.6;                          // 歩道の幅
let DETAIL = 18;                // ここまでは石を1つずつ描く
const FOG = [16, 11, 28];                    // 遠くが溶けていく色

const hash2 = (a, b) => jitter(a * 157.31 + b * 311.7 + 0.5);

// その場所が近くのランタンにどの色でどれだけ照らされているか（r, g, b）
function lightAt(x, z, lights) {
  const w = [0, 0, 0];
  for (const l of lights) {
    const dx = x - l.x, dz = z - l.z;
    const k = l.light / (1 + (dx * dx + dz * dz) * 2.2);
    for (let i = 0; i < 3; i++) w[i] += (k * l.rgb[i]) / 255;
  }
  return w.map((v) => Math.min(v, 1.4));
}

const scale = (v, k) => v.map((x) => x * k);

// スマホでは同じ色の石をまとめて塗る（Map<層, Map<色, Path2D>>）。
// まとめやすいよう、そのときは明るさともやを細かい段階に丸める
let batch = null;
const LAYERS = ['base', 'stones', 'edges', 'curbs']; // 塗る順番

function flushBatch() {
  for (const layer of LAYERS) {
    for (const [fill, path] of batch.get(layer) ?? []) {
      sc.fillStyle = fill;
      sc.fill(path);
    }
  }
  batch = null;
}

function color(base, warm, fog, tint = [1, 0.9, 1.25]) {
  if (batch) {
    base = Math.round(base / 0.025) * 0.025;
    fog = Math.round(fog / 0.08) * 0.08;
  }
  warm ||= [0, 0, 0];
  const c = tint.map((t, i) => base * 62 * t + warm[i] * 165);
  return `rgb(${c.map((v, i) => Math.round(v + (FOG[i] - v) * fog)).join(',')})`;
}

// カメラのすぐ手前で多角形を切る（後ろに回り込んだ部分を描かない）
function clipNear(ps) {
  const out = [];
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}

// ワールド座標の4点を結んで塗る（まとめ塗り中は層と色ごとのパスに足すだけ）
function poly(points, fill, layer = 'stones') {
  const clipped = clipNear(points.map(([x, y, z]) => toCam(x, y, z)));
  if (clipped.length < 3) return;
  const ps = clipped.map(screenOf);
  let path = sc;
  if (batch) {
    if (!batch.has(layer)) batch.set(layer, new Map());
    const byColor = batch.get(layer);
    if (!byColor.has(fill)) byColor.set(fill, new Path2D());
    path = byColor.get(fill);
  } else {
    sc.beginPath();
  }
  path.moveTo(ps[0].sx, ps[0].sy);
  for (let i = 1; i < ps.length; i++) path.lineTo(ps[i].sx, ps[i].sy);
  path.closePath();
  if (!batch) {
    sc.fillStyle = fill;
    sc.fill();
  }
}

// 互い違いの石を xMin〜xMax に敷く
function paveStones(xMin, xMax, y, rowLen, stoneW, gap, tone, lights, seed) {
  const near = cam.z - 2; // 横を向いたときも足元が見えるよう、少し後ろから敷く
  for (let r = Math.floor(near / rowLen); r * rowLen < cam.z + DETAIL; r++) {
    const z0 = r * rowLen + gap / 2, z1 = (r + 1) * rowLen - gap / 2;
    const zm = (z0 + z1) / 2;
    const fog = clamp((zm - cam.z - DETAIL * 0.45) / (DETAIL * 0.55));
    const offset = (((r % 2) + 2) % 2) * stoneW / 2 + hash2(r, seed) * 0.05;
    for (let c = Math.floor((xMin - offset) / stoneW); c * stoneW + offset < xMax; c++) {
      const x0 = Math.max(c * stoneW + offset + gap / 2, xMin);
      const x1 = Math.min((c + 1) * stoneW + offset - gap / 2, xMax);
      if (x1 <= x0) continue;
      const h = hash2(r + seed, c);
      const base = tone * (0.75 + h * 0.5);
      const warm = scale(lightAt((x0 + x1) / 2, zm, lights), 0.75 * (0.8 + h * 0.4));
      poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], color(base, warm, fog));
      // 石の手前の角を少し明るくして丸みを出す
      if (fog < 0.6) {
        const e = (z1 - z0) * 0.18;
        poly([[x0, y, z0], [x1, y, z0], [x1, y, z0 + e], [x0, y, z0 + e]],
          color(base * 1.25, scale(warm, 1.15), fog), 'edges');
      }
    }
  }
}

// 縁石（上面と、車道側の側面）
function drawCurbs(lights) {
  const near = cam.z - 3;
  const len = 0.9;
  for (const side of [-1, 1]) {
    const xi = side * ROAD, xo = side * (ROAD + CURB_W);
    for (let r = Math.floor(near / len); r * len < cam.z + FAR; r++) {
      const z0 = r * len + 0.012, z1 = (r + 1) * len - 0.012;
      const zm = (z0 + z1) / 2;
      const fog = clamp((zm - cam.z - DETAIL * 0.45) / (DETAIL * 0.55));
      const warm = zm - cam.z < DETAIL ? scale(lightAt(xi, zm, lights), 0.6) : null;
      poly([[xi, 0, z0], [xi, CURB_H, z0], [xi, CURB_H, z1], [xi, 0, z1]], color(0.55, warm && scale(warm, 0.6), fog), 'curbs');
      poly([[xi, CURB_H, z0], [xo, CURB_H, z0], [xo, CURB_H, z1], [xi, CURB_H, z1]], color(1.05, warm, fog), 'curbs');
    }
  }
}

// 遠くの家並み（一度だけ形を決める）
const skyline = Array.from({ length: 48 }, (_, i) => ({
  w: 0.025 + jitter(i + 7) * 0.05,
  h: 0.02 + jitter(i + 51) * 0.07,
  roof: jitter(i + 23) > 0.55,
  windows: Array.from({ length: 3 }, (_, k) => jitter(i * 3 + k + 200) > 0.72),
}));

function drawSkyline() {
  const hz = horizon();
  const shift = -Math.tan(cam.yaw) * focal(); // 横を向くと家並みも流れる
  let x = -0.7;
  for (const b of skyline) {
    // 道が抜ける中央はあける
    if (x > 0.44 && x < 0.56) { x = 0.56; continue; }
    const bx = x * W + shift, bw = b.w * W, bh = b.h * H, top = hz - bh;
    sc.fillStyle = '#0a0614';
    sc.beginPath();
    sc.moveTo(bx, hz);
    sc.lineTo(bx, top);
    if (b.roof) sc.lineTo(bx + bw / 2, top - bw * 0.35);
    sc.lineTo(bx + bw, top);
    sc.lineTo(bx + bw, hz);
    sc.closePath();
    sc.fill();
    b.windows.forEach((on, k) => {
      if (!on) return;
      sc.fillStyle = 'rgba(255,190,90,0.55)';
      sc.fillRect(bx + bw * (0.2 + k * 0.25), top + bh * 0.3, Math.max(1, bw * 0.12), Math.max(1, bh * 0.14));
    });
    x += b.w + 0.004;
  }
}

function drawRoad(lights) {
  const hz = horizon();
  drawSkyline();

  // 遠くまでの下地（車道の目地の色、歩道、その外側）
  const ground = sc.createLinearGradient(0, hz, 0, H);
  ground.addColorStop(0, `rgb(${FOG})`);
  ground.addColorStop(1, '#07040c');
  sc.fillStyle = ground;
  sc.fillRect(0, hz, W, H - hz);

  const near = cam.z - 3, far = cam.z + FAR;
  for (const side of [-1, 1]) {
    const x0 = side * (ROAD + CURB_W), x1 = side * (ROAD + CURB_W + WALK_W);
    poly([[x0, CURB_H, near], [x1, CURB_H, near], [x1, CURB_H, far], [x0, CURB_H, far]], color(0.5, 0, 0.35), 'base');
  }

  paveStones(-ROAD, ROAD, 0, ROW, STONE, GAP, 0.4, lights, 0);
  for (const side of [-1, 1]) {
    const a = side * (ROAD + CURB_W), b = side * (ROAD + CURB_W + WALK_W);
    paveStones(Math.min(a, b), Math.max(a, b), CURB_H, SLAB, SLAB * 1.15, 0.035, 0.34, lights, side * 50);
  }
  drawCurbs(lights);
  if (batch) flushBatch();

  // 地平線のもや
  const haze = sc.createLinearGradient(0, hz - H * 0.1, 0, hz + H * 0.12);
  haze.addColorStop(0, 'rgba(50,34,80,0)');
  haze.addColorStop(0.5, 'rgba(50,34,80,0.55)');
  haze.addColorStop(1, 'rgba(50,34,80,0)');
  sc.fillStyle = haze;
  sc.fillRect(0, hz - H * 0.1, W, H * 0.22);
}

// 見えているランタンを集めて、明るさを更新する
function visibleLanterns(t, heard) {
  const items = [];
  for (const it of shown) {
    it.box = null;
    const p = project(it.x, CURB_H, it.z);
    if (!p || p.dz > FAR) continue;
    const size = SIZE * p.s;
    if (p.sx + size < 0 || p.sx - size > W) continue;
    it.light = nextLight(it.light, heard, it.band, flicker(t, it.seed));
    items.push({ it, p, size });
  }
  return items.sort((a, b) => b.p.dz - a.p.dz); // 奥から描く
}

function drawLanterns(items) {
  // 向きが変わったランタンの描き直しは、大きく見えるものから1フレームに数個まで
  const prepared = items.map((entry) => {
    const { it, size } = entry;
    it.lantern ??= buildLantern(it.data.strokes, SPRITE, it.data.color);
    const L = size > SPRITE && it.hi ? it.hi : it.lantern;
    const step = size < 80 * dpr ? 0.12 : 0.05;
    const angle = viewAngle(it);
    const stale = L.cache && L.cache.key !== Math.round(angle / step);
    return { ...entry, L, step, angle, stale };
  });
  const allowed = new Set(prepared
    .filter((e) => e.stale && e.it !== focused)
    .sort((a, b) => b.size - a.size)
    .slice(0, RENDERS_PER_FRAME)
    .map((e) => e.it));

  for (const { it, p, size, L, step, angle } of prepared) {
    const sprite = lanternAt(L, angle, step, it === focused || !L.cache || allowed.has(it));
    const fog = 1 - clamp((p.dz - 8) / (FAR - 8)) * 0.85;
    const x = p.sx - size / 2, y = p.sy - size * 0.9; // カボチャの底（画像の 0.9）を地面に合わせる

    // 濡れた敷石への映り込み（小さいランタンは省く）
    if (size > 50 * dpr) {
    sc.save();
    sc.translate(0, p.sy * 2);
    sc.scale(1, -1);
    drawLanternAt(sc, sprite, it.light, x, y, size, 0.16 * fog);
    sc.restore();
    // 縦に伸ばしたぼかしの円で、濡れた路面の光の筋にする
    sc.save();
    sc.globalCompositeOperation = 'lighter';
    sc.globalAlpha = 0.26 * it.light * fog;
    sc.drawImage(glowOf(it), p.sx - size * 0.18, p.sy + size * 0.1 - size * 0.6, size * 0.36, size * 1.2);
    sc.restore();
    }

    drawLanternAt(sc, sprite, it.light, x, y, size, fog);
    it.box = { x: x + size * 0.08, y: y + size * 0.1, w: size * 0.84, h: size * 0.8 };

    if (size > 90 * dpr && it !== focused) {
      sc.font = `${12 * dpr}px "Zen Maru Gothic", sans-serif`;
      sc.textAlign = 'center';
      sc.fillStyle = `rgba(200,185,225,${fog * clamp((size - 90 * dpr) / (60 * dpr))})`;
      sc.fillText(it.data.name, p.sx, p.sy + 18 * dpr);
    }
  }
}

// 画面の端を暗くする（大きさが変わったときだけ作り直す）
function vignette() {
  if (!vignetteCache) {
    vignetteCache = document.createElement('canvas');
    vignetteCache.width = W;
    vignetteCache.height = H;
    const v = vignetteCache.getContext('2d');
    const g = v.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    v.fillStyle = g;
    v.fillRect(0, 0, W, H);
  }
  sc.drawImage(vignetteCache, 0, 0);
}

// 描くのに時間がかかる状態が続いたら、30fps → 石畳を細かく描く距離 → 解像度の順に下げる
// （画質に関わるものは最後）
let avgWork = 0, calmUntil = 0;
function adapt(now, work) {
  avgWork += (work - avgWork) * 0.05;
  if (now < calmUntil || avgWork < 12) return;
  if (!frameMs) frameMs = 32;
  else if (avgWork < 24) return; // 30fps ならこのくらいまでは間に合う
  else if (DETAIL > 10) DETAIL -= 2;
  else if (resScale > 0.6) {
    resScale -= 0.1;
    resize();
  } else return;
  avgWork = 0;
  calmUntil = now + 2000; // 下げた効果が出るまで待つ
}

// ランタンの色の、ぼかした円（作り置きして、光だまりと光の筋に使う）
function glowOf(it) {
  if (!it.glow) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(it.rgb, 1));
    grad.addColorStop(0.35, rgba(it.rgb, 0.5));
    grad.addColorStop(1, rgba(it.rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    it.glow = c;
  }
  return it.glow;
}

// スマホ用の照り返し: 石を1枚ずつ照らす代わりに、ランタンの足元に地面に沿って潰れた光だまりを重ねる
const POOL_R = 1.8;
function drawLightPools(items) {
  sc.save();
  sc.globalCompositeOperation = 'lighter';
  for (const { it } of items) {
    const p = project(it.x, 0, it.z);
    if (!p || p.dz > DETAIL + 3) continue;
    const rx = POOL_R * p.s, ry = rx * clamp(cam.h / p.dz, 0.04, 1);
    sc.globalAlpha = Math.min(1, 0.95 * it.light);
    sc.drawImage(glowOf(it), p.sx - rx, p.sy - ry, rx * 2, ry * 2);
  }
  sc.restore();
}

// スマホでは道の土台を画像として取っておき、カメラが動いたときだけ（同じ色の石をまとめて）描き直す
let roadCache = null, roadKey = '';
function drawRoadCached() {
  const key = [cam.x, cam.z, cam.h, cam.yaw].map((v) => v.toFixed(3)).join() + `|${W}x${H}|${DETAIL}`;
  if (!roadCache || roadKey !== key) {
    if (!roadCache || roadCache.width !== W || roadCache.height !== H) {
      roadCache = document.createElement('canvas');
      roadCache.width = W;
      roadCache.height = H;
    }
    sc = roadCache.getContext('2d');
    sc.clearRect(0, 0, W, H);
    batch = new Map();
    drawRoad([]);
    sc = screenCtx;
    roadKey = key;
  }
  sc.drawImage(roadCache, 0, 0);
}

let lastDraw = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (now - lastDraw < frameMs) return;
  const dt = Math.min(now - lastDraw, 100);
  lastDraw = now;
  const started = performance.now();
  const t = now / 1000;
  const heard = ears.read();
  // フレームの間隔によらず同じ速さで近づく
  const k = 1 - Math.pow(0.92, dt / 16.7);
  for (const key of ['x', 'z', 'h', 'yaw']) {
    cam[key] += (target[key] - cam[key]) * k;
    if (Math.abs(target[key] - cam[key]) < 1e-4) cam[key] = target[key];
  }

  sc.clearRect(0, 0, W, H);
  if (W && H) {
    const items = visibleLanterns(t, heard);
    // 石を照らす計算は、近くのランタン8個までにする
    const lights = items.filter((i) => i.p.dz < DETAIL + 3).slice(-8).map(({ it }) => ({ x: it.x, z: it.z, light: it.light, rgb: it.rgb }));
    if (LITE) {
      drawRoadCached();
      drawLightPools(items);
    } else {
      drawRoad(lights);
    }
    drawLanterns(items);
    vignette();
  }
  adapt(now, performance.now() - started);
}

async function main() {
  resize();
  requestAnimationFrame(tick);
  try {
    const page = await load();
    addLanterns(page.lanterns);
    next = page.next;
    msg.textContent = page.lanterns.length ? '' : 'まだ通りは真っ暗です。最初のランタンを彫ってみませんか？';
  } catch {
    msg.textContent = 'ランタンを運べませんでした。時間をおいて開き直してください。';
  }

  // 彫ったばかりのランタンを開く
  const id = new URLSearchParams(location.search).get('new');
  if (id) {
    history.replaceState(null, '', '/');
    const it = shown.find((s) => s.data.id === id);
    if (it) focus(it);
  }
}

main();
