(() => {
  const $ = (id) => document.getElementById(id);
  const drafts = new Map(), history = [];
  let snapshot = { photos: [], known: [] }, selectedSrc = null, token = "", busy = false;
  let map = null, marker = null, mapReady = false, lastGps = null, mapLoading = false;
  const selected = () => snapshot.photos.find((photo) => photo.src === selectedSrc);
  const validGps = (gps) => gps && Number.isFinite(gps.latitude) && Math.abs(gps.latitude) <= 90 && Number.isFinite(gps.longitude) && Math.abs(gps.longitude) <= 180;
  const asset = (path) => "/" + path.split("/").map(encodeURIComponent).join("/");
  const longitude = (value) => ((value + 180) % 360 + 360) % 360 - 180;
  const label = (photo) => photo.description || photo.src.split("/").pop();
  const status = (message, error = false) => { $("status").textContent = message; $("status").setAttribute("data-error", String(error)); };
  const setBusy = (value) => { busy = value; updateControls(); };
  const updateControls = () => {
    $("save").disabled = busy || !selected() || !validGps(drafts.get(selectedSrc));
    $("save").textContent = busy ? "正在处理…" : "保存并下一张 ↗";
    $("undo").disabled = busy || !history.length;
    $("reload").disabled = busy;
    $("reuse").disabled = busy || !selected() || !lastGps;
    $("latitude").disabled = $("longitude").disabled = busy || !selected();
    $("world").disabled = !mapReady;
    $("photo-queue").querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  };
  async function api(path, payload) {
    const response = await fetch(path, payload ? { method: "POST", headers: { "Content-Type": "application/json", "X-Gallery-GPS-Token": token }, body: JSON.stringify(payload) } : { cache: "no-store" });
    let body;
    try { body = await response.json(); }
    catch (_) { throw new Error("未连接本地标注服务。请运行 python3 scripts/gallery-gps-server.py，再打开终端里的地址。"); }
    if (!response.ok) throw new Error(body.error || "保存失败，请稍后重试。");
    return body;
  }
  function updateKnown() {
    if (!mapReady) return;
    const data = { type: "FeatureCollection", features: snapshot.known.map((photo) => ({ type: "Feature", geometry: { type: "Point", coordinates: [photo.gps.longitude, photo.gps.latitude] }, properties: {} })) };
    const source = map.getSource("known-photos");
    if (source) source.setData(data);
    else {
      map.addSource("known-photos", { type: "geojson", data });
      map.addLayer({ id: "known-photos", type: "circle", source: "known-photos", paint: { "circle-radius": 5, "circle-color": "#a994bc", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } });
    }
  }
  function updateMarker() {
    const gps = drafts.get(selectedSrc);
    if (!mapReady || !validGps(gps)) { if (marker) { marker.remove(); marker = null; } return; }
    if (!marker) {
      marker = new maplibregl.Marker({ color: "#715594", draggable: true }).setLngLat([gps.longitude, gps.latitude]).addTo(map);
      marker.on("dragend", () => { const point = marker.getLngLat(); setCandidate({ latitude: point.lat, longitude: longitude(point.lng) }); });
    } else marker.setLngLat([gps.longitude, gps.latitude]);
  }
  function renderQueue() {
    const scrollTop = $("photo-queue").scrollTop, scrollLeft = $("photo-queue").scrollLeft;
    $("photo-queue").replaceChildren();
    snapshot.photos.forEach((photo) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "queue-photo";
      button.setAttribute("aria-label", `标注照片：${label(photo)}`);
      button.setAttribute("aria-pressed", String(photo.src === selectedSrc));
      button.setAttribute("data-draft", String(drafts.has(photo.src)));
      button.title = label(photo);
      const image = document.createElement("img"); image.src = asset(photo.small || photo.thumb || photo.src); image.alt = ""; image.loading = "lazy";
      button.appendChild(image); button.addEventListener("click", () => { if (!busy) selectPhoto(photo.src); });
      $("photo-queue").appendChild(button);
    });
    $("progress").textContent = `${snapshot.photos.length} 张待标 · ${snapshot.known.length} 张已定位`;
    $("draft-count").textContent = drafts.size ? `${drafts.size} 张有未保存选点` : "";
    $("photo-queue").scrollTop = scrollTop; $("photo-queue").scrollLeft = scrollLeft;
  }
  function selectPhoto(src) {
    selectedSrc = src;
    const photo = selected(), image = $("selected-image"), gps = drafts.get(src);
    image.hidden = !photo; $("empty-photo").hidden = Boolean(photo);
    if (photo) { image.src = asset(photo.display || photo.thumb || photo.src); image.alt = label(photo); }
    else $("empty-photo").textContent = "全部标注完成 ✓";
    $("photo-description").textContent = photo ? (photo.description || "尚未填写地点描述") : "这批照片都有坐标了。";
    $("photo-filename").textContent = photo ? photo.src.split("/").pop() : "刷新 Globe 即可看到新标注的位置。";
    $("latitude").value = validGps(gps) ? gps.latitude.toFixed(6) : "";
    $("longitude").value = validGps(gps) ? gps.longitude.toFixed(6) : "";
    $("selection-state").textContent = validGps(gps) ? "已选点 · 尚未保存" : "尚未选点";
    $("selection-state").setAttribute("data-draft", String(validGps(gps)));
    renderQueue(); updateMarker(); updateControls();
    if (validGps(gps) && mapReady) map.easeTo({ center: [gps.longitude, gps.latitude], duration: 400 });
  }
  function setCandidate(gps, fromInput = false) {
    if (!selected() || busy) return;
    if (validGps(gps)) drafts.set(selectedSrc, { latitude: Number(gps.latitude.toFixed(6)), longitude: Number(gps.longitude.toFixed(6)) });
    else drafts.delete(selectedSrc);
    if (!fromInput && validGps(gps)) { $("latitude").value = gps.latitude.toFixed(6); $("longitude").value = gps.longitude.toFixed(6); }
    $("selection-state").textContent = validGps(gps) ? "已选点 · 尚未保存" : "请填写有效经纬度";
    $("selection-state").setAttribute("data-draft", String(validGps(gps)));
    renderQueue(); updateMarker(); updateControls();
  }
  async function loadPhotos(preferredSrc) {
    const result = await api("/api/photos");
    token = result.token; snapshot = result;
    for (const src of drafts.keys()) if (!snapshot.photos.some((photo) => photo.src === src)) drafts.delete(src);
    updateKnown();
    selectPhoto(snapshot.photos.some((photo) => photo.src === preferredSrc) ? preferredSrc : snapshot.photos[0]?.src);
  }
  async function loadMap() {
    if (mapLoading) return;
    mapLoading = true; $("map-error").hidden = true;
    try {
      if (!window.maplibregl) throw new Error("MapLibre did not load");
      const response = await fetch("https://tiles.openfreemap.org/styles/positron", { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("Map style did not load");
      const style = await response.json();
      if (map) map.remove();
      marker = null; mapReady = false;
      map = new maplibregl.Map({ container: $("map"), style, center: [-122.33, 47.6], zoom: 7, maxZoom: 19, attributionControl: true });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => { mapReady = true; updateKnown(); updateMarker(); updateControls(); $("map-error").hidden = true; });
      map.on("error", () => { $("map-error").hidden = false; });
      map.on("click", (event) => setCandidate({ latitude: event.lngLat.lat, longitude: longitude(event.lngLat.lng) }));
    } catch (_) { $("map-error").hidden = false; }
    finally { mapLoading = false; }
  }
  $("latitude").addEventListener("input", inputCoordinates);
  $("longitude").addEventListener("input", inputCoordinates);
  function inputCoordinates() {
    setCandidate({ latitude: $("latitude").value.trim() ? Number($("latitude").value) : NaN, longitude: $("longitude").value.trim() ? Number($("longitude").value) : NaN }, true);
  }
  $("coordinate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const photo = selected(), gps = drafts.get(selectedSrc);
    if (!photo || busy || !validGps(gps)) return;
    const oldIndex = snapshot.photos.indexOf(photo);
    setBusy(true);
    try {
      const result = await api("/api/gps", { src: photo.src, gps, expected_gps_revision: photo.gps_revision });
      history.push({ undo_id: result.undo_id, src: photo.src }); lastGps = result.saved.gps;
      drafts.delete(photo.src); snapshot = result; updateKnown();
      selectPhoto(snapshot.photos[Math.min(oldIndex, snapshot.photos.length - 1)]?.src);
      status(`已保存 ${photo.src.split("/").pop()} · ${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}。已备份，可撤销。`);
    } catch (error) { status(error.message, true); }
    finally { setBusy(false); }
  });
  $("undo").addEventListener("click", async () => {
    if (busy || !history.length) return;
    setBusy(true);
    try {
      const result = await api("/api/undo", { undo_id: history[history.length - 1].undo_id });
      history.pop(); snapshot = result; updateKnown(); selectPhoto(result.restored_src);
      status("已撤销上一条 GPS 标注，其他字段未改变。");
    } catch (error) { status(error.message, true); }
    finally { setBusy(false); }
  });
  $("reload").addEventListener("click", async () => {
    setBusy(true);
    try { await loadPhotos(selectedSrc); status("列表已刷新；未保存选点仍保留在当前页面。"); }
    catch (error) { status(error.message, true); }
    finally { setBusy(false); }
  });
  $("reuse").addEventListener("click", () => {
    if (lastGps) { setCandidate(lastGps); if (mapReady) map.easeTo({ center: [lastGps.longitude, lastGps.latitude], zoom: Math.max(map.getZoom(), 13), duration: 450 }); }
  });
  $("world").addEventListener("click", () => { if (mapReady) map.easeTo({ center: [-20, 25], zoom: 1.5, duration: 600 }); });
  $("retry-map").addEventListener("click", loadMap);
  window.addEventListener("beforeunload", (event) => { if (busy || drafts.size) { event.preventDefault(); event.returnValue = ""; } });
  setBusy(true);
  loadPhotos().then(() => status("选照片 → 地图点击选点（标记可拖动）→ 保存并下一张。未确认前不会写文件。"))
    .catch((error) => { status(error.message, true); $("empty-photo").textContent = "无法连接标注服务，请检查终端。"; })
    .finally(() => setBusy(false));
  loadMap();
})();
