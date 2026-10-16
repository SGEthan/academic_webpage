// Local annotator workflow test. The map and HTTP endpoints are mocked; no real photos are tagged.
const readSource = typeof readFile === "function" ? readFile : (path) => require("fs").readFileSync(path, "utf8");
const log = typeof print === "function" ? print : console.log;
function assert(value, message) { if (!value) throw new Error(message); }
class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.value = ""; this.textContent = ""; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name]; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  async fire(name, event = {}) { await Promise.all((this.listeners[name] || []).map((handler) => handler(event))); }
  querySelectorAll(tag) { return this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]).filter((child) => tag === "*" || child.tagName === tag); }
}
const elements = {};
for (const name of ["status", "save", "undo", "reload", "reuse", "latitude", "longitude", "world", "photo-queue", "progress", "draft-count", "selected-image", "empty-photo", "photo-description", "photo-filename", "selection-state", "map-error", "map", "coordinate-form", "retry-map"]) elements[name] = new Element();
const document = { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag) };
const state = { writes: [], maps: [], saved: [], failNext: false };
const photo = (name) => ({ src: `assets/gallery/${name}.jpg`, small: `assets/gallery/${name}.webp`, description: name, gps_revision: `revision-${name}` });
const original = [photo("Alpha"), photo("Beta"), photo("Gamma")];
let photos = [...original], known = [];
const snapshot = () => ({ photos, known, total: 3, excluded: 0 });
async function fetch(path, options = {}) {
  if (String(path).startsWith("https://")) return { ok: true, json: async () => ({ version: 8, sources: {}, layers: [] }) };
  if (path === "/api/photos") return { ok: true, json: async () => ({ ...snapshot(), token: "local-token" }) };
  const payload = JSON.parse(options.body); state.writes.push({ path, options, payload });
  if (state.failNext) { state.failNext = false; return { ok: false, json: async () => ({ error: "GPS changed elsewhere. Refresh before saving." }) }; }
  if (path === "/api/gps") {
    const item = photos.find((item) => item.src === payload.src);
    assert(item && payload.expected_gps_revision === item.gps_revision, "Saves must include the selected photo's concurrency revision");
    state.saved.push(item); photos = photos.filter((photo) => photo.src !== payload.src);
    known = [...known, { src: item.src, gps: payload.gps }];
    return { ok: true, json: async () => ({ ...snapshot(), saved: { src: item.src, gps: payload.gps }, undo_id: `undo-${state.saved.length}` }) };
  }
  const restored = state.saved.pop(); photos = original.filter((item) => photos.includes(item) || item === restored); known = known.filter((item) => item.src !== restored.src);
  return { ok: true, json: async () => ({ ...snapshot(), restored_src: restored.src }) };
}
class MapView {
  constructor(options) { this.options = options; this.listeners = {}; this.sources = {}; state.maps.push(this); }
  on(name, handler) { (this.listeners[name] ||= []).push(handler); }
  async fire(name, event) { await Promise.all((this.listeners[name] || []).map((handler) => handler(event))); }
  addControl() {}
  getSource(id) { return this.sources[id]; }
  addSource(id, source) { this.sources[id] = { ...source, setData(data) { this.data = data; } }; }
  addLayer() {}
  getZoom() { return 7; }
  easeTo(options) { this.camera = options; }
  remove() {}
}
class Marker {
  constructor() { this.listeners = {}; }
  setLngLat(coordinates) { this.coordinates = coordinates; return this; }
  getLngLat() { return { lng: this.coordinates[0], lat: this.coordinates[1] }; }
  addTo(map) { this.map = map; state.marker = this; return this; }
  on(name, handler) { this.listeners[name] = handler; }
  remove() { this.removed = true; }
}
const maplibregl = { Map: MapView, Marker, NavigationControl: class {} };
const window = new Element(); window.maplibregl = maplibregl;
new Function("document", "window", "fetch", "maplibregl", "AbortSignal", readSource("tools/gallery-gps/app.js"))(document, window, fetch, maplibregl, { timeout() {} });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
(async () => {
  await flush(); const map = state.maps[0]; await map.fire("load");
  assert(elements["photo-queue"].children.length === 3 && elements["photo-description"].textContent === "Alpha", "All missing photos must appear on the left with the first one selected");
  assert(state.writes.length === 0 && elements.save.disabled, "Opening the UI must not write coordinates or invent a default point");
  await map.fire("click", { lngLat: { lat: 47.1234567, lng: -122.5 } });
  assert(state.writes.length === 0 && !elements.save.disabled && elements.latitude.value === "47.123457", "Map click must create an unsaved draft, not silently write the file");
  assert(state.marker.coordinates.join(",") === "-122.5,47.123457", "The draft marker must use longitude,latitude order");
  await elements["photo-queue"].children[1].fire("click");
  assert(elements.save.disabled && elements.latitude.value === "", "Selecting another photo must not reuse the previous point automatically");
  await elements["photo-queue"].children[0].fire("click");
  assert(elements.latitude.value === "47.123457", "Switching photos must preserve unsaved drafts locally");
  await elements["coordinate-form"].fire("submit", { preventDefault() {} });
  assert(state.writes.length === 1 && state.writes[0].options.headers["X-Gallery-GPS-Token"] === "local-token", "Confirmed save must use the local session token");
  assert(state.writes[0].payload.src === original[0].src && state.writes[0].payload.gps.latitude === 47.123457, "Save must target only the selected photo and exact draft coordinates");
  assert(elements["photo-description"].textContent === "Beta" && elements["photo-queue"].children.length === 2 && !elements.undo.disabled, "Successful save must update the queue, advance and enable Undo");
  await elements.reuse.fire("click");
  assert(!elements.save.disabled && elements.longitude.value === "-122.500000" && state.writes.length === 1, "Reusing a point must still require an explicit save");
  state.failNext = true;
  await elements["coordinate-form"].fire("submit", { preventDefault() {} });
  assert(elements.status.getAttribute("data-error") === "true" && elements["photo-description"].textContent === "Beta" && !elements.save.disabled, "Save conflicts must retain the photo/draft and show a visible error");
  await elements.undo.fire("click");
  assert(elements["photo-description"].textContent === "Alpha" && elements["photo-queue"].children.length === 3 && elements.undo.disabled, "Undo must restore the photo to the queue and select it");
  elements.latitude.value = "91"; elements.longitude.value = "1"; await elements.latitude.fire("input");
  assert(elements.save.disabled, "Invalid or incomplete manual coordinates must disable saving");
  log("PASS: missing-photo queue, exact map drafts, no implicit writes, retained drafts, token/revision saves, auto-advance, reuse confirmation, conflict recovery, undo and coordinate validation");
})().catch((error) => { log(error.message); log(error.stack || ""); if (typeof quit === "function") quit(1); else throw error; });
