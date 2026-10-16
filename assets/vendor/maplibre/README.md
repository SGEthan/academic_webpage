# MapLibre GL JS 5.24.0

Unmodified browser distribution from the official npm package:

- https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js
- https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css
- https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/LICENSE.txt

Project: https://github.com/maplibre/maplibre-gl-js

BSD-3-Clause license and bundled third-party notices: see LICENSE.txt.

The UMD browser build includes its worker implementation and needs no bundler.
script.js loads this JS/CSS only when Full Gallery's Globe tab is opened.
Pin both filenames to the same version when updating and rerun
tests/gallery-globe.test.js plus visual desktop/mobile checks.

Basemap styles, vector tiles, sprites, and fonts are served by OpenFreeMap:
https://openfreemap.org/quick_start/

Attribution is supplied by the style's TileJSON sources and displayed by
MapLibre's AttributionControl. Keep it visible. No map API key or account is
needed. Only on-demand viewport requests are made; no tile prefetch/offline
download or photo upload is implemented.
