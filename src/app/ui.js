import { AudioEngine } from "../audio/engine.js";
import { loadStationsDoc, saveStationsDoc } from "./state.js";
import { getDefaultStationsDoc, normalizeStationsDoc, validateStationsDoc } from "./stations.js";
import { Visualizer } from "./visualizer.js";
import { FxCanvas } from "./fx.js";

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el;
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

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

function randomSeed32() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 0;
}

function pickFirstPlayableIndex(stations) {
  return stations.length ? 0 : -1;
}

function generateSpeakerGrid({ speakerGridEl, dynamicRate = 0.14, rainStreaks = 26 }) {
  const width = 320;
  const height = 320;
  const spacing = 10;
  const cols = Math.floor(width / spacing);
  const rows = Math.floor(height / spacing);
  const radius = 2;
  const svgNS = "http://www.w3.org/2000/svg";
  const dynamicDots = [];
  const streaks = [];

  const fragment = document.createDocumentFragment();
  const dotsGroup = document.createElementNS(svgNS, "g");
  const rainGroup = document.createElementNS(svgNS, "g");
  rainGroup.setAttribute("id", "speaker-rain");

  for (let i = 1; i < cols; i++) {
    for (let j = 1; j < rows; j++) {
      const cx = i * spacing;
      const cy = j * spacing;
      if (cx < 8 || cx > width - 8 || cy < 8 || cy > height - 8) continue;

      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", cy);
      dot.setAttribute("r", radius);
      dot.classList.add("speaker-dot");

      if (Math.random() < dynamicRate) {
        dot.dataset.seed = String(Math.random());
        dot.dataset.phase = String(Math.random() * Math.PI * 2);
        dynamicDots.push(dot);
      }

      dotsGroup.appendChild(dot);
    }
  }

  for (let i = 0; i < rainStreaks; i++) {
    const line = document.createElementNS(svgNS, "line");
    const x = 10 + Math.random() * (width - 20);
    const len = 6 + Math.random() * 18;
    const phase = Math.random() * (height + len);
    const speed = 0.55 + Math.random() * 1.25;
    line.classList.add("rain-streak");
    line.setAttribute("x1", x.toFixed(2));
    line.setAttribute("x2", x.toFixed(2));
    line.setAttribute("y1", (-len).toFixed(2));
    line.setAttribute("y2", "0");
    line.dataset.len = String(len);
    line.dataset.phase = String(phase);
    line.dataset.speed = String(speed);
    line.dataset.alpha = String(0.35 + Math.random() * 0.65);
    rainGroup.appendChild(line);
    streaks.push(line);
  }

  fragment.append(dotsGroup, rainGroup);
  speakerGridEl.replaceChildren(fragment);
  return { dynamicDots, rainStreaks: streaks };
}

function generateGlassDrops({ glassDropsEl, count = 14 }) {
  const svgNS = "http://www.w3.org/2000/svg";
  const drops = [];

  for (let i = 0; i < count; i++) {
    const line = document.createElementNS(svgNS, "line");
    const x = 10 + Math.random() * 230;
    const len = 6 + Math.random() * 22;
    const phase = Math.random() * 130;
    const speed = 0.2 + Math.random() * 0.9;
    line.classList.add("glass-drop");
    line.setAttribute("x1", x.toFixed(2));
    line.setAttribute("x2", x.toFixed(2));
    line.setAttribute("y1", (-len).toFixed(2));
    line.setAttribute("y2", "0");
    line.dataset.len = String(len);
    line.dataset.phase = String(phase);
    line.dataset.speed = String(speed);
    line.dataset.alpha = String(0.35 + Math.random() * 0.65);
    line.dataset.drift = String((Math.random() * 2 - 1) * 0.35);
    glassDropsEl.appendChild(line);
    drops.push(line);
  }

  return drops;
}

export function createApp() {
  const audio = new AudioEngine();
  const runtimeFiles = new Map();

  let stationsDoc = null;
  let stations = [];
  let currentIndex = 0;
  let knobAngle = 0;
  let isPowerOn = false;
  let isScanning = false;
  let weatherSeed = randomSeed32();
  let weather = null;
  let timerRaf = null;
  let audioUnlocked = false;

  const dom = {
    fxCanvas: $("fx-canvas"),
    mainRadio: $("main-radio"),
    knobArea: $("tuning-knob-area"),
    knobRotateGroup: $("tuning-knob-rotate-group"),
    powerButton: $("power-button"),
    powerLed: $("power-led"),
    modeLed: $("mode-led"),
    modeText: $("mode-text"),
    freqText: $("freq-text"),
    stationText: $("station-text"),
    staticOverlay: $("static-overlay"),
    flashOverlay: $("flash-overlay"),
    glassDrops: $("glass-drops"),
    equalizerBars: $("equalizer-bars"),
    bars: document.querySelectorAll(".bar"),
    speakerGrid: $("speaker-grid"),
    statusText: $("status-text"),
    newWeather: $("new-weather"),
    testLightning: $("test-lightning"),
    resetDefaults: $("reset-defaults")
  };

  const { dynamicDots, rainStreaks } = generateSpeakerGrid({ speakerGridEl: dom.speakerGrid });
  const glassDrops = generateGlassDrops({ glassDropsEl: dom.glassDrops });

  const fx = new FxCanvas({ canvas: dom.fxCanvas, getWeather: () => weather });
  fx.setPaused(true);
  fx.start();

  const visualizer = new Visualizer({
    getAnalyser: () => audio.getAnalyser(),
    getPowerOn: () => isPowerOn,
    bars: dom.bars,
    dynamicDots,
    rainStreaks,
    glassDrops,
    getWeather: () => weather
  });

  let flashTimeout = null;
  function flashScreen({ force = false } = {}) {
    if (!isPowerOn && !force) return;
    if (flashTimeout) clearTimeout(flashTimeout);
    dom.flashOverlay.classList.remove("flash");
    dom.flashOverlay.getClientRects();
    dom.flashOverlay.classList.add("flash");
    flashTimeout = setTimeout(() => dom.flashOverlay.classList.remove("flash"), 500);
    visualizer.bumpLightning();
    fx.flash({ strength: 1 });
  }

  audio.setOnLightning(() => flashScreen());

  function persistStations() {
    const persistentStations = stations.filter((s) => s.source?.kind !== "file");
    saveStationsDoc({ version: 1, stations: persistentStations });
  }

  function setStatus(text) {
    dom.statusText.textContent = text;
  }

  function deriveWeather(seed) {
    const rng = mulberry32(seed);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const space = pick(["window", "outdoor", "cabin"]);
    const thunderProfile = pick(["rare", "medium", "stormy"]);
    const intensity = clamp(0.35 + Math.pow(rng(), 0.55) * 0.6, 0.35, 0.95);
    const driftHz = clamp(0.03 + rng() * 0.09, 0.02, 0.14);
    const windChance = clamp(0.06 + rng() * 0.18, 0.05, 0.25);
    const thunderNearness = clamp(rng() * 0.9, 0.05, 0.95);
    const textureColor = pick(["off", "white", "pink", "brown"]);
    const textureAmount = clamp((rng() ** 1.4) * 0.22, 0, 0.22);

    return {
      seed,
      space,
      thunderProfile,
      intensity,
      driftHz,
      windChance,
      thunderNearness,
      texture: { color: textureColor, amount: textureAmount }
    };
  }

  function applyWeatherToStation(station) {
    if (!station || station.source?.kind !== "synth") return;
    if (!weather) return;
    station.source.preset = "rainWeather";
    station.source.params = {
      intensity: weather.intensity,
      driftHz: weather.driftHz,
      thunderProfile: weather.thunderProfile,
      thunderNearness: weather.thunderNearness,
      windChance: weather.windChance,
      space: weather.space
    };
    station.texture = weather.texture;
  }

  function renderWeatherStatus(prefix = "NOW") {
    if (!weather) return;
    const rain = weather.intensity.toFixed(2);
    const thunder = weather.thunderProfile.toUpperCase();
    const space = weather.space.toUpperCase();
    setStatus(`[ ${prefix}: Rain=${rain} · Thunder=${thunder} · Space=${space} ]`);
  }

  function applyPowerUi() {
    document.body.classList.toggle("radio-off", !isPowerOn);
    dom.powerButton.setAttribute("aria-pressed", isPowerOn ? "true" : "false");
    dom.powerLed.setAttribute("fill", isPowerOn ? "#22c55e" : "#444");
    dom.equalizerBars.style.opacity = "1";
    fx.setPaused(!isPowerOn);
    if (isPowerOn) {
      dom.modeLed.setAttribute("fill", "#ef4444");
      dom.modeText.setAttribute("fill", "#ef4444");
      dom.modeText.textContent = "LIVE";
    } else {
      dom.modeLed.setAttribute("fill", "#555");
      dom.modeText.setAttribute("fill", "#9ca3af");
      dom.modeText.textContent = "PAUSED";
    }
    if (!isPowerOn) {
      // keep timer visible even when off
      dom.staticOverlay.classList.remove("static-noise");
      dom.staticOverlay.style.opacity = "0";
      setStatus("[ POWER OFF ]");
      visualizer.reset();
    }
  }

  function currentStation() {
    return stations[currentIndex] ?? null;
  }

  function applyStationUi(station) {
    if (!station) return;
    dom.freqText.textContent = station.freq ?? "";
    dom.stationText.textContent = station.name ?? "";
  }

  async function setStationByIndex(index, { reason = "direct" } = {}) {
    const station = stations[index];
    if (!station) return;

    applyWeatherToStation(station);
    currentIndex = index;
    applyStationUi(station);
    if (station.category === "RAIN") renderWeatherStatus(reason.toUpperCase());
    else setStatus(`[ ${reason.toUpperCase()} · ${station.category} ]`);

    const file = station.source.kind === "file" ? runtimeFiles.get(station.id) : undefined;
    await audio.setStation(station, { file });
    audio.setTexture(station.texture);
  }

  async function togglePower() {
    isPowerOn = !isPowerOn;
    applyPowerUi();

    if (!isPowerOn) {
      await audio.powerOff();
      setStatus("[ POWER OFF ]");
      return;
    }

    setStatus("[ POWER ON ]");
    // POWER click is a user gesture; attempt to start audio here (may still be blocked on some platforms).
    await audio.powerOn();
    visualizer.start();

    const station = currentStation();
    if (station) {
      await setStationByIndex(currentIndex, { reason: "boot" });
      renderWeatherStatus("NOW");
    } else {
      setStatus("[ NO STATIONS ]");
    }
  }

  async function scanNextStation() {
    if (!isPowerOn || isScanning || stations.length === 0) return;
    isScanning = true;

    const glitch = (() => {
      const tick = () => {
        dom.freqText.textContent = `${(80 + Math.random() * 30).toFixed(1)}`;
      };
      tick();
      const id = setInterval(tick, 70);
      return () => clearInterval(id);
    })();

    knobAngle += 60;
    dom.knobRotateGroup.style.transform = `rotate(${knobAngle}deg)`;

    dom.staticOverlay.classList.add("static-noise");
    dom.staticOverlay.style.opacity = "0.22";
    dom.stationText.textContent = "SCANNING…";
    setStatus("[ SCANNING ]");

    const nextIndex = (currentIndex + 1) % stations.length;
    const nextStation = stations[nextIndex];
    const file = nextStation.source.kind === "file" ? runtimeFiles.get(nextStation.id) : undefined;

    await audio.scanToStation(nextStation, {
      file,
      onLock: () => {
        glitch();
        currentIndex = nextIndex;
        applyStationUi(nextStation);
      }
    });

    dom.staticOverlay.classList.remove("static-noise");
    dom.staticOverlay.style.opacity = "0";
    setStatus(`[ LOCKED · ${nextStation.category} ]`);
    isScanning = false;
  }

  function wireSvgButton(el, handler) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
    });
    el.addEventListener("click", handler);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    });
  }

  async function resetDefaults() {
    runtimeFiles.clear();
    stationsDoc = getDefaultStationsDoc();
    stationsDoc = normalizeStationsDoc(stationsDoc);
    stations = stationsDoc.stations;
    weatherSeed = randomSeed32();
    weather = deriveWeather(weatherSeed);
    fx.onWeatherChange();
    fx.resetWater();
    if (stations[0]) applyWeatherToStation(stations[0]);
    currentIndex = pickFirstPlayableIndex(stations);
    persistStations();

    if (isPowerOn && currentIndex >= 0) {
      await setStationByIndex(currentIndex, { reason: "reset" });
      setStatus("[ RESET · DEFAULTS ]");
    } else {
      setStatus("[ RESET · POWER OFF ]");
    }
  }

  async function newWeather() {
    weatherSeed = randomSeed32();
    weather = deriveWeather(weatherSeed);
    fx.onWeatherChange();
    const station = stations[0];
    if (station) applyWeatherToStation(station);
    renderWeatherStatus("NEW");
    persistStations();
    if (isPowerOn && station) await setStationByIndex(0, { reason: "new" });
  }

  function handleDropAudioFile(file) {
    const id = `local-${Date.now()}`;
    runtimeFiles.set(id, file);
    const station = {
      id,
      name: file.name.replace(/\.[^/.]+$/, "").slice(0, 24).toUpperCase(),
      freq: "--.-",
      band: "LOCAL",
      category: "LOCAL",
      source: { kind: "file" },
      texture: { color: "off", amount: 0 }
    };
    stations.unshift(station);
    currentIndex = 0;

    if (isPowerOn) setStationByIndex(0, { reason: "local" });
    else setStatus("[ LOCAL FILE ADDED ]");
  }

  function mount() {
    const persisted = loadStationsDoc();
    stationsDoc = persisted ?? getDefaultStationsDoc();
    const validation = validateStationsDoc(stationsDoc);
    if (!validation.ok) stationsDoc = getDefaultStationsDoc();
    stationsDoc = normalizeStationsDoc(stationsDoc);
    stations = stationsDoc.stations;
    persistStations();

    currentIndex = pickFirstPlayableIndex(stations);
    weather = deriveWeather(weatherSeed);
    if (stations[0]) applyWeatherToStation(stations[0]);
    // Default is muted: user explicitly turns POWER on for audio + timer.
    isPowerOn = false;
    applyPowerUi();
    visualizer.start();
    renderWeatherStatus("NOW");
    applyStationUi(currentStation());

    wireSvgButton(dom.powerButton, togglePower);
    wireSvgButton(dom.knobArea, scanNextStation);

    dom.newWeather.addEventListener("click", () => newWeather());
    dom.testLightning.addEventListener("click", () => flashScreen({ force: true }));
    dom.resetDefaults.addEventListener("click", () => resetDefaults());

    window.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("audio/")) {
        setStatus("[ DROP AN AUDIO FILE ]");
        return;
      }
      handleDropAudioFile(file);
    });

    window.addEventListener("keydown", (e) => {
      if (!isPowerOn || isScanning) return;
      if (e.key === "ArrowRight") scanNextStation();
      if (e.key === "ArrowLeft") setStationByIndex((currentIndex - 1 + stations.length) % stations.length);
    });

    const format = (ms) => {
      const total = Math.floor(ms / 1000);
      const m = String(Math.floor(total / 60)).padStart(2, "0");
      const s = String(total % 60).padStart(2, "0");
      return `${m}:${s}`;
    };

    const tickTimer = () => {
      dom.freqText.textContent = format(fx.getElapsedMs());
      timerRaf = requestAnimationFrame(tickTimer);
    };
    if (timerRaf) cancelAnimationFrame(timerRaf);
    timerRaf = requestAnimationFrame(tickTimer);
  }

  return { mount };
}
