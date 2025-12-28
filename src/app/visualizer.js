function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpRgb(from, to, t) {
  const r = Math.round(lerp(from[0], to[0], t));
  const g = Math.round(lerp(from[1], to[1], t));
  const b = Math.round(lerp(from[2], to[2], t));
  return `rgb(${r} ${g} ${b})`;
}

export class Visualizer {
  constructor({
    getAnalyser,
    bars,
    dynamicDots,
    rainStreaks = [],
    glassDrops = [],
    getWeather = null,
    getPowerOn
  }) {
    this._getAnalyser = getAnalyser;
    this._getPowerOn = getPowerOn;
    this._getWeather = typeof getWeather === "function" ? getWeather : null;
    this._bars = Array.from(bars);
    this._dots = Array.from(dynamicDots);
    this._rain = Array.from(rainStreaks);
    this._glass = Array.from(glassDrops);
    this._rafId = null;
    this._frequencyData = null;
    this._bandBinRanges = null;
    this._smoothed = new Float32Array(this._bars.length).fill(0);
    this._baseDot = [42, 42, 42];
    this._activeDot = [45, 90, 53];
    this._lightBoost = 0;
  }

  bumpLightning() {
    this._lightBoost = 1;
  }

  start() {
    if (this._rafId) return;
    const loop = (t) => {
      this._tick(t);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (!this._rafId) return;
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  reset() {
    this._smoothed.fill(0);
    this._applyBars(new Float32Array(this._bars.length).fill(0));
    this._applyDots(0, 0);
    this._applyRain(0, 0);
    this._applyGlass(0, 0, 0);
    this._lightBoost = 0;
  }

  _ensureBands(analyser) {
    if (this._frequencyData?.length === analyser.frequencyBinCount) return;

    this._frequencyData = new Uint8Array(analyser.frequencyBinCount);
    this._bandBinRanges = null;
  }

  _computeBandRanges({ sampleRate, binCount, bands }) {
    const nyquist = sampleRate / 2;
    const ranges = [];
    for (let i = 0; i < bands.length - 1; i++) {
      const f0 = bands[i];
      const f1 = bands[i + 1];
      const b0 = Math.max(0, Math.floor((f0 / nyquist) * binCount));
      const b1 = Math.max(b0 + 1, Math.floor((f1 / nyquist) * binCount));
      ranges.push([b0, Math.min(binCount, b1)]);
    }
    return ranges;
  }

  _tick(t) {
    const analyser = this._getAnalyser();
    const isOn = this._getPowerOn();
    if (!isOn || !analyser) {
      this.reset();
      return;
    }

    this._ensureBands(analyser);
    analyser.getByteFrequencyData(this._frequencyData);

    if (!this._bandBinRanges) {
      const sampleRate = analyser.context.sampleRate;
      const binCount = analyser.frequencyBinCount;
      const bands = [60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000];
      this._bandBinRanges = this._computeBandRanges({ sampleRate, binCount, bands });
    }

    const bandValues = new Float32Array(this._bars.length).fill(0);
    for (let i = 0; i < this._bars.length; i++) {
      const [b0, b1] = this._bandBinRanges[i] ?? [0, 1];
      let sum = 0;
      for (let b = b0; b < b1; b++) sum += this._frequencyData[b];
      bandValues[i] = sum / Math.max(1, b1 - b0);
    }

    for (let i = 0; i < this._smoothed.length; i++) {
      const v = bandValues[i];
      const prev = this._smoothed[i];
      const attack = 0.55;
      const release = 0.18;
      const next = v > prev ? prev + (v - prev) * attack : prev + (v - prev) * release;
      this._smoothed[i] = next;
    }

    this._applyBars(this._smoothed);

    const bass = clamp01((this._smoothed[0] + this._smoothed[1]) / (2 * 255));
    const mids = clamp01((this._smoothed[3] + this._smoothed[4]) / (2 * 255));
    this._applyDots(bass, mids, t);
    const weather = this._getWeather?.();
    const intensity = clamp01(Number(weather?.intensity ?? bass));
    this._applyRain(intensity, t);
    this._lightBoost *= 0.9;
    this._applyGlass(intensity, this._lightBoost, t);
  }

  _applyBars(values) {
    const baselineY = 100;
    const minH = 2.2;
    const maxH = 28;

    for (let i = 0; i < this._bars.length; i++) {
      const bar = this._bars[i];
      const v = clamp01(values[i] / 255);
      const shaped = Math.pow(v, 1.25);
      const h = minH + shaped * (maxH - minH);
      bar.setAttribute("height", h.toFixed(2));
      bar.setAttribute("y", (baselineY - h).toFixed(2));
    }
  }

  _applyDots(bass, mids, t = 0) {
    const intensity = Math.pow(bass, 1.25);
    const wobble = 0.35 + mids * 0.65;
    const time = t / 1000;

    for (const dot of this._dots) {
      const seed = Number(dot.dataset.seed ?? 0.5);
      const phase = Number(dot.dataset.phase ?? 0);
      const local = (0.25 + 0.75 * seed) * intensity;
      const pulse = 0.65 + 0.35 * Math.sin(time * (2.2 + wobble * 2.8) + phase);
      const amount = clamp01(local * pulse);
      dot.style.fill = lerpRgb(this._baseDot, this._activeDot, amount);
    }
  }

  _applyRain(intensity, t = 0) {
    if (!this._rain.length) return;
    const height = 320;
    const time = t / 1000;
    const baseSpeed = 18 + intensity * 120;
    const alphaBase = 0.05 + intensity * 0.22;

    for (const line of this._rain) {
      const len = Number(line.dataset.len ?? 12);
      const phase = Number(line.dataset.phase ?? 0);
      const speed = Number(line.dataset.speed ?? 1);
      const alpha = Number(line.dataset.alpha ?? 0.6);

      const y = ((time * baseSpeed * speed + phase) % (height + len)) - len;
      line.setAttribute("y1", y.toFixed(2));
      line.setAttribute("y2", (y + len).toFixed(2));
      line.style.opacity = String(alphaBase * alpha);
    }
  }

  _applyGlass(intensity, lightBoost, t = 0) {
    if (!this._glass.length) return;
    const width = 252;
    const height = 102;
    const time = t / 1000;
    const speedBase = 2.5 + intensity * 10;
    const alphaBase = 0.02 + intensity * 0.08 + lightBoost * 0.12;

    for (const line of this._glass) {
      const len = Number(line.dataset.len ?? 14);
      const phase = Number(line.dataset.phase ?? 0);
      const speed = Number(line.dataset.speed ?? 0.6);
      const alpha = Number(line.dataset.alpha ?? 0.6);
      const drift = Number(line.dataset.drift ?? 0);

      const y = ((time * speedBase * speed + phase) % (height + len)) - len;
      const x = Number(line.getAttribute("x1") ?? 20) + drift * Math.sin(time * 0.6 + phase);
      const clampedX = Math.max(8, Math.min(width - 8, x));
      line.setAttribute("x1", clampedX.toFixed(2));
      line.setAttribute("x2", clampedX.toFixed(2));
      line.setAttribute("y1", (4 + y).toFixed(2));
      line.setAttribute("y2", (4 + y + len).toFixed(2));
      line.style.opacity = String(alphaBase * alpha);
    }
  }
}
