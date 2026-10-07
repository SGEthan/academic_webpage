// Run with Node or macOS JavaScriptCore, like tests/homepage.test.js.
const readSource = typeof readFile === "function" ? readFile : (path) => require("fs").readFileSync(path, "utf8");
const log = typeof print === "function" ? print : console.log;
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.clientWidth = 1080;
  }
  set innerHTML(value) { this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  fire(name) { (this.listeners[name] || []).forEach((handler) => handler()); }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)])
      .filter((child) => selector.startsWith(".")
        ? (child.className || "").split(" ").includes(selector.slice(1))
        : child.tagName === selector);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const manifest = JSON.parse(readSource("assets/gallery/gallery.json"));
const originalManifest = JSON.stringify(manifest);
const source = readSource("script.js");
const body = source.slice(source.indexOf("{") + 1, source.lastIndexOf("  // ---------------------------------------------------------------------------\n  // Init"));
const exported = "\nreturn { initGalleryFromManifest, initGalleryPageFromManifest };";

async function loadPage(fullGallery, randomValue) {
  const container = new Element();
  const selector = fullGallery ? "[data-gallery-page]" : "[data-gallery-auto]";
  const documentStub = {
    querySelector: (query) => query === selector ? container : null,
    createElement: (tag) => new Element(tag),
  };
  const listeners = {};
  const windowStub = {
    innerWidth: 1200,
    getComputedStyle: () => ({ columnGap: "16px" }),
    requestAnimationFrame(handler) { handler(); },
    setTimeout(handler) { handler(); return 1; },
    clearTimeout() {},
    addEventListener(name, handler) { (listeners[name] ||= []).push(handler); },
  };
  let draws = 0;
  const mathStub = Object.create(Math);
  mathStub.random = () => { draws++; return randomValue; };
  const fetchStub = async () => ({ ok: true, json: async () => manifest });
  const site = new Function("document", "window", "fetch", "Math", body + exported)(documentStub, windowStub, fetchStub, mathStub);
  let refreshes = 0;
  const galleryApi = { refresh() { refreshes++; } };
  await (fullGallery ? site.initGalleryPageFromManifest : site.initGalleryFromManifest)(galleryApi);
  const order = () => container.querySelectorAll(".gallery-trigger").map((trigger) => trigger.attrs["data-full-src"]);
  const expected = manifest.map((item) => item.display || item.src);
  const renderedOrder = order();
  assert(renderedOrder.length === expected.length, "Shuffling must retain every photo");
  assert([...renderedOrder].sort().join("|") === [...expected].sort().join("|"), "Shuffling must not duplicate or lose photos");
  assert(draws === manifest.length - 1, "Each page must shuffle exactly once");
  assert(refreshes === 1, "The lightbox should collect the rendered order once");
  if (fullGallery) {
    const positions = () => JSON.stringify(container.children.map((card) => [card.style.left, card.style.top]));
    const initialPositions = positions();
    container.querySelectorAll("img").forEach((img) => img.fire("load"));
    (listeners.resize || []).forEach((handler) => handler());
    assert(positions() === initialPositions, "Image loads and same-size relayout must not reshuffle visual positions");
  }
  assert(draws === manifest.length - 1 && order().join("|") === renderedOrder.join("|"), "Browsing and relayout must preserve the current order");
  assert(JSON.stringify(manifest) === originalManifest, "Shuffling must not mutate the shared manifest");
  return renderedOrder.join("|");
}

(async () => {
  for (const fullGallery of [false, true]) {
    const firstLoad = await loadPage(fullGallery, 0);
    const refreshedLoad = await loadPage(fullGallery, 0.999);
    assert(firstLoad !== refreshedLoad, "A fresh page load must use new random choices");
  }
  log("PASS: homepage and Full Gallery shuffle once per page load, retain every photo, and stay stable during image loads/resize without changing the manifest");
})().catch((error) => { log(error.stack || error); throw error; });
