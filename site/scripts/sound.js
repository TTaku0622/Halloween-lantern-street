// 周りの音を聞く。マイクの音は端末の中で音量を測るだけで、録音も送信もしない
const BANDS = 8;

export class Ears {
  constructor() {
    this.on = false;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.stream = stream;
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(stream);
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 2048;
    this.an.smoothingTimeConstant = 0.5;
    src.connect(this.an);
    this.time = new Float32Array(this.an.fftSize);
    this.freq = new Float32Array(this.an.frequencyBinCount);

    // 80Hz〜8kHz を対数で8つに分ける（ランタンごとに担当の帯域を変える）
    const binHz = this.ctx.sampleRate / this.an.fftSize;
    this.edges = [];
    for (let i = 0; i <= BANDS; i++) {
      this.edges.push(Math.max(1, Math.round((80 * Math.pow(100, i / BANDS)) / binHz)));
    }
    this.on = true;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.on = false;
  }

  // { level: 全体の大きさ 0〜1, bands: 帯域ごとの大きさ 0〜1 × 8 }
  read() {
    if (!this.on) return null;
    this.an.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (const v of this.time) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / this.time.length) + 1e-9);
    const level = clamp((db + 60) / 45);

    this.an.getFloatFrequencyData(this.freq);
    const bands = [];
    for (let i = 0; i < BANDS; i++) {
      let acc = 0, n = 0;
      for (let b = this.edges[i]; b < this.edges[i + 1] && b < this.freq.length; b++) {
        acc += this.freq[b];
        n++;
      }
      bands.push(clamp((acc / Math.max(n, 1) + 90) / 55));
    }
    return { level, bands };
  }
}

export function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

// 1つのランタンの明るさを、音（なければ揺らぎだけ）から求めて滑らかに追従させる
export function nextLight(current, heard, band, flick) {
  const target = heard
    ? clamp(0.12 + 0.95 * (0.55 * heard.level + 0.45 * heard.bands[band % heard.bands.length])) * (0.88 + 0.12 * flick)
    : 0.62 + 0.25 * flick;
  // 明るくなるときは速く、暗くなるときはゆっくり
  return current + (target - current) * (target > current ? 0.45 : 0.07);
}
