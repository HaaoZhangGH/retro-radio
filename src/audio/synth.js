const NOISE_BUFFER_SECONDS = 8;

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function createNoiseBuffer({ audioContext, color, seconds = NOISE_BUFFER_SECONDS }) {
  const sampleRate = audioContext.sampleRate;
  const length = Math.floor(seconds * sampleRate);
  const buffer = audioContext.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const rngL = mulberry32(0x12345678 ^ sampleRate);
  const rngR = mulberry32(0x9e3779b9 ^ length);

  if (color === "white") {
    for (let i = 0; i < length; i++) {
      left[i] = rngL() * 2 - 1;
      right[i] = rngR() * 2 - 1;
    }
    return buffer;
  }

  if (color === "brown") {
    let lastOutL = 0;
    let lastOutR = 0;
    for (let i = 0; i < length; i++) {
      const whiteL = rngL() * 2 - 1;
      const whiteR = rngR() * 2 - 1;
      lastOutL = (lastOutL + 0.02 * whiteL) / 1.02;
      lastOutR = (lastOutR + 0.02 * whiteR) / 1.02;
      left[i] = clamp(lastOutL * 3.5, -1, 1);
      right[i] = clamp(lastOutR * 3.5, -1, 1);
    }
    return buffer;
  }

  // pink
  let b0L = 0,
    b1L = 0,
    b2L = 0,
    b3L = 0,
    b4L = 0,
    b5L = 0,
    b6L = 0;
  let b0R = 0,
    b1R = 0,
    b2R = 0,
    b3R = 0,
    b4R = 0,
    b5R = 0,
    b6R = 0;

  for (let i = 0; i < length; i++) {
    const whiteL = rngL() * 2 - 1;
    b0L = 0.99886 * b0L + whiteL * 0.0555179;
    b1L = 0.99332 * b1L + whiteL * 0.0750759;
    b2L = 0.969 * b2L + whiteL * 0.153852;
    b3L = 0.8665 * b3L + whiteL * 0.3104856;
    b4L = 0.55 * b4L + whiteL * 0.5329522;
    b5L = -0.7616 * b5L - whiteL * 0.016898;
    const pinkL = b0L + b1L + b2L + b3L + b4L + b5L + b6L + whiteL * 0.5362;
    b6L = whiteL * 0.115926;

    const whiteR = rngR() * 2 - 1;
    b0R = 0.99886 * b0R + whiteR * 0.0555179;
    b1R = 0.99332 * b1R + whiteR * 0.0750759;
    b2R = 0.969 * b2R + whiteR * 0.153852;
    b3R = 0.8665 * b3R + whiteR * 0.3104856;
    b4R = 0.55 * b4R + whiteR * 0.5329522;
    b5R = -0.7616 * b5R - whiteR * 0.016898;
    const pinkR = b0R + b1R + b2R + b3R + b4R + b5R + b6R + whiteR * 0.5362;
    b6R = whiteR * 0.115926;

    left[i] = clamp(pinkL * 0.11, -1, 1);
    right[i] = clamp(pinkR * 0.11, -1, 1);
  }

  return buffer;
}

const bufferCache = new Map();

function getNoiseBuffer(audioContext, color) {
  const key = `${audioContext.sampleRate}:${color}`;
  if (bufferCache.has(key)) return bufferCache.get(key);
  const buffer = createNoiseBuffer({ audioContext, color });
  bufferCache.set(key, buffer);
  return buffer;
}

function createNoiseChain(audioContext, { color, gain = 1, highpassHz, lowpassHz, type = "noise" }) {
  const source = audioContext.createBufferSource();
  source.buffer = getNoiseBuffer(audioContext, color);
  source.loop = true;

  let node = source;
  if (highpassHz) {
    const hp = audioContext.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = highpassHz;
    hp.Q.value = 0.8;
    node.connect(hp);
    node = hp;
  }
  if (lowpassHz) {
    const lp = audioContext.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lowpassHz;
    lp.Q.value = 0.6;
    node.connect(lp);
    node = lp;
  }

  const gainNode = audioContext.createGain();
  gainNode.gain.value = gain;
  node.connect(gainNode);

  return {
    kind: type,
    source,
    output: gainNode,
    start() {
      try {
        source.start();
      } catch {}
    },
    stop() {
      try {
        source.stop();
      } catch {}
    }
  };
}

function scheduleRecurring({ audioContext, intervalMs, lookAheadSeconds, schedule }) {
  let timer = null;
  let nextTime = audioContext.currentTime;
  const tick = () => {
    const now = audioContext.currentTime;
    while (nextTime < now + lookAheadSeconds) {
      schedule(nextTime);
      nextTime += intervalMs / 1000;
    }
  };
  timer = setInterval(tick, Math.max(25, Math.floor(intervalMs / 2)));
  tick();
  return () => {
    if (timer) clearInterval(timer);
  };
}

function createRain(audioContext, { intensity = 0.8 } = {}) {
  const out = audioContext.createGain();
  out.gain.value = 1;

  const base = createNoiseChain(audioContext, {
    color: "pink",
    highpassHz: 350,
    lowpassHz: 9000,
    gain: 0.18 * intensity,
    type: "rain-base"
  });
  base.output.connect(out);

  const rumble = createNoiseChain(audioContext, {
    color: "brown",
    lowpassHz: 220,
    gain: 0.05 * intensity,
    type: "rain-rumble"
  });
  rumble.output.connect(out);

  const droplets = createNoiseChain(audioContext, {
    color: "white",
    highpassHz: 1200,
    lowpassHz: 11000,
    gain: 1,
    type: "rain-droplets"
  });

  const band = audioContext.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3800;
  band.Q.value = 1.8;
  droplets.output.connect(band);

  const vca = audioContext.createGain();
  vca.gain.value = 0.0001;
  band.connect(vca);

  const panner = audioContext.createStereoPanner();
  panner.pan.value = 0;
  vca.connect(panner);
  panner.connect(out);

  const stopSchedulers = [];
  const stopDroplets = scheduleRecurring({
    audioContext,
    intervalMs: 140,
    lookAheadSeconds: 0.7,
    schedule: (t) => {
      const rate = clamp(0.35 + intensity * 1.25, 0.35, 1.6);
      const doDrop = Math.random() < rate;
      if (!doDrop) return;

      const level = 0.18 * intensity * (0.35 + Math.random());
      const pan = (Math.random() * 2 - 1) * 0.75;
      panner.pan.setValueAtTime(pan, t);

      vca.gain.cancelScheduledValues(t);
      vca.gain.setValueAtTime(0.0001, t);
      vca.gain.exponentialRampToValueAtTime(level, t + 0.006);
      vca.gain.exponentialRampToValueAtTime(0.0001, t + 0.055 + Math.random() * 0.03);

      band.frequency.setValueAtTime(3200 + Math.random() * 2600, t);
      band.Q.setValueAtTime(1.2 + Math.random() * 2.2, t);
    }
  });
  stopSchedulers.push(stopDroplets);

  return {
    output: out,
    start() {
      base.start();
      rumble.start();
      droplets.start();
    },
    stop() {
      stopSchedulers.forEach((s) => s());
      base.stop();
      rumble.stop();
      droplets.stop();
    }
  };
}

function createForest(audioContext, { intensity = 0.7 } = {}) {
  const out = audioContext.createGain();
  out.gain.value = 1;

  const wind = createNoiseChain(audioContext, {
    color: "pink",
    highpassHz: 120,
    lowpassHz: 4200,
    gain: 0.12 * intensity,
    type: "forest-wind"
  });
  wind.output.connect(out);

  const insectsGain = audioContext.createGain();
  insectsGain.gain.value = 0.008 * intensity;
  insectsGain.connect(out);

  const insectOsc = audioContext.createOscillator();
  insectOsc.type = "sine";
  insectOsc.frequency.value = 5200;
  insectOsc.connect(insectsGain);

  const lfo = audioContext.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.18;
  const lfoGain = audioContext.createGain();
  lfoGain.gain.value = 0.004 * intensity;
  lfo.connect(lfoGain);
  lfoGain.connect(insectsGain.gain);

  const activeOscillators = new Set();
  const stopBirds = scheduleRecurring({
    audioContext,
    intervalMs: 950,
    lookAheadSeconds: 1.2,
    schedule: (t) => {
      if (Math.random() > 0.42) return;

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const panner = audioContext.createStereoPanner();
      osc.type = "sine";
      const f0 = 750 + Math.random() * 450;
      const f1 = 1500 + Math.random() * 1200;
      const dur = 0.08 + Math.random() * 0.18;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.55);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + dur);

      const level = 0.05 * intensity * (0.5 + Math.random() * 0.8);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.85, t);

      osc.connect(gain);
      gain.connect(panner);
      panner.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);

      activeOscillators.add(osc);
      osc.addEventListener("ended", () => activeOscillators.delete(osc), { once: true });
    }
  });

  return {
    output: out,
    start() {
      wind.start();
      insectOsc.start();
      lfo.start();
    },
    stop() {
      stopBirds();
      wind.stop();
      try {
        insectOsc.stop();
      } catch {}
      try {
        lfo.stop();
      } catch {}
      for (const osc of activeOscillators) {
        try {
          osc.stop();
        } catch {}
      }
      activeOscillators.clear();
    }
  };
}

function createAirport(audioContext, { intensity = 0.75 } = {}) {
  const out = audioContext.createGain();
  out.gain.value = 1;

  const rumble = createNoiseChain(audioContext, {
    color: "brown",
    lowpassHz: 160,
    gain: 0.12 * intensity,
    type: "airport-rumble"
  });
  rumble.output.connect(out);

  const crowd = createNoiseChain(audioContext, {
    color: "pink",
    gain: 1,
    type: "airport-crowd"
  });
  const crowdBand = audioContext.createBiquadFilter();
  crowdBand.type = "bandpass";
  crowdBand.frequency.value = 650;
  crowdBand.Q.value = 0.55;
  crowd.output.connect(crowdBand);

  const crowdGain = audioContext.createGain();
  crowdGain.gain.value = 0.07 * intensity;
  crowdBand.connect(crowdGain);
  crowdGain.connect(out);

  const crowdLfo = audioContext.createOscillator();
  crowdLfo.type = "sine";
  crowdLfo.frequency.value = 0.07;
  const crowdLfoGain = audioContext.createGain();
  crowdLfoGain.gain.value = 0.015 * intensity;
  crowdLfo.connect(crowdLfoGain);
  crowdLfoGain.connect(crowdGain.gain);

  const activeOscillators = new Set();
  const stopBeeps = scheduleRecurring({
    audioContext,
    intervalMs: 1100,
    lookAheadSeconds: 1.4,
    schedule: (t) => {
      if (Math.random() > 0.28) return;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "sine";
      const f = Math.random() > 0.5 ? 880 : 660;
      const dur = 0.06 + Math.random() * 0.06;
      osc.frequency.setValueAtTime(f, t);

      const level = 0.04 * intensity * (0.6 + Math.random() * 0.6);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);

      activeOscillators.add(osc);
      osc.addEventListener("ended", () => activeOscillators.delete(osc), { once: true });
    }
  });

  const announcements = createNoiseChain(audioContext, {
    color: "pink",
    gain: 1,
    type: "airport-announcement"
  });
  const annBand = audioContext.createBiquadFilter();
  annBand.type = "bandpass";
  annBand.frequency.value = 1100;
  annBand.Q.value = 0.85;
  announcements.output.connect(annBand);
  const annGain = audioContext.createGain();
  annGain.gain.value = 0.0001;
  annBand.connect(annGain);
  annGain.connect(out);

  const stopAnnouncements = scheduleRecurring({
    audioContext,
    intervalMs: 2100,
    lookAheadSeconds: 1.6,
    schedule: (t) => {
      if (Math.random() > 0.18) return;
      const dur = 0.55 + Math.random() * 0.75;
      const level = 0.03 * intensity * (0.55 + Math.random() * 0.8);
      annBand.frequency.setValueAtTime(850 + Math.random() * 900, t);
      annBand.Q.setValueAtTime(0.6 + Math.random() * 1.0, t);

      annGain.gain.cancelScheduledValues(t);
      annGain.gain.setValueAtTime(0.0001, t);
      annGain.gain.exponentialRampToValueAtTime(level, t + 0.08);
      annGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
  });

  return {
    output: out,
    start() {
      rumble.start();
      crowd.start();
      announcements.start();
      crowdLfo.start();
    },
    stop() {
      stopBeeps();
      stopAnnouncements();
      rumble.stop();
      crowd.stop();
      announcements.stop();
      try {
        crowdLfo.stop();
      } catch {}
      for (const osc of activeOscillators) {
        try {
          osc.stop();
        } catch {}
      }
      activeOscillators.clear();
    }
  };
}

export function createSynthSource(audioContext, { preset, params = {}, callbacks = {} }) {
  if (preset === "noise") {
    const color = params.color ?? "white";
    const out = audioContext.createGain();
    out.gain.value = 1;
    const noise = createNoiseChain(audioContext, {
      color,
      highpassHz: color === "brown" ? 0 : 40,
      lowpassHz: 18000,
      gain: 0.24,
      type: "station-noise"
    });
    noise.output.connect(out);
    return {
      output: out,
      start() {
        noise.start();
      },
      stop() {
        noise.stop();
      }
    };
  }

  if (preset === "rain") return createRain(audioContext, params);
  if (preset === "rainWeather")
    return createRainWeather(audioContext, { ...params, onLightning: callbacks.onLightning });
  if (preset === "forest") return createForest(audioContext, params);
  if (preset === "airport") return createAirport(audioContext, params);

  // fallback: gentle pink noise
  return createRain(audioContext, { intensity: 0.5 });
}

export function createTextureNoise(audioContext, { color = "pink" } = {}) {
  if (color === "off") {
    const out = audioContext.createGain();
    out.gain.value = 1;
    return { output: out, start() {}, stop() {} };
  }

  const out = audioContext.createGain();
  out.gain.value = 1;
  const noise = createNoiseChain(audioContext, {
    color,
    highpassHz: 320,
    lowpassHz: 9000,
    gain: 1,
    type: "texture"
  });
  noise.output.connect(out);

  return {
    output: out,
    start() {
      noise.start();
    },
    stop() {
      noise.stop();
    }
  };
}

function createRainWeather(
  audioContext,
  {
    intensity = 0.8,
    driftHz = 0.06,
    thunderProfile = "rare",
    thunderNearness = 0.35,
    windChance = 0.12,
    space = "window",
    onLightning
  } = {}
) {
  const out = audioContext.createGain();
  out.gain.value = 1;

  const rain = createRain(audioContext, { intensity });
  rain.output.connect(out);

  const wind = createNoiseChain(audioContext, {
    color: "pink",
    highpassHz: 90,
    lowpassHz: 1800,
    gain: 1,
    type: "wind"
  });
  const windFilter = audioContext.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 1200;
  windFilter.Q.value = 0.6;
  wind.output.connect(windFilter);

  const windVca = audioContext.createGain();
  windVca.gain.value = 0.0001;
  windFilter.connect(windVca);
  windVca.connect(out);

  const drift = audioContext.createOscillator();
  drift.type = "sine";
  drift.frequency.value = clamp(driftHz, 0.02, 0.14);
  const driftGain = audioContext.createGain();
  driftGain.gain.value = 0.12;
  drift.connect(driftGain);
  driftGain.connect(rain.output.gain);

  // Space tint (subtle)
  const spaceFilter = audioContext.createBiquadFilter();
  spaceFilter.type = "lowpass";
  spaceFilter.frequency.value = space === "cabin" ? 5200 : space === "window" ? 8200 : 12000;
  spaceFilter.Q.value = 0.4;
  out.connect(spaceFilter);

  const post = audioContext.createGain();
  post.gain.value = 1;
  spaceFilter.connect(post);

  const activeOscillators = new Set();
  const stopSchedulers = [];

  const thunderIntervals =
    thunderProfile === "stormy"
      ? [20, 60]
      : thunderProfile === "medium"
        ? [45, 120]
        : [90, 240];

  let nextThunderAt = audioContext.currentTime + thunderIntervals[0] + Math.random() * 6;

  const stopThunder = scheduleRecurring({
    audioContext,
    intervalMs: 250,
    lookAheadSeconds: 1.4,
    schedule: (t) => {
      if (t < nextThunderAt) return;

      const span = thunderIntervals[1] - thunderIntervals[0];
      nextThunderAt = t + thunderIntervals[0] + Math.random() * span;

      const near = clamp(thunderNearness + (Math.random() * 2 - 1) * 0.18, 0, 1);
      const delay = 0.25 + (1 - near) * (0.9 + Math.random() * 1.5);
      const start = t + 0.05 + Math.random() * 0.25;
      const soundAt = start + delay;

      if (typeof onLightning === "function") {
        const ms = Math.max(0, (start - audioContext.currentTime) * 1000);
        setTimeout(() => {
          try {
            onLightning({ near, thunderProfile, intensity });
          } catch {}
        }, ms);
      }

      const dur = near > 0.6 ? 0.9 + Math.random() * 0.8 : 2.2 + Math.random() * 2.8;
      const base = near > 0.6 ? 120 + Math.random() * 80 : 55 + Math.random() * 55;
      const rumble = audioContext.createOscillator();
      rumble.type = "triangle";
      rumble.frequency.setValueAtTime(base, soundAt);
      rumble.frequency.exponentialRampToValueAtTime(base * (0.55 + Math.random() * 0.25), soundAt + dur);

      const rumbleGain = audioContext.createGain();
      const level = 0.08 * clamp(intensity, 0.3, 1) * (0.55 + near * 0.9);
      rumbleGain.gain.setValueAtTime(0.0001, soundAt);
      rumbleGain.gain.exponentialRampToValueAtTime(level, soundAt + 0.06);
      rumbleGain.gain.exponentialRampToValueAtTime(0.0001, soundAt + dur);

      const rumbleLP = audioContext.createBiquadFilter();
      rumbleLP.type = "lowpass";
      rumbleLP.frequency.setValueAtTime(240 + near * 520, soundAt);
      rumbleLP.Q.value = 0.7;

      rumble.connect(rumbleLP);
      rumbleLP.connect(rumbleGain);
      rumbleGain.connect(post);

      rumble.start(soundAt);
      rumble.stop(soundAt + dur + 0.05);
      activeOscillators.add(rumble);
      rumble.addEventListener("ended", () => activeOscillators.delete(rumble), { once: true });

      // Crack (near thunder) - short noise burst
      if (near > 0.55 && Math.random() < 0.75) {
        const crack = createNoiseChain(audioContext, {
          color: "white",
          highpassHz: 900,
          lowpassHz: 9000,
          gain: 1,
          type: "thunder-crack"
        });
        const crackVca = audioContext.createGain();
        crackVca.gain.setValueAtTime(0.0001, soundAt);
        crackVca.gain.exponentialRampToValueAtTime(0.12 * level, soundAt + 0.01);
        crackVca.gain.exponentialRampToValueAtTime(0.0001, soundAt + 0.12);
        crack.output.connect(crackVca);
        crackVca.connect(post);
        crack.start();
        setTimeout(() => crack.stop(), 250);
      }
    }
  });
  stopSchedulers.push(stopThunder);

  const stopWind = scheduleRecurring({
    audioContext,
    intervalMs: 900,
    lookAheadSeconds: 1.6,
    schedule: (t) => {
      if (Math.random() > windChance) return;
      const dur = 1.6 + Math.random() * 3.2;
      const level = 0.02 + 0.05 * intensity * (0.4 + Math.random() * 0.8);
      windFilter.frequency.setValueAtTime(800 + Math.random() * 1400, t);
      windVca.gain.setValueAtTime(0.0001, t);
      windVca.gain.exponentialRampToValueAtTime(level, t + 0.18);
      windVca.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
  });
  stopSchedulers.push(stopWind);

  return {
    output: post,
    start() {
      rain.start();
      wind.start();
      drift.start();
    },
    stop() {
      stopSchedulers.forEach((s) => s());
      rain.stop();
      wind.stop();
      try {
        drift.stop();
      } catch {}
      for (const osc of activeOscillators) {
        try {
          osc.stop();
        } catch {}
      }
      activeOscillators.clear();
    }
  };
}
