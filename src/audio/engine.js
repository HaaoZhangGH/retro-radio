import { createSynthSource, createTextureNoise } from "./synth.js";

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function safeExpRamp(param, toValue, atTime) {
  const v = Math.max(0.0001, toValue);
  param.exponentialRampToValueAtTime(v, atTime);
}

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._analyser = null;
    this._masterGain = null;
    this._stationGain = null;
    this._textureGain = null;
    this._transitionGain = null;

    this._currentStation = null;
    this._currentSource = null;

    this._texture = { color: "off", amount: 0 };
    this._textureSource = null;

    this._transitionSource = null;
    this._powered = false;
    this._onLightning = null;
  }

  getState() {
    return this._ctx?.state ?? "none";
  }

  getAnalyser() {
    return this._analyser;
  }

  setOnLightning(handler) {
    this._onLightning = typeof handler === "function" ? handler : null;
  }

  async _ensureContext() {
    if (this._ctx) return;

    const ctx = new AudioContext({ latencyHint: "interactive" });
    this._ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.9;
    this._masterGain = master;

    const stationGain = ctx.createGain();
    stationGain.gain.value = 0.0001;
    this._stationGain = stationGain;

    const textureGain = ctx.createGain();
    textureGain.gain.value = 0.0001;
    this._textureGain = textureGain;

    const transitionGain = ctx.createGain();
    transitionGain.gain.value = 0.0001;
    this._transitionGain = transitionGain;

    stationGain.connect(master);
    textureGain.connect(master);
    transitionGain.connect(master);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.7;
    this._analyser = analyser;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 24;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    master.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(ctx.destination);

    // Always-on scan noise (muted by default)
    const scanNoise = createTextureNoise(ctx, { color: "white" });
    scanNoise.output.connect(transitionGain);
    scanNoise.start();
    this._transitionSource = scanNoise;
  }

  async powerOn() {
    await this._ensureContext();
    this._powered = true;
    try {
      await this._ctx.resume();
    } catch {}
    return this.getState();
  }

  async powerOff() {
    this._powered = false;
    this._stopCurrentSource();
    this._setTextureInternal({ color: "off", amount: 0 }, { immediate: true });
    if (this._ctx) {
      try {
        await this._ctx.suspend();
      } catch {}
    }
  }

  _stopCurrentSource() {
    const src = this._currentSource;
    this._currentSource = null;
    this._currentStation = null;

    if (!src) return;
    try {
      src.stop?.();
    } catch {}
    try {
      src.disconnect?.();
    } catch {}
    try {
      src.cleanup?.();
    } catch {}
  }

  _createMediaSource({ url, file }) {
    const el = document.createElement("audio");
    el.preload = "auto";
    el.loop = true;
    el.crossOrigin = "anonymous";
    let objectUrl = null;

    if (file) {
      objectUrl = URL.createObjectURL(file);
      el.src = objectUrl;
    } else if (url) {
      el.src = url;
    } else {
      throw new Error("Missing media source.");
    }

    const mediaNode = this._ctx.createMediaElementSource(el);
    mediaNode.connect(this._stationGain);

    return {
      kind: "media",
      start: async () => {
        try {
          await el.play();
        } catch {}
      },
      stop: () => {
        try {
          el.pause();
        } catch {}
      },
      disconnect: () => {
        try {
          mediaNode.disconnect();
        } catch {}
      },
      cleanup: () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    };
  }

  _createStationSource(station, { file } = {}) {
    if (station.source.kind === "synth") {
      const synth = createSynthSource(this._ctx, {
        preset: station.source.preset,
        params: station.source.params ?? {},
        callbacks: { onLightning: this._onLightning }
      });
      synth.output.connect(this._stationGain);
      return {
        kind: "synth",
        start: () => synth.start(),
        stop: () => synth.stop(),
        disconnect: () => {
          try {
            synth.output.disconnect();
          } catch {}
        }
      };
    }

    if (station.source.kind === "url") return this._createMediaSource({ url: station.source.url });
    if (station.source.kind === "file") return this._createMediaSource({ file });

    throw new Error(`Unsupported source.kind: ${station.source.kind}`);
  }

  async setStation(station, { file } = {}) {
    if (!this._powered) return;
    await this._ensureContext();
    try {
      await this._ctx.resume();
    } catch {}

    const now = this._ctx.currentTime;
    this._stationGain.gain.cancelScheduledValues(now);
    this._stationGain.gain.setValueAtTime(this._stationGain.gain.value, now);
    safeExpRamp(this._stationGain.gain, 0.0001, now + 0.03);

    this._stopCurrentSource();

    const source = this._createStationSource(station, { file });
    this._currentSource = source;
    this._currentStation = station;
    source.start();

    const t = this._ctx.currentTime;
    this._stationGain.gain.cancelScheduledValues(t);
    this._stationGain.gain.setValueAtTime(0.0001, t);
    safeExpRamp(this._stationGain.gain, 0.95, t + 0.25);
  }

  setTexture(texture) {
    if (!this._powered) return;
    this._setTextureInternal(texture, { immediate: false });
  }

  _setTextureInternal(texture, { immediate }) {
    if (!this._ctx) {
      this._texture = texture;
      return;
    }

    const color = texture?.color ?? "off";
    const amount = clamp(Number(texture?.amount ?? 0), 0, 0.35);
    const changed = color !== this._texture.color;
    this._texture = { color, amount };

    const now = this._ctx.currentTime;
    const textureGain = this._textureGain;
    textureGain.gain.cancelScheduledValues(now);
    textureGain.gain.setValueAtTime(textureGain.gain.value, now);
    const target = color === "off" ? 0.0001 : Math.max(0.0001, amount);
    if (immediate) textureGain.gain.setValueAtTime(target, now);
    else safeExpRamp(textureGain.gain, target, now + 0.12);

    if (!changed) return;

    if (this._textureSource) {
      try {
        this._textureSource.stop();
      } catch {}
      try {
        this._textureSource.output.disconnect();
      } catch {}
      this._textureSource = null;
    }

    if (color === "off") return;

    const noise = createTextureNoise(this._ctx, { color });
    noise.output.connect(this._textureGain);
    noise.start();
    this._textureSource = noise;
  }

  async scanToStation(station, { file, onLock } = {}) {
    if (!this._powered) return;
    await this._ensureContext();
    try {
      await this._ctx.resume();
    } catch {}

    const now = this._ctx.currentTime;
    const lockDelay = 0.55;

    this._stationGain.gain.cancelScheduledValues(now);
    this._stationGain.gain.setValueAtTime(this._stationGain.gain.value, now);
    safeExpRamp(this._stationGain.gain, 0.0001, now + 0.06);

    this._transitionGain.gain.cancelScheduledValues(now);
    this._transitionGain.gain.setValueAtTime(this._transitionGain.gain.value, now);
    safeExpRamp(this._transitionGain.gain, 0.32, now + 0.04);

    return new Promise((resolve) => {
      setTimeout(async () => {
        try {
          this._transitionGain.gain.cancelScheduledValues(this._ctx.currentTime);
          this._transitionGain.gain.setValueAtTime(this._transitionGain.gain.value, this._ctx.currentTime);
        } catch {}

        await this.setStation(station, { file });
        this.setTexture(station.texture);
        onLock?.();

        const t = this._ctx.currentTime;
        this._transitionGain.gain.cancelScheduledValues(t);
        this._transitionGain.gain.setValueAtTime(this._transitionGain.gain.value, t);
        safeExpRamp(this._transitionGain.gain, 0.0001, t + 0.38);

        resolve();
      }, lockDelay * 1000);
    });
  }
}
