/* 地図のページ：学校の点（3つの選択肢）と、都道府県の人数の塗り分け（同時に1つ） */
(function () {
  "use strict";

  const GROUPS = {
    jp: { label: "日本語学校", shape: "circle", color: "#2563A8" },
    higher: { label: "大学・短大・高専", shape: "square", color: "#0E8A6A" },
    senmon: { label: "専門学校", shape: "diamond", color: "#8A52B4" },
  };
  const TYPES = {
    jp: { label: "日本語学校", group: "jp" },
    univ: { label: "大学", group: "higher" },
    jc: { label: "短大", group: "higher" },
    kosen: { label: "高専", group: "higher" },
    senmon: { label: "専門学校", group: "senmon" },
  };
  const RAMP = ["#FADFB8", "#F5C484", "#EBA053", "#CC7629", "#924C17"];
  const ZERO = "#FFFFFF";
  const NODATA = "#D9D6CE";
  const PAGE = 50;
  const HOME = [[24.0, 122.6], [45.7, 146.0]]; // 沖縄まで入る範囲
  const BUBBLE_BELOW = 6.5; // これより引いた全国表示では、都道府県ごとの数を出す
  const ROMAJI = ["hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima", "ibaraki", "tochigi", "gunma", "saitama", "chiba", "tokyo", "kanagawa", "niigata", "toyama", "ishikawa", "fukui", "yamanashi", "nagano", "gifu", "shizuoka", "aichi", "mie", "shiga", "kyoto", "osaka", "hyogo", "nara", "wakayama", "tottori", "shimane", "okayama", "hiroshima", "yamaguchi", "tokushima", "kagawa", "ehime", "kochi", "fukuoka", "saga", "nagasaki", "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa"];

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fold = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[\s　]/g, "");

  // rough＝町名の代表点。白抜きで表す
  function shape(group, size, rough) {
    const g = GROUPS[group];
    const common = rough ? `fill="#fff" stroke="${g.color}" stroke-width="3"` : `fill="${g.color}" stroke="#fff" stroke-width="2"`;
    const body = g.shape === "circle" ? `<circle cx="11" cy="11" r="7" ${common}/>`
      : g.shape === "square" ? `<rect x="4.5" y="4.5" width="13" height="13" rx="1" ${common}/>`
      : `<path d="M11 2.5l8.5 8.5-8.5 8.5L2.5 11z" ${common}/>`;
    return `<svg class="shape" viewBox="0 0 22 22" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
  }

  const state = { pref: "", city: "", groups: new Set(Object.keys(GROUPS)), layer: "", variant: "all", q: "", kind: "", limit: PAGE };
  let startSchool = "", D = null, S = null, GEO = null, byId = {}, prefName = {}, repPoint = {}, map = null, cluster = null, bubbles = null, prefLayer = null, markers = {};
  let imageUrl = "";

  // ---- 読み込み ----
  Promise.all(["data/schools.json", "data/stats.json", "data/prefectures.json"].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); })))
    .then(([d, s, g]) => { D = d; S = s; GEO = g; init(); })
    .catch(() => { $("summary").innerHTML = '<p class="note">データを読み込めませんでした。ページを開き直してください。</p>'; });

  function init() {
    GEO.features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
    GEO.features.forEach((f) => {
      prefName[f.properties.code] = f.properties.name;
      repPoint[f.properties.code] = centroid(mainRing(f));
    });
    D.schools.forEach((s) => {
      s.g = TYPES[s.t].group;
      s.h = fold([prefName[s.p], s.c, s.a, s.n].join(" "));
      s.hn = fold(s.n);
      byId[s.i] = s;
    });
    readUrl();
    buildControls();
    buildMap();
    applyGroups();
    applyLayer();
    applyRegion(true, false);
    if (startSchool && byId[startSchool]) openSchool(byId[startSchool]);
    window.__mapCheck = check;
  }

  // 県の中でいちばん大きい陸地
  function mainRing(f) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null, area = -1;
    polys.forEach((p) => {
      const a = Math.abs(ringArea(p[0]));
      if (a > area) { area = a; best = p[0]; }
    });
    return best;
  }

  function ringArea(r) {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
    return a / 2;
  }

  function centroid(r) {
    let x = 0, y = 0, a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f; a += f;
    }
    return [y / (3 * a), x / (3 * a)];
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    startSchool = p.get("school") || "";
    let pref = p.get("pref") || "";
    if (pref && !prefName[pref]) pref = Object.keys(prefName).find((k) => prefName[k] === pref) || "";
    state.pref = pref;
    const city = p.get("city") || "";
    if (pref && city && D.schools.some((s) => s.p === pref && s.cc === city)) state.city = city;
    const types = p.get("types");
    if (types !== null) state.groups = new Set(types.split(",").filter((k) => GROUPS[k]));
    const layer = p.get("layer") || "";
    const ind = S.indicators.find((i) => i.id === layer);
    if (ind) {
      state.layer = layer;
      const v = p.get("variant");
      state.variant = ind.variants.some((x) => x.id === v) ? v : "all";
    }
  }

  function writeUrl() { history.replaceState(null, "", location.pathname + query()); }

  function query() {
    const p = new URLSearchParams();
    if (state.pref) p.set("pref", state.pref);
    if (state.city) p.set("city", state.city);
    if (state.groups.size < 3) p.set("types", [...state.groups].join(","));
    if (state.layer) {
      p.set("layer", state.layer);
      if (state.variant !== "all") p.set("variant", state.variant);
    }
    const s = p.toString();
    return s ? "?" + s : "";
  }

  // ---- 操作部分 ----
  function buildControls() {
    const sel = $("sel-pref");
    GEO.features.forEach((f) => sel.insertAdjacentHTML("beforeend", `<option value="${f.properties.code}">${esc(f.properties.name)}</option>`));
    sel.value = state.pref;
    sel.addEventListener("change", () => { state.pref = sel.value; state.city = ""; state.limit = PAGE; applyRegion(true); });
    $("sel-city").addEventListener("change", (e) => { state.city = e.target.value; state.limit = PAGE; applyRegion(true); });

    $("chk-types").innerHTML = Object.keys(GROUPS).map((k) =>
      `<label class="check"><input type="checkbox" value="${k}" ${state.groups.has(k) ? "checked" : ""}>${shape(k, 20)}<span>${GROUPS[k].label}</span></label>`).join("");
    $("chk-types").addEventListener("change", (e) => {
      if (e.target.checked) state.groups.add(e.target.value); else state.groups.delete(e.target.value);
      state.limit = PAGE;
      applyGroups();
      renderSide();
      renderFind();
      writeUrl();
    });

    const layer = $("sel-layer");
    S.indicators.forEach((i) => layer.insertAdjacentHTML("beforeend", `<option value="${i.id}">${esc(i.label)}</option>`));
    layer.value = state.layer;
    layer.addEventListener("change", () => { state.layer = layer.value; state.variant = "all"; applyLayer(); });
    $("sel-variant").addEventListener("change", (e) => { state.variant = e.target.value; applyLayer(); });

    // 全国から学校をさがす
    const find = $("find");
    find.addEventListener("input", debounce(renderFind, 120));
    find.addEventListener("focus", renderFind);
    find.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeFind();
      if (e.key === "ArrowDown") { const b = $("find-results").querySelector("button"); if (b) { b.focus(); e.preventDefault(); } }
      if (e.key === "Enter") { const b = $("find-results").querySelector("button[data-id]"); if (b) { goSchool(byId[b.dataset.id]); e.preventDefault(); } }
    });
    $("find-results").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.id) goSchool(byId[b.dataset.id]);
      else if (b.dataset.all) {
        Object.keys(GROUPS).forEach((k) => state.groups.add(k));
        $("chk-types").querySelectorAll("input").forEach((i) => { i.checked = true; });
        applyGroups(); renderSide(); renderFind(); writeUrl();
      }
    });
    $("find-results").addEventListener("keydown", (e) => {
      const list = [...$("find-results").querySelectorAll("button")];
      const i = list.indexOf(document.activeElement);
      if (e.key === "ArrowDown" && list[i + 1]) { list[i + 1].focus(); e.preventDefault(); }
      if (e.key === "ArrowUp") { (list[i - 1] || find).focus(); e.preventDefault(); }
      if (e.key === "Escape") { closeFind(); find.focus(); }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".searchbox")) closeFind(); });

    $("q").addEventListener("input", debounce(() => { state.q = $("q").value; state.limit = PAGE; renderList(); }, 160));
    $("kind").addEventListener("change", () => { state.kind = $("kind").value; state.limit = PAGE; renderList(); });
    $("more").addEventListener("click", () => { state.limit += PAGE; renderList(); });
    $("list").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) openSchool(byId[b.dataset.id], b);
    });

    $("save-img").addEventListener("click", openImage);
    $("img-close").addEventListener("click", () => $("img-dialog").close());
    $("img-dialog").addEventListener("close", () => { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = ""; });

    // スマホでは閉じて地図を優先し、PCでは常に開く
    const mq = window.matchMedia("(min-width: 900px)");
    const setBoxes = () => { ["box-types", "box-layer"].forEach((id) => { $(id).open = mq.matches; }); };
    setBoxes();
    mq.addEventListener("change", setBoxes);
  }

  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function renderFind() {
    const box = $("find-results");
    const q = fold($("find").value);
    if (!q) { closeFind(); return; }
    const hit = D.schools.filter((s) => s.h.includes(q));
    const shown = hit.filter((s) => state.groups.has(s.g));
    const rank = (s) => (s.hn.includes(q) ? 0 : 2) + (inRegion(s) ? 0 : 1);
    shown.sort((a, b) => rank(a) - rank(b) || a.n.length - b.n.length);
    let html = shown.slice(0, 8).map((s) =>
      `<button type="button" class="find-item" data-id="${esc(s.i)}">${shape(s.g, 16)}<span><b>${esc(s.n)}</b><small>${esc(prefName[s.p])}${esc(s.c || "")}・${TYPES[s.t].label}</small></span></button>`).join("");
    if (!shown.length) html += '<p class="find-note">表示中の種類には見つかりませんでした。</p>';
    if (shown.length > 8) html += `<p class="find-note">ほか${fmt(shown.length - 8)}校。続けて入力すると絞り込めます。</p>`;
    if (hit.length > shown.length) html += `<p class="find-note">チェックを外している種類に${fmt(hit.length - shown.length)}校あります。<button type="button" class="link" data-all="1">すべての種類を表示</button></p>`;
    box.innerHTML = html;
    box.hidden = false;
    $("find").setAttribute("aria-expanded", "true");
  }

  function closeFind() {
    $("find-results").hidden = true;
    $("find").setAttribute("aria-expanded", "false");
  }

  function goSchool(s) {
    closeFind();
    $("find").value = s.n;
    state.pref = s.p;
    state.city = "";
    state.limit = PAGE;
    $("sel-pref").value = s.p;
    applyRegion(false);
    if (s.la != null) {
      openSchool(s);
    } else {
      state.q = s.n;
      $("q").value = s.n;
      renderList();
      const b = $("list").querySelector(`button[data-id="${s.i}"]`);
      if (b) { openSchool(s, b); b.scrollIntoView({ block: "center" }); }
    }
  }

  function indicator() { return S.indicators.find((i) => i.id === state.layer) || null; }
  function variantOf(ind, id) { return ind.variants.find((v) => v.id === id) || ind.variants[0]; }
  function short(ind, v) { return ind.label + (v.id !== "all" ? `（${v.label}）` : ""); }
  function valueText(n) { return n == null ? "データなし" : fmt(n) + "人"; }

  // ---- 地図 ----
  function buildMap() {
    map = L.map("map", { minZoom: 3.5, maxZoom: 18, zoomSnap: 0.25 });
    map.attributionControl.setPrefix(false);
    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
      minNativeZoom: 5, maxNativeZoom: 18, opacity: 0.75,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>／<a href="sources.html">境界・位置：国土交通省の資料を加工</a>',
    }).addTo(map);
    map.createPane("prefs");
    map.getPane("prefs").style.zIndex = 350;
    map.createPane("lines");
    map.getPane("lines").style.zIndex = 450;
    map.getPane("lines").style.pointerEvents = "none";
    prefLayer = L.geoJSON(GEO, {
      pane: "prefs",
      style: prefStyle,
      onEachFeature: (f, layer) => {
        layer.on("click", () => setPref(f.properties.code));
        layer.on("mouseover", () => layer.setStyle({ weight: f.properties.code === state.pref ? 3 : 2 }));
        layer.on("mouseout", () => prefLayer.resetStyle(layer));
        layer.bindTooltip(() => prefTip(f.properties.code), { sticky: true, className: "pref-tip", direction: "top" });
      },
    }).addTo(map);

    cluster = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: clusterRadius,
      iconCreateFunction: (c) => clusterIcon(c.getChildCount()),
    });
    bubbles = L.layerGroup();
    const popWidth = Math.min(320, Math.max(200, map.getSize().x - 64)); // スマホで地図からはみ出さない幅
    const icons = {};
    D.schools.forEach((s) => {
      if (s.la == null) return;
      const key = s.g + (s.lv === 0 ? "-rough" : "") + (s.st ? "-prov" : "");
      if (!icons[key]) icons[key] = L.divIcon({ className: "pt" + (s.st ? " pt-prov" : ""), html: shape(s.g, 22, s.lv === 0), iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -8] });
      const m = L.marker([s.la, s.ln], { icon: icons[key], title: s.n, alt: s.n, riseOnHover: true });
      m.bindPopup(() => detailHtml(s), { maxWidth: popWidth, minWidth: Math.min(220, popWidth), autoPanPaddingTopLeft: [12, 84], autoPanPaddingBottomRight: [12, 12] });
      markers[s.i] = m;
    });
    map.fitBounds(HOME);
    map.on("zoomend", () => { syncFill(); syncMode(); });
  }

  function clusterRadius(z) { return z < 12 ? 58 : z < 14 ? 34 : 12; }

  function clusterIcon(n) {
    const size = n < 10 ? 28 : n < 100 ? 32 : n < 1000 ? 38 : 44;
    return L.divIcon({ html: `<span>${fmt(n)}</span>`, className: "cl", iconSize: [size, size] });
  }

  // 重なる丸を少しずつ押し広げる（全国の都道府県の数・画像で共用）
  function relax(items, gap) {
    items.forEach((a, k) => { a.x = a.ax + k * 0.01; a.y = a.ay; });
    for (let t = 0; t < 240; t++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + b.r + gap;
          if (d < min) {
            const p = (min - d) / 2 / d;
            a.x -= dx * p; a.y -= dy * p; b.x += dx * p; b.y += dy * p;
            moved = true;
          }
        }
      }
      items.forEach((a) => { a.x += (a.ax - a.x) * 0.015; a.y += (a.ay - a.y) * 0.015; });
      if (!moved) break;
    }
    return items;
  }

  function prefCounts() {
    const c = {};
    D.schools.forEach((s) => { if (s.la != null && state.groups.has(s.g)) c[s.p] = (c[s.p] || 0) + 1; });
    return c;
  }

  function renderBubbles() {
    bubbles.clearLayers();
    const c = prefCounts();
    const items = Object.keys(c).map((code) => {
      const a = map.latLngToLayerPoint(repPoint[code]);
      return { code, n: c[code], ax: a.x, ay: a.y, r: c[code] < 100 ? 10 : c[code] < 1000 ? 12 : 14 };
    });
    relax(items, 1).forEach((i) => {
      const ll = map.layerPointToLatLng([i.x, i.y]);
      if (Math.hypot(i.x - i.ax, i.y - i.ay) > 8) L.polyline([repPoint[i.code], ll], { pane: "lines", color: "#5C5140", weight: 1, opacity: 0.7, interactive: false }).addTo(bubbles);
      const m = L.marker(ll, { icon: L.divIcon({ className: "cl cl-pref", html: `<span>${fmt(i.n)}</span>`, iconSize: [i.r * 2, i.r * 2] }), title: `${prefName[i.code]}：地図の点 ${fmt(i.n)}（クリックで移動）`, alt: `${prefName[i.code]} ${fmt(i.n)}` });
      m.on("click", () => setPref(i.code));
      bubbles.addLayer(m);
    });
  }

  function useBubbles() { return !state.pref && map.getZoom() < BUBBLE_BELOW; }

  function syncMode() {
    if (useBubbles()) {
      if (map.hasLayer(cluster)) map.removeLayer(cluster);
      if (!map.hasLayer(bubbles)) map.addLayer(bubbles);
      renderBubbles();
    } else {
      if (map.hasLayer(bubbles)) map.removeLayer(bubbles);
      if (!map.hasLayer(cluster)) map.addLayer(cluster);
    }
  }

  function prefTip(code) {
    const ind = indicator();
    if (!ind) return esc(prefName[code]);
    const v = variantOf(ind, state.variant);
    return `<b>${esc(prefName[code])}</b><br>${esc(short(ind, v))}：${valueText(v.values[code])}`;
  }

  function colorFor(n, br) {
    if (n == null) return NODATA;
    if (n === 0) return ZERO;
    let i = 0;
    while (i < br.length && n >= br[i]) i++;
    return RAMP[i];
  }

  function prefStyle(f) {
    const code = f.properties.code;
    const ind = indicator();
    const selected = code === state.pref;
    const base = { color: selected ? "#352D20" : "#7A6A45", weight: selected ? 3 : 1, opacity: selected ? 1 : 0.75 };
    if (!ind) return Object.assign(base, { fillColor: "#fff", fillOpacity: 0.001 });
    const v = variantOf(ind, state.variant);
    return Object.assign(base, { fillColor: colorFor(v.values[code], v.breaks), fillOpacity: fillOpacity() });
  }

  // 拡大するほど色を薄くして、町名や道路が読めるようにする（凡例の色も合わせる）
  function fillOpacity() {
    const z = map ? map.getZoom() : 5;
    return z >= 12 ? 0.25 : z >= 10 ? 0.4 : z >= 8 ? 0.62 : 0.85;
  }

  function syncFill() {
    if (!indicator()) return;
    prefLayer.setStyle(prefStyle);
    $("legend").style.setProperty("--fo", fillOpacity());
  }

  function applyGroups() {
    cluster.clearLayers();
    cluster.addLayers(D.schools.filter((s) => s.la != null && state.groups.has(s.g)).map((s) => markers[s.i]));
    syncMode();
    const on = [...state.groups];
    $("now-types").textContent = on.length === 3 ? "すべて" : on.length ? on.map((k) => GROUPS[k].label).join("、") : "なし";
  }

  function applyLayer() {
    const ind = indicator();
    const box = $("sel-variant");
    if (ind && ind.variants.length > 1) {
      box.innerHTML = ind.variants.map((v) => `<option value="${v.id}">${esc(v.label)}</option>`).join("");
      box.value = state.variant;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    prefLayer.setStyle(prefStyle);
    const v = ind ? variantOf(ind, state.variant) : null;
    $("now-layer").textContent = ind ? short(ind, v) : "色分けなし";
    const badge = $("layer-badge");
    badge.hidden = !ind;
    badge.textContent = ind ? `色：${short(ind, v)}（${ind.period}）` : "";
    renderLegend();
    renderSummary();
    writeUrl();
  }

  // 凡例の1段（画像でも同じものを使う）
  function scaleRows(v) {
    const b = v.breaks, vals = Object.values(v.values);
    const rows = RAMP.map((color, i) => {
      const lo = i === 0 ? null : b[i - 1];
      const hi = i === RAMP.length - 1 ? null : b[i] - 1;
      return { color, label: lo == null ? `${fmt(hi)}人以下` : hi == null ? `${fmt(lo)}人以上` : `${fmt(lo)}～${fmt(hi)}人` };
    });
    if (vals.includes(0)) rows.unshift({ color: ZERO, label: "0人" });
    if (vals.some((x) => x == null)) rows.push({ color: NODATA, label: "データなし" });
    return rows;
  }

  function renderLegend() {
    const ind = indicator();
    let html = `<div class="lg-points">${Object.keys(GROUPS).map((k) => `<span>${shape(k, 16)}${GROUPS[k].label}</span>`).join("")}<span>${shape("jp", 16, true)}白抜き＝町名の代表点</span><span><i class="lg-cl">12</i>数字＝まとめた点の数</span></div>`;
    if (ind) {
      const v = variantOf(ind, state.variant);
      html = `<div class="lg-title">${esc(short(ind, v))}<small>${esc(ind.period)}・都道府県単位</small></div><ul class="lg-scale">${scaleRows(v).map((r) => `<li><i><b style="background:${r.color}"></b></i>${r.label}</li>`).join("")}</ul><p class="lg-note">色の濃さは人数の多さだけを表します。</p>` + html;
    }
    $("legend").innerHTML = html;
    $("legend").style.setProperty("--fo", fillOpacity());
    map.invalidateSize({ pan: false }); // 凡例の高さが変わると地図の高さも変わるため
  }

  function setPref(code) {
    state.pref = code;
    state.city = "";
    state.limit = PAGE;
    $("sel-pref").value = code;
    applyRegion(true);
  }

  function mainBounds(code) {
    const f = GEO.features.find((x) => x.properties.code === code);
    return L.latLngBounds(mainRing(f).map((c) => [c[1], c[0]]));
  }

  function applyRegion(move, animate) {
    const cs = $("sel-city");
    const opt = { animate: animate !== false };
    if (state.pref) {
      const seen = {};
      D.schools.forEach((s) => { if (s.p === state.pref && s.cc) seen[s.cc] = s.c; });
      cs.innerHTML = '<option value="">全市区町村</option>' + Object.keys(seen).sort().map((k) => `<option value="${k}">${esc(seen[k])}</option>`).join("");
      cs.value = state.city;
      cs.hidden = false;
    } else {
      cs.hidden = true;
    }
    prefLayer.setStyle(prefStyle);
    if (move) {
      if (state.city) {
        const pts = D.schools.filter((s) => s.cc === state.city && s.la != null).map((s) => [s.la, s.ln]);
        if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), Object.assign({ maxZoom: 14 }, opt));
      } else if (state.pref) {
        map.fitBounds(mainBounds(state.pref).pad(0.08), opt);
      } else {
        map.fitBounds(HOME, opt);
      }
    }
    syncMode();
    renderSide();
    writeUrl();
  }

  function renderSide() {
    renderSummary();
    renderList();
  }

  // ---- 地域の概要 ----
  function inRegion(s) { return (!state.pref || s.p === state.pref) && (!state.city || s.cc === state.city); }

  function regionLabel() {
    if (!state.pref) return "全国";
    if (state.city) {
      const s = D.schools.find((x) => x.cc === state.city);
      return prefName[state.pref] + " " + (s ? s.c : "");
    }
    return prefName[state.pref];
  }

  function regionCounts() {
    const c = { jp: 0, univ: 0, jc: 0, kosen: 0, senmon: 0 };
    D.schools.forEach((s) => { if (inRegion(s)) c[s.t]++; });
    return c;
  }

  function rankOf(values, code) {
    const n = values[code];
    return n == null ? null : 1 + Object.values(values).filter((x) => x > n).length;
  }

  function unallocText(v) { return v.unallocated ? `都道府県不詳${fmt(v.unallocated)}人を含む` : ""; }

  function renderSummary() {
    const c = regionCounts();
    const higher = c.univ + c.jc + c.kosen;
    const row = (k, n, sub) => `<li class="${state.groups.has(k) ? "" : "off"}">${shape(k, 18)}<span>${GROUPS[k].label}${sub ? `<small>${sub}</small>` : ""}</span><b>${state.groups.has(k) ? fmt(n) + "校" : "非表示"}</b></li>`;
    const rows = row("jp", c.jp) + row("higher", higher, `大学${fmt(c.univ)}／短大${fmt(c.jc)}／高専${fmt(c.kosen)}`) + row("senmon", c.senmon);
    const ind = indicator();
    let metric = '<p class="m-empty">「人数の表示」を選ぶと、ここに人数が出ます。</p>';
    if (ind) {
      const v = variantOf(ind, state.variant);
      const n = state.pref ? v.values[state.pref] : v.national;
      const rank = state.pref ? rankOf(v.values, state.pref) : null;
      metric = `<div class="metric">
        <div class="m-label">${esc(short(ind, v))}</div>
        <div class="m-value">${valueText(n)}${!state.pref && v.unallocated ? `<small>（${unallocText(v)}）</small>` : ""}</div>
        <div class="m-sub">${state.city ? esc(prefName[state.pref]) + "全体・" : ""}${esc(ind.period)}・<a href="${esc(v.url)}" target="_blank" rel="noopener">出典</a>${rank ? `・全国${rank}位／47` : ""}</div>
        <p class="m-note">${esc(ind.note)}</p>
        <a class="m-link" href="ranking.html?m=${ind.id}:${v.id}">都道府県の順位を見る</a>
      </div>`;
    }
    const more = S.indicators.map((i) => {
      const v = variantOf(i, i.id === state.layer ? state.variant : "all");
      const n = state.pref ? v.values[state.pref] : v.national;
      return `<div class="ms"><div class="ms-head"><b>${esc(short(i, v))}</b><span>${valueText(n)}</span></div>
        <small>${esc(i.period)}・<a href="${esc(v.url)}" target="_blank" rel="noopener">出典</a>${!state.pref && v.unallocated ? `・全国${fmt(v.national)}人（${unallocText(v)}）` : ""}</small><p>${esc(i.scope)}</p></div>`;
    }).join("");
    $("summary").innerHTML = `
      <div class="sum-head"><h2>${esc(regionLabel())}</h2>${state.pref ? '<button type="button" class="link" id="to-nation">全国に戻す</button>' : ""}</div>
      <ul class="counts">${rows}</ul>
      ${metric}
      <details class="more-stats"><summary>人数と校数の説明</summary>${more}
        <p class="fine">校数は国の一覧をもとに地図へ登録した学校の数です。大学・短大・高専・専門学校は本部の所在地で数えています。日本語学校でもある専門学校は両方に数えるため、種類をまたいだ合計は出していません。</p></details>`;
    const nb = $("to-nation");
    if (nb) nb.addEventListener("click", () => { state.pref = ""; state.city = ""; state.limit = PAGE; $("sel-pref").value = ""; applyRegion(true); });
    updateShare(c, higher);
  }

  // X の文字数の数え方（日本語は1文字2、URLは長さに関係なく23）
  function xLen(text) {
    let n = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      n += c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247) ? 1 : 2;
    }
    return n;
  }

  function updateShare(c, higher) {
    const site = document.body.dataset.site;
    const url = site + query();
    const ind = indicator();
    const parts = [];
    if (state.groups.has("jp")) parts.push(`日本語学校${fmt(c.jp)}校`);
    if (state.groups.has("higher")) parts.push(`大学・短大・高専${fmt(higher)}校`);
    if (state.groups.has("senmon")) parts.push(`専門学校${fmt(c.senmon)}校`);
    let text = `${regionLabel()}の学校：${parts.join("、") || "種類を選択していません"}`;
    if (ind) {
      const v = variantOf(ind, state.variant);
      const n = state.pref ? v.values[state.pref] : v.national;
      text += `\n${state.pref ? prefName[state.pref] : "全国"}の${short(ind, v)}：${valueText(n)}（${ind.period}）`;
    }
    const tail = "\n日本語学校・留学生 全国マップ";
    if (xLen(text + tail) + 24 <= 280) text += tail;
    const a = $("share");
    a.href = "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
    a.dataset.text = text;
    a.dataset.url = url;
  }

  // ---- 学校一覧 ----
  function filtered() {
    const q = fold(state.q);
    return D.schools.filter((s) => inRegion(s) && state.groups.has(s.g) && (!state.kind || s.t === state.kind) && (!q || s.h.includes(q)));
  }

  function renderList() {
    const rows = filtered();
    $("list-title").textContent = `${regionLabel()}の学校一覧`;
    const limit = Math.min(state.limit, rows.length);
    $("list-count").textContent = state.groups.size === 0 ? "学校の種類を選んでください。" : `${fmt(rows.length)}校${rows.length > limit ? `（${fmt(limit)}校まで表示）` : ""}`;
    $("list").innerHTML = rows.slice(0, limit).map(itemHtml).join("");
    $("more").hidden = rows.length <= limit;
  }

  function fullAddress(s) { return s.a ? prefName[s.p] + s.a : ""; }

  function itemHtml(s) {
    return `<li><button type="button" class="sch-name" data-id="${esc(s.i)}">${esc(s.n)}</button>
      <div class="sch-meta">${shape(s.g, 14, s.lv === 0)}<span>${TYPES[s.t].label}</span>${s.la == null ? '<span class="tag">地図に位置なし</span>' : ""}${s.st ? `<span class="tag">${esc(s.st)}</span>` : ""}</div>
      <div class="sch-addr">${s.a ? esc(fullAddress(s)) : esc(prefName[s.p]) + "（所在地確認中）"}</div>
      <div class="sch-detail" hidden></div></li>`;
  }

  function detailHtml(s) {
    const lines = [];
    lines.push(`<h3>${esc(s.n)}</h3>`);
    const kind = TYPES[s.t].label + (s.s ? `（${s.s}）` : "");
    lines.push(`<p class="d-kind">${shape(s.g, 14)}${esc(kind)}</p>`);
    if (s.st) lines.push(`<p class="d-status">${esc(s.st)}</p>`);
    if (s.a) {
      lines.push(`<p>${esc(fullAddress(s))}</p>`);
    } else {
      lines.push(`<p>所在地を確認中です。<br><a href="https://www.google.com/maps/search/${encodeURIComponent(prefName[s.p] + " " + s.n)}" target="_blank" rel="noopener">Googleマップで探す</a></p>`);
    }
    if (s.la != null) {
      lines.push(`<p class="d-pos">位置の精度：${s.lv === 0 ? "町名の代表点です（建物の位置ではありません）" : "番地の区画の代表点です（建物の位置とは限りません）"}</p>`);
    } else if (s.a) {
      lines.push('<p class="d-pos">位置の精度：住所から位置を計算できないため、地図に点を置いていません</p>');
    }
    if (s.u) lines.push(`<p><a href="${esc(s.u)}" target="_blank" rel="noopener">公式サイト</a></p>`);
    const b = s.b.map((i) => D.bases[i]).map((x) => `<li>学校一覧の根拠：<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a></li>`);
    if (s.a) {
      const ab = s.ab != null ? D.bases[s.ab] : { name: s.an, url: s.au };
      b.push(`<li>所在地の根拠：<a href="${esc(ab.url)}" target="_blank" rel="noopener">${esc(ab.name)}</a></li>`);
    }
    lines.push(`<ul class="d-basis">${b.join("")}</ul>`);
    const fromSchool = s.an && s.an.startsWith("学校の") ? "住所は学校のページから読み取ったものです。最新の情報は学校へご確認ください。" : "";
    lines.push(`<p class="fine">確認日：${esc(s.ck)}${fromSchool ? "<br>" + fromSchool : ""}</p>`);
    return `<div class="detail">${lines.join("")}</div>`;
  }

  function openSchool(s, btn) {
    if (s.la != null && markers[s.i]) {
      if (window.matchMedia("(max-width: 899px)").matches) document.querySelector(".mapwrap").scrollIntoView({ behavior: "smooth", block: "start" });
      if (!state.groups.has(s.g)) {
        state.groups.add(s.g);
        $("chk-types").querySelector(`input[value="${s.g}"]`).checked = true;
        applyGroups();
        renderSide();
        writeUrl();
      }
      map.setView([s.la, s.ln], Math.max(map.getZoom(), 15), { animate: false });
      syncMode();
      cluster.zoomToShowLayer(markers[s.i], () => markers[s.i].openPopup());
    } else if (btn) {
      const box = btn.parentElement.querySelector(".sch-detail");
      box.hidden = !box.hidden;
      if (!box.hidden) box.innerHTML = detailHtml(s);
    }
  }

  // ---- 画像保存 ----
  // 選んだ地域の学校のうち、地図に写っていないものがあるか（校数は地域全体の数なので、画像に一言添える）
  function imagePartial() {
    if (useBubbles() && map.getBounds().contains(L.latLngBounds([[31, 130], [45, 145]]))) return false;
    const b = map.getBounds();
    return D.schools.some((s) => s.la != null && state.groups.has(s.g) && (!state.pref || s.p === state.pref) && (!state.city || s.cc === state.city) && !b.contains([s.la, s.ln]));
  }

  function imageSpec() {
    const c = regionCounts();
    const ind = indicator();
    const v = ind ? variantOf(ind, state.variant) : null;
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const slug = state.pref ? ROMAJI[Number(state.pref) - 1] + (state.city ? "-" + state.city : "") : "japan";
    return {
      siteName: document.body.dataset.name || "日本語学校・留学生 全国マップ",
      siteUrl: document.body.dataset.site,
      region: regionLabel(),
      checked: D.generated,
      file: `nihongo-map_${slug}_${stamp}.png`,
      bounds: map.getBounds(),
      bubbles: useBubbles(),
      home: useBubbles() && map.getBounds().contains(L.latLngBounds([[31, 130], [45, 145]])),
      partial: imagePartial(),
      selected: state.pref,
      geo: GEO,
      rep: repPoint,
      relax,
      groups: GROUPS,
      on: state.groups,
      points: D.schools.filter((s) => s.la != null && state.groups.has(s.g)).map((s) => ({ la: s.la, ln: s.ln, g: s.g, p: s.p, rough: s.lv === 0 })),
      rows: [
        { key: "jp", n: c.jp },
        { key: "higher", n: c.univ + c.jc + c.kosen, sub: `大学${fmt(c.univ)}／短大${fmt(c.jc)}／高専${fmt(c.kosen)}` },
        { key: "senmon", n: c.senmon },
      ],
      fill: ind ? (code) => colorFor(v.values[code], v.breaks) : null,
      fillOpacity: fillOpacity(),
      metric: ind ? {
        label: short(ind, v),
        value: valueText(state.pref ? v.values[state.pref] : v.national),
        area: state.pref ? prefName[state.pref] + (state.city ? "全体" : "") : "全国",
        extra: !state.pref && v.unallocated ? unallocText(v) : "",
        period: ind.period,
        note: ind.note,
        source: ind.source_name,
        scale: scaleRows(v),
      } : null,
    };
  }

  function openImage() {
    const dlg = $("img-dialog");
    const img = $("img-preview");
    const save = $("img-save");
    img.hidden = true;
    save.hidden = true;
    $("img-status").textContent = "画像を作っています…";
    dlg.showModal();
    const spec = imageSpec();
    setTimeout(() => {
      try {
        window.MapImage.render(spec).then((blob) => {
          if (imageUrl) URL.revokeObjectURL(imageUrl);
          imageUrl = URL.createObjectURL(blob);
          img.src = imageUrl;
          img.hidden = false;
          save.href = imageUrl;
          save.download = spec.file;
          save.hidden = false;
          $("img-status").textContent = `ファイル名：${spec.file}（1600×900ピクセル）`;
        }).catch(() => { $("img-status").textContent = "画像を作れませんでした。ページを開き直してお試しください。"; });
      } catch (e) {
        $("img-status").textContent = "画像を作れませんでした。ページを開き直してお試しください。";
      }
    }, 30);
  }

  // 動作確認用
  function check() {
    return {
      total: D.schools.length,
      mapped: D.schools.filter((s) => s.la != null).length,
      zoom: map.getZoom(),
      mode: map.hasLayer(bubbles) ? "県ごとの数" : "クラスタ",
      inCluster: cluster.getLayers().length,
      state: { pref: state.pref, city: state.city, groups: [...state.groups], layer: state.layer, variant: state.variant },
      list: filtered().length,
      url: location.search,
      share: $("share").dataset.text,
    };
  }
})();
