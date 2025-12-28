function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export class FxCanvas {
  constructor({ canvas, getWeather }) {
    this._canvas = canvas;
    this._ctx = canvas.getContext("2d", { alpha: true });
    this._getWeather = typeof getWeather === "function" ? getWeather : () => null;

    this._farDrops = [];
    this._nearDrops = [];
    this._bursts = [];
    this._lastT = 0;
    this._raf = null;

    this._flash = 0;
    this._flashVel = 0;
    this._flashPhase = null;
    this._flashStrength = 0;
    this._reducedMotion = prefersReducedMotion();

    this._windX = 0;
    this._windTargetX = 0;
    this._gust = null;

    this._elapsedMs = 0;
    this._paused = false;
    this._fillMs = 5 * 60 * 1000;

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize, { passive: true });
    this._resize();
    this._seedDrops();
  }

  setPaused(paused) {
    this._paused = !!paused;
  }

  resetWater() {
    this._elapsedMs = 0;
  }

  getElapsedMs() {
    return this._elapsedMs;
  }

  onWeatherChange() {
    if (this._reducedMotion) return;
    this._seedDrops();
    this._lastT = 0;
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    window.removeEventListener("resize", this._resize);
  }

  start() {
    if (this._raf) return;
    const loop = (t) => {
      this._tick(t);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  flash({ strength = 1 } = {}) {
    if (this._reducedMotion) return;
    const s = clamp01(strength);
    this._flash = Math.max(this._flash, 0.7 + 0.3 * s);
    this._flashStrength = Math.max(this._flashStrength, 0.75 + 0.25 * s);
    this._flashPhase = 0;
    this._spawnBurst(2 + Math.floor(s * 3));
  }

  _resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (this._canvas.width === w && this._canvas.height === h) return;
    this._canvas.width = w;
    this._canvas.height = h;
    this._ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._ctx.scale(dpr, dpr);
    if (!this._reducedMotion) this._seedDrops();
    this._lastT = 0;
  }

  _seedDrops() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this._farDrops = Array.from({ length: 320 }, () => {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 8 + Math.random() * 18;
      const speed = 160 + Math.random() * 360;
      const width = 0.9;
      const alpha = 0.025 + Math.random() * 0.045;
      const windFactor = 0.45 + Math.random() * 0.35;
      const jitter = (Math.random() * 2 - 1) * 22;
      return { x, y, len, speed, width, alpha, windFactor, jitter };
    });

    this._nearDrops = Array.from({ length: 160 }, () => {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 18 + Math.random() * 44;
      const speed = 520 + Math.random() * 980;
      const width = 1.6 + Math.random() * 0.9;
      const alpha = 0.04 + Math.random() * 0.08;
      const windFactor = 0.75 + Math.random() * 0.55;
      const jitter = (Math.random() * 2 - 1) * 34;
      return { x, y, len, speed, width, alpha, windFactor, jitter };
    });
  }

  _spawnBurst(count) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w;
      const y = (Math.random() * h) / 2;
      const len = 42 + Math.random() * 70;
      const speed = 900 + Math.random() * 900;
      const width = 2.2 + Math.random() * 1.2;
      const alpha = 0.18 + Math.random() * 0.18;
      const slant = -10 - Math.random() * 18;
      const life = 0.22 + Math.random() * 0.18;
      this._bursts.push({ x, y, len, speed, width, alpha, slant, life });
    }
  }

  _tick(t) {
    const dt = this._lastT ? Math.min(0.05, Math.max(0, (t - this._lastT) / 1000)) : 0;
    this._lastT = t;
    const ctx = this._ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;

    const weather = this._getWeather();
    const intensity = clamp01(Number(weather?.intensity ?? 0.65));
    const density = lerp(0.55, 1.35, Math.pow(intensity, 0.8));

    ctx.clearRect(0, 0, w, h);

    if (this._reducedMotion) return;

    if (!this._farDrops.length || !this._nearDrops.length) this._seedDrops();

    const time = t / 1000;
    const windinessBase = clamp01(Number(weather?.windChance ?? 0.12) * 3.3);
    const space = weather?.space ?? "window";
    const spaceFactor = space === "outdoor" ? 1.0 : space === "window" ? 0.65 : 0.4;
    const windiness = clamp01(windinessBase * spaceFactor);

    // Smooth wind field (px/s). Changes slowly, plus occasional gust.
    const baseWind =
      (Math.sin(time * 0.22) * 0.65 + Math.sin(time * 0.07 + 1.3) * 0.35) * (40 + 120 * windiness);
    this._windTargetX = baseWind;

    if (!this._gust && Math.random() < dt * (0.045 + windiness * 0.22)) {
      const sign = Math.random() < 0.5 ? -1 : 1;
      const strength = (55 + Math.random() * 220) * windiness * sign;
      const duration = 0.7 + Math.random() * 1.7;
      this._gust = { strength, t: 0, duration };
    }
    if (this._gust) {
      this._gust.t += dt;
      const p = clamp01(this._gust.t / this._gust.duration);
      const ease = Math.sin(Math.PI * p); // rise and fall
      this._windTargetX += this._gust.strength * ease;
      if (this._gust.t >= this._gust.duration) this._gust = null;
    }

    const follow = 1 - Math.pow(0.001, dt); // ~ fast but smooth
    this._windX = lerp(this._windX, this._windTargetX, follow);

    if (!this._paused) this._elapsedMs += dt * 1000;

    this._drawWater({ ctx, w, h, t, intensity });

    const drawDrop = (d, alphaScale, vyScale, windScale) => {
      const vy = d.speed * dt * vyScale;
      const vx = (this._windX * d.windFactor + d.jitter) * dt * windScale;

      d.y += vy;
      d.x += vx;
      if (d.y > h + d.len) d.y = -d.len;
      if (d.x < -80) d.x = w + 80;
      if (d.x > w + 80) d.x = -80;

      const a = d.alpha * alphaScale;
      const dx = (vx / Math.max(1e-3, vy)) * d.len;
      const x2 = d.x + dx;
      const y2 = d.y + d.len;

      // subtle outline (cool gray) + highlight (cool light gray)
      ctx.globalAlpha = a * 0.9;
      ctx.lineWidth = d.width + 0.7;
      ctx.strokeStyle = "rgba(90, 100, 115, 1)";
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.globalAlpha = a;
      ctx.lineWidth = d.width;
      ctx.strokeStyle = "rgba(203, 213, 225, 1)";
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    // Far rain (lighter, slower)
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const farAlphaScale = 0.55 + density * 0.55;
    const farVyScale = 0.55 + density * 0.55;
    const farWindScale = 0.75;
    const farCount = Math.floor(this._farDrops.length * (0.55 + density * 0.35));
    for (let i = 0; i < farCount; i++) drawDrop(this._farDrops[i], farAlphaScale, farVyScale, farWindScale);
    ctx.restore();

    // Near rain (stronger, faster)
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const nearAlphaScale = 0.42 + density * 0.95;
    const nearVyScale = 0.9 + density * 0.75;
    const nearWindScale = 1.0;
    const nearCount = Math.floor(this._nearDrops.length * (0.35 + density * 0.55));
    for (let i = 0; i < nearCount; i++) drawDrop(this._nearDrops[i], nearAlphaScale, nearVyScale, nearWindScale);
    ctx.restore();

    // Burst streaks near lightning
    if (this._bursts.length) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      for (let i = this._bursts.length - 1; i >= 0; i--) {
        const b = this._bursts[i];
        b.life -= dt;
        const vy = b.speed * dt;
        const vx = (this._windX * 1.1) * dt * 1.2;
        b.y += vy;
        b.x += vx;
        if (b.life <= 0 || b.y > h + b.len) {
          this._bursts.splice(i, 1);
          continue;
        }
        const a = b.alpha * (0.55 + this._flash * 1.35);
        const dx = (vx / Math.max(1e-3, vy)) * b.len;
        const x2 = b.x + dx;
        const y2 = b.y + b.len;

        ctx.globalAlpha = a * 0.9;
        ctx.lineWidth = b.width + 1;
        ctx.strokeStyle = "rgba(80, 90, 105, 1)";
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.globalAlpha = a;
        ctx.lineWidth = b.width;
        ctx.strokeStyle = "rgba(203, 213, 225, 1)";
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Full-screen lightning flash (整体发白，双脉冲)
    if (this._flashPhase !== null) {
      this._flashPhase += dt;
      const p = this._flashPhase;

      const p1 = Math.exp(-p * 14);
      const p2 = p < 0.1 ? 0 : Math.exp(-(p - 0.12) * 18) * 0.55;
      const envelope = (p1 + p2) * this._flashStrength;
      const a = clamp01(envelope * 0.55);

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      if (p > 0.55) {
        this._flashPhase = null;
        this._flashStrength = 0;
        this._flash = 0;
      }
    }
  }

  _drawWater({ ctx, w, h, t, intensity }) {
    const p = clamp01(this._elapsedMs / this._fillMs);
    if (p <= 0) return;

    const waterHeight = h * p;
    const yTop = h - waterHeight;

    // Base fill
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const baseAlpha = 0.16 + intensity * 0.10;
    ctx.globalAlpha = baseAlpha;
    const grad = ctx.createLinearGradient(0, yTop, 0, h);
    grad.addColorStop(0, "rgba(186, 203, 224, 0.60)");
    grad.addColorStop(1, "rgba(96, 120, 156, 0.52)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, yTop, w, waterHeight);
    ctx.restore();

    // Surface wave (subtle)
    const time = t / 1000;
    const waveAmp = 6 + intensity * 10;
    const waveFreq = 0.006 + intensity * 0.004;
    const waveSpeed = 0.9 + intensity * 0.6;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.20 + intensity * 0.10;
    ctx.beginPath();
    ctx.moveTo(0, yTop);
    const step = 18;
    for (let x = 0; x <= w + step; x += step) {
      const y =
        yTop +
        Math.sin((x * waveFreq) + time * waveSpeed) * waveAmp +
        Math.sin((x * waveFreq * 0.6) + time * waveSpeed * 1.6) * (waveAmp * 0.35);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(125, 150, 185, 0.55)";
    ctx.fill();

    // Highlight line
    ctx.globalAlpha = 0.22 + intensity * 0.14;
    ctx.strokeStyle = "rgba(236, 245, 255, 0.70)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 0; x <= w + step; x += step) {
      const y =
        yTop +
        Math.sin((x * waveFreq) + time * waveSpeed) * waveAmp +
        Math.sin((x * waveFreq * 0.6) + time * waveSpeed * 1.6) * (waveAmp * 0.35);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
