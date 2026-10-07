// Dependency-free logic smoke tests. Run with Node, or macOS JavaScriptCore:
// /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/homepage.test.js
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
    this.listeners = {};
    this.style = {};
    this._text = "";
    this.className = "";
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
        this.className = Array.from(names).join(" ");
      },
    };
  }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
  set innerHTML(value) { this._text = ""; this.children = []; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this._text = ""; this.children = children; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  fire(name, event = {}) { (this.listeners[name] || []).forEach((handler) => handler(event)); }
  querySelectorAll(selector) {
    const descendants = this.children.filter((child) => typeof child !== "string")
      .flatMap((child) => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return descendants;
    if (selector.includes("button:not")) return descendants.filter((child) => child.tagName === "button" && !child.disabled);
    if (selector.startsWith(".")) return descendants.filter((child) => child.classList.contains(selector.slice(1)));
    return descendants.filter((child) => child.tagName === selector);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getClientRects() { return [1]; }
  contains(element) { return this === element || this.querySelectorAll("*").includes(element); }
  focus() { documentStub.activeElement = this; }
  closest(selector) { return this.ancestors?.[selector] || null; }
}

const elements = {};
const documentStub = {
  hidden: false,
  activeElement: null,
  listeners: {},
  body: new Element("body"),
  createElement: (tag) => new Element(tag),
  getElementById: (id) => elements[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); },
  fire(name, event) { (this.listeners[name] || []).forEach((handler) => handler(event)); },
};
let currentTimer = null;
let timerDelay = null;
const windowStub = {
  listeners: {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  setInterval(handler, delay) { currentTimer = handler; timerDelay = delay; return 1; },
  clearInterval() { currentTimer = null; },
  setTimeout(handler) { handler(); },
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); },
};
const source = readSource("script.js");
const body = source.slice(source.indexOf("{") + 1, source.lastIndexOf("  // ---------------------------------------------------------------------------\n  // Init"));
const fetchStub = async () => ({ ok: true, text: async () => readSource("bibtex/yichuan_deng.bib") });
const site = new Function("document", "window", "fetch", body + "\nreturn { parseBibtexEntries, renderPublicationItem, buildCiteBibtex, isSelectedEntry, parseContentFrontmatter, populateContent, trapDialogFocus, initGalleryCarousel, groupPublicationsByCategory, renderGroupedPublications, initPublicationsFromBibtex };")(documentStub, windowStub, fetchStub);

const entries = site.parseBibtexEntries(readSource("bibtex/yichuan_deng.bib"));
const selected = entries.filter(site.isSelectedEntry);
assert(selected.length === 4, "All four selected publications must be retained");
const longEntry = entries.find((entry) => entry.authors.split(/\s+and\s+/i).length > 8);
const card = site.renderPublicationItem(longEntry);
const authors = card.querySelector(".pub-authors");
const toggle = card.querySelector(".authors-toggle");
assert(authors.textContent.includes("Yichuan Deng"), "Compact authors must include the site owner");
assert(authors.textContent.includes("…"), "Long lists should start collapsed");
assert(card.querySelectorAll(".equal-contribution-marker").length === Number(longEntry.fields.equal_contribution), "Compact list must preserve all co-first markers");
toggle.fire("click");
assert(toggle.getAttribute("aria-expanded") === "true" && !authors.textContent.includes("…"), "Author expansion should reveal the full list");
toggle.fire("click");
assert(toggle.getAttribute("aria-expanded") === "false" && authors.textContent.includes("…"), "Authors should collapse again");
const mvffn = entries.find((entry) => /mvffn/i.test(entry.key + entry.title));
assert(site.renderPublicationItem(mvffn).querySelectorAll(".equal-contribution-marker").length === 3, "MVFFN must keep its first three co-first authors");
assert(site.buildCiteBibtex(longEntry).includes(longEntry.fields.author), "Cite must retain the full author list");
assert(!site.buildCiteBibtex(longEntry).includes("equal_contribution="), "Cite should omit site-only metadata");
assert(entries.every((entry) => !site.buildCiteBibtex(entry).includes("cat=")), "Copied citations should omit category metadata");

const groups = site.groupPublicationsByCategory(entries);
assert(groups.map((group) => group.category).join("|") === "Computer Vision|Language Models|Theory & ML", "Categories must follow BibTeX first appearance");
assert(groups.map((group) => group.entries.length).join(",") === "1,1,6", "All eight papers must appear in their categories");
assert(groups.every((group) => group.entries.every((entry, index) => index === 0 || group.entries[index - 1].year >= entry.year)), "Papers must be newest first within each category");
const categoryFixtures = [
  { ...entries[0], year: 2022, fields: { cat: " Alpha " } },
  { ...entries[1], year: 2026, fields: { cat: "Beta" } },
  { ...entries[2], year: 2025, fields: { cat: "Alpha" } },
  { ...entries[3], year: 2024, fields: {} },
  { ...entries[4], year: 2023, fields: { cat: " " } },
];
const fixtureGroups = site.groupPublicationsByCategory(categoryFixtures);
assert(fixtureGroups.map((group) => group.category).join("|") === "Alpha|Beta|Other Publications", "Whitespace must be trimmed and missing categories must share a fallback");
assert(fixtureGroups[0].entries.map((entry) => entry.year).join(",") === "2025,2022", "Category sorting must be independent of category order");
assert(fixtureGroups[2].entries.length === 2 && categoryFixtures[0].year === 2022, "Grouping must not lose papers or mutate input order");
const groupedContainer = new Element();
groupedContainer.id = "test-publications";
site.renderGroupedPublications(groupedContainer, entries);
assert(groupedContainer.querySelectorAll(".pub-category").length === 3, "Rendering should create three labeled category sections");
assert(groupedContainer.querySelectorAll(".pub-item").length === entries.length, "Grouped rendering must retain every paper");
assert(groupedContainer.querySelectorAll(".pub-item--compact").length === entries.length, "Full Publications should use compact rows for every paper");
assert(groupedContainer.querySelectorAll(".pub-category-count").map((element) => element.textContent).join("|") === "1 paper|1 paper|6 papers", "Category counts should match the rendered papers");
assert(groupedContainer.children.every((section) => section.getAttribute("aria-labelledby") === section.querySelector("h2").id), "Category headings should label each section accessibly");
const categoryNotes = groupedContainer.querySelectorAll(".pub-category-note");
assert(categoryNotes.length === 1, "Only Theory & ML should have an author-order/contribution note");
const theorySection = groupedContainer.children.find((section) => section.querySelector("h2").textContent === "Theory & ML");
assert(theorySection.querySelector(".pub-category-note") === categoryNotes[0], "The contribution note must stay within Theory & ML");
assert(categoryNotes[0].textContent === "Authors are listed alphabetically. All authors contributed equally.", "The note should state alphabetical author order and equal contributions");
assert(theorySection.getAttribute("aria-describedby") === categoryNotes[0].id, "The Theory & ML section should reference its note accessibly");
const fixtureContainer = new Element();
site.renderGroupedPublications(fixtureContainer, categoryFixtures);
assert(fixtureContainer.querySelectorAll(".pub-category-note").length === 0, "Unrelated categories must not inherit the contribution note");

const compactCard = site.renderPublicationItem(longEntry, { compact: true });
assert(compactCard.children.length === 3 && compactCard.children[0].tagName === "h3", "Compact rows should contain title, authors, and combined details");
assert(compactCard.querySelector("h3").textContent === longEntry.title, "Compact rows must retain the full paper title");
const compactDetails = compactCard.querySelector(".pub-details");
assert(compactDetails.querySelector(".pub-tags") && compactDetails.querySelector(".pub-links"), "Venue tags and links should share the compact details row");
assert(compactDetails.querySelector(".equal-contribution-note"), "Compact details must preserve the co-first explanation");
const compactAuthorsToggle = compactCard.querySelector(".authors-toggle");
compactAuthorsToggle.fire("click");
assert(compactAuthorsToggle.getAttribute("aria-expanded") === "true" && !compactCard.querySelector(".pub-authors").textContent.includes("…"), "Author expansion must still work within compact rows");
assert(compactCard.querySelector(".authors-toggle") === compactAuthorsToggle, "Expanding authors must not remove the inline toggle");
assert(card.className === "pub-item", "Default/homepage rendering should keep the original card layout");

elements["contact-row"] = new Element();
elements["profile-affiliation"] = new Element();
const { meta } = site.parseContentFrontmatter(readSource("content.md"));
site.populateContent(meta, "");
assert(elements["contact-row"].children[0].href === "mailto:ycdeng@cs.washington.edu", "Email must use a valid mailto address");
assert(elements["profile-affiliation"].textContent === "University of Washington", "Hero affiliation should use the content metadata");

const dialog = new Element();
const first = new Element("button");
const last = new Element("button");
dialog.append(first, last);
let prevented = false;
last.focus();
site.trapDialogFocus({ key: "Tab", shiftKey: false, preventDefault() { prevented = true; } }, dialog);
assert(prevented && documentStub.activeElement === first, "Tab should wrap within the modal");
first.focus();
site.trapDialogFocus({ key: "Tab", shiftKey: true, preventDefault() {} }, dialog);
assert(documentStub.activeElement === last, "Shift+Tab should wrap within the modal");

const root = new Element();
const viewport = new Element();
viewport.clientWidth = 1000;
viewport.scrollTo = () => {};
const track = elements["auto-gallery"] = new Element();
track.ancestors = { ".gallery-viewport": viewport, ".gallery-carousel": root };
const slides = [0, 1, 2].map(() => {
  const slide = new Element("figure");
  slide.className = "gallery-card";
  const trigger = new Element("button");
  trigger.className = "gallery-trigger";
  trigger.append(new Element("img"));
  slide.append(trigger);
  return slide;
});
track.append(...slides);
const querySlides = track.querySelectorAll.bind(track);
track.querySelectorAll = (selector) => selector.includes("gallery-card:not") ? slides : querySlides(selector);
for (const id of ["gallery-prev", "gallery-next", "gallery-autoplay", "gallery-autoplay-icon", "gallery-position", "gallery-current", "gallery-total", "gallery-progress-fill"]) elements[id] = new Element("button");
const events = {};
let index = 0;
let steps = 0;
windowStub.EmblaCarousel = () => ({
  selectedScrollSnap: () => index,
  scrollNext() { index = (index + 1) % slides.length; steps++; events.select(); },
  scrollPrev() { index = (index + slides.length - 1) % slides.length; events.select(); },
  scrollTo(value) { index = value; events.select(); },
  on(name, handler) { events[name] = handler; },
});
site.initGalleryCarousel();
assert(currentTimer && timerDelay === 1000, "Autoplay should retain the one-second interval");
currentTimer();
assert(steps === 1, "Autoplay should advance exactly one slide per tick");
root.fire("mouseenter");
assert(!currentTimer, "Hover should pause autoplay");
root.fire("mouseleave");
assert(currentTimer, "Leaving hover should resume autoplay");
root.fire("focusin");
assert(!currentTimer, "Keyboard focus should pause autoplay until explicit resume");
elements["gallery-autoplay"].fire("click");
assert(currentTimer, "Explicit play should resume after keyboard focus");
documentStub.fire("site:dialogchange", { detail: { open: true } });
assert(!currentTimer, "Opening a dialog should pause autoplay");
documentStub.fire("site:dialogchange", { detail: { open: false } });
assert(currentTimer, "Dialog close should restore eligible autoplay");
elements["gallery-autoplay"].fire("pointerdown");
root.fire("focusin");
elements["gallery-autoplay"].fire("click");
assert(!currentTimer, "Pointer focus should not turn a pause click into play");
let clickPrevented = false;
track.fire("click", {
  target: { closest: () => slides[0] },
  preventDefault() { clickPrevented = true; },
});
assert(clickPrevented && index === 0, "Side-slide selection should consume the click before the lightbox listener");
log("PASS: selected publications, authors/co-first/Cite, email, affiliation, modal focus, one-second autoplay, side-slide click");

const allContainer = new Element();
allContainer.id = "all-publications";
allContainer.setAttribute("data-publications", "all");
allContainer.setAttribute("data-group-by", "category");
const selectedContainer = new Element();
selectedContainer.setAttribute("data-publications", "selected");
documentStub.querySelectorAll = (selector) => selector === "[data-publications]" ? [allContainer, selectedContainer] : [];
site.initPublicationsFromBibtex().then(() => {
  assert(allContainer.querySelectorAll(".pub-category").length === 3, "Full Publications must use grouped rendering");
  assert(allContainer.querySelectorAll(".pub-item").length === entries.length, "Full Publications must display all papers");
  assert(selectedContainer.querySelectorAll(".pub-category").length === 0, "Homepage selected publications must remain flat");
  assert(selectedContainer.querySelectorAll(".pub-category-note").length === 0, "Homepage selected publications must not show the category note");
  assert(selectedContainer.querySelectorAll(".pub-item--compact").length === 0, "Homepage selected publications must keep the original card density");
  assert(selectedContainer.querySelectorAll(".pub-item").length === selected.length, "Homepage must still show every selected paper");
  log("PASS: compact publication rows, full titles/inline author expansion, category order/counts/year sorting, missing-category fallback, unchanged homepage, category-free citations");
});
