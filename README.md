# Static Academic Homepage

This folder contains a from-scratch static academic homepage.

This repo is 100% developed with Cursor. Please let me know if there is any infringement issue.

## Included sections

- About (personal introduction)
- Publications (selected papers with links)
- Gallery (local photography, with uncropped previews and a full gallery)

## Preview

### macOS / Linux

Run `python3 -m http.server 1313 --bind 127.0.0.1` from this folder, then open
`http://127.0.0.1:1313/`. Stop the preview with Ctrl+C.

To regenerate the gallery's responsive WebP previews (800/1600px), lightbox images
(up to 2560px), dimensions, and 400/800px portrait variants, run
`python3 scripts/build-gallery.py` (requires Pillow: `python3 -m pip install Pillow`).
This preserves originals and existing manifest order/captions; new photos are appended.

### One-command local preview (like `hugo server`)

From this folder, run:

- `npm run preview`

or directly:

- `.\preview.bat`
- `.\preview.ps1`

This will:

- Try `http://localhost:1313` first
- Auto-switch to the next free port if occupied (for example `1314`, `1315`, ...)
- Open your default browser automatically

Alternative port:

- `npm run preview:8080`

## Deploy bundle (one command)

From this folder, run:

- `npm run deploy`

This will:

- Rebuild gallery thumbnails and `gallery.json`
- Generate a ready-to-upload folder: `_deploy`
- Put all required static files inside `_deploy`

Upload everything inside `_deploy` to your school homepage server.

## Customize quickly

- Edit bio and contact links in `content.md` (the homepage also has initial HTML bio text)
- Update publication items in `bibtex/yichuan_deng.bib`; use `selected={true}` for the homepage and `equal_contribution={3}` to mark the first three authors
- Set `cat={Computer Vision}` (or any category name) to group papers on Full Publications. Category order follows first appearance in BibTeX; papers within each category are newest first. Missing/empty categories go under Other Publications. The `cat` field is omitted from copied citations.
- Replace gallery images in `assets/gallery/`
- Write each photo's location in the `description` string in `assets/gallery/gallery.json`, for example `"description": "Seattle, Washington, USA"`. Empty strings show no text. Locations appear below each homepage photo and slide with it during dragging, button navigation, and autoplay. They also appear below photos in Full Gallery and in the lightbox; filenames are not used as visible descriptions. Gallery regeneration preserves these hand-written descriptions. Autoplay advances every two seconds, and refresh randomizes the photo order once.
- Tweak visual style in `styles.css`

## Photo globe and GPS

Full Gallery has **Gallery / Globe** views. The floating, zoomable globe uses
locally vendored [MapLibre GL JS 5.24.0](https://maplibre.org/) and
[OpenFreeMap](https://openfreemap.org/) Positron/Dark vector basemaps. The library,
CSS, map style, fonts, and tiles load only when Globe is selected. No API key,
account, or framework is required; provider attribution remains visible.

Drag or use arrow keys to explore. Use the +/− buttons, Ctrl/⌘ + scroll, or
two-finger pinch to zoom from the complete Earth down to streets. Photo clusters
show a photo cover and count badge, not dots, and split into individual photo
cards as you zoom in. Cluster covers are chosen deterministically from their
members. Globe is a single centered Earth with no sidebar. Clicking a photo or
cluster cover opens an enlarged, uncropped photo directly on the globe, anchored
to that marker. Preview cards follow each photo's original aspect ratio, including
portrait and panorama shots, rather than letterboxing inside a landscape frame.
Groups have previous/next buttons and support left/right arrow
keys; photos at identical coordinates remain available together. Close with ×,
Escape, a map-background click, or by navigating the map. Keyboard dismissal
returns focus to the marker. Square map markers use centered crops without white
padding. Backside markers are hidden and removed from pointer/keyboard interaction.
**Overview** dismisses the preview and restores the complete globe. Photos without
GPS remain in the regular Gallery rather than adding extra panels to Globe.
Neither map clustering nor selection changes the manifest.

Initial automatic rotation pauses on hover/focus. Use **Resume rotation** to
restart it and return to globe scale, even if the map still holds focus or the
pointer remains over it. Explicitly resumed rotation continues until paused or
another interaction begins. Zooming, panning, and photo selection pause rotation.
Reduced-motion preferences disable automatic motion by default;
hidden tabs, offscreen globes, and open lightboxes stop automatic camera updates.
The map renders on demand once motion/loading finishes. Light/dark theme changes
preserve the camera and restore the photo overlay. If WebGL or the basemap is
unavailable, the photo controls remain usable, and Gallery is unaffected.

Extract GPS from the originals without rebuilding or modifying any images:

`python3 scripts/build-gallery.py --gps-only`

Each photo in `assets/gallery/gallery.json` has a `gps` object. For a photo without
GPS, replace its two `null` values with decimal-degree numbers, for example:

```json
"gps": { "latitude": 47.6062, "longitude": -122.3321 }
```

Latitude is north/south (`-90` to `90`); longitude is east/west (`-180` to `180`),
with negative values for south/west. Keep unknown coordinates `null`, not `0`.
Manual coordinates and partially completed values survive regeneration. Empty
pairs are filled only if EXIF GPS exists; locations are never guessed from text.
Set `"gps": null` to explicitly exclude a photo from Globe, even on future rebuilds.

**Privacy:** publishing the manifest makes its exact coordinates public. Review
them before deploying. Rendering runs in the browser. OpenFreeMap receives normal
map style/font/tile requests for the visible area; photos and the gallery manifest
are not uploaded to it. No geolocation permission, visitor-location lookup, or
reverse-geocoding service is used. The public tile service is an external
dependency and has no availability guarantee.

### Local GPS annotation studio

Run `python3 scripts/gallery-gps-server.py`, then open
`http://127.0.0.1:1314/` (or set `--port 1315` if needed).
This standalone tool is not linked from, or bundled with, the public website.

Select a missing-GPS photo on the left, click its location on the map on the right,
and choose **保存并下一张**. The marker can be dragged for fine adjustment; decimal
coordinates can also be entered directly. **沿用上一位置** prepares the same point
for another photo but still requires confirmation. Switching photos retains draft
points in the current tab; drafts do not modify files and are lost if you close it.
Map tiles come from OpenFreeMap; photos are never uploaded, and no place-name
geocoding or visitor geolocation is performed.

Each confirmed save updates only that photo's `gps` in the latest
`assets/gallery/gallery.json`, then advances the queue. Existing valid GPS and
explicit `gps: null` opt-outs are excluded and protected from overwrite. The
server rejects stale GPS revisions and checks for concurrent file edits before
atomic replacement; descriptions, order, custom metadata and originals are kept.
**撤销上一条** restores a save made during this server session. Before every save
or undo, a full copy is retained under `.local/gallery-gps-backups/` (gitignored,
not served by the tool). Refresh the public Globe preview to see saved positions.
The server listens only on IPv4 loopback and requires same-origin/session-token
writes. Stop it with Ctrl+C when finished; it must not be deployed as a public API.

## Smoke tests

Run `node tests/homepage.test.js`, or on macOS without Node:

`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/homepage.test.js`

Also run `node tests/gallery-order.test.js`, `node tests/gallery-globe.test.js`
(or the same JavaScriptCore command with those files), and
`python3 tests/gallery-builder.test.py`.

For the local annotation tool, run `python3 tests/gallery-gps-server.test.py`
and `node tests/gallery-gps-ui.test.js` (or the JavaScriptCore equivalent).
Server tests only write disposable files in temporary directories.

These check author expansion/co-first markers, citation content, email links,
modal focus wrapping, two-second autoplay, location display, random/stable ordering,
globe GeoJSON/clustering/zoom/rotation/view switching/theme races/retry behavior, EXIF GPS decoding, and preservation
of descriptions/manual coordinates during regeneration; they do not replace visual browser testing.
