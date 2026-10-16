(() => {
  const GALLERY_PAGE_ORDER_KEY = "gallery-page-manual-order-v1";
  const GALLERY_PAGE_SIZE_KEY = "gallery-page-manual-size-v1";
  const MIN_CARD_SPAN = 1;
  const MAX_CARD_SPAN = 6;
  const SPAN_STEP = 0.1;
  const BUTTON_SPAN_STEP = 0.2;

  function initThemeToggle() {
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;

    const storageKey = "site-theme";
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const states = ["auto", "dark", "light"];

    function getStoredTheme() {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "dark" || stored === "light" || stored === "auto") return stored;
      return "auto";
    }

    function setButtonLabel(mode) {
      if (mode === "dark") toggle.textContent = "Dark";
      else if (mode === "light") toggle.textContent = "Light";
      else toggle.textContent = "Auto";
    }

    function applyTheme(mode) {
      if (mode === "auto") {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", mode);
      }
      setButtonLabel(mode);
    }

    let currentMode = getStoredTheme();
    applyTheme(currentMode);

    toggle.addEventListener("click", () => {
      document.documentElement.classList.add("theme-animating");
      const nextMode = states[(states.indexOf(currentMode) + 1) % states.length];
      currentMode = nextMode;
      window.localStorage.setItem(storageKey, currentMode);

      // Ensure the browser paints transition styles before theme variables change.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          applyTheme(currentMode);
          window.setTimeout(() => {
            document.documentElement.classList.remove("theme-animating");
          }, 720);
        });
      });
    });

    mediaQuery.addEventListener("change", () => {
      if (currentMode === "auto") applyTheme("auto");
    });
  }

  function refreshBodyScrollLock() {
    const hasOpenDialog = document.querySelector(".lightbox.is-open, .bibtex-modal.is-open");
    document.body.classList.toggle("no-scroll", Boolean(hasOpenDialog));
    document.querySelectorAll("body > header, body > main, body > footer").forEach((element) => {
      element.inert = Boolean(hasOpenDialog);
    });
    document.dispatchEvent(new CustomEvent("site:dialogchange", { detail: { open: Boolean(hasOpenDialog) } }));
  }

  function trapDialogFocus(event, dialog) {
    if (event.key !== "Tab") return;
    const controls = Array.from(dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]'))
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) return;
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function initSmoothAnchorScroll() {
    const header = document.querySelector(".site-header");

    function targetTopForHash(hash) {
      if (!hash || hash === "#") return;
      let target = null;
      try {
        target = document.querySelector(hash);
      } catch (error) {
        return null;
      }
      if (!target) return null;
      const headerOffset = header ? header.getBoundingClientRect().height + 20 : 20;
      return target.getBoundingClientRect().top + window.scrollY - headerOffset;
    }

    function scrollToHash(hash, smooth) {
      const top = targetTopForHash(hash);
      if (top == null) return;
      window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    }

    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href*="#"]');
      if (!link) return;
      const rawHref = link.getAttribute("href");
      if (!rawHref || rawHref === "#") return;
      let parsed = null;
      try {
        parsed = new URL(rawHref, window.location.href);
      } catch (error) {
        return;
      }
      if (parsed.origin !== window.location.origin) return;
      if (parsed.pathname !== window.location.pathname) return;
      const href = parsed.hash;
      if (!href || href === "#") return;
      let target = null;
      try {
        target = document.querySelector(href);
      } catch (error) {
        return;
      }
      if (!target) return;

      event.preventDefault();
      window.history.replaceState(null, "", href);
      scrollToHash(href, true);
    });

    // Cross-page hash can be slightly off; do one gentle correction only if needed.
    if (window.location.hash) {
      window.requestAnimationFrame(() => scrollToHash(window.location.hash, false));
      window.setTimeout(() => {
        const expectedTop = targetTopForHash(window.location.hash);
        if (expectedTop == null) return;
        const delta = Math.abs(window.scrollY - Math.max(0, expectedTop));
        if (delta > 10) scrollToHash(window.location.hash, false);
      }, 320);
    }
  }

  function galleryImageSrcset(item, maxEdge = Infinity) {
    const byWidth = new Map();
    (item.variants || []).forEach((variant) => {
      if (!variant.src || !(variant.width > 0) || !(variant.height > 0)) return;
      if (Math.max(variant.width, variant.height) > maxEdge) return;
      const url = encodeURI(variant.src).replace(/,/g, "%2C").replace(/#/g, "%23");
      byWidth.set(variant.width, `${url} ${variant.width}w`);
    });
    return Array.from(byWidth).sort(([a], [b]) => a - b).map(([, source]) => source).join(", ");
  }

  function galleryLightboxSizes(item) {
    const ratio = item.width > 0 && item.height > 0 ? item.width / item.height : 1;
    const heightLimit = `calc(82vh * ${ratio.toFixed(5)})`;
    return `(max-width: 560px) min(calc(96vw - 1.6rem), ${heightLimit}), min(calc(1240px - 4.4rem), calc(96vw - 4.4rem), ${heightLimit})`;
  }

  function configureGalleryImage(img, item, sizes) {
    if (item.width > 0 && item.height > 0) {
      img.width = item.width;
      img.height = item.height;
    }
    const srcset = galleryImageSrcset(item, 1600);
    if (srcset) {
      img.srcset = srcset;
      img.sizes = sizes;
    }
    // Set lazy loading, srcset, and sizes before src to avoid an unnecessary large request.
    img.src = srcset ? item.small || item.thumb || item.src : item.thumb || item.src;
  }

  function configureGalleryTrigger(button, item) {
    button.setAttribute("data-full-src", item.display || item.src);
    const srcset = galleryImageSrcset(item);
    if (srcset) button.setAttribute("data-full-srcset", srcset);
    const description = galleryDescription(item);
    if (description) button.setAttribute("data-description", description);
  }

  function galleryDescription(item) {
    return typeof item.description === "string" ? item.description.trim() : "";
  }

  function galleryPageImageSizes(span = 2) {
    const breakpoints = [[560, 1], [760, 2], [980, 3], [1120, 4], [1280, 5], [1480, 6]];
    const hints = breakpoints.map(([width, columns]) =>
      `(max-width: ${width}px) calc(94vw * ${(Math.min(span, columns) / columns).toFixed(5)})`
    );
    hints.push(`calc(min(1700px, 94vw) * ${(Math.min(span, 7) / 7).toFixed(5)})`);
    return hints.join(", ");
  }

  function initGalleryLightbox() {
    const lightbox = document.getElementById("lightbox");
    const backdrop = lightbox?.querySelector(".lightbox-backdrop");
    const imageEl = document.getElementById("lightbox-image");
    const captionEl = document.getElementById("lightbox-caption");
    const closeBtn = document.getElementById("lightbox-close");
    const prevBtn = document.getElementById("lightbox-prev");
    const nextBtn = document.getElementById("lightbox-next");

    if (!lightbox || !backdrop || !imageEl || !captionEl || !closeBtn || !prevBtn || !nextBtn) return null;

    let galleryItems = [];

    let currentIndex = 0;
    let lastFocusedEl = null;
    let adjacentPreloads = [];

    function collectGalleryItems() {
      const triggers = Array.from(document.querySelectorAll(".gallery-trigger"));
      galleryItems = triggers.map((trigger, index) => {
        const img = trigger.querySelector("img");
        const description = trigger.getAttribute("data-description") || "";
        const fullSrc = trigger.getAttribute("data-full-src") || img?.getAttribute("src") || "";
        trigger.setAttribute("data-gallery-index", String(index));
        return {
          src: fullSrc,
          srcset: trigger.getAttribute("data-full-srcset") || "",
          width: Number(img?.getAttribute("width") || img?.naturalWidth || 0),
          height: Number(img?.getAttribute("height") || img?.naturalHeight || 0),
          alt: img?.getAttribute("alt") || "",
          description,
        };
      });
    }

    collectGalleryItems();

    function renderLightbox(index) {
      const item = galleryItems[index];
      if (!item) return;
      imageEl.srcset = item.srcset;
      imageEl.sizes = item.srcset ? galleryLightboxSizes(item) : "";
      imageEl.src = item.src;
      imageEl.alt = item.alt;
      captionEl.textContent = item.description;
      captionEl.hidden = !item.description;
      // Warm only neighboring images, at the same responsive size used in the viewer.
      const connection = window.navigator?.connection;
      if (typeof window.Image !== "function" || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return;
      const neighbors = new Set([(index + 1) % galleryItems.length, (index - 1 + galleryItems.length) % galleryItems.length]);
      neighbors.delete(index);
      adjacentPreloads = Array.from(neighbors, (neighbor) => {
        const next = galleryItems[neighbor];
        const preload = new window.Image();
        preload.decoding = "async";
        preload.srcset = next.srcset;
        preload.sizes = next.srcset ? galleryLightboxSizes(next) : "";
        preload.src = next.src;
        return preload;
      });
    }

    function openLightbox(index) {
      currentIndex = index;
      renderLightbox(currentIndex);
      lastFocusedEl = document.activeElement;
      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");
      refreshBodyScrollLock();
      closeBtn.focus();
    }

    function closeLightbox() {
      adjacentPreloads = [];
      lightbox.classList.remove("is-open");
      lightbox.setAttribute("aria-hidden", "true");
      refreshBodyScrollLock();
      if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
        lastFocusedEl.focus();
      }
    }

    function showPrevious() {
      currentIndex = (currentIndex - 1 + galleryItems.length) % galleryItems.length;
      renderLightbox(currentIndex);
    }

    function showNext() {
      currentIndex = (currentIndex + 1) % galleryItems.length;
      renderLightbox(currentIndex);
    }

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest(".gallery-trigger");
      if (!trigger) return;
      if (event.defaultPrevented) return;
      if (document.body.classList.contains("is-gallery-arranging")) return;
      const carouselCard = trigger.closest(".gallery-carousel .gallery-card");
      if (carouselCard && !carouselCard.classList.contains("is-active")) return;
      const index = Number.parseInt(trigger.getAttribute("data-gallery-index") || "-1", 10);
      if (index < 0) return;
      openLightbox(index);
    });

    prevBtn.addEventListener("click", showPrevious);
    nextBtn.addEventListener("click", showNext);
    closeBtn.addEventListener("click", closeLightbox);
    backdrop.addEventListener("click", closeLightbox);

    document.addEventListener("keydown", (event) => {
      if (!lightbox.classList.contains("is-open")) return;
      trapDialogFocus(event, lightbox);
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowLeft") showPrevious();
      if (event.key === "ArrowRight") showNext();
    });

    return {
      refresh: collectGalleryItems,
      openBySrc(src) {
        const index = galleryItems.findIndex((item) => item.src === src);
        if (index < 0) return false;
        openLightbox(index);
        return true;
      },
    };
  }

  async function initGalleryFromManifest(galleryApi) {
    const container = document.querySelector("[data-gallery-auto]");
    if (!container) return;

    try {
      // Shuffle once per page load; navigation and autoplay keep this order.
      const items = shuffleArray(await loadGalleryManifest());

      container.innerHTML = "";
      items.forEach((item) => {
        const figure = document.createElement("figure");
        figure.className = "gallery-card";
        const description = galleryDescription(item);

        const button = document.createElement("button");
        button.className = "gallery-trigger";
        button.type = "button";
        button.setAttribute("aria-label", `Open image: ${description || item.alt || item.caption || "Gallery image"}`);
        configureGalleryTrigger(button, item);

        const img = document.createElement("img");
        if (item.width > 0 && item.height > 0) {
          figure.style.aspectRatio = `${item.width} / ${item.height}`;
        }
        const syncPreviewRatio = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            figure.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
          }
        };
        if (!item.width || !item.height) img.addEventListener("load", syncPreviewRatio, { once: true });
        img.alt = description || item.alt || item.caption || "Gallery image";
        img.loading = container.children.length < 3 ? "eager" : "lazy";
        img.decoding = "async";
        const ratio = item.width > 0 && item.height > 0 ? item.width / item.height : 1.6;
        const carouselSizes = `(max-width: 560px) min(88vw, calc(min(58vw, 300px) * ${ratio.toFixed(5)})), (max-width: 900px) min(90vw, calc(min(48vw, 440px) * ${ratio.toFixed(5)})), min(1015px, 86.48vw, calc(clamp(300px, 43vw, 480px) * ${ratio.toFixed(5)}))`;
        configureGalleryImage(img, item, carouselSizes);
        if ((!item.width || !item.height) && img.complete) syncPreviewRatio();
        button.appendChild(img);

        figure.appendChild(button);
        if (description) {
          // Keep text inside the slide so dragging, looping, and autoplay move it
          // with its photo, rather than swapping a separate fixed label.
          const caption = document.createElement("figcaption");
          caption.className = "gallery-preview-description";
          caption.textContent = description;
          caption.title = description;
          figure.appendChild(caption);
        }
        container.appendChild(figure);
      });

      galleryApi?.refresh?.();
    } catch (error) {
      container.innerHTML = `
        <figure class="gallery-card gallery-loading">
          <figcaption>Failed to load gallery manifest. Run preview again to rebuild.</figcaption>
        </figure>
      `;
    }
  }

  let galleryManifestPromise = null;
  function loadGalleryManifest() {
    if (!galleryManifestPromise) {
      galleryManifestPromise = fetch("assets/gallery/gallery.json", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`Failed to load gallery manifest: ${response.status}`);
        return response.json();
      });
    }
    return galleryManifestPromise;
  }

  async function initGalleryPageFromManifest(galleryApi) {
    const container = document.querySelector("[data-gallery-page]");
    if (!container) return;

    try {
      const rawItems = await loadGalleryManifest();
      // Layout, image loading, and resizing reuse this one shuffled DOM order.
      const items = shuffleArray(rawItems);
      container.innerHTML = "";
      const validLayouts = new Set(["wide", "tall", "big"]);

      items.forEach((item) => {
        const figure = document.createElement("figure");
        figure.className = "gallery-card gallery-page-card";
        figure.dataset.itemId = item.src;

        const button = document.createElement("button");
        button.className = "gallery-trigger";
        button.type = "button";
        button.setAttribute("aria-label", `Open image: ${galleryDescription(item) || item.alt || item.caption || "Gallery image"}`);
        configureGalleryTrigger(button, item);

        const img = document.createElement("img");
        img.alt = galleryDescription(item) || item.alt || item.caption || "Gallery image";
        img.loading = "lazy";
        img.decoding = "async";
        const setImageLayout = () => {
          const ratio = (item.width || img.naturalWidth || 1) / (item.height || img.naturalHeight || 1);
          figure.dataset.ratio = String(ratio);
          let layout = typeof item.layout === "string" ? item.layout.trim().toLowerCase() : "";
          if (!validLayouts.has(layout)) layout = "";
          // Desktop auto rule:
          // - very wide landscape -> 4 columns
          // - regular landscape -> 3 columns
          // - portrait/near-square -> 2 columns
          const autoSpan = ratio >= 1.9 ? 4 : ratio > 1.02 ? 3 : 2;
          const spanFromLayout = layout === "big" ? 4 : layout === "wide" ? 3 : 2;
          const defaultSpan = normalizeSpan(layout ? spanFromLayout : autoSpan, 2);
          figure.dataset.defaultSpan = spanToString(defaultSpan);
          figure.dataset.span = spanToString(defaultSpan);
        };
        if (item.width > 0 && item.height > 0) setImageLayout();
        const onImageReady = () => {
          if (!item.width || !item.height) setImageLayout();
          layoutGalleryGrid(container, { optimize: true });
        };
        img.addEventListener("load", onImageReady, { once: true });
        configureGalleryImage(img, item, galleryPageImageSizes(Number(figure.dataset.defaultSpan) || 2));
        if (img.complete && img.naturalWidth > 0) {
          // Cached images can skip async load dispatch in some browsers.
          onImageReady();
        }
        button.appendChild(img);

        figure.appendChild(button);
        const description = galleryDescription(item);
        if (description) {
          const caption = document.createElement("figcaption");
          caption.className = "gallery-description";
          caption.textContent = description;
          figure.appendChild(caption);
        }
        container.appendChild(figure);
      });

      window.requestAnimationFrame(() => layoutGalleryGrid(container, { optimize: true }));
      window.setTimeout(() => layoutGalleryGrid(container, { optimize: true }), 80);
      if (document.fonts?.ready) {
        document.fonts.ready.then(() => layoutGalleryGrid(container, { optimize: true }));
      }
      if (!window.__galleryPageResizeBound) {
        window.__galleryPageResizeBound = true;
        let resizeTimer = null;
        window.addEventListener("resize", () => {
          if (resizeTimer) window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            const grid = document.querySelector("[data-gallery-page]");
            if (grid) layoutGalleryGrid(grid, { optimize: true });
          }, 80);
        });
      }
      galleryApi?.refresh?.();
    } catch (error) {
      container.innerHTML = `
        <figure class="gallery-card gallery-loading">
          <figcaption>Failed to load gallery manifest. Run preview again to rebuild.</figcaption>
        </figure>
      `;
    }
  }

  function layoutGalleryGrid(container, options = {}) {
    if (!container) return;
    const { optimize = false, randomize = false } = options;
    const styles = window.getComputedStyle(container);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "16") || 16;
    const containerWidth = container.clientWidth;
    if (!containerWidth) return;
    const viewport = window.innerWidth || document.documentElement.clientWidth || 1400;
    const columns = viewport <= 560 ? 1 : viewport <= 760 ? 2 : viewport <= 980 ? 3 : viewport <= 1120 ? 4 : viewport <= 1280 ? 5 : viewport <= 1480 ? 6 : 7;
    const colWidth = (containerWidth - gap * (columns - 1)) / columns;
    if (colWidth <= 0) return;
    const cards = Array.from(container.querySelectorAll(".gallery-page-card"));
    const heights = new Array(columns).fill(0);

    const readyCards = cards.filter((card) => {
      const img = card.querySelector("img");
      const isReady = Boolean(card.dataset.ratio || (img && img.complete && img.naturalWidth > 0));
      card.style.visibility = isReady ? "visible" : "hidden";
      return isReady;
    });

    const pendingBase = readyCards.map((card) => {
      const ratio = Number.parseFloat(card.dataset.ratio || "1") || 1;
      const desiredSpan = normalizeSpan(card.dataset.span || card.dataset.defaultSpan, normalizeSpan(card.dataset.defaultSpan, 2));
      const span = Math.max(MIN_CARD_SPAN, Math.min(desiredSpan, columns));
      const width = colWidth * span + gap * (span - 1);
      // Measure wrapped text at its actual width, without changing the image ratio.
      card.style.width = `${width}px`;
      const cardStyles = window.getComputedStyle(card);
      const borderX = (Number.parseFloat(cardStyles.borderLeftWidth) || 0) + (Number.parseFloat(cardStyles.borderRightWidth) || 0);
      const borderY = (Number.parseFloat(cardStyles.borderTopWidth) || 0) + (Number.parseFloat(cardStyles.borderBottomWidth) || 0);
      const imageHeight = Math.max(0, width - borderX) / ratio;
      const trigger = card.querySelector(".gallery-trigger");
      if (trigger) trigger.style.height = `${imageHeight}px`;
      const description = card.querySelector(".gallery-description");
      if (description) description.style.width = `${Math.max(0, width - borderX)}px`;
      const height = imageHeight + (description?.offsetHeight || 0) + borderY;
      const rand = Number.parseFloat(card.dataset.rand || "0") || 0;
      return { card, span, width, height, rand };
    });

    const pending = randomize ? pendingBase.slice().sort((a, b) => a.rand - b.rand) : pendingBase.slice();

    if (!optimize) {
      // Stable placement by current DOM order. Used in interactive drag mode.
      pending.forEach((item) => {
        let bestStartCol = 0;
        let bestTop = Number.POSITIVE_INFINITY;
        const occupiedCols = Math.max(1, Math.ceil(item.span));
        const maxStartCol = Math.max(0, columns - occupiedCols);
        for (let startCol = 0; startCol <= maxStartCol; startCol += 1) {
          const top = Math.max(...heights.slice(startCol, startCol + occupiedCols));
          if (top < bestTop) {
            bestTop = top;
            bestStartCol = startCol;
          }
        }

        const left = bestStartCol * (colWidth + gap);
        item.card.style.position = "absolute";
        item.card.style.left = `${left}px`;
        item.card.style.top = `${bestTop}px`;
        item.card.style.width = `${item.width}px`;
        item.card.style.height = `${item.height}px`;

        const nextHeight = bestTop + item.height + gap;
        for (let i = bestStartCol; i < bestStartCol + occupiedCols; i += 1) heights[i] = nextHeight;
      });
    } else {
      // Randomized item order + compact local best-fit placement.
      pending.forEach((item) => {
        const occupiedCols = Math.max(1, Math.ceil(item.span));
        const maxStartCol = Math.max(0, columns - occupiedCols);
        let bestStartCol = 0;
        let bestTop = 0;
        let bestScore = Number.POSITIVE_INFINITY;
        let bestHeights = heights.slice();

        for (let startCol = 0; startCol <= maxStartCol; startCol += 1) {
          const top = Math.max(...heights.slice(startCol, startCol + occupiedCols));
          const nextHeight = top + item.height + gap;
          const newHeights = heights.slice();
          for (let i = startCol; i < startCol + occupiedCols; i += 1) newHeights[i] = nextHeight;

          const maxH = Math.max(...newHeights);
          const minH = Math.min(...newHeights);
          const spread = maxH - minH;
          const leftAvg =
            newHeights.slice(0, Math.floor(columns / 2)).reduce((sum, v) => sum + v, 0) /
            Math.max(1, Math.floor(columns / 2));
          const rightAvg =
            newHeights.slice(Math.ceil(columns / 2)).reduce((sum, v) => sum + v, 0) /
            Math.max(1, columns - Math.ceil(columns / 2));
          const lrBalance = Math.abs(leftAvg - rightAvg);
          const edgePenalty = Math.abs(startCol - (maxStartCol / 2)) * 0.15;

          const score = maxH * 1.0 + spread * 0.46 + lrBalance * 0.28 + edgePenalty;
          if (score < bestScore - 0.0001) {
            bestScore = score;
            bestStartCol = startCol;
            bestTop = top;
            bestHeights = newHeights;
          }
        }

        const left = bestStartCol * (colWidth + gap);
        item.card.style.position = "absolute";
        item.card.style.left = `${left}px`;
        item.card.style.top = `${bestTop}px`;
        item.card.style.width = `${item.width}px`;
        item.card.style.height = `${item.height}px`;
        for (let i = 0; i < heights.length; i += 1) heights[i] = bestHeights[i];
      });
    }

    const maxHeight = Math.max(...heights, 0);
    container.style.height = `${Math.max(0, maxHeight - gap)}px`;
  }

  function galleryCoordinates(item) {
    const latitude = item.gps?.latitude;
    const longitude = item.gps?.longitude;
    // Do not coerce null/empty values to zero and accidentally plot missing GPS.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return [latitude, longitude];
  }

  function groupGalleryLocations(items) {
    const groups = new Map();
    const unlocated = [];
    items.forEach((item) => {
      const coordinates = galleryCoordinates(item);
      if (!coordinates) { unlocated.push(item); return; }
      const key = coordinates.map((value) => value.toFixed(5)).join(",");
      if (!groups.has(key)) groups.set(key, { coordinates, items: [] });
      groups.get(key).items.push(item);
    });
    return { groups: Array.from(groups.values()), unlocated };
  }

  function galleryPhotoGeoJSON(items) {
    return {
      type: "FeatureCollection",
      features: items.flatMap((item, index) => {
        const coordinates = galleryCoordinates(item);
        return coordinates ? [{
          type: "Feature", id: index,
          geometry: { type: "Point", coordinates: [coordinates[1], coordinates[0]] },
          properties: { photo_id: index },
        }] : [];
      }),
    };
  }

  function galleryGlobeStyle(style, dark) {
    // Work on a copy: preserve the provider's source attribution and style data.
    const copy = JSON.parse(JSON.stringify(style));
    copy.projection = { type: "globe" };
    copy.transition = { duration: 0, delay: 0 };
    copy.layers.forEach((layer) => {
      if (layer.type === "background") layer.paint["background-color"] = dark ? "#252b3b" : "#faf9fd";
      if (layer.id === "water") layer.paint["fill-color"] = dark ? "#151a29" : "#e6e4ef";
    });
    return copy;
  }

  function galleryPhotoMarkerInfo(feature, items) {
    const properties = feature.properties || {};
    const clustered = Boolean(properties.cluster);
    const photoId = clustered ? properties.cover_id : properties.photo_id;
    const item = Number.isInteger(photoId) ? items[photoId] : null;
    const coordinates = feature.geometry?.coordinates;
    if (!item || !galleryCoordinates(item) || feature.geometry?.type !== "Point" ||
        !Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return null;
    if (clustered && (!Number.isInteger(properties.cluster_id) || !Number.isInteger(properties.point_count) || properties.point_count < 2)) return null;
    return { key: clustered ? `cluster:${properties.cluster_id}` : `photo:${photoId}`,
      clustered, photoId, item, count: clustered ? properties.point_count : 1, coordinates, feature };
  }

  function galleryPhotoPreviewSize(item, bounds) {
    const valid = Number.isFinite(item.width) && item.width > 0 && Number.isFinite(item.height) && item.height > 0;
    const width = valid ? item.width : 1, height = valid ? item.height : 1;
    const scale = Math.min(bounds.width / width, bounds.height / height, valid ? 1 : Infinity);
    return { width: width * scale, height: height * scale };
  }

  let galleryGlobeLibraryPromise = null;
  function loadGalleryGlobeLibrary() {
    if (galleryGlobeLibraryPromise) return galleryGlobeLibraryPromise;
    const load = (tag, path, id) => new Promise((resolve, reject) => {
      if (document.getElementById(id)) { resolve(); return; }
      const element = document.createElement(tag);
      element.id = id;
      const fail = () => { window.clearTimeout(timeout); element.remove(); reject(new Error("Globe assets could not load")); };
      const timeout = window.setTimeout(fail, 20000);
      element.onload = () => { window.clearTimeout(timeout); resolve(); };
      element.onerror = fail;
      if (tag === "link") { element.rel = "stylesheet"; element.href = path; }
      else { element.src = path; element.async = true; }
      document.head.appendChild(element);
    });
    galleryGlobeLibraryPromise = Promise.all([
      load("link", "assets/vendor/maplibre/maplibre-gl-5.24.0.css", "gallery-maplibre-css"),
      window.maplibregl ? Promise.resolve() : load("script", "assets/vendor/maplibre/maplibre-gl-5.24.0.js", "gallery-maplibre-js"),
    ]).then(() => window.maplibregl).catch((error) => { galleryGlobeLibraryPromise = null; throw error; });
    return galleryGlobeLibraryPromise;
  }

  const galleryBasemapPromises = new Map();
  function loadGalleryBasemap(dark) {
    const name = dark ? "dark" : "positron";
    if (!galleryBasemapPromises.has(name)) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      const pending = fetch("https://tiles.openfreemap.org/styles/" + name, { signal: controller.signal })
        .then((response) => { if (!response.ok) throw new Error("Basemap could not load"); return response.json(); })
        .catch((error) => { galleryBasemapPromises.delete(name); throw error; })
        .finally(() => window.clearTimeout(timeout));
      galleryBasemapPromises.set(name, pending);
    }
    return galleryBasemapPromises.get(name);
  }

  async function initGalleryGlobe(loadLibrary = loadGalleryGlobeLibrary, loadBasemap = loadGalleryBasemap) {
    const get = (name) => document.getElementById("gallery-" + name);
    const gridTab = get("grid-tab"), globeTab = get("globe-tab");
    const gridPanel = get("grid-panel"), panel = get("globe-panel");
    const stage = get("globe-stage"), container = get("globe-map");
    if (!gridTab || !globeTab || !gridPanel || !panel || !container) return;
    const message = get("globe-message"), retry = get("globe-retry"), rotate = get("globe-rotate");
    const reset = get("globe-reset"), zoomIn = get("globe-zoom-in"), zoomOut = get("globe-zoom-out");
    let items;
    try { items = await loadGalleryManifest(); }
    catch (_) { return; }
    const { groups } = groupGalleryLocations(items);
    const geojson = galleryPhotoGeoJSON(items);
    const located = items.filter((item) => galleryCoordinates(item));
    globeTab.disabled = false;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const isDark = () => {
      const mode = document.documentElement.getAttribute("data-theme");
      return mode === "dark" || (!mode && colorScheme.matches);
    };
    let map = null, maplibre = null, pending = null, ready = false;
    const photoMarkers = new Map();
    let frame = 0, lastTime = 0, spinning = false, rotating = !motion.matches, rotationExplicit = false;
    let hovered = false, focused = false;
    let inView = true, pageActive = true, dialogOpen = false, contextLost = false, disposed = false;
    let selectedPhoto = null, activeMarkerKey = null, photoPopup = null, popupOrigin = null, resizePhotoPreview = null;
    let styleRevision = 0, currentDark = isDark();
    let loadTimeout = null, clickRevision = 0;
    const overviewZoom = () => {
      const bounds = stage.getBoundingClientRect();
      return Math.log2(Math.max(240, Math.min(bounds.width, bounds.height)) / 512) + 1.2;
    };
    const overviewCenter = located.length ? [galleryCoordinates(located[0])[1], 25] : [0, 20];
    const showMessage = (text, canRetry = false) => {
      message.textContent = text; message.hidden = !text; retry.hidden = !canRetry;
    };
    const setControls = (enabled) => {
      [rotate, reset, zoomIn, zoomOut].forEach((button) => { button.disabled = !enabled; });
    };
    const updateRotationLabel = () => {
      rotate.textContent = rotating ? "Pause rotation" : "Resume rotation";
      rotate.setAttribute("aria-pressed", String(rotating));
    };
    updateRotationLabel();

    const canSpin = () => map && ready && rotating && (rotationExplicit || (!hovered && !focused)) && inView && pageActive &&
      !panel.hidden && !document.hidden && !dialogOpen && !photoPopup && !contextLost && !disposed && map.getZoom() <= overviewZoom() + 0.3;
    const tick = (time) => {
      frame = 0;
      if (!canSpin()) return;
      const elapsed = lastTime ? time - lastTime : 32;
      if (elapsed >= 32 && !map.isMoving()) {
        const center = map.getCenter();
        spinning = true;
        map.jumpTo({ center: [center.lng + Math.min(elapsed, 64) * 0.002, center.lat] });
        spinning = false;
        lastTime = time;
      }
      if (canSpin()) frame = window.requestAnimationFrame(tick);
    };
    const syncAnimation = () => {
      if (!canSpin()) {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0; lastTime = 0;
      } else if (!frame) { lastTime = 0; frame = window.requestAnimationFrame(tick); }
    };
    const pauseRotation = () => { rotating = false; rotationExplicit = false; updateRotationLabel(); syncAnimation(); };
    const moveCamera = (options) => {
      if (!map || contextLost) return;
      map.stop();
      map.easeTo({ ...options, duration: motion.matches ? 0 : 950 });
    };
    const highlightPhoto = () => {
      const selectedId = items.indexOf(selectedPhoto);
      photoMarkers.forEach((entry) => {
        const active = entry.info.key === activeMarkerKey || entry.info.photoId === selectedId;
        entry.element.setAttribute("data-selected", String(active));
        entry.element.style.zIndex = active ? "2" : "1";
      });
    };
    const clearPhotoMarkers = () => {
      photoMarkers.forEach((entry) => entry.marker.remove());
      photoMarkers.clear();
    };
    const closePhotoPopup = (restoreFocus = false) => {
      clickRevision++;
      const origin = popupOrigin;
      if (photoPopup) photoPopup.remove();
      if (restoreFocus) (origin && container.contains(origin) ? origin : map?.getCanvas())?.focus();
    };
    const openPhotoPopup = (photos, info, initialPhoto = photos[0]) => {
      if (!photos.length || !map || !ready) return;
      closePhotoPopup(); pauseRotation();
      const card = document.createElement("div");
      card.className = "gallery-globe-preview";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", "Photo preview");
      const close = document.createElement("button");
      close.type = "button"; close.className = "gallery-globe-preview-close";
      close.textContent = "×"; close.setAttribute("aria-label", "Close photo preview");
      close.addEventListener("click", () => closePhotoPopup(true));
      card.appendChild(close);
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.decoding = "async";
      const caption = document.createElement("figcaption");
      caption.setAttribute("aria-live", "polite");
      figure.appendChild(image); figure.appendChild(caption); card.appendChild(figure);
      const navigation = document.createElement("div");
      navigation.className = "gallery-globe-preview-navigation";
      navigation.hidden = photos.length < 2;
      const previous = document.createElement("button"), next = document.createElement("button"), count = document.createElement("span");
      previous.type = next.type = "button";
      previous.textContent = "‹"; next.textContent = "›";
      previous.setAttribute("aria-label", "Previous photo in this group");
      next.setAttribute("aria-label", "Next photo in this group");
      count.setAttribute("aria-live", "polite");
      navigation.appendChild(previous); navigation.appendChild(count); navigation.appendChild(next);
      card.appendChild(navigation);
      let index = Math.max(0, photos.indexOf(initialPhoto));
      const resizePreview = () => {
        const item = photos[index];
        const bounds = stage.getBoundingClientRect();
        const dimensions = item.width > 0 && item.height > 0 ? item : {
          width: image.complete ? image.naturalWidth : 0,
          height: image.complete ? image.naturalHeight : 0,
        };
        const size = galleryPhotoPreviewSize(dimensions, {
          width: Math.max(1, Math.min(320, bounds.width - 48, (window.innerWidth || bounds.width) - 48)),
          height: Math.max(1, Math.min(320, bounds.height - 120, (window.innerHeight || bounds.height) * 0.45)),
        });
        // Size the card itself, not just the image inside a fixed-width landscape frame.
        card.style.width = `${size.width}px`;
        image.style.height = `${size.height}px`;
        image.sizes = `${Math.ceil(size.width)}px`;
        photoPopup?.setLngLat(info.coordinates);
      };
      resizePhotoPreview = resizePreview;
      const renderPhoto = () => {
        const item = photos[index];
        selectedPhoto = item;
        image.alt = galleryDescription(item) || item.alt || "Gallery image";
        configureGalleryImage(image, item, "(max-width: 420px) 75vw, 320px");
        caption.textContent = galleryDescription(item); caption.hidden = !caption.textContent;
        count.textContent = `${index + 1} / ${photos.length}`;
        highlightPhoto();
        resizePreview();
      };
      const navigate = (step) => { index = (index + step + photos.length) % photos.length; renderPhoto(); };
      previous.addEventListener("click", () => navigate(-1));
      next.addEventListener("click", () => navigate(1));
      card.addEventListener("click", (event) => event.stopPropagation());
      card.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePhotoPopup(true); }
        else if (photos.length > 1 && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); navigate(event.key === "ArrowLeft" ? -1 : 1);
        }
      });
      activeMarkerKey = info.key;
      popupOrigin = photoMarkers.get(info.key)?.element;
      renderPhoto();
      // Native anchoring keeps the enlarged image attached to its location, not a sidebar or full-screen modal.
      const popup = new maplibre.Popup({ className: "gallery-globe-popup", closeButton: false,
        closeOnClick: false, closeOnMove: true, focusAfterOpen: true, maxWidth: "none",
        offset: 12, subpixelPositioning: true, locationOccludedOpacity: 0,
        padding: { top: 12, right: 12, bottom: 28, left: 12 } });
      photoPopup = popup;
      popup.on("close", () => {
        if (photoPopup !== popup) return;
        photoPopup = null; popupOrigin = null; activeMarkerKey = null; selectedPhoto = null; resizePhotoPreview = null;
        highlightPhoto();
      });
      popup.setLngLat(info.coordinates).setDOMContent(card).addTo(map);
      image.addEventListener("load", () => { if (photoPopup === popup) resizePreview(); });
    };
    if (!located.length) {
      stage.hidden = true;
      get("globe-hint").textContent = "No photos have GPS coordinates yet. You can still browse them in Gallery.";
    }

    const addPhotoLayers = () => {
      if (!map.getSource("gallery-photos")) map.addSource("gallery-photos", {
        type: "geojson", data: geojson, maxzoom: 19, cluster: true, clusterRadius: 44, clusterMaxZoom: 18,
        clusterProperties: { cover_id: ["min", ["get", "photo_id"]] },
      });
      // Keep the source active, but render the actual photo cards as HTML markers.
      map.addLayer({
        id: "gallery-photo-anchors", type: "circle", source: "gallery-photos",
        paint: { "circle-radius": 1, "circle-opacity": 0 },
      });
      ready = true;
      updatePhotoMarkers(); setControls(true); syncAnimation();
    };
    const onClusterClick = async (info) => {
      const cluster = info.feature;
      if (!cluster || !ready) return;
      const revision = ++clickRevision;
      pauseRotation();
      try {
        const source = map.getSource("gallery-photos");
        const leaves = await source.getClusterLeaves(cluster.properties.cluster_id, cluster.properties.point_count, 0);
        if (revision !== clickRevision || disposed || panel.hidden) return;
        const photos = leaves.map((leaf) => items[leaf.properties.photo_id]).filter(Boolean);
        photos.sort((a, b) => items.indexOf(a) - items.indexOf(b));
        openPhotoPopup(photos, info, info.item);
      } catch (_) { showMessage("That photo group could not open. Please try again, or browse Gallery."); }
    };
    const onPhotoClick = (info) => {
      const item = info.item;
      clickRevision++; pauseRotation();
      const group = groups.find((group) => group.items.includes(item));
      if (group) openPhotoPopup(group.items, info, item);
    };
    const updatePhotoMarkers = () => {
      if (!map || !ready || contextLost || disposed || panel.hidden || !map.isSourceLoaded("gallery-photos")) return;
      const visible = new Set();
      map.querySourceFeatures("gallery-photos").forEach((feature) => {
        const info = galleryPhotoMarkerInfo(feature, items);
        if (!info || visible.has(info.key)) return; // Features can appear in multiple source tiles.
        visible.add(info.key);
        let entry = photoMarkers.get(info.key);
        if (!entry) {
          const button = document.createElement("button");
          button.type = "button"; button.className = "gallery-globe-pin";
          button.setAttribute("data-cluster", String(info.clustered));
          button.setAttribute("data-photo-id", String(info.photoId));
          const image = document.createElement("img");
          image.src = info.item.small || info.item.thumb || info.item.src;
          image.alt = ""; image.decoding = "async";
          button.appendChild(image);
          const badge = document.createElement("span");
          badge.className = "gallery-globe-pin-count";
          badge.setAttribute("aria-hidden", "true");
          button.appendChild(badge);
          const marker = new maplibre.Marker({ element: button, anchor: "bottom", offset: [0, -10],
            opacityWhenCovered: 0, subpixelPositioning: true }).setLngLat(info.coordinates).addTo(map);
          entry = { marker, element: button, badge, info };
          button.addEventListener("click", (event) => {
            event.stopPropagation?.();
            return entry.info.clustered
              ? onClusterClick(entry.info)
              : onPhotoClick(entry.info);
          });
          photoMarkers.set(info.key, entry);
        }
        if (entry.info.coordinates.join(",") !== info.coordinates.join(",")) entry.marker.setLngLat(info.coordinates);
        entry.info = info;
        entry.badge.textContent = String(info.count);
        entry.badge.hidden = !info.clustered;
        const description = galleryDescription(info.item) || "Photo location";
        const label = info.clustered ? `${info.count} photos near ${description}. Click to preview.` : `View photo: ${description}`;
        entry.element.setAttribute("aria-label", label);
        entry.element.title = label;
      });
      photoMarkers.forEach((entry, key) => {
        if (!visible.has(key)) { entry.marker.remove(); photoMarkers.delete(key); }
      });
      highlightPhoto();
    };
    const resize = () => { if (map && !panel.hidden && !contextLost) { map.resize(); resizePhotoPreview?.(); syncAnimation(); } };
    const ensureGlobe = () => {
      if (map) { resize(); syncAnimation(); return Promise.resolve(); }
      if (pending) return pending;
      if (!located.length || disposed) return Promise.resolve();
      currentDark = isDark();
      showMessage("Loading globe…");
      panel.setAttribute("aria-busy", "true");
      pending = (async () => {
        try {
          const [library, style] = await Promise.all([loadLibrary(), loadBasemap(currentDark)]);
          if (panel.hidden || disposed) return;
          maplibre = library;
          map = new maplibre.Map({
            container, style: galleryGlobeStyle(style, currentDark),
            center: overviewCenter, zoom: overviewZoom(), minZoom: -1, maxZoom: 19,
            pitch: 0, bearing: 0, maxPitch: 60, cooperativeGestures: true,
            renderWorldCopies: false, attributionControl: false,
            pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
            canvasContextAttributes: { antialias: true },
          });
          map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");
          map.on("style.load", () => {
            map.setProjection({ type: "globe" });
            addPhotoLayers();
            map.setSky({ "sky-color": currentDark ? "#0f1117" : "#ffffff",
              "horizon-color": currentDark ? "#312441" : "#e8e2f2",
              "fog-color": currentDark ? "#151a29" : "#ffffff", "atmosphere-blend": 0.15 });
            panel.setAttribute("aria-busy", "false");
          });
          map.on("load", () => {
            window.clearTimeout(loadTimeout); showMessage(""); syncAnimation();
          });
          map.on("error", () => {
            showMessage("Some map details could not load. Photos are still available; retry to reload the map.", true);
            panel.setAttribute("aria-busy", "false");
          });
          map.on("render", updatePhotoMarkers);
          map.on("click", () => closePhotoPopup());
          map.on("sourcedata", (event) => { if (event.sourceId === "gallery-photos") updatePhotoMarkers(); });
          ["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach((name) => map.on(name, (event) => {
            if (event.originalEvent) { closePhotoPopup(); pauseRotation(); }
          }));
          map.on("moveend", () => { if (!spinning) syncAnimation(); });
          map.on("webglcontextlost", () => {
            closePhotoPopup();
            contextLost = true; setControls(false); syncAnimation();
            showMessage("The globe paused because its graphics context was lost. Photos remain available.");
          });
          map.on("webglcontextrestored", () => {
            contextLost = false; setControls(ready); showMessage(""); syncAnimation();
          });
          loadTimeout = window.setTimeout(() => {
            showMessage("Map details are taking longer than expected. You can keep browsing photos or retry.", true);
            panel.setAttribute("aria-busy", "false");
          }, 25000);
          if (isDark() !== currentDark) updateAppearance();
        } catch (_) {
          clearPhotoMarkers();
          if (map) map.remove();
          map = null; ready = false;
          setControls(false);
          panel.setAttribute("aria-busy", "false");
          showMessage("The globe could not load. You can still explore the photos here or in Gallery.", true);
        } finally { pending = null; }
      })();
      return pending;
    };
    const selectView = async (showGlobe) => {
      gridTab.setAttribute("aria-selected", String(!showGlobe));
      globeTab.setAttribute("aria-selected", String(showGlobe));
      gridTab.tabIndex = showGlobe ? -1 : 0; globeTab.tabIndex = showGlobe ? 0 : -1;
      gridPanel.hidden = showGlobe; panel.hidden = !showGlobe;
      if (!showGlobe) { closePhotoPopup(); if (map) map.stop(); }
      syncAnimation();
      if (showGlobe) await ensureGlobe();
      else window.requestAnimationFrame(() => layoutGalleryGrid(document.querySelector("[data-gallery-page]"), { optimize: true }));
    };
    gridTab.addEventListener("click", () => selectView(false));
    globeTab.addEventListener("click", () => selectView(true));
    [gridTab, globeTab].forEach((tab) => tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? gridTab : event.key === "End" ? globeTab : tab === gridTab ? globeTab : gridTab;
      next.focus(); return selectView(next === globeTab);
    }));
    rotate.addEventListener("click", () => {
      closePhotoPopup();
      rotating = !rotating;
      // An explicit Resume must win over hover/focus left behind by dragging the map.
      rotationExplicit = rotating;
      if (rotating) moveCamera({ zoom: overviewZoom(), bearing: 0, pitch: 0 });
      updateRotationLabel(); syncAnimation();
    });
    reset.addEventListener("click", () => {
      closePhotoPopup(); pauseRotation();
      moveCamera({ center: overviewCenter, zoom: overviewZoom(), bearing: 0, pitch: 0 });
    });
    zoomIn.addEventListener("click", () => { closePhotoPopup(); pauseRotation(); moveCamera({ zoom: Math.min(19, map.getZoom() + 1) }); });
    zoomOut.addEventListener("click", () => { closePhotoPopup(); pauseRotation(); moveCamera({ zoom: Math.max(-1, map.getZoom() - 1) }); });
    retry.addEventListener("click", () => {
      clickRevision++; styleRevision++;
      window.clearTimeout(loadTimeout); pauseRotation();
      closePhotoPopup();
      clearPhotoMarkers();
      if (map) map.remove();
      map = null; ready = false; contextLost = false;
      container.textContent = ""; setControls(false);
      return ensureGlobe();
    });
    stage.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") { hovered = true; syncAnimation(); } });
    stage.addEventListener("pointerleave", () => { hovered = false; syncAnimation(); });
    container.addEventListener("focusin", () => { focused = true; syncAnimation(); });
    container.addEventListener("focusout", (event) => { if (!container.contains(event.relatedTarget)) { focused = false; syncAnimation(); } });
    container.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-", "="].includes(event.key)) pauseRotation();
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden && map) map.stop(); syncAnimation(); });
    document.addEventListener("site:dialogchange", (event) => {
      dialogOpen = event.detail.open;
      if (dialogOpen && map) map.stop();
      syncAnimation();
    });
    motion.addEventListener("change", () => { if (motion.matches) { if (map) map.stop(); pauseRotation(); } });
    const updateAppearance = async () => {
      const revision = ++styleRevision;
      if (!map || disposed || isDark() === currentDark) return;
      const dark = isDark();
      try {
        const style = await loadBasemap(dark);
        if (revision !== styleRevision || !map || disposed) return;
        currentDark = dark; ready = false; syncAnimation();
        closePhotoPopup();
        clearPhotoMarkers();
        map.setStyle(galleryGlobeStyle(style, dark), { diff: false });
      } catch (_) {
        if (revision === styleRevision && map && !disposed) showMessage("The new map theme could not load. Photos and the current map remain available.", true);
      }
    };
    colorScheme.addEventListener("change", updateAppearance);
    if (window.MutationObserver) new window.MutationObserver(updateAppearance).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (window.ResizeObserver) new window.ResizeObserver(resize).observe(stage);
    else window.addEventListener("resize", resize);
    if (window.IntersectionObserver) new window.IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (!inView && map) map.stop();
      syncAnimation();
    }).observe(stage);
    window.addEventListener("pagehide", (event) => {
      pageActive = false; if (map) map.stop(); syncAnimation();
      if (!event.persisted) {
        disposed = true; styleRevision++; clickRevision++; window.clearTimeout(loadTimeout);
        closePhotoPopup();
        clearPhotoMarkers();
        if (map) map.remove();
      }
    });
    window.addEventListener("pageshow", () => { pageActive = true; resize(); syncAnimation(); });
    if (window.location?.hash === "#globe") selectView(true);
  }

  function getSavedGalleryOrder() {
    try {
      const raw = window.localStorage.getItem(GALLERY_PAGE_ORDER_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => typeof item === "string" && item.trim().length > 0);
    } catch (error) {
      return [];
    }
  }

  function getSavedGallerySizes() {
    try {
      const raw = window.localStorage.getItem(GALLERY_PAGE_SIZE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const clean = {};
      Object.entries(parsed).forEach(([key, value]) => {
        const num = normalizeSpan(value, Number.NaN);
        if (key && Number.isFinite(num)) clean[key] = num;
      });
      return clean;
    } catch (error) {
      return {};
    }
  }

  function parseLayoutSizes(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const clean = {};
    Object.entries(input).forEach(([key, value]) => {
      const num = normalizeSpan(value, Number.NaN);
      if (key && Number.isFinite(num)) clean[key] = num;
    });
    return clean;
  }

  function applySavedGalleryOrder(items, savedOrder) {
    if (!Array.isArray(items) || !items.length) return [];
    if (!Array.isArray(savedOrder) || !savedOrder.length) return items.slice();
    const rank = new Map(savedOrder.map((src, index) => [src, index]));
    return items
      .slice()
      .sort((a, b) => (rank.get(a.src) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.src) ?? Number.MAX_SAFE_INTEGER));
  }

  function initGalleryArrangeControls(container, galleryApi) {
    const controls = document.querySelector("[data-gallery-arrange-controls]");
    const toggleBtn = document.getElementById("gallery-arrange-toggle");
    const saveBtn = document.getElementById("gallery-arrange-save");
    const exportBtn = document.getElementById("gallery-arrange-export");
    const resetBtn = document.getElementById("gallery-arrange-reset");
    const statusEl = document.getElementById("gallery-arrange-status");
    if (!controls || !toggleBtn || !saveBtn || !exportBtn || !resetBtn || !statusEl) return;

    let arranging = false;
    let draggedId = "";
    let previewRaf = 0;
    let pendingPreview = null;

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function setArranging(next) {
      arranging = next;
      container.classList.toggle("is-arrange-mode", arranging);
      document.body.classList.toggle("is-gallery-arranging", arranging);
      toggleBtn.textContent = arranging ? "Done Arranging" : "Arrange Photos";
      saveBtn.disabled = !arranging;

      const cards = Array.from(container.querySelectorAll(".gallery-page-card"));
      cards.forEach((card) => {
        card.draggable = arranging;
        syncCardSizeUi(card);
      });
      if (arranging) setStatus("Drag to reorder. Use +/- or slider to resize each photo.");
      else setStatus(getSavedGalleryOrder().length ? "Saved order is active." : "No saved order yet.");
    }

    if (!container.__galleryArrangeBound) {
      container.__galleryArrangeBound = true;

      container.addEventListener("dragstart", (event) => {
        if (!arranging) return;
        const card = event.target.closest(".gallery-page-card");
        if (!card) return;
        draggedId = card.dataset.itemId || "";
        card.classList.add("is-dragging");
        setStatus("Dragging... release to keep this order.");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggedId);
        }
      });

      container.addEventListener("dragend", (event) => {
        const card = event.target.closest(".gallery-page-card");
        if (card) card.classList.remove("is-dragging");
        container.querySelectorAll(".gallery-page-card.is-drop-target").forEach((el) => {
          el.classList.remove("is-drop-target");
        });
        pendingPreview = null;
        if (previewRaf) {
          window.cancelAnimationFrame(previewRaf);
          previewRaf = 0;
        }
        if (arranging) setStatus("Drag to reorder. Use +/- or slider to resize each photo.");
      });

      container.addEventListener("dragover", (event) => {
        if (!arranging) return;
        event.preventDefault();
        const target = event.target.closest(".gallery-page-card");
        if (!target) return;
        if (!draggedId) return;
        container.querySelectorAll(".gallery-page-card.is-drop-target").forEach((el) => {
          if (el !== target) el.classList.remove("is-drop-target");
        });
        target.classList.add("is-drop-target");

        pendingPreview = { target, clientY: event.clientY };
        if (previewRaf) return;
        previewRaf = window.requestAnimationFrame(() => {
          previewRaf = 0;
          if (!pendingPreview) return;
          applyPreviewMove(pendingPreview.target, pendingPreview.clientY);
        });
      });

      container.addEventListener("drop", (event) => {
        if (!arranging) return;
        event.preventDefault();
        const target = event.target.closest(".gallery-page-card");
        if (target) {
          target.classList.remove("is-drop-target");
          applyPreviewMove(target, event.clientY);
        }
        layoutGalleryGrid(container);
        galleryApi?.refresh?.();
      });

      container.addEventListener("click", (event) => {
        if (!arranging) return;
        const btn = event.target.closest(".gallery-size-btn");
        if (!btn) return;
        const card = btn.closest(".gallery-page-card");
        if (!card) return;
        event.preventDefault();
        event.stopPropagation();
        const step = btn.dataset.action === "increase" ? BUTTON_SPAN_STEP : -BUTTON_SPAN_STEP;
        const current = normalizeSpan(card.dataset.span || card.dataset.defaultSpan, 2);
        const next = normalizeSpan(current + step, current);
        card.dataset.span = spanToString(next);
        syncCardSizeUi(card);
        layoutGalleryGrid(container);
        galleryApi?.refresh?.();
      });

      container.addEventListener("input", (event) => {
        if (!arranging) return;
        const slider = event.target.closest(".gallery-size-slider");
        if (!slider) return;
        const card = slider.closest(".gallery-page-card");
        if (!card) return;
        const next = normalizeSpan(slider.value || card.dataset.span || card.dataset.defaultSpan, 2);
        card.dataset.span = spanToString(next);
        syncCardSizeUi(card);
        layoutGalleryGrid(container);
        galleryApi?.refresh?.();
      });

      function applyPreviewMove(target, clientY) {
        const cards = Array.from(container.querySelectorAll(".gallery-page-card"));
        const dragged = cards.find((card) => card.dataset.itemId === draggedId);
        if (!dragged || !target || dragged === target) return;

        const rect = target.getBoundingClientRect();
        const insertAfter = clientY > rect.top + rect.height / 2;
        if (insertAfter) {
          if (target.nextElementSibling === dragged) return;
          target.after(dragged);
        } else {
          if (target.previousElementSibling === dragged) return;
          target.before(dragged);
        }
        layoutGalleryGrid(container);
        galleryApi?.refresh?.();
      }
    }

    toggleBtn.onclick = () => {
      setArranging(!arranging);
    };

    saveBtn.onclick = () => {
      const order = Array.from(container.querySelectorAll(".gallery-page-card"))
        .map((card) => card.dataset.itemId || "")
        .filter(Boolean);
      window.localStorage.setItem(GALLERY_PAGE_ORDER_KEY, JSON.stringify(order));
      const sizes = {};
      Array.from(container.querySelectorAll(".gallery-page-card")).forEach((card) => {
        const id = card.dataset.itemId || "";
        const span = normalizeSpan(card.dataset.span || card.dataset.defaultSpan, 2);
        if (id) sizes[id] = span;
      });
      window.localStorage.setItem(GALLERY_PAGE_SIZE_KEY, JSON.stringify(sizes));
      setStatus("Order saved.");
      setArranging(false);
    };

    exportBtn.onclick = () => {
      const layout = collectCurrentLayout(container);
      const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "layout.json";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setStatus("Exported layout.json. Put it at assets/gallery/layout.json before deploy.");
    };

    resetBtn.onclick = () => {
      window.localStorage.removeItem(GALLERY_PAGE_ORDER_KEY);
      window.localStorage.removeItem(GALLERY_PAGE_SIZE_KEY);
      Array.from(container.querySelectorAll(".gallery-page-card")).forEach((card) => {
        const fallback = normalizeSpan(card.dataset.defaultSpan, 2);
        card.dataset.span = spanToString(fallback);
        syncCardSizeUi(card);
      });
      layoutGalleryGrid(container);
      galleryApi?.refresh?.();
      setStatus("Saved order and sizes cleared.");
    };

    setArranging(false);
  }

  function collectCurrentLayout(container) {
    const order = Array.from(container.querySelectorAll(".gallery-page-card"))
      .map((card) => card.dataset.itemId || "")
      .filter(Boolean);
    const sizes = {};
    Array.from(container.querySelectorAll(".gallery-page-card")).forEach((card) => {
      const id = card.dataset.itemId || "";
      const span = normalizeSpan(card.dataset.span || card.dataset.defaultSpan, 2);
      if (id) sizes[id] = span;
    });
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      order,
      sizes,
    };
  }

  function shuffleArray(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function createGallerySizeControl(figure) {
    const wrap = document.createElement("div");
    wrap.className = "gallery-size-control";

    const dec = document.createElement("button");
    dec.className = "gallery-size-btn";
    dec.type = "button";
    dec.dataset.action = "decrease";
    dec.textContent = "−";

    const slider = document.createElement("input");
    slider.className = "gallery-size-slider";
    slider.type = "range";
    slider.min = String(MIN_CARD_SPAN);
    slider.max = String(MAX_CARD_SPAN);
    slider.step = String(SPAN_STEP);
    slider.value = figure.dataset.span || figure.dataset.defaultSpan || "2";
    slider.setAttribute("aria-label", "Adjust image size");

    const inc = document.createElement("button");
    inc.className = "gallery-size-btn";
    inc.type = "button";
    inc.dataset.action = "increase";
    inc.textContent = "+";

    const label = document.createElement("span");
    label.className = "gallery-size-value";
    label.textContent = slider.value;

    wrap.appendChild(dec);
    wrap.appendChild(slider);
    wrap.appendChild(inc);
    wrap.appendChild(label);
    return wrap;
  }

  function syncCardSizeUi(card) {
    if (!card) return;
    const control = card.querySelector(".gallery-size-control");
    if (!control) return;
    const span = normalizeSpan(card.dataset.span || card.dataset.defaultSpan, 2);
    const slider = control.querySelector(".gallery-size-slider");
    const valueEl = control.querySelector(".gallery-size-value");
    if (slider) slider.value = spanToString(span);
    if (valueEl) valueEl.textContent = spanToString(span);
  }

  function normalizeSpan(value, fallback = 2) {
    const num = Number.parseFloat(String(value));
    if (!Number.isFinite(num)) return fallback;
    const clamped = Math.max(MIN_CARD_SPAN, Math.min(MAX_CARD_SPAN, num));
    return Math.round(clamped / SPAN_STEP) * SPAN_STEP;
  }

  function spanToString(span) {
    const rounded = Math.round(span * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 0.00001) return String(Math.round(rounded));
    return rounded.toFixed(1);
  }

  function initGalleryCarousel() {
    const track = document.getElementById("auto-gallery");
    const prevBtn = document.getElementById("gallery-prev");
    const nextBtn = document.getElementById("gallery-next");
    const viewport = track?.closest(".gallery-viewport");
    const carouselRoot = track?.closest(".gallery-carousel");
    const autoplayBtn = document.getElementById("gallery-autoplay");
    const autoplayIcon = document.getElementById("gallery-autoplay-icon");
    const positionEl = document.getElementById("gallery-position");
    const currentEl = document.getElementById("gallery-current");
    const totalEl = document.getElementById("gallery-total");
    const progressEl = document.getElementById("gallery-progress-fill");
    if (!track || !viewport || !carouselRoot || !prevBtn || !nextBtn) return null;

    const slides = Array.from(track.querySelectorAll(".gallery-card:not(.gallery-loading)"));
    const total = slides.length;
    const formatIndex = (value) => String(value).padStart(2, "0");
    const hasDescriptions = slides.some((slide) => Boolean(slide.querySelector(".gallery-trigger")?.getAttribute("data-description")));
    carouselRoot.classList.toggle("has-descriptions", hasDescriptions);

    function setUi(selectedIndex) {
      const safeIndex = total ? ((selectedIndex % total) + total) % total : 0;
      slides.forEach((slide, index) => {
        const isActive = index === safeIndex;
        slide.classList.toggle("is-active", isActive);
        slide.setAttribute("role", "group");
        slide.setAttribute("aria-roledescription", "slide");
        slide.setAttribute("aria-label", `${index + 1} of ${total}`);
        if (isActive) slide.setAttribute("aria-current", "true");
        else slide.removeAttribute("aria-current");
        const trigger = slide.querySelector(".gallery-trigger");
        if (trigger) trigger.tabIndex = isActive ? 0 : -1;
        // Warm the selected image and its neighbors before the next autoplay step.
        if ([safeIndex, (safeIndex + 1) % total, (safeIndex - 1 + total) % total].includes(index)) {
          const img = slide.querySelector("img");
          if (img) img.loading = "eager";
        }
      });
      if (currentEl) currentEl.textContent = formatIndex(total ? safeIndex + 1 : 0);
      if (totalEl) totalEl.textContent = formatIndex(total);
      if (progressEl) progressEl.style.transform = `scaleX(${total ? (safeIndex + 1) / total : 0})`;
      prevBtn.disabled = total <= 1;
      nextBtn.disabled = total <= 1;
    }

    function setupAutoplay(goNext) {
      if (!autoplayBtn || total <= 1) {
        if (autoplayBtn) autoplayBtn.disabled = true;
        return;
      }

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let userPaused = reducedMotion.matches;
      let focusPaused = false;
      let pauseButtonState = null;
      let dialogPaused = Boolean(document.querySelector(".lightbox.is-open, .bibtex-modal.is-open"));
      let hoverPaused = false;
      let pointerPaused = false;
      let pageVisible = !document.hidden;
      let carouselVisible = !("IntersectionObserver" in window);
      let timer = null;

      function updateButton() {
        const paused = userPaused || focusPaused;
        if (autoplayIcon) autoplayIcon.textContent = paused ? "▶" : "Ⅱ";
        const label = paused ? "Start automatic slideshow" : "Pause automatic slideshow";
        autoplayBtn.setAttribute("aria-label", label);
        autoplayBtn.title = label;
        if (positionEl) positionEl.setAttribute("aria-live", paused ? "polite" : "off");
      }

      function stop() {
        if (!timer) return;
        window.clearInterval(timer);
        timer = null;
      }

      function reconcile() {
        stop();
        if (userPaused || focusPaused || dialogPaused || hoverPaused || pointerPaused || !pageVisible || !carouselVisible) return;
        timer = window.setInterval(goNext, 2000);
      }

      autoplayBtn.addEventListener("pointerdown", () => {
        pauseButtonState = userPaused || focusPaused;
      });
      autoplayBtn.addEventListener("pointercancel", () => { pauseButtonState = null; });
      autoplayBtn.addEventListener("click", () => {
        userPaused = !(pauseButtonState ?? (userPaused || focusPaused));
        pauseButtonState = null;
        focusPaused = false;
        updateButton();
        reconcile();
      });

      carouselRoot.addEventListener("focusin", () => {
        focusPaused = true;
        updateButton();
        reconcile();
      });
      document.addEventListener("site:dialogchange", (event) => {
        dialogPaused = event.detail.open;
        reconcile();
      });

      carouselRoot.addEventListener("mouseenter", () => {
        hoverPaused = true;
        reconcile();
      });
      carouselRoot.addEventListener("mouseleave", () => {
        hoverPaused = false;
        reconcile();
      });
      viewport.addEventListener("pointerdown", () => {
        pointerPaused = true;
        reconcile();
      });
      const resumeAfterPointer = () => {
        pointerPaused = false;
        window.setTimeout(reconcile, 180);
      };
      window.addEventListener("pointerup", resumeAfterPointer);
      window.addEventListener("pointercancel", resumeAfterPointer);

      document.addEventListener("visibilitychange", () => {
        pageVisible = !document.hidden;
        reconcile();
      });
      reducedMotion.addEventListener("change", (event) => {
        if (event.matches) userPaused = true;
        updateButton();
        reconcile();
      });

      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
          ([entry]) => {
            carouselVisible = Boolean(entry?.isIntersecting);
            reconcile();
          },
          { threshold: 0.2 }
        );
        observer.observe(carouselRoot);
      }

      updateButton();
      reconcile();
    }

    if (!total) {
      setUi(0);
      return null;
    }

    if (typeof window.EmblaCarousel !== "function") {
      let fallbackIndex = 0;
      const syncFallbackEdges = () => {
        track.style.setProperty("--gallery-start-space", `${Math.max(0, (viewport.clientWidth - slides[0].clientWidth) / 2)}px`);
        track.style.setProperty("--gallery-end-space", `${Math.max(0, (viewport.clientWidth - slides[total - 1].clientWidth) / 2)}px`);
      };
      const showFallback = (nextIndex) => {
        const previousIndex = fallbackIndex;
        fallbackIndex = ((nextIndex % total) + total) % total;
        const slide = slides[fallbackIndex];
        if (slide) viewport.scrollTo({
          left: viewport.scrollLeft + slide.getBoundingClientRect().left - viewport.getBoundingClientRect().left - (viewport.clientWidth - slide.clientWidth) / 2,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(fallbackIndex - previousIndex) > 1 ? "auto" : "smooth",
        });
        setUi(fallbackIndex);
      };
      let scrollFrame = null;
      const syncFallbackScroll = () => {
        scrollFrame = null;
        const center = viewport.getBoundingClientRect().left + viewport.clientWidth / 2;
        let nearest = fallbackIndex;
        let distance = Infinity;
        slides.forEach((slide, index) => {
          const rect = slide.getBoundingClientRect();
          const delta = Math.abs(rect.left + rect.width / 2 - center);
          if (delta < distance) { nearest = index; distance = delta; }
        });
        if (nearest !== fallbackIndex) {
          fallbackIndex = nearest;
          setUi(fallbackIndex);
        }
      };
      viewport.addEventListener("scroll", () => {
        if (scrollFrame !== null) return;
        scrollFrame = window.requestAnimationFrame(syncFallbackScroll);
      }, { passive: true });
      prevBtn.addEventListener("click", () => showFallback(fallbackIndex - 1));
      nextBtn.addEventListener("click", () => showFallback(fallbackIndex + 1));
      track.addEventListener("click", (event) => {
        const slide = event.target.closest(".gallery-card");
        if (!slide || slide.classList.contains("is-active")) return;
        event.preventDefault();
        const index = slides.indexOf(slide);
        if (index >= 0) showFallback(index);
      });
      viewport.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        showFallback(fallbackIndex + (event.key === "ArrowRight" ? 1 : -1));
      });
      window.addEventListener("resize", () => {
        syncFallbackEdges();
        showFallback(fallbackIndex);
      });
      syncFallbackEdges();
      showFallback(0);
      setupAutoplay(() => showFallback(fallbackIndex + 1));
      return { refresh: () => { syncFallbackEdges(); showFallback(fallbackIndex); } };
    }

    carouselRoot.classList.add("is-enhanced");
    const embla = window.EmblaCarousel(viewport, {
      align: "center",
      loop: total > 2,
      skipSnaps: false,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 28,
    });

    const sync = () => setUi(embla.selectedScrollSnap());
    prevBtn.addEventListener("click", () => embla.scrollPrev());
    nextBtn.addEventListener("click", () => embla.scrollNext());

    track.addEventListener("click", (event) => {
      const slide = event.target.closest(".gallery-card");
      if (!slide || slide.classList.contains("is-active")) return;
      event.preventDefault();
      const index = slides.indexOf(slide);
      if (index >= 0) embla.scrollTo(index);
    });

    viewport.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        embla.scrollPrev();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        embla.scrollNext();
      }
    });

    let lastHorizontalWheelAt = 0;
    viewport.addEventListener(
      "wheel",
      (event) => {
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 18) return;
        event.preventDefault();
        const now = Date.now();
        if (now - lastHorizontalWheelAt < 420) return;
        lastHorizontalWheelAt = now;
        if (event.deltaX > 0) embla.scrollNext();
        else embla.scrollPrev();
      },
      { passive: false }
    );

    embla.on("select", sync);
    embla.on("reInit", sync);
    sync();
    setupAutoplay(() => embla.scrollNext());

    return {
      refresh: () => {
        embla.reInit();
        sync();
      },
    };
  }

  function parseBibtexEntries(rawText) {
    const entries = [];
    const lines = rawText.split(/\r?\n/);
    let current = null;

    for (const lineRaw of lines) {
      const line = lineRaw.trim();
      if (!line) continue;

      if (line.startsWith("@")) {
        const match = line.match(/^@(\w+)\s*\{\s*([^,]+),?/);
        if (match) {
          current = {
            type: match[1].toLowerCase(),
            key: match[2].trim(),
            fields: {},
            rawLines: [lineRaw],
          };
        }
        continue;
      }

      if (!current) continue;

      if (line === "}") {
        current.rawLines.push(lineRaw);
        entries.push(current);
        current = null;
        continue;
      }

      current.rawLines.push(lineRaw);
      const fieldMatch = line.match(/^(\w+)\s*=\s*\{([\s\S]*)\}\s*,?$/);
      if (fieldMatch) {
        const key = fieldMatch[1].toLowerCase();
        current.fields[key] = fieldMatch[2].trim();
      }
    }

    return entries.map((entry) => {
      const venue = entry.fields.booktitle || entry.fields.journal || entry.fields.organization || "Publication";
      const year = Number.parseInt(entry.fields.year || "0", 10) || 0;
      return {
        ...entry,
        year,
        title: entry.fields.title || "(Untitled)",
        authors: entry.fields.author || "(Unknown authors)",
        venue,
        rawBibtex: entry.rawLines.join("\n"),
      };
    });
  }

  const EXTRA_LINK_FIELDS = ["poster", "talk", "dataset", "code", "slides", "video", "website", "project"];
  const NON_CITE_FIELDS = new Set([
    "tag",
    "selected",
    "topic",
    "cat",
    "equal_contribution",
    ...EXTRA_LINK_FIELDS,
    "url",
  ]);

  function splitTags(rawTag) {
    if (!rawTag) return [];
    return rawTag
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function labelForField(fieldName) {
    if (fieldName === "url") return "Paper";
    return fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  }

  function isSelectedEntry(entry) {
    const selectedRaw = (entry.fields.selected || "").trim().toLowerCase();
    return selectedRaw === "true" || selectedRaw === "yes" || selectedRaw === "1";
  }

  function buildCiteBibtex(entry) {
    const preferred = ["title", "author", "journal", "booktitle", "year", "volume", "number", "pages", "organization"];
    const lines = [`@${entry.type}{${entry.key},`];
    const used = new Set();

    preferred.forEach((field) => {
      if (!entry.fields[field] || NON_CITE_FIELDS.has(field)) return;
      lines.push(`  ${field}={${entry.fields[field]}},`);
      used.add(field);
    });

    Object.keys(entry.fields).forEach((field) => {
      if (used.has(field) || NON_CITE_FIELDS.has(field)) return;
      lines.push(`  ${field}={${entry.fields[field]}},`);
    });

    if (lines.length > 1) {
      const lastIdx = lines.length - 1;
      lines[lastIdx] = lines[lastIdx].replace(/,$/, "");
    }
    lines.push("}");
    return lines.join("\n");
  }

  function normalizeAuthorName(author) {
    const trimmed = author.trim();
    if (!trimmed) return "";
    if (/^others$/i.test(trimmed)) return "et al.";
    if (trimmed.includes(",")) {
      const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return `${parts.slice(1).join(" ")} ${parts[0]}`.replace(/\s+/g, " ").trim();
      }
    }
    return trimmed;
  }

  function splitAndNormalizeAuthors(authorField) {
    const authors = authorField
      .split(/\s+and\s+/i)
      .map((s) => normalizeAuthorName(s))
      .filter(Boolean);
    return authors;
  }

  function firstAuthors(authorField) {
    const authors = splitAndNormalizeAuthors(authorField);
    const hasEtAl = authors.some((a) => a.toLowerCase() === "et al.");
    const cleanAuthors = authors.filter((a) => a.toLowerCase() !== "et al.");
    const base = cleanAuthors.join(", ");
    if (hasEtAl) return base ? `${base}, et al.` : "et al.";
    return base;
  }

  function isMyName(authorName) {
    return authorName.trim().toLowerCase() === "yichuan deng";
  }

  function renderPublicationItem(entry, { compact = false } = {}) {
    const article = document.createElement("article");
    article.className = compact ? "pub-item pub-item--compact" : "pub-item";

    const tagsRow = document.createElement("div");
    tagsRow.className = "pub-tags";
    const tags = splitTags(entry.fields.tag);
    const finalTags = tags.length ? tags : [entry.year ? `${entry.venue} ${entry.year}` : entry.venue];
    finalTags.forEach((tagText) => {
      const tag = document.createElement("span");
      tag.className = "pub-meta";
      tag.textContent = tagText;
      tagsRow.appendChild(tag);
    });

    const title = document.createElement("h3");
    title.textContent = entry.title;

    const authors = document.createElement("p");
    authors.className = "pub-authors";
    const authorNames = splitAndNormalizeAuthors(entry.authors);
    const hasEtAl = authorNames.some((a) => a.toLowerCase() === "et al.");
    const cleanNames = authorNames.filter((a) => a.toLowerCase() !== "et al.");
    const equalContributionCount = Math.min(
      cleanNames.length,
      Math.max(0, Number.parseInt(entry.fields.equal_contribution || "0", 10) || 0)
    );
    const compactIndices = cleanNames.map((name, index) => index)
      .filter((index) => index < Math.max(3, equalContributionCount) || isMyName(cleanNames[index]));
    const canCollapse = cleanNames.length > 8 && compactIndices.length < cleanNames.length;
    const renderAuthors = (expanded) => {
      authors.replaceChildren();
      const indices = canCollapse && !expanded ? compactIndices : cleanNames.map((name, index) => index);
      let previous = -1;
      indices.forEach((index, position) => {
        if (position > 0) authors.append(index > previous + 1 ? ", …, " : ", ");
        const name = cleanNames[index];
        if (isMyName(name)) {
          const strong = document.createElement("strong");
          strong.textContent = name;
          authors.appendChild(strong);
        } else authors.append(name);
        if (index < equalContributionCount) {
          const marker = document.createElement("sup");
          marker.className = "equal-contribution-marker";
          marker.textContent = "*";
          marker.title = "Equal contribution";
          authors.appendChild(marker);
        }
        previous = index;
      });
      if (previous < cleanNames.length - 1) authors.append(", …");
      if (hasEtAl) authors.append(cleanNames.length ? ", et al." : "et al.");
    };
    renderAuthors(false);
    let authorsToggle = null;
    if (canCollapse) {
      authors.id = `authors-${entry.key}`;
      authorsToggle = document.createElement("button");
      authorsToggle.type = "button";
      authorsToggle.className = "authors-toggle";
      authorsToggle.textContent = `Show all ${cleanNames.length} authors`;
      authorsToggle.setAttribute("aria-expanded", "false");
      authorsToggle.setAttribute("aria-controls", authors.id);
      authorsToggle.addEventListener("click", () => {
        const expanded = authorsToggle.getAttribute("aria-expanded") !== "true";
        authorsToggle.setAttribute("aria-expanded", String(expanded));
        authorsToggle.textContent = expanded ? "Show fewer authors" : `Show all ${cleanNames.length} authors`;
        renderAuthors(expanded);
      });
    }

    let contributionNote = null;
    if (equalContributionCount > 0) {
      contributionNote = document.createElement("p");
      contributionNote.className = "equal-contribution-note";
      contributionNote.textContent = "* Equal contribution";
    }

    const links = document.createElement("div");
    links.className = "pub-links";

    const primaryUrl = entry.fields.url;
    if (primaryUrl) {
      const paperLink = document.createElement("a");
      paperLink.href = primaryUrl;
      paperLink.textContent = labelForField("url");
      paperLink.target = "_blank";
      paperLink.rel = "noopener noreferrer";
      links.appendChild(paperLink);
    }

    EXTRA_LINK_FIELDS.forEach((field) => {
      const url = entry.fields[field];
      if (!url) return;
      const link = document.createElement("a");
      link.href = url;
      link.textContent = labelForField(field);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      links.appendChild(link);
    });

    const bibtexBtn = document.createElement("button");
    bibtexBtn.className = "bibtex-btn";
    bibtexBtn.type = "button";
    bibtexBtn.textContent = "Cite";
    bibtexBtn.setAttribute("data-bibtex", buildCiteBibtex(entry));
    links.appendChild(bibtexBtn);

    if (compact) {
      const authorRow = document.createElement("div");
      authorRow.className = "pub-author-row";
      authorRow.appendChild(authors);
      if (authorsToggle) authorRow.appendChild(authorsToggle);
      const details = document.createElement("div");
      details.className = "pub-details";
      details.appendChild(tagsRow);
      if (contributionNote) details.appendChild(contributionNote);
      details.appendChild(links);
      article.append(title, authorRow, details);
    } else {
      article.append(tagsRow, title, authors);
      if (authorsToggle) article.appendChild(authorsToggle);
      if (contributionNote) article.appendChild(contributionNote);
      article.appendChild(links);
    }
    return article;
  }

  function groupPublicationsByCategory(entries) {
    const groups = new Map();
    entries.forEach((entry) => {
      const category = (entry.fields.cat || "").trim() || "Other Publications";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(entry);
    });
    return Array.from(groups, ([category, items]) => ({
      category,
      entries: items.slice().sort((a, b) => b.year - a.year),
    }));
  }

  function renderGroupedPublications(container, entries) {
    const groups = groupPublicationsByCategory(entries);
    groups.forEach((group, index) => {
      const section = document.createElement("section");
      section.className = "pub-category";
      const heading = document.createElement("div");
      heading.className = "pub-category-heading";
      const title = document.createElement("h2");
      title.id = `${container.id || "publications"}-category-${index + 1}`;
      title.textContent = group.category;
      section.setAttribute("aria-labelledby", title.id);
      const count = document.createElement("span");
      count.className = "pub-category-count";
      count.textContent = `${group.entries.length} ${group.entries.length === 1 ? "paper" : "papers"}`;
      heading.append(title, count);
      section.appendChild(heading);
      if (group.category === "Theory & ML") {
        const note = document.createElement("p");
        note.className = "pub-category-note";
        note.id = `${title.id}-note`;
        note.textContent = "Authors are listed alphabetically. All authors contributed equally.";
        section.setAttribute("aria-describedby", note.id);
        section.appendChild(note);
      }
      const list = document.createElement("div");
      list.className = "pub-list";
      group.entries.forEach((entry) => list.appendChild(renderPublicationItem(entry, { compact: true })));
      section.appendChild(list);
      container.appendChild(section);
    });
  }

  async function initPublicationsFromBibtex() {
    const containers = Array.from(document.querySelectorAll("[data-publications]"));
    if (!containers.length) return;

    try {
      const response = await fetch("bibtex/yichuan_deng.bib", { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load bibtex: ${response.status}`);
      const rawText = await response.text();
      const entries = parseBibtexEntries(rawText);
      const sortedEntries = entries.slice().sort((a, b) => b.year - a.year);
      const selectedEntries = sortedEntries.filter(isSelectedEntry);
      const hasExplicitSelected = selectedEntries.length > 0;

      containers.forEach((container) => {
        const mode = container.getAttribute("data-publications");
        const limit = Number.parseInt(container.getAttribute("data-limit") || "0", 10);
        let list = sortedEntries;
        if (mode === "selected") {
          list = hasExplicitSelected ? selectedEntries : sortedEntries;
          if (limit > 0) list = list.slice(0, limit);
        }

        container.innerHTML = "";
        if (!list.length) {
          const emptyItem = document.createElement("article");
          emptyItem.className = "pub-item pub-loading";
          emptyItem.innerHTML = "<p>No publications found in bibtex/yichuan_deng.bib.</p>";
          container.appendChild(emptyItem);
          return;
        }

        if (mode === "all" && container.getAttribute("data-group-by") === "category") {
          renderGroupedPublications(container, entries);
          return;
        }

        list.forEach((entry) => {
          container.appendChild(renderPublicationItem(entry));
        });
      });
    } catch (error) {
      containers.forEach((container) => {
        container.innerHTML = "";
        const failedItem = document.createElement("article");
        failedItem.className = "pub-item pub-loading";
        failedItem.innerHTML = "<p>Failed to load publications from bibtex/yichuan_deng.bib.</p>";
        container.appendChild(failedItem);
      });
    }
  }

  function initBibtexModal() {
    const modal = document.getElementById("bibtex-modal");
    const backdrop = modal?.querySelector(".bibtex-backdrop");
    const closeBtn = document.getElementById("bibtex-close");
    const codeEl = document.getElementById("bibtex-code");
    const copyBtn = document.getElementById("copy-bibtex-btn");

    if (!modal || !backdrop || !closeBtn || !codeEl || !copyBtn) return;

    let lastFocusedEl = null;

    function openModal(rawBibtex) {
      codeEl.textContent = rawBibtex.replace(/\\n/g, "\n");
      copyBtn.textContent = "Copy";
      lastFocusedEl = document.activeElement;
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      refreshBodyScrollLock();
      copyBtn.focus();
    }

    function closeModal() {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      refreshBodyScrollLock();
      if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
        lastFocusedEl.focus();
      }
    }

    async function copyBibtex() {
      const text = codeEl.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        const temp = document.createElement("textarea");
        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
      }
      copyBtn.textContent = "Copied!";
      window.setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1200);
    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest(".bibtex-btn");
      if (!button) return;
      const rawBibtex = button.getAttribute("data-bibtex") || "";
      if (!rawBibtex) return;
      openModal(rawBibtex);
    });

    closeBtn.addEventListener("click", closeModal);
    backdrop.addEventListener("click", closeModal);
    copyBtn.addEventListener("click", copyBibtex);

    document.addEventListener("keydown", (event) => {
      if (!modal.classList.contains("is-open")) return;
      trapDialogFocus(event, modal);
      if (event.key === "Escape") closeModal();
    });
  }

  // ---------------------------------------------------------------------------
  // Content from Markdown
  // ---------------------------------------------------------------------------

  function parseContentFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { meta: {}, body: raw };

    const yamlBlock = match[1];
    const body = match[2].trim();
    const meta = {};
    let currentKey = null;
    let currentList = null;
    let currentObj = null;

    for (const line of yamlBlock.split(/\r?\n/)) {
      // List item with key:value (nested object field)
      const nestedMatch = line.match(/^    (\w[\w_]*):\s*(.*)$/);
      if (nestedMatch && currentList !== null) {
        if (currentObj) currentObj[nestedMatch[1]] = nestedMatch[2].trim();
        continue;
      }

      // List item (simple or start of object)
      const listMatch = line.match(/^  - (?:(\w[\w_]*):\s*(.*)|(.*))$/);
      if (listMatch && currentKey) {
        if (!currentList) {
          currentList = [];
          meta[currentKey] = currentList;
        }
        if (listMatch[1]) {
          // Start of object item: "  - key: value"
          currentObj = { [listMatch[1]]: listMatch[2].trim() };
          currentList.push(currentObj);
        } else {
          // Simple list item: "  - value"
          currentObj = null;
          currentList.push(listMatch[3].trim());
        }
        continue;
      }

      // Top-level key: value
      const kvMatch = line.match(/^(\w[\w_]*):\s*(.*)$/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        currentObj = null;
        currentList = null;
        const val = kvMatch[2].trim();
        if (val) {
          meta[currentKey] = val;
        }
        continue;
      }
    }

    return { meta, body };
  }

  function markdownToHtml(md) {
    return md
      .split(/\n{2,}/)
      .map((block) => {
        const html = block
          .trim()
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>");
        return `<p class="lead">${html}</p>`;
      })
      .filter((p) => p !== '<p class="lead"></p>')
      .join("\n");
  }

  const EMAIL_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 6h18v12H3z" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8"/>
  </svg>`;

  const SCHOLAR_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3 2.5 9 12 15 21.5 9z" fill="currentColor"/>
    <circle cx="12" cy="16.8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M16 20.5v-2.3" fill="none" stroke="currentColor" stroke-width="1.8"/>
  </svg>`;

  function populateContent(meta, bodyHtml) {
    // Logo / name
    const logo = document.getElementById("site-logo");
    if (logo) logo.textContent = meta.name?.split("(")[0]?.trim() || meta.name || "";

    // About text
    const aboutText = document.getElementById("about-text");
    if (aboutText) aboutText.innerHTML = bodyHtml;

    // Profile card
    const photo = document.getElementById("profile-photo");
    if (photo && meta.photo) {
      photo.srcset = meta.photo_srcset || "";
      photo.sizes = meta.photo_srcset ? "(max-width: 900px) 160px, 200px" : "";
      photo.src = meta.photo_preview || meta.photo;
      photo.alt = "Portrait of " + (meta.name || "");
    }
    const pName = document.getElementById("profile-name");
    if (pName) pName.textContent = meta.name || "";
    const pTitle = document.getElementById("profile-title");
    if (pTitle) pTitle.textContent = meta.title || "";
    const affiliation = document.getElementById("profile-affiliation");
    if (affiliation) affiliation.textContent = meta.education?.[0]?.school || "";

    // Contact row
    const contactRow = document.getElementById("contact-row");
    if (contactRow) {
      contactRow.innerHTML = "";
      if (meta.email) {
        const a = document.createElement("a");
        a.className = "social-icon";
        a.href = "mailto:" + meta.email.replace(/\s+AT\s+/i, "@").replace(/\s+/g, "");
        a.setAttribute("aria-label", "Email");
        a.title = "Email";
        a.innerHTML = EMAIL_SVG;
        const label = document.createElement("span");
        label.textContent = "Email";
        a.appendChild(label);
        contactRow.appendChild(a);
      }
      if (meta.scholar) {
        const a = document.createElement("a");
        a.className = "social-icon";
        a.href = meta.scholar;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("aria-label", "Google Scholar");
        a.title = "Google Scholar";
        a.innerHTML = SCHOLAR_SVG;
        const label = document.createElement("span");
        label.textContent = "Google Scholar";
        a.appendChild(label);
        contactRow.appendChild(a);
      }
    }

    // Research interests
    const riList = document.getElementById("research-interests");
    if (riList && Array.isArray(meta.research_interests)) {
      riList.innerHTML = "";
      meta.research_interests.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        riList.appendChild(li);
      });
    }

    // Education
    const eduList = document.getElementById("education-list");
    if (eduList && Array.isArray(meta.education)) {
      eduList.innerHTML = "";
      meta.education.forEach((edu) => {
        const article = document.createElement("article");
        article.className = "education-item";

        const img = document.createElement("img");
        img.className = "school-logo";
        img.src = edu.logo || "";
        img.alt = edu.logo_alt || "";

        const div = document.createElement("div");

        const h3 = document.createElement("h3");
        h3.textContent = edu.degree || "";

        const year = document.createElement("p");
        year.className = "edu-year";
        year.textContent = edu.year || "";

        const college = document.createElement("a");
        college.className = "edu-college";
        college.href = edu.college_url || "#";
        college.target = "_blank";
        college.rel = "noopener noreferrer";
        college.textContent = edu.college || "";

        const school = document.createElement("a");
        school.className = "edu-school";
        school.href = edu.school_url || "#";
        school.target = "_blank";
        school.rel = "noopener noreferrer";
        school.textContent = edu.school || "";

        div.append(h3, year, college, school);
        article.append(img, div);
        eduList.appendChild(article);
      });
    }

    // Footer
    const footer = document.getElementById("footer-text");
    if (footer) footer.textContent = meta.footer || "";
  }

  async function initContentFromMarkdown() {
    try {
      const response = await fetch("content.md", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load content.md: " + response.status);
      const raw = await response.text();
      const { meta, body } = parseContentFrontmatter(raw);
      const bodyHtml = markdownToHtml(body);
      populateContent(meta, bodyHtml);
    } catch (err) {
      console.error("Content loading failed:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  initThemeToggle();
  initSmoothAnchorScroll();
  initContentFromMarkdown();
  const galleryApi = initGalleryLightbox();
  initGalleryFromManifest(galleryApi).then(() => {
    initGalleryCarousel();
  });
  initGalleryPageFromManifest(galleryApi).then(() => initGalleryGlobe());
  initPublicationsFromBibtex();
  initBibtexModal();
})();
