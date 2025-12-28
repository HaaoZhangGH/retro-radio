import defaultDoc from "../stations/default.stations.json";

export function getDefaultStationsDoc() {
  return structuredClone(defaultDoc);
}

export function validateStationsDoc(doc) {
  if (!doc || typeof doc !== "object") return { ok: false, error: "JSON root must be an object." };
  if (doc.version !== 1) return { ok: false, error: "Unsupported version (expected version: 1)." };
  if (!Array.isArray(doc.stations)) return { ok: false, error: "`stations` must be an array." };

  const seenIds = new Set();
  for (const station of doc.stations) {
    if (!station || typeof station !== "object") return { ok: false, error: "Station must be an object." };
    if (typeof station.id !== "string" || !station.id) return { ok: false, error: "Station.id is required." };
    if (seenIds.has(station.id)) return { ok: false, error: `Duplicate station id: ${station.id}` };
    seenIds.add(station.id);

    if (typeof station.name !== "string" || !station.name)
      return { ok: false, error: `Station.name is required (id: ${station.id}).` };
    if (typeof station.freq !== "string")
      return { ok: false, error: `Station.freq must be a string (id: ${station.id}).` };
    if (typeof station.band !== "string" || !station.band)
      return { ok: false, error: `Station.band is required (id: ${station.id}).` };
    if (typeof station.category !== "string" || !station.category)
      return { ok: false, error: `Station.category is required (id: ${station.id}).` };

    if (!station.source || typeof station.source !== "object")
      return { ok: false, error: `Station.source is required (id: ${station.id}).` };
    if (!["synth", "url", "file"].includes(station.source.kind))
      return { ok: false, error: `Unsupported source.kind (id: ${station.id}).` };

    if (station.source.kind === "url" && typeof station.source.url !== "string")
      return { ok: false, error: `source.url must be a string (id: ${station.id}).` };

    if (station.source.kind === "synth" && typeof station.source.preset !== "string")
      return { ok: false, error: `source.preset must be a string (id: ${station.id}).` };
  }

  return { ok: true };
}

export function normalizeStationsDoc(doc) {
  const normalized = { version: 1, stations: [] };
  for (const station of doc.stations) {
    const texture = station.texture ?? { color: "off", amount: 0 };
    normalized.stations.push({
      ...station,
      texture: {
        color: texture.color ?? "off",
        amount: Number.isFinite(texture.amount) ? texture.amount : 0
      }
    });
  }
  return normalized;
}

export function listCategories(stations) {
  const categories = new Set(stations.map((s) => s.category).filter(Boolean));
  return ["ALL", ...Array.from(categories).sort()];
}

