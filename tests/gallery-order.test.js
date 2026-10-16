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
  get offsetHeight() {
    if (this.className !== "gallery-description") return 0;
    const width = Math.max(1, Number.parseFloat(this.style.width) - 20);
    return 20 + Math.ceil(this.textContent.length * 8 / width) * 20;
  }
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

const savedManifest = JSON.parse(readSource("assets/gallery/gallery.json"));
assert(savedManifest.every((item) => typeof item.description === "string"), "Every photo should have an editable description field");
// Fictional locations belong only to test fixtures, never to the real manifest.
const manifest = savedManifest.map((item, index) => ({
  ...item,
  description: index % 3 === 0 ? "  Example location, 示例地点, " + "a long place name ".repeat(8) + "  " : index % 3 === 1 ? " " : "<b>Literal location text</b>",
}));
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
    getComputedStyle: (element) => element === container ? { columnGap: "16px" } : {
      borderLeftWidth: "1px", borderRightWidth: "1px", borderTopWidth: "1px", borderBottomWidth: "1px",
    },
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
  container.children.forEach((card) => {
    const trigger = card.querySelector(".gallery-trigger");
    const item = manifest.find((entry) => (entry.display || entry.src) === trigger.attrs["data-full-src"]);
    const description = item.description.trim();
    assert((trigger.attrs["data-description"] || "") === description, "Each shuffled photo must retain its own description");
    const caption = card.querySelector(fullGallery ? ".gallery-description" : ".gallery-preview-description");
    assert(description ? caption && caption.textContent === description : !caption, "Every nonempty description must belong to its photo's slide, with empty descriptions omitted");
    if (caption) assert(card.children.includes(caption), "Captions must be inside the moving card rather than in a separate fixed label");
    if (fullGallery && description) {
      assert(caption && caption.textContent === description, "Full Gallery should show descriptions as plain text below the photo");
      const imageHeight = Number.parseFloat(trigger.style.height);
      assert(Math.abs(Number.parseFloat(card.style.height) - imageHeight - caption.offsetHeight - 2) < 0.001, "Masonry height must include the caption and borders without cropping the image");
    }
  });
  if (fullGallery) {
    const assertLayout = () => {
      const rects = container.children.map((card) => {
        const width = Number.parseFloat(card.style.width);
        const height = Number.parseFloat(card.style.height);
        const trigger = card.querySelector(".gallery-trigger");
        const imageHeight = Number.parseFloat(trigger.style.height);
        const captionHeight = card.querySelector(".gallery-description")?.offsetHeight || 0;
        assert(Math.abs(imageHeight - (width - 2) / Number(card.dataset.ratio)) < 0.001, "Image frames must preserve the original aspect ratio at every width");
        assert(Math.abs(height - imageHeight - captionHeight - 2) < 0.001, "All wrapped text must fit inside the card");
        return { left: Number.parseFloat(card.style.left), top: Number.parseFloat(card.style.top), width, height };
      });
      rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => {
        assert(!(a.left < b.left + b.width - 0.001 && b.left < a.left + a.width - 0.001 && a.top < b.top + b.height - 0.001 && b.top < a.top + a.height - 0.001), "Caption-aware masonry cards must not overlap");
      }));
    };
    assertLayout();
    const positions = () => JSON.stringify(container.children.map((card) => [card.style.left, card.style.top]));
    const initialPositions = positions();
    container.querySelectorAll("img").forEach((img) => img.fire("load"));
    (listeners.resize || []).forEach((handler) => handler());
    assert(positions() === initialPositions, "Image loads and same-size relayout must not reshuffle visual positions");
    for (const width of [320, 390, 760, 980]) {
      windowStub.innerWidth = width;
      container.clientWidth = width * 0.92;
      (listeners.resize || []).forEach((handler) => handler());
      assertLayout();
    }
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
  log("PASS: per-refresh shuffle, physically attached slide captions, photo/description pairing, uncropped caption-aware masonry, empty-caption handling, and stable relayout");
})().catch((error) => { log(error.stack || error); throw error; });
