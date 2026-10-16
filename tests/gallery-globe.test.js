// Dependency-free MapLibre integration tests; GPU, tile service, and DOM are mocked.
const readSource = typeof readFile === "function" ? readFile : (path) => require("fs").readFileSync(path, "utf8");
const log = typeof print === "function" ? print : console.log;
function assert(condition, message) { if (!condition) throw new Error(message); }
class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {};
    this._text = ""; this.style = {}; this.hidden = false;
  }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  async fire(name, event = {}) { await Promise.all((this.listeners[name] || []).map((handler) => handler(event))); }
  focus() { this.focused = true; }
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
  getBoundingClientRect() { return { width: 560, height: 560 }; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]).filter((child) =>
      selector === "*" || (selector.startsWith(".") ? child.className === selector.slice(1) : child.tagName === selector));
  }
}
const source = readSource("script.js");
const styles = readSource("styles.css");
const pinStyles = styles.match(/\.gallery-globe-pin\s*\{([^}]+)\}/)[1];
const pinImageStyles = styles.match(/\.gallery-globe-pin img\s*\{([^}]+)\}/)[1];
const fullPhotoStyles = styles.match(/\.gallery-globe-preview img\s*\{([^}]+)\}/)[1];
assert(/padding:\s*0\s*;/.test(pinStyles) && /object-fit:\s*cover\s*;/.test(pinImageStyles) && /object-position:\s*center\s*;/.test(pinImageStyles), "Square globe thumbnails must fill their frames with centered crops, without white padding");
assert(/object-fit:\s*contain\s*;/.test(fullPhotoStyles), "Globe detail photos must remain uncropped");
assert(!/max-height\s*:/.test(fullPhotoStyles), "A CSS height cap must not letterbox a portrait inside an independently fixed-width image");
const html = readSource("gallery.html");
assert(!/gallery-globe-(story|missing|feature|thumbnails|locations)/.test(html), "Globe must be a single centered map without a sidebar or missing-GPS list");
assert(/\.gallery-globe-world\s*\{[^}]*margin-inline:\s*auto/.test(styles), "Globe must be centered on desktop as well as mobile");
const body = source.slice(source.indexOf("{") + 1, source.lastIndexOf("  // ---------------------------------------------------------------------------\n  // Init"));
const exported = "\nreturn { galleryCoordinates, groupGalleryLocations, galleryPhotoGeoJSON, galleryGlobeStyle, galleryPhotoMarkerInfo, galleryPhotoPreviewSize, initGalleryGlobe };";
const baseStyle = { version: 8, sources: { world: { type: "vector", attribution: "OpenStreetMap · OpenMapTiles" } },
  layers: [{ id: "background", type: "background", paint: { "background-color": "white" } },
    { id: "water", type: "fill", paint: { "fill-color": "blue" } }] };
function harness(items, { failFirst = false, reduced = false, failMap = false } = {}) {
  const elements = {};
  for (const name of ["grid-tab", "globe-tab", "grid-panel", "globe-panel", "globe-stage", "globe-map",
    "globe-message", "globe-rotate", "globe-retry", "globe-reset", "globe-zoom-in",
    "globe-zoom-out", "globe-hint"]) elements["gallery-" + name] = new Element();
  elements["gallery-globe-panel"].hidden = true;
  const state = { loads: 0, styles: [], maps: [], markers: [], popups: [], sourceFeatures: null, sourceLoading: false, camera: [], styleChanges: [], destroyed: 0,
    now: 0, frames: new Map(), nextFrame: 0, timers: new Map(), nextTimer: 0, pendingCluster: null };
  class FakeMap {
    constructor(options) {
      if (failMap) throw new Error("GPU unavailable");
      this.options = options; this.listeners = {}; this.sources = {}; this.layers = {};
      this.zoom = options.zoom; this.center = { lng: options.center[0], lat: options.center[1] };
      this.canvas = new Element("canvas"); state.maps.push(this);
    }
    on(name, layer, handler) {
      const key = typeof layer === "function" ? name : name + ":" + layer;
      (this.listeners[key] ||= []).push(typeof layer === "function" ? layer : handler);
    }
    async emit(name, event = {}, layer) {
      if (name === "move") state.popups.filter((popup) => popup.map === this && popup.options.closeOnMove).forEach((popup) => popup.remove());
      await Promise.all((this.listeners[layer ? name + ":" + layer : name] || []).map((handler) => handler(event)));
    }
    addControl(control, position) { this.control = { control, position }; }
    addSource(id, options) {
      this.sources[id] = { ...options,
        getClusterExpansionZoom: async () => 6,
        getClusterLeaves: async () => {
          if (state.pendingCluster) await state.pendingCluster;
          return this.options.style ? [0, 1, 2].map((index) => ({ properties: { photo_id: index } })) : [];
        },
      };
    }
    getSource(id) { return this.sources[id]; }
    isSourceLoaded(id) { return Boolean(this.sources[id]) && !state.sourceLoading; }
    querySourceFeatures(id) { return state.sourceFeatures || this.sources[id]?.data.features || []; }
    addLayer(layer) { assert(!this.layers[layer.id], "Style reload must not duplicate overlay layers"); this.layers[layer.id] = layer; }
    getLayer(id) { return this.layers[id]; }
    setPaintProperty(id, property, value) { this.layers[id].paint[property] = value; }
    setProjection(projection) { this.projection = projection; }
    setSky(sky) { this.sky = sky; }
    getCanvas() { return this.canvas; }
    getZoom() { return this.zoom; }
    getCenter() { return this.center; }
    isMoving() { return false; }
    stop() {}
    camera(options) {
      if (options.zoom != null) this.zoom = options.zoom;
      if (options.center) this.center = { lng: options.center[0], lat: options.center[1] };
      state.camera.push(options); this.emit("move"); this.emit("moveend"); this.emit("render");
    }
    easeTo(options) { this.camera(options); }
    jumpTo(options) { this.camera(options); }
    resize() { state.resizes = (state.resizes || 0) + 1; }
    setStyle(style, options) {
      state.styleChanges.push({ style, options });
      this.sources = {}; this.layers = {}; this.options.style = style;
      this.emit("style.load");
    }
    remove() { state.destroyed++; }
  }
  class Marker {
    constructor(options) { this.options = options; state.markers.push(this); }
    setLngLat(coordinates) { this.coordinates = coordinates; return this; }
    addTo(map) { this.map = map; map.options.container.appendChild(this.options.element); return this; }
    remove() { this.removed = true; this.options.element.remove(); }
  }
  class Popup {
    constructor(options) { this.options = options; this.listeners = {}; state.popups.push(this); }
    on(name, callback) { (this.listeners[name] ||= []).push(callback); return this; }
    setLngLat(coordinates) { this.coordinates = coordinates; this.updates = (this.updates || 0) + 1; return this; }
    setDOMContent(content) { this.content = content; return this; }
    addTo(map) {
      this.map = map; map.options.container.appendChild(this.content);
      if (this.options.focusAfterOpen) this.content.querySelector("button").focus();
      return this;
    }
    remove() {
      if (!this.map) return this;
      this.content.remove(); this.map = null;
      (this.listeners.close || []).forEach((callback) => callback());
      return this;
    }
  }
  const maplibre = { Map: FakeMap, Marker, Popup, AttributionControl: class { constructor(options) { this.options = options; } } };
  const document = new Element("document");
  document.documentElement = new Element("html");
  document.getElementById = (id) => elements[id] || null;
  document.createElement = (tag) => new Element(tag);
  document.querySelector = () => null;
  document.hidden = false;
  const motion = new Element(); motion.matches = reduced;
  const scheme = new Element(); scheme.matches = false;
  const window = new Element("window");
  window.devicePixelRatio = 3;
  window.matchMedia = (query) => query.includes("reduced-motion") ? motion : scheme;
  window.requestAnimationFrame = (handler) => { const id = ++state.nextFrame; state.frames.set(id, handler); return id; };
  window.cancelAnimationFrame = (id) => state.frames.delete(id);
  window.setTimeout = (handler) => { const id = ++state.nextTimer; state.timers.set(id, handler); return id; };
  window.clearTimeout = (id) => state.timers.delete(id);
  window.MutationObserver = class { constructor(callback) { state.themeChange = callback; } observe() {} };
  window.ResizeObserver = class { constructor(callback) { state.resize = callback; } observe() {} };
  window.IntersectionObserver = class { constructor(callback) { state.intersection = callback; } observe() {} };
  const loadLibrary = async () => {
    state.loads++; if (failFirst && state.loads === 1) throw new Error("Simulated script failure"); return maplibre;
  };
  const loadBasemap = async (dark) => { state.styles.push(dark); return baseStyle; };
  const site = new Function("document", "window", "fetch", body + exported)(document, window, async () => ({ ok: true, json: async () => items }));
  const flush = (count = 1) => {
    for (let i = 0; i < count; i++) {
      const callbacks = Array.from(state.frames.values()); state.frames.clear(); state.now += 16;
      callbacks.forEach((callback) => callback(state.now));
    }
  };
  const init = (basemap = loadBasemap, library = loadLibrary) => site.initGalleryGlobe(library, basemap);
  const open = async () => {
    await elements["gallery-globe-tab"].fire("click");
    const map = state.maps[state.maps.length - 1];
    if (map) { await map.emit("style.load"); await map.emit("load"); }
    return map;
  };
  const activeMarkers = () => state.markers.filter((marker) => !marker.removed);
  const activePopup = () => state.popups.find((popup) => popup.map) || null;
  return { site, elements, state, document, window, motion, scheme, flush, init, open, loadLibrary, loadBasemap, activeMarkers, activePopup };
}
const makePhoto = (name, gps, width = 1800, height = 1200) => ({ src: name + ".jpg", small: name + ".small.webp", display: name + ".display.webp", description: name, gps, width, height });
const photos = [
  makePhoto("Alpha", { latitude: 47.6, longitude: -122.3 }, 1200, 1800),
  makePhoto("Beta", { latitude: 47.6, longitude: -122.3 }),
  makePhoto("Nearby", { latitude: 47.7, longitude: -122.2 }),
  makePhoto("Gamma", { latitude: 30.5, longitude: 60 }),
  makePhoto("Missing", { latitude: null, longitude: null }),
];
(async () => {
  const h = harness(photos), { site, elements: e, state: s } = h;
  for (const bounds of [{ width: 320, height: 320 }, { width: 270, height: 180 }]) {
    for (const item of [{ width: 1200, height: 1800 }, { width: 1800, height: 1200 }, { width: 1000, height: 1000 }, { width: 6000, height: 1000 }]) {
      const size = site.galleryPhotoPreviewSize(item, bounds);
      assert(Math.abs(size.width / size.height - item.width / item.height) < 1e-9, "Portrait, landscape, square and panorama previews must preserve the original ratio");
      assert(size.width <= bounds.width && size.height <= bounds.height, "Adaptive previews must stay within the map and viewport limits");
    }
  }
  for (const gps of [undefined, null, {}, { latitude: null, longitude: null }, { latitude: "47.6", longitude: -122 }, { latitude: true, longitude: 1 }, { latitude: 91, longitude: 1 }, { latitude: 1, longitude: 181 }, { latitude: 1, longitude: Infinity }]) {
    assert(site.galleryCoordinates({ gps }) === null, "Missing/invalid GPS must never become 0,0");
  }
  assert(site.galleryCoordinates({ gps: { latitude: 0, longitude: 0 } }).join(",") === "0,0", "Explicit numeric zero is valid GPS");
  const original = JSON.stringify(photos);
  const data = site.galleryPhotoGeoJSON(photos);
  assert(data.features.length === 4 && data.features[0].geometry.coordinates.join(",") === "-122.3,47.6", "GeoJSON must include every located photo using longitude,latitude");
  assert(data.features[1].properties.photo_id === 1 && JSON.stringify(photos) === original, "GeoJSON must preserve photo IDs and original metadata");
  assert(site.groupGalleryLocations(photos).groups[0].items.length === 2, "Identical locations must keep every photo");
  const markerInfo = site.galleryPhotoMarkerInfo(data.features[0], photos);
  assert(markerInfo.key === "photo:0" && markerInfo.item === photos[0] && markerInfo.count === 1, "Individual markers must resolve the correct photo");
  assert(site.galleryPhotoMarkerInfo({ properties: { cluster: true, cluster_id: 1, point_count: 2, cover_id: 99 }, geometry: { type: "Point", coordinates: [1, 1] } }, photos) === null, "Unknown cluster covers must not show the wrong photo");
  const style = site.galleryGlobeStyle(baseStyle, false);
  assert(style.projection.type === "globe" && style.sources.world.attribution.includes("OpenStreetMap"), "Style must use globe projection and retain attribution");
  assert(baseStyle.layers[0].paint["background-color"] === "white", "Theme adaptation must not mutate cached provider styles");

  await h.init();
  assert(s.loads === 0 && s.styles.length === 0 && s.maps.length === 0, "Default Gallery must not load MapLibre, styles, or tiles");
  assert(!h.activePopup(), "The simplified globe must not show a photo until a marker is clicked");
  const map = await h.open();
  assert(s.maps.length === 1 && map.projection.type === "globe", "Opening Globe must lazily create a real globe projection");
  assert(map.options.maxZoom === 19 && map.options.pixelRatio === 2 && map.options.cooperativeGestures, "Map must support street-level zoom with capped DPR and cooperative gestures");
  assert(map.sources["gallery-photos"].data.features.length === 4 && map.sources["gallery-photos"].cluster, "Native clusters must count every photo, not fixed regional groups");
  assert(map.sources["gallery-photos"].maxzoom > map.sources["gallery-photos"].clusterMaxZoom, "Clusters must have an unclustered zoom level above their maximum clustering zoom");
  assert(map.sources["gallery-photos"].clusterProperties.cover_id[0] === "min", "Cluster covers must deterministically identify an actual member photo");
  assert(map.layers["gallery-photo-anchors"].paint["circle-opacity"] === 0 && !map.layers["gallery-photo-counts"], "Photo cards must replace the visible dot/count layers");
  assert(h.activeMarkers().length === 4 && h.activeMarkers().every((marker) => marker.options.element.querySelector("img")), "All source photos must appear as image markers, including at globe scale");
  assert(h.activeMarkers().every((marker) => marker.options.opacityWhenCovered === 0), "Markers behind the globe must be hidden");
  const markerCount = s.markers.length; await map.emit("render"); await map.emit("render");
  assert(s.markers.length === markerCount, "Rendering/rotation must reuse photo cards instead of recreating them");
  assert(map.control.position === "bottom-right", "Provider attribution must remain visible");
  assert(e["gallery-grid-panel"].hidden, "Globe must hide the regular photo grid");
  h.flush(20); assert(s.frames.size === 1, "Auto-rotation must have exactly one RAF loop, including moveend callbacks");
  const nearbyMarker = h.activeMarkers().find((marker) => marker.options.element.getAttribute("data-photo-id") === "2");
  const initialZoom = map.zoom;
  await nearbyMarker.options.element.fire("click");
  const preview = h.activePopup();
  assert(preview && preview.content.querySelector("img").alt === "Nearby" && preview.content.querySelector("figcaption").textContent === "Nearby", "Clicking a globe image must expand that photo in an anchored popup");
  assert(preview.coordinates.join(",") === "-122.2,47.7" && map.zoom === initialZoom, "Preview must stay at the actual photo location without jumping to street-level or full-screen");
  assert(preview.options.locationOccludedOpacity === 0 && preview.content.getAttribute("role") === "dialog", "Anchored previews must be accessible and hidden behind the globe");
  assert(preview.content.querySelector(".gallery-globe-preview-close").focused, "Keyboard focus must enter the preview at its close button");
  assert(preview.content.querySelectorAll(".gallery-trigger").length === 0, "Globe must not duplicate lightbox collection entries");
  const updates = preview.updates; await preview.content.querySelector("img").fire("load");
  assert(preview.updates > updates, "Image load must recalculate popup placement using its actual dimensions");
  assert(nearbyMarker.coordinates.join(",") === "-122.2,47.7" && nearbyMarker.options.element.getAttribute("data-selected") === "true", "The selected photo marker must remain at its exact GPS and be highlighted");
  assert(s.frames.size === 0 && e["gallery-globe-rotate"].getAttribute("aria-pressed") === "false", "Manual selection must pause rotation");
  await preview.content.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert(!h.activePopup() && nearbyMarker.options.element.focused && nearbyMarker.options.element.getAttribute("data-selected") === "false", "Escape must close the preview, clear its highlight, and restore marker focus");
  await nearbyMarker.options.element.fire("click"); await map.emit("click");
  assert(!h.activePopup(), "Clicking the map background must dismiss the preview");
  await nearbyMarker.options.element.fire("click");
  await e["gallery-globe-zoom-in"].fire("click"); assert(map.zoom === initialZoom + 1 && !h.activePopup(), "Zoom-in must dismiss the preview and increase real map zoom");
  await e["gallery-globe-zoom-out"].fire("click"); assert(map.zoom === initialZoom, "Zoom-out button must decrease real map zoom");

  const clusterFeature = { properties: { cluster: true, cluster_id: 10, point_count: 3, cover_id: 0 }, geometry: { type: "Point", coordinates: [-122.3, 47.6] } };
  const showCluster = async (target) => {
    target.state.sourceFeatures = [clusterFeature, clusterFeature, data.features[3]];
    await target.state.maps[0].emit("render");
    return target.activeMarkers().find((marker) => marker.options.element.getAttribute("data-cluster") === "true");
  };
  const clusterMarker = await showCluster(h);
  assert(h.activeMarkers().length === 2, "Duplicate source-tile features must not create duplicate photo cards");
  assert(clusterMarker.options.element.querySelector("img").src === "Alpha.small.webp" && clusterMarker.options.element.querySelector("span").textContent === "3", "A cluster must show its photo cover and actual photo count");
  assert(clusterMarker.options.element.getAttribute("aria-label").includes("3 photos"), "Cluster photo covers need an accessible label");
  s.sourceLoading = true; s.sourceFeatures = []; await map.emit("render");
  assert(h.activeMarkers().length === 2, "Keep existing photos while new source tiles are loading to avoid flicker");
  s.sourceLoading = false; s.sourceFeatures = [clusterFeature, data.features[3]];
  map.zoom = 2;
  await clusterMarker.options.element.fire("click");
  const clusterPreview = h.activePopup();
  assert(clusterPreview.content.querySelector("img").alt === "Alpha" && clusterPreview.content.querySelector("span").textContent === "1 / 3" && map.zoom === 2, "Clicking a cluster must expand its cover directly on the globe and keep every member available");
  const portraitWidth = parseFloat(clusterPreview.content.style.width), portraitHeight = parseFloat(clusterPreview.content.querySelector("img").style.height);
  assert(portraitWidth < portraitHeight && Math.abs(portraitWidth / portraitHeight - 2 / 3) < 1e-9, "A portrait must narrow the entire popup to match its image, with no side letterboxing");
  await clusterPreview.content.querySelectorAll("button")[2].fire("click");
  assert(clusterPreview.content.querySelector("img").alt === "Beta" && clusterPreview.content.querySelector("span").textContent === "2 / 3", "Grouped photos must be browsable in the same popup");
  const landscapeWidth = parseFloat(clusterPreview.content.style.width), landscapeHeight = parseFloat(clusterPreview.content.querySelector("img").style.height);
  assert(landscapeWidth > portraitWidth && Math.abs(landscapeWidth / landscapeHeight - 3 / 2) < 1e-9, "Switching from portrait to landscape must resize the card as well as the image");
  e["gallery-globe-stage"].getBoundingClientRect = () => ({ width: 300, height: 300 });
  s.resize();
  assert(parseFloat(clusterPreview.content.style.width) <= 252 && parseFloat(clusterPreview.content.querySelector("img").style.height) <= 180, "An open preview must adapt when the map becomes smaller");
  e["gallery-globe-stage"].getBoundingClientRect = () => ({ width: 560, height: 560 });
  await clusterPreview.content.fire("keydown", { key: "ArrowLeft", preventDefault() {}, stopPropagation() {} });
  assert(clusterPreview.content.querySelector("img").alt === "Alpha", "Arrow keys must navigate the group without rotating the map");
  await clusterPreview.content.querySelector(".gallery-globe-preview-close").fire("click");
  assert(!h.activePopup() && clusterMarker.options.element.focused, "The close button must return focus to its cluster cover");
  s.sourceFeatures = null; await map.emit("render");
  assert(clusterMarker.removed && h.activeMarkers().length === 4, "Expanded clusters must be removed and replaced by individual photo cards");
  await h.activeMarkers().find((marker) => marker.options.element.getAttribute("data-photo-id") === "1").options.element.fire("click");
  assert(h.activePopup().content.querySelector("span").textContent === "2 / 2" && h.activePopup().content.querySelector("img").alt === "Beta", "Coincident GPS photos must remain available and show the clicked photo first");
  await e["gallery-globe-reset"].fire("click");
  assert(!h.activePopup() && map.zoom < 2, "Overview must dismiss the popup and restore the complete globe");
  await e["gallery-globe-rotate"].fire("click"); h.flush();
  h.document.hidden = true; await h.document.fire("visibilitychange"); assert(s.frames.size === 0, "Hidden tabs must stop rotation");
  h.document.hidden = false; await h.document.fire("visibilitychange");
  await h.document.fire("site:dialogchange", { detail: { open: true } }); assert(s.frames.size === 0, "Open lightbox must pause rotation");
  await h.document.fire("site:dialogchange", { detail: { open: false } });
  s.intersection([{ isIntersecting: false }]); assert(s.frames.size === 0, "Offscreen map must stop rotation");
  s.intersection([{ isIntersecting: true }]);
  await map.emit("zoomstart", { originalEvent: {} }); assert(s.frames.size === 0, "Native zoom gestures must pause rotation");
  await e["gallery-grid-tab"].fire("click"); h.flush(); assert(s.frames.size === 0, "Gallery tab must suspend Globe rotation");
  await e["gallery-globe-tab"].fire("click"); assert(s.maps.length === 1 && s.loads === 1, "Returning to Globe must reuse its instance");
  await h.activeMarkers().find((marker) => marker.options.element.getAttribute("data-photo-id") === "2").options.element.fire("click");
  h.document.documentElement.setAttribute("data-theme", "dark"); await s.themeChange();
  assert(!h.activePopup() && s.styleChanges.length === 1 && map.getSource("gallery-photos") && h.activeMarkers().length === 4, "Theme reload must dismiss the preview and restore markers/source without duplicates");
  assert(s.styleChanges[0].style.layers[0].paint["background-color"] === "#252b3b", "Dark theme must use the dark basemap");
  await e["gallery-globe-reset"].fire("click"); await e["gallery-globe-rotate"].fire("click");
  h.motion.matches = true; await h.motion.fire("change"); assert(s.frames.size === 0, "Reduced-motion changes must stop automatic rotation");
  await map.emit("webglcontextlost"); assert(e["gallery-globe-zoom-in"].disabled, "Lost graphics context must disable controls");
  await map.emit("webglcontextrestored"); assert(!e["gallery-globe-zoom-in"].disabled, "Restored graphics context must re-enable controls");
  await map.emit("error"); assert(!e["gallery-globe-retry"].hidden, "Tile errors must offer retry without removing photos");
  await e["gallery-globe-retry"].fire("click");
  assert(s.destroyed === 1 && s.maps.length === 2, "Retry must dispose the old map before recreating it");
  assert(h.activeMarkers().length === 0, "Retry must remove old photo markers before the new source loads");
  await s.maps[1].emit("style.load"); await s.maps[1].emit("load");
  await e["gallery-globe-tab"].fire("keydown", { key: "Home", preventDefault() {} });
  assert(e["gallery-grid-tab"].focused && !e["gallery-grid-panel"].hidden, "View tabs must support keyboard navigation");

  const empty = harness([photos[4]]); await empty.init(); await empty.open();
  assert(empty.state.loads === 0 && empty.elements["gallery-globe-stage"].hidden, "Missing-only galleries must not load an empty map or fabricate locations");
  const retry = harness(photos, { failFirst: true, reduced: true }); await retry.init(); await retry.open();
  assert(!retry.elements["gallery-globe-retry"].hidden && retry.state.maps.length === 0, "Library load failures must preserve photo browsing and allow retry");
  await retry.elements["gallery-globe-retry"].fire("click"); await retry.state.maps[0].emit("style.load"); await retry.state.maps[0].emit("load");
  assert(retry.elements["gallery-globe-message"].hidden && retry.state.frames.size === 0, "Retry must recover without violating initial reduced motion");
  const resume = harness(photos); await resume.init(); const resumeMap = await resume.open();
  await resume.elements["gallery-globe-stage"].fire("pointerenter", { pointerType: "mouse" });
  await resume.elements["gallery-globe-map"].fire("focusin");
  await resumeMap.emit("dragstart", { originalEvent: {} });
  resumeMap.camera({ center: [25, 42], zoom: 6 });
  await resumeMap.emit("dragend", { originalEvent: {} });
  assert(resume.state.frames.size === 0 && resume.elements["gallery-globe-rotate"].textContent === "Resume rotation", "Dragging must pause rotation before the resume regression test");
  let easing = true; resumeMap.isMoving = () => easing;
  await resume.elements["gallery-globe-rotate"].fire("click");
  const resumeLongitude = resumeMap.center.lng;
  resume.flush(12); assert(resumeMap.center.lng === resumeLongitude, "Resuming must not interrupt the return-to-globe camera animation");
  easing = false; await resumeMap.emit("moveend"); resume.flush(30);
  assert(resumeMap.center.lng > resumeLongitude && resume.state.frames.size === 1, "After dragging, explicit Resume must restart actual rotation even while the map retains focus or hover");
  await resumeMap.emit("dragstart", { originalEvent: {} });
  resume.flush(10); const draggedLongitude = resumeMap.center.lng;
  assert(resume.state.frames.size === 0 && resume.elements["gallery-globe-rotate"].textContent === "Resume rotation", "A new drag must still stop explicitly resumed rotation");
  await resume.elements["gallery-globe-rotate"].fire("click"); resume.flush(30);
  assert(resumeMap.center.lng > draggedLongitude && resume.state.frames.size === 1, "Repeated drag/resume cycles must restart without duplicating RAF loops");
  await resume.elements["gallery-globe-rotate"].fire("click"); resume.flush();
  assert(resume.state.frames.size === 0, "The Pause button must still stop explicitly resumed rotation");
  const unsupported = harness(photos, { failMap: true }); await unsupported.init(); await unsupported.open();
  assert(unsupported.state.maps.length === 0 && !unsupported.elements["gallery-globe-retry"].hidden && !unsupported.elements["gallery-grid-tab"].disabled, "WebGL failure must leave retry and the regular Gallery available");

  const race = harness(photos); let releaseTheme;
  await race.init((dark) => dark ? new Promise((resolve) => { releaseTheme = () => resolve(baseStyle); }) : Promise.resolve(baseStyle));
  const raceMap = await race.open();
  race.document.documentElement.setAttribute("data-theme", "dark"); const pendingTheme = race.state.themeChange();
  race.document.documentElement.setAttribute("data-theme", "light"); await race.state.themeChange();
  releaseTheme(); await pendingTheme;
  assert(race.state.styleChanges.length === 0, "A stale dark-theme request must not overwrite a newer light-theme choice");
  let releaseCluster; race.state.pendingCluster = new Promise((resolve) => { releaseCluster = resolve; });
  const raceCluster = await showCluster(race);
  const pendingClick = raceCluster.options.element.fire("click");
  await race.activeMarkers().find((marker) => marker.options.element.getAttribute("data-photo-id") === "3").options.element.fire("click");
  releaseCluster(); await pendingClick;
  assert(race.activePopup().content.querySelector("img").alt === "Gamma", "A stale cluster lookup must not overwrite a newer photo preview");
  race.state.pendingCluster = new Promise((resolve) => { releaseCluster = resolve; });
  const staleCluster = raceCluster.options.element.fire("click");
  await race.elements["gallery-globe-reset"].fire("click"); releaseCluster(); await staleCluster;
  assert(!race.activePopup(), "Overview must invalidate an older cluster lookup instead of reopening a preview");
  race.state.pendingCluster = new Promise((resolve) => { releaseCluster = resolve; });
  const dismissedCluster = raceCluster.options.element.fire("click");
  await raceMap.emit("click"); releaseCluster(); await dismissedCluster;
  assert(!race.activePopup(), "A map-background click must also invalidate pending photo previews");
  const noDimensions = harness([{ ...photos[0], width: null, height: null }]);
  await noDimensions.init(); await noDimensions.open(); await noDimensions.activeMarkers()[0].options.element.fire("click");
  const naturalPreview = noDimensions.activePopup(), naturalImage = naturalPreview.content.querySelector("img");
  naturalImage.complete = true; naturalImage.naturalWidth = 900; naturalImage.naturalHeight = 1600; await naturalImage.fire("load");
  assert(Math.abs(parseFloat(naturalPreview.content.style.width) / parseFloat(naturalImage.style.height) - 9 / 16) < 1e-9, "Missing manifest dimensions must fall back to the loaded image's natural ratio");
  log("PASS: centered single globe, exact GPS/GeoJSON, lazy MapLibre, cropped photo clusters/pins, ratio-adaptive portrait/landscape/panorama previews, natural-size fallback, responsive/group resizing, keyboard/close/focus, marker reuse/cleanup, zoom/reset, attribution, repeated drag/resume with retained focus/hover, camera easing and single RAF, theme/race safety, retry and GPU fallback");
})().catch((error) => {
  log(error.message); log(error.stack || "");
  if (typeof quit === "function") quit(1); else throw error;
});
