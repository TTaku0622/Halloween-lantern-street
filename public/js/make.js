import { buildLantern, drawFrame, drawStrokes, clipPumpkin, flicker, DEFAULT_COLOR } from './lantern.js';
import { Ears, nextLight } from './sound.js';

const MAX_POINTS = 4000; // worker.js と同じ上限
const MIN_STEP = 0.004;  // これより近い点は記録しない

const board = document.getElementById('board');
const ctx = board.getContext('2d');
const S = board.width;
const postBtn = document.getElementById('post');
const status = document.getElementById('status');
const earsBtn = document.getElementById('ears');

const ears = new Ears();
const strokes = [];
let color = DEFAULT_COLOR;
let lantern = buildLantern(strokes, S, color);
let current = null; // 今なぞっている線
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
  current = { m: mode, w: width, p: [toPoint(e)] };
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
  strokes.push(current);
  current = null;
  rebuild();
}
board.addEventListener('pointerup', endStroke);
board.addEventListener('pointercancel', endStroke);

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
    const res = await fetch('/api/lanterns', {
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
  if (current) {
    ctx.save();
    clipPumpkin(ctx, S);
    ctx.fillStyle = ctx.strokeStyle = 'rgba(20, 8, 2, 0.85)';
    drawStrokes(ctx, [current], S);
    ctx.restore();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
