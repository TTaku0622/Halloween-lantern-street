import { buildLantern, drawFrame, drawLanternAt, flicker, flameColors, rgba } from './lantern.js';
import { Ears, nextLight, clamp } from './sound.js';

const scene = document.getElementById('scene');
const sc = scene.getContext('2d');
const msg = document.getElementById('msg');
const earsBtn = document.getElementById('ears');
const detail = document.getElementById('detail');
const detailCanvas = detail.querySelector('canvas');
const reportBtn = document.getElementById('report');

// 通りの寸法（ワールド座標。x: 左右、y: 高さ、z: 奥行き）
const ROAD = 1.1;      // 道の半分の幅
const CAM_H = 1.05;    // 目の高さ
const SPACING = 1.4;   // ランタンの間隔（左右交互に置く）
const FIRST_Z = 3.2;   // 一番手前のランタン
const SIZE = 1.15;     // ランタンの大きさ
const FAR = 45;        // これより奥は描かない
const SPRITE = 300;    // ランタン1つを作る解像度

const ears = new Ears();
const shown = []; // { data, x, z, lantern, light, seed, band, box }
let next = null;
let loading = false;
let camZ = 0, targetZ = 0;
let opened = null;
let W = 0, H = 0, dpr = 1;

// 座標から決まる、毎回同じになるばらつき
const jitter = (i) => {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = scene.width = Math.round(scene.clientWidth * dpr);
  H = scene.height = Math.round(scene.clientHeight * dpr);
}
new ResizeObserver(resize).observe(scene);

const focal = () => Math.min(W, H * 1.2) * 0.9;
const horizon = () => H * 0.36;

function project(x, y, z) {
  const dz = z - camZ;
  if (dz < 0.35) return null;
  const s = focal() / dz;
  return { sx: W / 2 + x * s, sy: horizon() + (CAM_H - y) * s, s, dz };
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
    shown.push({
      data,
      x: side * (ROAD + 0.55 + jitter(i) * 0.5),
      z: FIRST_Z + i * SPACING + jitter(i + 99) * 0.4,
      lantern: null, // 近づいたときに作る
      rgb: flameColors(data.color).base,
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
  targetZ = clamp(targetZ + dz, 0, maxCamZ());
  if (targetZ > maxCamZ() - 12) loadMore();
}

scene.addEventListener('wheel', (e) => {
  e.preventDefault();
  walk(e.deltaY * 0.01);
}, { passive: false });

let drag = null;
scene.addEventListener('pointerdown', (e) => {
  scene.setPointerCapture(e.pointerId);
  drag = { y: e.clientY, x: e.clientX, moved: 0 };
});
scene.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  drag.moved += Math.abs(dy) + Math.abs(e.clientX - drag.x);
  drag.y = e.clientY;
  drag.x = e.clientX;
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
document.getElementById('forward').addEventListener('click', () => walk(SPACING * 4));
document.getElementById('back').addEventListener('click', () => walk(-SPACING * 4));

// 押した位置のランタン（手前を優先）
function pick(e) {
  const r = scene.getBoundingClientRect();
  const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
  const hit = shown
    .filter((it) => it.box)
    .sort((a, b) => a.z - b.z)
    .find(({ box }) => px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h);
  if (hit) openDetail(hit.data);
}

// ---- 1つのランタンを見る ----
function openDetail(data) {
  opened = {
    data,
    ctx: detailCanvas.getContext('2d'),
    lantern: buildLantern(data.strokes, detailCanvas.width, data.color),
    light: 0.5,
    seed: 3.3,
  };
  detail.querySelector('h2').textContent = data.name;
  detail.querySelector('.meta').textContent = new Date(data.created_at).toLocaleString('ja-JP', {
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) + ' に灯されたランタン';
  reportBtn.disabled = false;
  reportBtn.textContent = '通報する';
  detail.showModal();
}

detail.addEventListener('close', () => { opened = null; });
document.getElementById('close').addEventListener('click', () => detail.close());
detail.addEventListener('click', (e) => { if (e.target === detail) detail.close(); });

reportBtn.addEventListener('click', async () => {
  if (!opened) return;
  reportBtn.disabled = true;
  const res = await fetch(`/api/lanterns/${opened.data.id}/report`, { method: 'POST' });
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
const DETAIL = 18;                           // ここまでは石を1つずつ描く
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

function color(base, warm, fog, tint = [1, 0.9, 1.25]) {
  warm ||= [0, 0, 0];
  const c = tint.map((t, i) => base * 62 * t + warm[i] * 165);
  return `rgb(${c.map((v, i) => Math.round(v + (FOG[i] - v) * fog)).join(',')})`;
}

// ワールド座標の4点を結んで塗る
function poly(points, fill) {
  const ps = points.map(([x, y, z]) => project(x, y, Math.max(z, camZ + 0.36)));
  sc.beginPath();
  sc.moveTo(ps[0].sx, ps[0].sy);
  for (let i = 1; i < ps.length; i++) sc.lineTo(ps[i].sx, ps[i].sy);
  sc.closePath();
  sc.fillStyle = fill;
  sc.fill();
}

// 互い違いの石を xMin〜xMax に敷く
function paveStones(xMin, xMax, y, rowLen, stoneW, gap, tone, lights, seed) {
  const near = camZ + 0.36;
  for (let r = Math.floor(near / rowLen); r * rowLen < camZ + DETAIL; r++) {
    const z0 = Math.max(r * rowLen + gap / 2, near), z1 = (r + 1) * rowLen - gap / 2;
    if (z1 <= z0) continue;
    const zm = (z0 + z1) / 2;
    const fog = clamp((zm - camZ - DETAIL * 0.45) / (DETAIL * 0.55));
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
          color(base * 1.25, scale(warm, 1.15), fog));
      }
    }
  }
}

// 縁石（上面と、車道側の側面）
function drawCurbs(lights) {
  const near = camZ + 0.36;
  const len = 0.9;
  for (const side of [-1, 1]) {
    const xi = side * ROAD, xo = side * (ROAD + CURB_W);
    for (let r = Math.floor(near / len); r * len < camZ + FAR; r++) {
      const z0 = Math.max(r * len + 0.012, near), z1 = (r + 1) * len - 0.012;
      if (z1 <= z0) continue;
      const zm = (z0 + z1) / 2;
      const fog = clamp((zm - camZ - DETAIL * 0.45) / (DETAIL * 0.55));
      const warm = zm - camZ < DETAIL ? scale(lightAt(xi, zm, lights), 0.6) : null;
      poly([[xi, 0, z0], [xi, CURB_H, z0], [xi, CURB_H, z1], [xi, 0, z1]], color(0.55, warm && scale(warm, 0.6), fog));
      poly([[xi, CURB_H, z0], [xo, CURB_H, z0], [xo, CURB_H, z1], [xi, CURB_H, z1]], color(1.05, warm, fog));
    }
  }
}

// 遠くの家並み（一度だけ形を決める）
const skyline = Array.from({ length: 34 }, (_, i) => ({
  w: 0.025 + jitter(i + 7) * 0.05,
  h: 0.02 + jitter(i + 51) * 0.07,
  roof: jitter(i + 23) > 0.55,
  windows: Array.from({ length: 3 }, (_, k) => jitter(i * 3 + k + 200) > 0.72),
}));

function drawSkyline() {
  const hz = horizon();
  let x = -0.02;
  for (const b of skyline) {
    // 道が抜ける中央はあける
    if (x > 0.44 && x < 0.56) { x = 0.56; continue; }
    const bx = x * W, bw = b.w * W, bh = b.h * H, top = hz - bh;
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

  const near = camZ + 0.36, far = camZ + FAR;
  for (const side of [-1, 1]) {
    const x0 = side * (ROAD + CURB_W), x1 = side * (ROAD + CURB_W + WALK_W);
    poly([[x0, CURB_H, near], [x1, CURB_H, near], [x1, CURB_H, far], [x0, CURB_H, far]], color(0.5, 0, 0.35));
  }

  paveStones(-ROAD, ROAD, 0, ROW, STONE, GAP, 0.4, lights, 0);
  for (const side of [-1, 1]) {
    const a = side * (ROAD + CURB_W), b = side * (ROAD + CURB_W + WALK_W);
    paveStones(Math.min(a, b), Math.max(a, b), CURB_H, SLAB, SLAB * 1.15, 0.035, 0.34, lights, side * 50);
  }
  drawCurbs(lights);

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
  for (const { it, p, size } of items) {
    it.lantern ??= buildLantern(it.data.strokes, SPRITE, it.data.color);
    const fog = 1 - clamp((p.dz - 8) / (FAR - 8)) * 0.85;
    const x = p.sx - size / 2, y = p.sy - size * 0.9; // カボチャの底（画像の 0.9）を地面に合わせる

    // 濡れた敷石への映り込み
    sc.save();
    sc.translate(0, p.sy * 2);
    sc.scale(1, -1);
    drawLanternAt(sc, it.lantern, it.light, x, y, size, 0.16 * fog);
    sc.restore();
    sc.save();
    sc.globalCompositeOperation = 'lighter';
    sc.globalAlpha = 0.3 * it.light * fog;
    // 縦に伸ばしたぼかしの円で、濡れた路面の光の筋にする
    sc.translate(p.sx, p.sy + size * 0.1);
    sc.scale(0.3, 1);
    const streak = sc.createRadialGradient(0, 0, 0, 0, 0, size * 0.6);
    streak.addColorStop(0, rgba(it.rgb, 0.8));
    streak.addColorStop(1, rgba(it.rgb, 0));
    sc.fillStyle = streak;
    sc.fillRect(-size * 0.6, -size * 0.6, size * 1.2, size * 1.2);
    sc.restore();

    drawLanternAt(sc, it.lantern, it.light, x, y, size, fog);
    it.box = { x: x + size * 0.08, y: y + size * 0.1, w: size * 0.84, h: size * 0.8 };

    if (size > 90 * dpr) {
      sc.font = `${12 * dpr}px "Zen Maru Gothic", sans-serif`;
      sc.textAlign = 'center';
      sc.fillStyle = `rgba(200,185,225,${fog * clamp((size - 90 * dpr) / (60 * dpr))})`;
      sc.fillText(it.data.name, p.sx, p.sy + 18 * dpr);
    }
  }
}

function vignette() {
  const g = sc.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  sc.fillStyle = g;
  sc.fillRect(0, 0, W, H);
}

function tick(now) {
  const t = now / 1000;
  const heard = ears.read();
  camZ += (targetZ - camZ) * 0.12;

  sc.clearRect(0, 0, W, H);
  if (W && H) {
    const items = visibleLanterns(t, heard);
    const lights = items.filter((i) => i.p.dz < DETAIL + 3).map(({ it }) => ({ x: it.x, z: it.z, light: it.light, rgb: it.rgb }));
    drawRoad(lights);
    drawLanterns(items);
    vignette();
  }

  if (opened) {
    opened.light = nextLight(opened.light, heard, 3, flicker(t, opened.seed));
    drawFrame(opened.ctx, opened.lantern, opened.light);
  }
  requestAnimationFrame(tick);
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
    const res = await fetch(`/api/lanterns/${id}`);
    if (res.ok) openDetail((await res.json()).lantern);
  }
}

main();
