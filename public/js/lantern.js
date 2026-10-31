// ランタンの描画
// 彫った線から「消灯」「点灯」の2枚を先に作っておき、毎フレームは明るさに応じて重ねるだけにする

// カボチャの形（キャンバスを 0〜1 とした座標）
export const CX = 0.5, CY = 0.57, RX = 0.42, RY = 0.33;

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
  ctx.moveTo(0.46 * s, 0.27 * s);
  ctx.quadraticCurveTo(0.46 * s, 0.17 * s, 0.53 * s, 0.12 * s);
  ctx.lineTo(0.565 * s, 0.145 * s);
  ctx.quadraticCurveTo(0.525 * s, 0.19 * s, 0.545 * s, 0.27 * s);
  ctx.closePath();
  ctx.fillStyle = lit ? '#6b7a2c' : '#2b3313';
  ctx.fill();
}

function drawBody(ctx, s, lit) {
  // 外側の房から順に重ねる [中心のずれ, 横幅]
  const lobes = [[-0.36, 0.6], [0.36, 0.6], [-0.17, 0.66], [0.17, 0.66], [0, 0.62]];
  const stops = lit
    ? ['#ffb04a', '#e8671a', '#8a340b']
    : ['#8e4716', '#55260b', '#241005'];
  for (const [dx, w] of lobes) {
    const x = (CX + dx * RX) * s, y = CY * s;
    const rx = RX * w * s, ry = RY * s;
    const g = ctx.createRadialGradient(x - rx * 0.25, y - ry * 0.35, ry * 0.05, x, y, Math.max(rx, ry) * 1.05);
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.6, stops[1]);
    g.addColorStop(1, stops[2]);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = s * 0.005;
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.stroke();
  }
}

// 彫った形を mask にして、好きな塗りで染めたキャンバスを返す
function tinted(mask, s, paint, dx = 0, dy = 0) {
  const c = makeCanvas(s), x = c.getContext('2d');
  x.drawImage(mask, dx, dy);
  x.globalCompositeOperation = 'source-in';
  paint(x);
  return c;
}

function glowPaint(s) {
  return (x) => {
    const g = x.createRadialGradient(CX * s, CY * s, 0, CX * s, CY * s, RX * s);
    g.addColorStop(0, '#fffbe6');
    g.addColorStop(0.45, '#ffd76a');
    g.addColorStop(1, '#ff9a2a');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
  };
}

export function buildLantern(strokes, s) {
  const mask = makeCanvas(s), m = mask.getContext('2d');
  m.save();
  clipPumpkin(m, s);
  m.fillStyle = m.strokeStyle = '#fff';
  drawStrokes(m, strokes, s);
  m.restore();

  const wall = s * 0.014; // 皮の厚み（穴の上側に見える）
  const glow = tinted(mask, s, glowPaint(s));

  // 消灯: 暗いカボチャに暗い穴
  const unlit = makeCanvas(s), u = unlit.getContext('2d');
  drawStem(u, s, false);
  drawBody(u, s, false);
  u.drawImage(tinted(mask, s, (x) => { x.fillStyle = '#3b1a07'; x.fillRect(0, 0, s, s); }), 0, 0);
  u.drawImage(tinted(mask, s, (x) => { x.fillStyle = '#0d0502'; x.fillRect(0, 0, s, s); }, 0, wall), 0, 0);

  // 点灯: 周りの光 → 明るい皮 → 皮の厚み → 中の光 → にじみ
  const lit = makeCanvas(s), l = lit.getContext('2d');
  const halo = l.createRadialGradient(CX * s, CY * s, RX * s * 0.6, CX * s, CY * s, s * 0.5);
  halo.addColorStop(0, 'rgba(255,150,50,0.45)');
  halo.addColorStop(1, 'rgba(255,150,50,0)');
  l.fillStyle = halo;
  l.fillRect(0, 0, s, s);
  drawStem(l, s, true);
  drawBody(l, s, true);

  const hole = tinted(mask, s, (x) => { x.fillStyle = '#c4621a'; x.fillRect(0, 0, s, s); });
  const hx = hole.getContext('2d');
  hx.globalCompositeOperation = 'source-atop';
  hx.drawImage(glow, 0, wall);
  l.drawImage(hole, 0, 0);

  l.save();
  l.globalCompositeOperation = 'lighter';
  l.shadowColor = 'rgba(255,180,70,0.9)';
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
