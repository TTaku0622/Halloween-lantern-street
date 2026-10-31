// ランタンの描画
// 彫った線から「消灯」「点灯」の2枚を先に作っておき、毎フレームは明るさに応じて重ねるだけにする

// カボチャの形（キャンバスを 0〜1 とした座標）
export const CX = 0.5, CY = 0.57, RX = 0.42, RY = 0.33;

export const DEFAULT_COLOR = '#ff9a2a';

// 灯りの色から、芯・中間・外側・皮の厚みの色を作る
// 自由に選んだ色でも灯りに見えるよう、明るさは一定の範囲に収める
export function flameColors(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '') || [, DEFAULT_COLOR.slice(1)];
  const n = parseInt(m[1], 16);
  const [h, sat, l] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const base = hslToRgb(h, sat, Math.min(0.72, Math.max(0.55, l)));
  const toward = (t) => base.map((v) => Math.round(v + (255 - v) * t));
  return { base, mid: toward(0.2), core: toward(0.6), wall: base.map((v) => Math.round(v * 0.7)) };
}

export const rgba = (c, a) => `rgba(${c.join(',')},${a})`;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

function makeCanvas(s) {
  const c = document.createElement('canvas');
  c.width = c.height = s;
  return c;
}

// 彫れる範囲（皮の内側）
export function clipPumpkin(ctx, s) {
  ctx.beginPath();
  ctx.ellipse(CX * s, CY * s, RX * 0.92 * s, RY * 0.9 * s, 0, 0, Math.PI * 2);
  ctx.clip();
}

export function drawStrokes(ctx, strokes, s) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const st of strokes) {
    const p = st.p;
    if (!p.length) continue;
    ctx.beginPath();
    ctx.moveTo(p[0][0] * s, p[0][1] * s);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * s, p[i][1] * s);
    if (st.m === 'f') {
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 0.01 * s;
    } else {
      if (p.length === 1) ctx.lineTo(p[0][0] * s + 0.1, p[0][1] * s);
      ctx.lineWidth = st.w * s;
    }
    ctx.stroke();
  }
}

function drawStem(ctx, s, lit) {
  ctx.beginPath();
  ctx.moveTo(0.46 * s, 0.32 * s); // 根元はヘタのくぼみの中まで伸ばす（本体の後ろに隠れる）
  ctx.quadraticCurveTo(0.46 * s, 0.17 * s, 0.53 * s, 0.12 * s);
  ctx.lineTo(0.565 * s, 0.145 * s);
  ctx.quadraticCurveTo(0.525 * s, 0.19 * s, 0.545 * s, 0.32 * s);
  ctx.closePath();
  ctx.fillStyle = lit ? '#6b7a2c' : '#2b3313';
  ctx.fill();
}

// カボチャ本体。縦の房を球の経線として描き、angle だけ回した姿にする
// angle > 0 で顔が画面の右へ回る
const RIBS = 10;

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p, k) => (p >> k) & 255;
  return `rgb(${[16, 8, 0].map((k) => Math.round(ch(pa, k) + (ch(pb, k) - ch(pa, k)) * t)).join(',')})`;
}

// 房の境目（経線）の画面上の位置。高さ t での横幅を (1 - t²)^0.38 にして、
// 楕円よりふっくら張り出したカボチャらしい形にする
const BODY_W = 0.97; // 本体の横幅（RX に対する比）
const STEPS = 24;
const widthAt = (t) => Math.pow(Math.max(0, 1 - t * t), 0.38);

function meridian(s, phi, reverse) {
  const cx = CX * s, cy = CY * s, rx = RX * BODY_W * s, ry = RY * s;
  const pts = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = -1 + (2 * i) / STEPS;
    const w = widthAt(t);
    // ヘタの付け根と底を少しくぼませて、上下を平らにする
    const dip = Math.pow(1 - w, 3) * ry * (t < 0 ? 0.16 : -0.07);
    pts.push([cx + Math.sin(phi) * rx * w, cy + t * ry + dip]);
  }
  return reverse ? pts.reverse() : pts;
}

// カボチャの輪郭のパスを作る
function silhouette(ctx, s) {
  ctx.beginPath();
  const right = meridian(s, Math.PI / 2, false), left = meridian(s, -Math.PI / 2, true);
  ctx.moveTo(right[0][0], right[0][1]);
  for (const [x, y] of right) ctx.lineTo(x, y);
  for (const [x, y] of left) ctx.lineTo(x, y);
  ctx.closePath();
}

function drawBody(ctx, s, lit, angle = 0) {
  const stops = lit
    ? ['#ffb04a', '#e8671a', '#8a340b']
    : ['#8e4716', '#55260b', '#241005'];
  const cx = CX * s, cy = CY * s, rx = RX * BODY_W * s, ry = RY * s;

  // 下地（房の隙間が見えないように）
  silhouette(ctx, s);
  ctx.fillStyle = stops[2];
  ctx.fill();

  // 正面に房の真ん中が来るよう、境目を半分ずらす（正面にまっすぐな線が出ないように）
  for (let k = 0; k < RIBS; k++) {
    let a = ((k + 0.5) / RIBS) * Math.PI * 2 + angle;
    let b = ((k + 1.5) / RIBS) * Math.PI * 2 + angle;
    // こちら側（cos > 0）の部分だけ描く
    const vis = (p) => Math.cos(p) > 0;
    if (!vis(a) && !vis(b)) continue;
    // 見えている側（-π/2〜π/2 の周期）に収める
    const v = vis(a) ? a : b;
    const lo = Math.floor((v + Math.PI / 2) / (Math.PI * 2)) * Math.PI * 2 - Math.PI / 2;
    a = Math.max(a, lo);
    b = Math.min(b, lo + Math.PI);
    const mid = (a + b) / 2;
    const facing = Math.max(0, Math.cos(mid)); // 正面を向いている房ほど明るい

    const left = meridian(s, a, false), right = meridian(s, b, true);
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const [x, y] of left) ctx.lineTo(x, y);
    for (const [x, y] of right) ctx.lineTo(x, y);
    ctx.closePath();

    const xa = cx + Math.sin(a) * rx, xb = cx + Math.sin(b) * rx;
    const g = ctx.createLinearGradient(Math.min(xa, xb), 0, Math.max(xa, xb) + 0.01, 0);
    // 房の端は少しだけ暗く、正面を向いた房ほど明るく
    const edge = mixHex(stops[2], stops[1], 0.25 + 0.5 * facing);
    g.addColorStop(0, edge);
    g.addColorStop(0.5, mixHex(stops[1], stops[0], 0.15 + 0.85 * facing));
    g.addColorStop(1, edge);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = s * 0.004;
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.stroke();
  }

  // 全体の陰影（上が明るく下が暗い）
  ctx.save();
  silhouette(ctx, s);
  ctx.clip();
  const shade = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
  shade.addColorStop(0, 'rgba(255,230,180,0.12)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = shade;
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  ctx.restore();
}

// 彫った形を mask にして、好きな塗りで染めたキャンバスを返す
function tinted(mask, s, paint, dx = 0, dy = 0) {
  const c = makeCanvas(s), x = c.getContext('2d');
  x.drawImage(mask, dx, dy);
  x.globalCompositeOperation = 'source-in';
  paint(x);
  return c;
}

function glowPaint(s, f) {
  return (x) => {
    const g = x.createRadialGradient(CX * s, CY * s, 0, CX * s, CY * s, RX * s);
    g.addColorStop(0, rgba(f.core, 1));
    g.addColorStop(0.45, rgba(f.mid, 1));
    g.addColorStop(1, rgba(f.base, 1));
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
  };
}

export function buildLantern(strokes, s, color = DEFAULT_COLOR) {
  const f = flameColors(color);
  const mask = makeCanvas(s), m = mask.getContext('2d');
  m.save();
  clipPumpkin(m, s);
  m.fillStyle = m.strokeStyle = '#fff';
  drawStrokes(m, strokes, s);
  m.restore();

  const wall = s * 0.014; // 皮の厚み（穴の上側に見える）
  const glow = tinted(mask, s, glowPaint(s, f));

  // 消灯: 暗いカボチャに暗い穴
  const unlit = makeCanvas(s), u = unlit.getContext('2d');
  drawStem(u, s, false);
  drawBody(u, s, false);
  u.drawImage(tinted(mask, s, (x) => { x.fillStyle = '#3b1a07'; x.fillRect(0, 0, s, s); }), 0, 0);
  u.drawImage(tinted(mask, s, (x) => { x.fillStyle = '#0d0502'; x.fillRect(0, 0, s, s); }, 0, wall), 0, 0);

  // 点灯: 周りの光 → 明るい皮 → 皮の厚み → 中の光 → にじみ
  const lit = makeCanvas(s), l = lit.getContext('2d');
  const halo = l.createRadialGradient(CX * s, CY * s, RX * s * 0.6, CX * s, CY * s, s * 0.5);
  halo.addColorStop(0, rgba(f.base, 0.45));
  halo.addColorStop(1, rgba(f.base, 0));
  l.fillStyle = halo;
  l.fillRect(0, 0, s, s);
  drawStem(l, s, true);
  drawBody(l, s, true);
  // 中の灯りの色が皮に少し透ける
  l.save();
  l.globalCompositeOperation = 'source-atop';
  l.fillStyle = rgba(f.base, 0.28);
  l.fillRect(0, 0, s, s);
  l.restore();

  const hole = tinted(mask, s, (x) => { x.fillStyle = rgba(f.wall, 1); x.fillRect(0, 0, s, s); });
  const hx = hole.getContext('2d');
  hx.globalCompositeOperation = 'source-atop';
  hx.drawImage(glow, 0, wall);
  l.drawImage(hole, 0, 0);

  l.save();
  l.globalCompositeOperation = 'lighter';
  l.shadowColor = rgba(f.mid, 0.9);
  l.shadowBlur = s * 0.05;
  l.globalAlpha = 0.6;
  l.drawImage(glow, 0, 0);
  l.restore();

  return { unlit, lit };
}

export function drawFrame(ctx, lantern, light) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(lantern.unlit, 0, 0, w, h);
  ctx.globalAlpha = Math.max(0, Math.min(1, light));
  ctx.drawImage(lantern.lit, 0, 0, w, h);
  ctx.globalAlpha = 1;
}

// 大きなキャンバスの好きな位置に描く（通りの3D表示用）
export function drawLanternAt(ctx, lantern, light, x, y, size, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(lantern.unlit, x, y, size, size);
  ctx.globalAlpha = alpha * Math.max(0, Math.min(1, light));
  ctx.drawImage(lantern.lit, x, y, size, size);
  ctx.globalAlpha = 1;
}

// ろうそくの揺らぎ（0〜1）。seed でランタンごとにずらす
export function flicker(t, seed) {
  const v = Math.sin(t * 7.3 + seed) * 0.5 + Math.sin(t * 13.1 + seed * 2.3) * 0.3 + Math.sin(t * 2.1 + seed * 3.7) * 0.2;
  return 0.5 + 0.5 * v;
}
