const STORAGE_KEY = "retro-radio.stations.v1";

export function loadStationsDoc() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveStationsDoc(doc) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
}

