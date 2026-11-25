import { buildLantern, drawFrame, drawStrokes, clipPumpkin, flicker, DEFAULT_COLOR } from './lantern.js';
import { Ears, nextLight } from './sound.js';
import { API } from './api.js';

const MAX_POINTS = 4000; // worker.js と同じ上限
const MIN_STEP = 0.004;  // これより近い点は記録しない
const CLOSE = 0.045;     // 始点からこの距離で離すと、囲んだ形を切り抜く
const SLIT = 0.008;      // つながっていない切り込みの太さ
const MIN_AREA = 0.0006; // これより小さい囲みは切り抜かない
const FALL_MS = 700;     // 切り抜いた皮が落ちていく時間

const NOTES = {
  cut: 'ナイフで切り込みを入れます。線を始点の丸までつなげて離すと、囲んだ形がくり抜けます。つながっていない線は細い切れ込みになります。',
  draw: 'なぞったところが、そのままくり抜かれます。「塗り」で囲むと、囲んだ形ごと抜けます。',
  slit: '切れ込みになりました。始点の丸まで戻ってから離すと、形がくり抜けます。',
};

const board = document.getElementById('board');
const ctx = board.getContext('2d');
const S = board.width;
const postBtn = document.getElementById('post');
const status = document.getElementById('status');
const earsBtn = document.getElementById('ears');
const kindNote = document.getElementById('kind-note');
const toolsSection = document.getElementById('tools-section');

const ears = new Ears();
const strokes = [];
let color = DEFAULT_COLOR;
let lantern = buildLantern(strokes, S, color);
let current = null; // 今なぞっている線
let kind = 'cut';   // 'cut'（ふつう: 切り抜く）| 'draw'（かんたん: なぞる）
const falling = []; // 切り抜いて落ちていく皮
let mode = 'l';
let width = 0.032;
let light = 0.6;

const pointCount = () => strokes.reduce((n, st) => n + st.p.length, 0);

function rebuild() {
  lantern = buildLantern(strokes, S, color);
  postBtn.disabled = strokes.length === 0;
}

function toPoint(e) {
  const r = board.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
}

board.addEventListener('pointerdown', (e) => {
  if (pointCount() >= MAX_POINTS) {
    status.textContent = 'これ以上は彫れません（細かく彫りすぎました）';
    return;
  }
  board.setPointerCapture(e.pointerId);
  current = kind === 'cut' ? { m: 'l', w: SLIT, p: [toPoint(e)] } : { m: mode, w: width, p: [toPoint(e)] };
});

board.addEventListener('pointermove', (e) => {
  if (!current) return;
  const p = toPoint(e);
  const last = current.p[current.p.length - 1];
  if (Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) return;
  if (pointCount() + current.p.length >= MAX_POINTS) return;
  current.p.push(p);
});

function endStroke() {
  if (!current) return;
  const st = current;
  current = null;
  if (kind === 'cut' && closes(st.p)) {
    falling.push(cutPiece(st.p));
    strokes.push({ m: 'f', w: 0.01, p: st.p });
    kindNote.textContent = NOTES.cut;
  } else {
    strokes.push(st);
    if (kind === 'cut') kindNote.textContent = NOTES.slit;
  }
  rebuild();
}
board.addEventListener('pointerup', endStroke);
board.addEventListener('pointercancel', endStroke);

// ---- ふつう（切り抜く）----
// 線の終わりが始点の近くに戻っていて、ある程度の広さを囲んでいれば切り抜ける
function closes(p) {
  if (p.length < 3) return false;
  const [x0, y0] = p[0], [x1, y1] = p[p.length - 1];
  if (Math.hypot(x1 - x0, y1 - y0) > CLOSE) return false;
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
    area += ax * by - bx * ay;
  }
  return Math.abs(area) / 2 >= MIN_AREA;
}

function tracePath(c, p, close) {
  c.beginPath();
  c.moveTo(p[0][0] * S, p[0][1] * S);
  for (let i = 1; i < p.length; i++) c.lineTo(p[i][0] * S, p[i][1] * S);
  if (close) c.closePath();
}

// 切り抜く前の見た目から、囲んだ形の皮を1枚の絵として取り出す
function cutPiece(p) {
  const img = document.createElement('canvas');
  img.width = img.height = S;
  const x = img.getContext('2d');
  x.save();
  clipPumpkin(x, S);
  tracePath(x, p, true);
  x.clip();
  drawFrame(x, lantern, light);
  // 切り口（皮の厚み）
  x.strokeStyle = 'rgba(120, 60, 15, 0.9)';
  x.lineWidth = S * 0.012;
  x.stroke();
  x.restore();
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return {
    img,
    cx: ((Math.min(...xs) + Math.max(...xs)) / 2) * S,
    cy: ((Math.min(...ys) + Math.max(...ys)) / 2) * S,
    spin: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5),
    t0: performance.now(),
  };
}

// 少し手前に浮いてから、回りながら下へ落ちて消える
function drawFalling(now) {
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    const t = (now - f.t0) / FALL_MS;
    if (t >= 1) {
      falling.splice(i, 1);
      continue;
    }
    const pop = Math.sin(Math.min(1, t * 4) * Math.PI / 2);
    ctx.save();
    ctx.globalAlpha = 1 - Math.max(0, (t - 0.45) / 0.55);
    ctx.translate(f.cx, f.cy + S * 0.55 * t * t);
    ctx.rotate(f.spin * t);
    ctx.scale(1 + 0.06 * pop, 1 + 0.06 * pop);
    ctx.drawImage(f.img, -f.cx, -f.cy);
    ctx.restore();
  }
}

// なぞっている途中のナイフの線。囲めそうなら、抜ける形と始点の丸を光らせる
function drawKnife(p) {
  const near = closes(p);
  ctx.save();
  clipPumpkin(ctx, S);
  if (near) {
    tracePath(ctx, p, true);
    ctx.fillStyle = 'rgba(20, 8, 2, 0.45)';
    ctx.fill();
  }
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = SLIT * S;
  ctx.strokeStyle = 'rgba(20, 8, 2, 0.9)';
  tracePath(ctx, p, false);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(p[0][0] * S, p[0][1] * S, CLOSE * S, 0, Math.PI * 2);
  ctx.lineWidth = S * 0.004;
  ctx.strokeStyle = near ? 'rgba(255, 215, 106, 0.95)' : 'rgba(255, 240, 210, 0.45)';
  ctx.stroke();
}

function setKind(next) {
  kind = next;
  toolsSection.hidden = kind !== 'draw';
  kindNote.textContent = NOTES[kind];
  for (const b of document.querySelectorAll('#kinds button')) b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
}
setKind(kind);

document.getElementById('kinds').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) setKind(btn.dataset.kind);
});

document.getElementById('tools').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  mode = btn.dataset.mode;
  width = Number(btn.dataset.w);
  for (const b of e.currentTarget.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
});

document.getElementById('undo').addEventListener('click', () => {
  strokes.pop();
  rebuild();
});
document.getElementById('clear').addEventListener('click', () => {
  strokes.length = 0;
  rebuild();
});

// 灯りの色（用意した色か、自由に選んだ色）
const swatches = document.getElementById('swatches');
const custom = document.getElementById('custom-color');

function pickColor(value, chosen) {
  color = value;
  for (const el of swatches.querySelectorAll('.swatch')) el.setAttribute('aria-pressed', String(el === chosen));
  rebuild();
}

swatches.addEventListener('click', (e) => {
  const btn = e.target.closest('button.swatch');
  if (btn) pickColor(btn.dataset.color, btn);
});
function pickCustom() {
  const label = custom.closest('.swatch');
  label.style.setProperty('--c', custom.value);
  pickColor(custom.value, label);
}
custom.addEventListener('input', pickCustom);
custom.addEventListener('click', pickCustom); // 前に選んだ自由な色に戻すとき

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

postBtn.addEventListener('click', async () => {
  postBtn.disabled = true;
  status.textContent = '通りに運んでいます…';
  try {
    const res = await fetch(`${API}/api/lanterns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: document.getElementById('name').value, strokes, color }),
    });
    if (res.status === 429) throw new Error('少し時間をおいてから灯してください（1時間に10個まで）');
    if (!res.ok) throw new Error('灯せませんでした。もう一度試してください');
    const { id } = await res.json();
    location.href = `/?new=${id}`;
  } catch (err) {
    status.textContent = err.message;
    postBtn.disabled = false;
  }
});

function tick(now) {
  light = nextLight(light, ears.read(), 3, flicker(now / 1000, 1.2));
  drawFrame(ctx, lantern, light);
  // なぞっている途中の線は暗く見せる
  if (current && kind === 'cut') drawKnife(current.p);
  else if (current) {
    ctx.save();
    clipPumpkin(ctx, S);
    ctx.fillStyle = ctx.strokeStyle = 'rgba(20, 8, 2, 0.85)';
    drawStrokes(ctx, [current], S);
    ctx.restore();
  }
  drawFalling(now);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
