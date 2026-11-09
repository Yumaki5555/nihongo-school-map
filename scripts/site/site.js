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
  const RAMP = ["#FADFB8", "#F5C484", "#EBA053", "#CC7629", "#924C17"]; // 人数（国の統計）
  const COUNT_RAMP = ["#DCE9F2", "#B0CDE3", "#7AA9CF", "#4580B5", "#1F5487"]; // 学校の数（人数と見分けるため別の色）
  const ZERO = "#FFFFFF";
  const NODATA = "#D9D6CE";
  const PAGE = 50;
  const HOME = [[24.0, 122.6], [45.7, 146.0]]; // 沖縄まで入る範囲
  const NATION_BELOW = 6.5; // これより引いた全国表示では、学校の点を出さず都道府県ごとの校数を色で表す
  // 地図に出すもの：学校の数と場所／人数の分布（国の統計）。2つは別の情報なので同時には出さない
  const VIEWS = ["place", "stats"];
  const VEIL = 0.38; // 地域を選んでいる間、ほかの都道府県にかける白い膜の濃さ
  const ROMAJI = ["hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima", "ibaraki", "tochigi", "gunma", "saitama", "chiba", "tokyo", "kanagawa", "niigata", "toyama", "ishikawa", "fukui", "yamanashi", "nagano", "gifu", "shizuoka", "aichi", "mie", "shiga", "kyoto", "osaka", "hyogo", "nara", "wakayama", "tottori", "shimane", "okayama", "hiroshima", "yamaguchi", "tokushima", "kagawa", "ehime", "kochi", "fukuoka", "saga", "nagasaki", "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa"];

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fold = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[\s　]/g, "");
  // 住所の書き方の違いをそろえる（1丁目2番3号・1-2-3・1−2−3・1の2 を同じに）
  const norm = (s) => fold(s)
    .replace(/(\d)\s*丁目/g, "$1-").replace(/(\d)\s*番地?/g, "$1-").replace(/(\d)\s*号/g, "$1")
    .replace(/(\d)[‐‑‒–—―−ーｰ\-の](?=\d)/g, "$1-").replace(/-+/g, "-");

  // rough＝町名の代表点。白抜きで表す
  function shape(group, size, rough) {
    const g = GROUPS[group];
    const common = rough ? `fill="#fff" stroke="${g.color}" stroke-width="3"` : `fill="${g.color}" stroke="#fff" stroke-width="2"`;
    const body = g.shape === "circle" ? `<circle cx="11" cy="11" r="7" ${common}/>`
      : g.shape === "square" ? `<rect x="4.5" y="4.5" width="13" height="13" rx="1" ${common}/>`
      : `<path d="M11 2.5l8.5 8.5-8.5 8.5L2.5 11z" ${common}/>`;
    return `<svg class="shape" viewBox="0 0 22 22" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
  }

  const state = { pref: "", city: "", groups: new Set(Object.keys(GROUPS)), view: "place", layer: "", variant: "all", q: "", kind: "", limit: PAGE };
  let startSchool = "", D = null, S = null, GEO = null, byId = {}, prefName = {}, map = null, cluster = null, prefLayer = null, markers = {};
  const places = [];
  let imageUrl = "";

  // ---- 読み込み ----
  Promise.all(["data/schools.json", "data/stats.json", "data/prefectures.json"].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); })))
    .then(([d, s, g]) => { D = d; S = s; GEO = g; init(); })
    .catch(() => { $("summary").innerHTML = '<p class="note">データを読み込めませんでした。ページを開き直してください。</p>'; });

  function init() {
    GEO.features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
    GEO.features.forEach((f) => {
      prefName[f.properties.code] = f.properties.name;
    });
    D.schools.forEach((s) => {
      s.g = TYPES[s.t].group;
      // 「都道府県＋住所」「都道府県＋市区町村」「学校名」を | で区切る（区切りをまたいで一致させないため）
      s.h = norm([prefName[s.p] + (s.a || ""), prefName[s.p] + (s.c || ""), s.n].join("|"));
      s.hn = fold(s.n);
      byId[s.i] = s;
    });
    // 検索で選べる地域（都道府県と、学校のある市区町村）
    GEO.features.forEach((f) => {
      const n = f.properties.name;
      places.push({ p: f.properties.code, cc: "", label: n, key: norm(n), full: norm(n), count: 0 });
    });
    const cityOf = {};
    D.schools.forEach((s) => {
      places.find((x) => x.p === s.p && !x.cc).count++;
      if (!s.cc) return;
      if (!cityOf[s.cc]) places.push(cityOf[s.cc] = { p: s.p, cc: s.cc, label: s.c, key: norm(s.c), full: norm(prefName[s.p] + s.c), count: 0 });
      cityOf[s.cc].count++;
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
    state.layer = ind ? layer : S.indicators[0].id;
    if (ind) {
      const v = p.get("variant");
      state.variant = ind.variants.some((x) => x.id === v) ? v : "all";
    }
    // 以前の「両方」（view=both）や view のない古いリンクで人数を選んでいたものは、地域があれば学校の場所、なければ人数の分布で開く
    const view = p.get("view");
    state.view = VIEWS.includes(view) ? view : (view === "both" || ind) && !pref ? "stats" : "place";
  }

  function writeUrl() { history.replaceState(null, "", location.pathname + query()); }

  function query() {
    const p = new URLSearchParams();
    if (state.pref) p.set("pref", state.pref);
    if (state.city) p.set("city", state.city);
    if (state.groups.size < 3) p.set("types", [...state.groups].join(","));
    const custom = state.layer !== S.indicators[0].id || state.variant !== "all";
    if (state.view !== "place" || custom) p.set("view", state.view);
    if (custom) {
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
      `<label class="check"><input type="checkbox" value="${k}" aria-label="${GROUPS[k].label}" ${state.groups.has(k) ? "checked" : ""}>${shape(k, 20)}<span>${GROUPS[k].label}</span></label>`).join("");
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
    $("seg-view").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-view]");
      if (b) setView(b.dataset.view);
    });

    // 全国から学校をさがす
    const find = $("find");
    find.addEventListener("input", debounce(renderFind, 120));
    find.addEventListener("focus", renderFind);
    find.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeFind();
      if (e.key === "ArrowDown") { const b = $("find-results").querySelector("button"); if (b) { b.focus(); e.preventDefault(); } }
      if (e.key === "Enter") { const b = $("find-results").querySelector("button[data-id], button[data-pref]"); if (b) { pick(b); e.preventDefault(); } }
    });
    const pick = (b) => { if (b.dataset.pref) goRegion(b.dataset.pref, b.dataset.city || ""); else goSchool(byId[b.dataset.id]); };
    $("find-results").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.id || b.dataset.pref) pick(b);
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
    $("img-kinds").addEventListener("change", renderImage);
    $("img-ref").addEventListener("change", renderImage);
    $("img-save").addEventListener("click", () => { $("img-saved").hidden = false; });
    $("img-dialog").addEventListener("close", () => { imageJob++; $("img-preview").removeAttribute("src"); if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = ""; });

    // スマホでは閉じて地図を優先し、PCでは常に開く
    const mq = window.matchMedia("(min-width: 900px)");
    const setBoxes = () => { $("box-types").open = mq.matches; };
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
    const qa = norm($("find").value);
    const hit = D.schools.filter((s) => s.h.includes(qa));
    const shown = hit.filter((s) => state.groups.has(s.g));
    const rank = (s) => (s.hn.includes(q) ? 0 : 2) + (inRegion(s) ? 0 : 1);
    shown.sort((a, b) => rank(a) - rank(b) || a.n.length - b.n.length);
    // 地域：名前に入力が含まれるもの（「東京都新宿区」のように都道府県から書いても当たる）。
    // 並びは、名前の先頭が一致（都道府県→市区町村）→途中に含む、同じなら学校の多い順
    const withPref = (x) => x.cc && qa.length > norm(prefName[x.p]).length;
    const regions = places.filter((x) => x.key.includes(qa) || (withPref(x) && x.full.includes(qa)));
    const rrank = (x) => (x.key.startsWith(qa) || (withPref(x) && x.full.startsWith(qa)) ? 0 : 2) + (x.cc ? 1 : 0);
    regions.sort((a, b) => rrank(a) - rrank(b) || b.count - a.count || a.cc.localeCompare(b.cc));
    const pin = '<svg class="shape" viewBox="0 0 22 22" width="16" height="16" aria-hidden="true"><path d="M11 2a6 6 0 0 0-6 6c0 4.5 6 11.5 6 11.5s6-7 6-11.5a6 6 0 0 0-6-6z" fill="#7A6A45"/><circle cx="11" cy="8" r="2.3" fill="#fff"/></svg>';
    let html = "";
    if (regions.length) {
      html += '<p class="find-head">地域（押すと地図がその地域へ移動）</p>' + regions.slice(0, 5).map((x) =>
        `<button type="button" class="find-item" data-pref="${x.p}" data-city="${esc(x.cc)}">${pin}<span><b>${esc(x.label)}</b><small>${x.cc ? esc(prefName[x.p]) + "・" : ""}学校${fmt(x.count)}校</small></span></button>`).join("");
      if (regions.length > 5) html += `<p class="find-note">ほか${fmt(regions.length - 5)}地域。続けて入力すると絞り込めます。</p>`;
      if (shown.length) html += '<p class="find-head">学校</p>';
    }
    html += shown.slice(0, 8).map((s) =>
      `<button type="button" class="find-item" data-id="${esc(s.i)}">${shape(s.g, 16)}<span><b>${esc(s.n)}</b><small>${esc(prefName[s.p])}${esc(s.a || s.c || "")}・${TYPES[s.t].label}</small></span></button>`).join("");
    if (!shown.length && !regions.length) html += '<p class="find-note">表示中の種類には見つかりませんでした。</p>';
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

  function goRegion(p, cc) {
    closeFind();
    $("find").value = "";
    state.pref = p;
    state.city = cc;
    state.limit = PAGE;
    $("sel-pref").value = p;
    applyRegion(true);
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

    // ほぼ同じ場所に重なる学校だけをまとめる。押すと拡大し、いちばん拡大しても重なるときは広げて見せる
    cluster = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      maxClusterRadius: clusterRadius,
      iconCreateFunction: (c) => clusterIcon(c.getChildCount()),
    });
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
    map.on("zoomend", () => {
      const was = nationView.last;
      syncFill();
      syncMode();
      if (was !== nationView()) { renderLegend(); syncBadge(indicator(), variantOf(indicator(), state.variant)); }
    });
    // 概要や凡例の高さが変わって地図の大きさが変わったとき
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($("map"));
  }

  // まとめる距離（画面上のピクセル）。市区町村が見える拡大では、ほぼ同じ位置の学校だけをまとめる
  function clusterRadius(z) { return z < 10 ? 18 : z < 12 ? 10 : z < 14 ? 5 : 3; }

  // まとめた印：「3校」と単位を付け、市区町村の校数と取り違えないようにする
  function clusterIcon(n) {
    const w = n < 10 ? 40 : n < 100 ? 48 : 56;
    return L.divIcon({ html: `<span>${fmt(n)}校</span>`, className: "cl", iconSize: [w, 26] });
  }

  // 都道府県ごとの校数（表示中の種類。位置が分からない学校も都道府県は分かるので数える）
  function prefCounts() {
    const c = {};
    Object.keys(prefName).forEach((k) => { c[k] = 0; });
    D.schools.forEach((s) => { if (state.groups.has(s.g)) c[s.p]++; });
    return c;
  }

  // 校数の色の区切り（その時の47都道府県の数から、切りのよい数で5段階まで）。
  // 4分の1ずつの区切りに、東京都のような飛び抜けて多い県を分ける区切りを1つ足す
  function niceNum(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / p;
    return (m < 1.5 ? 1 : m < 2.5 ? 2 : m < 4 ? 3 : m < 7.5 ? 5 : 10) * p;
  }
  function countBreaks(values) {
    const v = Object.values(values).filter((x) => x > 0).sort((a, b) => a - b);
    const out = [];
    if (!v.length) return out;
    const add = (x) => { const b = niceNum(Math.max(2, x)); if (b > v[0] && b <= v[v.length - 1] && b > (out[out.length - 1] || 0)) out.push(b); };
    [0.25, 0.5, 0.75].forEach((q) => add(v[Math.min(v.length - 1, Math.floor(q * v.length))]));
    if (out.length) add(Math.sqrt(out[out.length - 1] * v[v.length - 1]));
    return out;
  }
  // 学校の数の色分け（地図と画像で共用）
  function countScale() {
    const values = prefCounts();
    const breaks = countBreaks(values);
    const ramp = COUNT_RAMP.slice(COUNT_RAMP.length - breaks.length - 1);
    return { values, breaks, ramp, color: (n) => colorFor(n, breaks, ramp), rows: scaleRows({ values, breaks }, "校", ramp) };
  }

  // 全国表示：地域を選ばず引いて見ているとき。学校の点は出さず、都道府県ごとの校数を色で表す
  function nationView() { return (nationView.last = !state.pref && map.getZoom() < NATION_BELOW); }

  // 地域を選んで点を見ている（人数の分布では地域へ寄せても色分けを残すので当たらない）
  function regionZoomed() { return !!state.pref && state.view !== "stats"; }
  // 都道府県を人数（国の統計）で塗るか
  function showFill() { return state.view === "stats"; }
  // 都道府県を学校の数で塗るか
  function showCount() { return state.view === "place" && nationView(); }

  function toggleLayer(layer, on) {
    if (on && !map.hasLayer(layer)) map.addLayer(layer);
    if (!on && map.hasLayer(layer)) map.removeLayer(layer);
  }

  // 人数の分布では学校の点を出さない（学校の所在地と国の統計を混ぜないため）。全国表示でも点は出さない
  function syncMode() {
    toggleLayer(cluster, state.view === "place" && !nationView());
  }

  function setView(v) {
    if (v === state.view || !VIEWS.includes(v)) return;
    const was = state.view;
    state.view = v;
    applyLayer();
    // 人数の分布との切り替えでは、選んでいる地域（なければ全国）を映し直す
    applyRegion(v === "stats" || (was === "stats" && !!state.pref));
    renderLegend();
  }

  function prefTip(code) {
    const ind = indicator();
    if (state.view === "place") {
      if (!showCount()) return esc(prefName[code]);
      return `<b>${esc(prefName[code])}</b><br>学校 ${fmt(prefCounts()[code])}校（表示中の種類）<br><small>押すと拡大して学校の位置を表示</small>`;
    }
    const v = variantOf(ind, state.variant);
    return `<b>${esc(prefName[code])}</b><br>${esc(short(ind, v))}：${valueText(v.values[code])}`;
  }

  function colorFor(n, br, ramp) {
    if (n == null) return NODATA;
    if (n === 0) return ZERO;
    let i = 0;
    while (i < br.length && n >= br[i]) i++;
    return (ramp || RAMP)[i];
  }

  function prefStyle(f) {
    const code = f.properties.code;
    const ind = indicator();
    const selected = code === state.pref;
    const base = { color: selected ? "#352D20" : "#7A6A45", weight: selected ? 3 : 1, opacity: selected ? 1 : 0.75 };
    // 地域を選んで拡大したら人数の色は消し、選んだ地域の外を白く薄めて輪郭を見やすくする
    if (regionZoomed()) return Object.assign(base, { fillColor: "#fff", fillOpacity: selected ? 0.001 : VEIL });
    if (showCount()) {
      const cs = prefStyle.count || (prefStyle.count = countScale());
      return Object.assign(base, { fillColor: cs.color(cs.values[code]), fillOpacity: 0.85 });
    }
    if (!showFill()) return Object.assign(base, { fillColor: "#fff", fillOpacity: 0.001 });
    const v = variantOf(ind, state.variant);
    return Object.assign(base, { fillColor: colorFor(v.values[code], v.breaks), fillOpacity: fillOpacity() });
  }

  // 拡大するほど色を薄くして、町名や道路が読めるようにする（凡例の色も合わせる）
  function fillOpacity() { return showCount() ? 0.85 : opacityAt(map ? map.getZoom() : 5); }
  function opacityAt(z) { return z >= 12 ? 0.25 : z >= 10 ? 0.4 : z >= 8 ? 0.62 : 0.85; }

  function restyle() { prefStyle.count = null; prefLayer.setStyle(prefStyle); }

  function syncFill() {
    restyle();
    $("legend").style.setProperty("--fo", fillOpacity());
  }

  function applyGroups() {
    cluster.clearLayers();
    cluster.addLayers(D.schools.filter((s) => s.la != null && state.groups.has(s.g)).map((s) => markers[s.i]));
    syncMode();
    if (showCount()) { restyle(); renderLegend(); }
    const on = [...state.groups];
    $("now-types").textContent = on.length === 3 ? "すべて" : on.length ? on.map((k) => GROUPS[k].label).join("、") : "なし";
  }

  function applyLayer() {
    const ind = indicator();
    const v = variantOf(ind, state.variant);
    const colored = state.view === "stats";
    $("seg-view").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
    $("sel-layer").hidden = !colored;
    const box = $("sel-variant");
    if (colored && ind.variants.length > 1) {
      box.innerHTML = ind.variants.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join("");
      box.value = state.variant;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    restyle();
    syncMode();
    syncBadge(ind, v);
    renderLegend();
    renderSummary();
    writeUrl();
  }

  // スマホで、地図の上に今の色分けを小さく出す
  function syncBadge(ind, v) {
    const badge = $("layer-badge");
    badge.hidden = !showFill() && !showCount();
    badge.textContent = showFill() ? `色：${short(ind, v)}（${ind.period}・国の統計）` : showCount() ? "色：都道府県ごとの学校の数" : "";
  }

  // 凡例の1段（画像でも同じものを使う）
  function scaleRows(v, unit, ramp) {
    const b = v.breaks, vals = Object.values(v.values), u = unit || "人", r = ramp || RAMP;
    const rows = r.map((color, i) => {
      const lo = i === 0 ? null : b[i - 1];
      const hi = i === r.length - 1 ? null : b[i] - 1;
      return { color, label: lo == null ? `${fmt(hi)}${u}以下` : hi == null ? `${fmt(lo)}${u}以上` : lo === hi ? `${fmt(lo)}${u}` : `${fmt(lo)}～${fmt(hi)}${u}` };
    });
    if (vals.includes(0)) rows.unshift({ color: ZERO, label: "0" + u });
    if (vals.some((x) => x == null)) rows.push({ color: NODATA, label: "データなし" });
    return rows;
  }

  function renderLegend() {
    const ind = indicator();
    const v = variantOf(ind, state.variant);
    const pts = `<div class="lg-points">${Object.keys(GROUPS).map((k) => `<span>${shape(k, 16)}${GROUPS[k].label}</span>`).join("")}<span>${shape("jp", 16, true)}白抜き＝町名までしか位置が分からない学校</span><span><i class="lg-cl">3校</i>＝近い場所の学校をまとめた数（押すと拡大）</span></div>`
      + '<p class="lg-note">点は1校に1つで、建物ではなく番地の区画や町の代表の位置です。大学・短大・高専・専門学校は本部・本校の所在地に置き、ほかのキャンパスは表示していません。</p>';
    const scale = `<div class="lg-title">${esc(short(ind, v))}<small>${esc(ind.period)}・都道府県ごとの国の統計</small></div><ul class="lg-scale">${scaleRows(v).map((r) => `<li><i><b style="background:${r.color}"></b></i>${r.label}</li>`).join("")}</ul><p class="lg-note">色の濃さは都道府県の人数の多さです。学校ごとの人数ではありません。</p>`;
    let html;
    if (state.view === "stats") html = scale + '<p class="lg-note">学校の点は「学校の数と場所」で表示します。</p>';
    else if (showCount()) {
      const cs = countScale();
      html = `<div class="lg-title">都道府県ごとの学校の数<small>色が濃いほど学校数が多い・表示中の種類の合計</small></div><ul class="lg-scale">${cs.rows.map((r) => `<li><i><b style="background:${r.color}"></b></i>${r.label}</li>`).join("")}</ul><p class="lg-note">学校の所在地を数えたもので、人数ではありません。都道府県を押すと拡大して、学校の位置を1校ずつ表示します。</p>`;
    } else html = pts;
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

  // 選んだ地域を映す範囲（地図と保存画像で共用）。市区町村はその学校の点、都道府県はいちばん大きい陸地
  function regionBounds() {
    if (state.city) {
      const pts = D.schools.filter((s) => s.cc === state.city && s.la != null).map((s) => [s.la, s.ln]);
      if (pts.length) return L.latLngBounds(pts).pad(0.25);
    }
    return mainBounds(state.pref).pad(0.08);
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
    restyle();
    if (move) {
      // 人数の分布は都道府県ごとの数なので、市区町村を選んでいても都道府県全体を映す（色分けは残し、選んだ県は太線）
      if (!state.pref) map.fitBounds(HOME, opt);
      else if (state.view === "stats") map.fitBounds(mainBounds(state.pref).pad(0.08), opt);
      else map.fitBounds(regionBounds(), Object.assign({ maxZoom: 14 }, opt));
    }
    syncMode();
    syncBadge(indicator(), variantOf(indicator(), state.variant));
    renderLegend();
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

  function countsWhere(test) {
    const c = { jp: 0, univ: 0, jc: 0, kosen: 0, senmon: 0 };
    D.schools.forEach((s) => { if (test(s)) c[s.t]++; });
    return c;
  }
  function regionCounts() { return countsWhere(inRegion); }

  function rankOf(values, code) {
    const n = values[code];
    return n == null ? null : 1 + Object.values(values).filter((x) => x > n).length;
  }

  function unallocText(v) { return v.unallocated ? `都道府県不詳${fmt(v.unallocated)}人を含む` : ""; }

  // 地図の上（スマホでは下）の概要：学校の所在地と、都道府県ごとの国の統計を分けて出す
  function renderSummary() {
    const c = regionCounts();
    const higher = c.univ + c.jc + c.kosen;
    const row = (k, n) => `<li class="${state.groups.has(k) ? "" : "off"}">${shape(k, 16)}<span>${GROUPS[k].label}</span><b>${state.groups.has(k) ? fmt(n) + "校" : "非表示"}</b></li>`;
    const rows = row("jp", c.jp) + row("higher", higher) + row("senmon", c.senmon);
    // 登録した学校と、地図に点を置けた学校の数（種類のチェックに合わせる）
    const reg = D.schools.filter((s) => inRegion(s) && state.groups.has(s.g));
    const mapped = reg.filter((s) => s.la != null).length;
    const pos = reg.length === mapped ? "" : `<p class="sum-pos">登録${fmt(reg.length)}校／地図に位置を表示できる${fmt(mapped)}校<small>（${fmt(reg.length - mapped)}校は位置が確認できないため、学校一覧にだけ載せています）</small></p>`;
    const ind = indicator();
    const v = variantOf(ind, state.variant);
    // 日本語指導：推移と内訳のページへ（選んでいる都道府県と、外国籍・日本国籍の区分を引き継ぐ）
    const nihongoLink = (iv) => {
      const p = new URLSearchParams();
      if (state.pref) p.set("pref", state.pref);
      const s = { foreign: "f", japan: "j" }[iv.id];
      if (s) p.set("s", s);
      const q = p.toString();
      return ` <a class="nj-link" href="nihongo.html${q ? "?" + q : ""}#trend">人数の内訳・推移を見る</a>`;
    };
    const n = state.pref ? v.values[state.pref] : v.national;
    const rank = state.pref ? rankOf(v.values, state.pref) : null;
    const rk = `ranking.html?m=${ind.id}:${v.id}`;
    const area = state.city ? prefName[state.pref] + "全体の" : "";
    const metric = `<div class="sum-block">
        <h3>都道府県別の人数（国の統計）</h3>
        <div class="m-line"><span class="m-label">${esc(area + short(ind, v))}</span><b class="m-value">${valueText(n)}</b></div>
        <div class="m-sub">基準日 ${esc(ind.period)}・${rank ? `<a href="${rk}">全国${rank}位／47</a>` : `<a href="${rk}">都道府県の順位</a>`}・<a href="${esc(v.url)}" target="_blank" rel="noopener">出典</a>${!state.pref && v.unallocated ? `・${unallocText(v)}` : ""}。${esc(ind.note)}${ind.id === "nihongo" ? nihongoLink(v) : ""}</div>
      </div>`;
    $("summary").innerHTML = `
      <div class="sum-head"><h2>${esc(regionLabel())}</h2>${state.pref ? '<button type="button" class="link" id="to-nation">全国に戻す</button>' : ""}</div>
      <div class="sum-grid">
        <div class="sum-block"><h3>学校の所在地</h3><ul class="counts">${rows}</ul>${pos}</div>
        ${metric}
      </div>`;
    const more = S.indicators.map((i) => {
      const iv = variantOf(i, i.id === state.layer ? state.variant : "all");
      const x = state.pref ? iv.values[state.pref] : iv.national;
      return `<div class="ms"><div class="ms-head"><b>${esc(short(i, iv))}</b><span>${valueText(x)}</span></div>
        <small>基準日 ${esc(i.period)}・<a href="${esc(iv.url)}" target="_blank" rel="noopener">出典</a>${!state.pref && iv.unallocated ? `・全国${fmt(iv.national)}人（${unallocText(iv)}）` : ""}${i.id === "nihongo" ? nihongoLink(iv) : ""}</small><p>${esc(i.scope)}</p></div>`;
    }).join("");
    const opened = $("summary-more").querySelector("details[open]") ? " open" : "";
    $("summary-more").innerHTML = `<details class="more-stats"${opened}><summary>${esc(regionLabel())}の数字の説明</summary>
        <p class="fine">大学・短大・高専の内訳：大学${fmt(c.univ)}校／短大${fmt(c.jc)}校／高専${fmt(c.kosen)}校</p>
        ${more}
        <p class="fine">対象と基準日が異なる統計は、同じ集団の人数として合算・単純比較できません。</p>
        <p class="fine">校数は国の一覧をもとに地図へ登録した学校の数です。大学・短大・高専・専門学校は本部・本校の所在地で数えています。日本語学校でもある専門学校は両方に数えるため、種類をまたいだ合計は出していません。</p></details>`;
    const nb = $("to-nation");
    if (nb) nb.addEventListener("click", () => { state.pref = ""; state.city = ""; state.limit = PAGE; $("sel-pref").value = ""; applyRegion(true); });
    updateShare();
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

  // X に入る長さか（URL は長さに関係なく23）
  const X_LIMIT = 280;
  function fitsX(text, url) { return xLen(text.replace(url, "")) + 23 <= X_LIMIT; }

  // 全国を見ているときの投稿文（改善指示書の文のまま）
  function nationShareText() {
    return `あなたの地域に、日本語学校・大学・専門学校はどこに、何校ある？\n\n全国の学校の所在地と、国の統計による留学生等の人数を地図で確認できます。\n\n【テスト運用中】\n${document.body.dataset.site}`;
  }

  // 地域を選んでいるときの投稿文：実際の校数・地域名・統計名から作り、長すぎたら統計の部分を短くする
  function regionShareText() {
    const url = document.body.dataset.site + query();
    const c = regionCounts();
    const parts = [];
    if (state.groups.has("jp")) parts.push(`日本語学校が${fmt(c.jp)}校`);
    if (state.groups.has("higher")) parts.push(`大学・短大・高専が${fmt(c.univ + c.jc + c.kosen)}校`);
    if (state.groups.has("senmon")) parts.push(`専門学校が${fmt(c.senmon)}校`);
    const head = parts.length ? `${regionLabel()}には、${parts.join("、")}あります。` : `${regionLabel()}の学校の所在地を地図で確認できます。`;
    const ind = indicator(), v = variantOf(ind, state.variant);
    const n = v.values[state.pref];
    const survey = (ind.source_name.match(/「(.+?)」/) || [])[1];
    const what = `${prefName[state.pref]}${state.city ? "全体" : ""}の${short(ind, v)}は${valueText(n)}（${ind.period}）`;
    const tail = `\n\n【テスト運用中】\n${url}`;
    const options = n == null ? [head] : [`${head}\n国の統計（${survey}）では、${what}。`, `${head}\n国の統計では、${what}。`, head];
    return options.map((t) => t + tail).find((t) => fitsX(t, url)) || head.slice(0, 100) + tail;
  }

  function intentUrl(text) { return "https://x.com/intent/post?text=" + encodeURIComponent(text); }

  function updateShare() {
    const text = state.pref ? regionShareText() : nationShareText();
    const a = $("share");
    a.href = intentUrl(text);
    a.dataset.text = text;
  }

  // ---- 学校一覧 ----
  function filtered() {
    const q = norm(state.q);
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

  // ---- 画像保存（3種類） ----
  // schools＝全国の学校分布／stats＝全国の人数分布／region＝選択した地域（地域を選んでいるときだけ）

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  // 学校一覧の根拠の機関名（「出入国在留管理庁「…」」の「の前）
  function agencies() {
    return [...new Set(D.bases.map((b) => b.name.split("「")[0]))].join("・");
  }

  function schoolRows(c) {
    return [
      { key: "jp", n: c.jp },
      { key: "higher", n: c.univ + c.jc + c.kosen, sub: `大学${fmt(c.univ)}校／短大${fmt(c.jc)}校／高専${fmt(c.kosen)}校` },
      { key: "senmon", n: c.senmon },
    ];
  }

  // 日付の書き方（2026-11-07 → 2026年11月7日）
  function jpDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : iso;
  }

  // 表示中の学校の種類（画像の小見出し用）
  function typesText() {
    const on = Object.keys(GROUPS).filter((k) => state.groups.has(k)).map((k) => GROUPS[k].label);
    return on.length ? on.join("・") : "学校";
  }

  function topRows(values, unit) {
    const codes = Object.keys(values).filter((k) => values[k] != null).sort((a, b) => values[b] - values[a] || a.localeCompare(b));
    return codes.slice(0, 5).map((k) => ({ rank: rankOf(values, k), name: prefName[k], value: unit === "校" ? `${fmt(values[k])}校` : valueText(values[k]) }));
  }

  function imageBase(kind) {
    const ind = indicator();
    const v = variantOf(ind, state.variant);
    return {
      kind,
      siteName: document.body.dataset.name || "日本語学校・留学生 全国マップ",
      siteUrl: document.body.dataset.site,
      geo: GEO,
      groups: GROUPS,
      on: state.groups,
      metric: { label: short(ind, v), period: ind.period, note: ind.note, source: ind.source_name },
      schoolLine: `学校：${agencies()}の公表資料をもとに作成（確認日 ${jpDate(D.generated)}）。点や色は学校の所在地で、人数ではありません。`,
      statLine: `統計：${ind.source_name}／基準日 ${ind.period}`,
    };
  }

  // 全国の2種類（A：学校分布／B：人数分布）
  function imageSpec(kind) {
    const ind = indicator();
    const v = variantOf(ind, state.variant);
    const base = imageBase(kind);
    if (kind === "schools") {
      const cs = countScale();
      return Object.assign(base, {
        title: "都道府県別の学校の数",
        subtitle: `数えたもの：${typesText()}の所在地（国の一覧に載っている学校）・確認日 ${jpDate(D.generated)}`,
        file: `nihongo-map_schools_japan_${dateStamp()}.png`,
        fill: (code) => cs.color(cs.values[code]),
        fillOpacity: 0.9,
        selected: state.pref,
        rows: schoolRows(countsWhere(() => true)),
        scale: cs.rows,
        top: topRows(cs.values, "校"),
        metric: null,
        notes: [
          "色は表示中の種類の校数の合計です。人数ではありません。",
          "大学・短大・高専・専門学校は本部・本校の所在地で数えています。日本語学校でもある専門学校があるため、種類をまたいだ合計は出していません。",
        ],
        foot: [base.schoolLine],
      });
    }
    const rank = state.pref ? rankOf(v.values, state.pref) : null;
    return Object.assign(base, {
      title: `都道府県別の${short(ind, v)}`,
      subtitle: `国の統計：${ind.source_name.replace(/（e-Stat）$/, "")}・基準日 ${ind.period}`,
      file: `nihongo-map_${ind.id}${v.id !== "all" ? "-" + v.id : ""}_japan_${dateStamp()}.png`,
      fill: (code) => colorFor(v.values[code], v.breaks),
      fillOpacity: opacityAt(5), // 全国を見ている「人数の分布」と同じ濃さ
      selected: state.pref,
      metric: Object.assign(base.metric, {
        national: valueText(v.national),
        extra: v.unallocated ? unallocText(v) : "",
        top: topRows(v.values, "人"),
        scale: scaleRows(v),
        pick: state.pref ? `${prefName[state.pref]} ${valueText(v.values[state.pref])}${rank ? `（全国${rank}位／47）` : ""}` : "",
      }),
      foot: [base.statLine],
      footExtra: "。色は都道府県ごとの人数（国の統計）で、学校の所在地とは別の情報です。",
    });
  }

  // 画像用の地図データ（同じサイトの data/geo/。一度読んだら使い回す）
  const geoCache = {};
  function getJson(u) {
    if (!geoCache[u]) geoCache[u] = fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); }).catch((e) => { delete geoCache[u]; throw e; });
    return geoCache[u];
  }

  function cityName() {
    const s = state.city ? D.schools.find((x) => x.cc === state.city) : null;
    return s ? s.c : "";
  }

  // C の共通部分（地図でもグラフでも同じ）
  function regionBase(kind) {
    const ind = indicator();
    const v = variantOf(ind, state.variant);
    const base = imageBase(kind);
    const on = (s) => state.groups.has(s.g);
    // 市区町村の画像では、都道府県全体の人数は「参考」として選んだときだけ入れる
    const withStat = !state.city || $("img-ref").checked;
    const slug = ROMAJI[Number(state.pref) - 1] + (state.city ? "-" + state.city : "");
    return Object.assign(base, {
      title: regionLabel(),
      subtitle: `${typesText()}の所在地・学校の確認日 ${jpDate(D.generated)}`,
      prefName: prefName[state.pref],
      cityName: cityName(),
      pref: state.pref,
      city: state.city,
      file: `nihongo-map_${slug}_${dateStamp()}.png`,
      rows: schoolRows(regionCounts()),
      unmapped: D.schools.filter((s) => inRegion(s) && on(s) && s.la == null).length,
      metric: withStat ? Object.assign(base.metric, {
        area: prefName[state.pref],
        value: valueText(v.values[state.pref]),
        rank: rankOf(v.values, state.pref),
        ref: !!state.city,
      }) : null,
      foot: [base.schoolLine].concat(withStat ? [base.statLine] : []),
    });
  }

  // C：選択した地域の地図（市区町村の境界・線路・駅は、その範囲にかかる都道府県の分だけ読む）
  async function regionSpec() {
    const base = regionBase("region");
    const [idx, own] = await Promise.all([getJson("data/geo/index.json"), getJson(`data/geo/p${state.pref}.json`)]);
    let bb;
    if (state.city) {
      const c = own.cities.find((x) => x.c === state.city);
      if (!c) throw new Error("city");
      bb = c.mb;
    } else {
      const b = mainBounds(state.pref);
      bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
    }
    const pad = state.city ? 0.07 : 0.05, dy = (bb[2] - bb[0]) * pad, dx = (bb[3] - bb[1]) * pad;
    const bounds = { s: bb[0] - dy, w: bb[1] - dx, n: bb[2] + dy, e: bb[3] + dx };
    // 枠の縦横に合わせて広がる分も含めて、かかる県を探す
    const span = Math.max(bounds.n - bounds.s, (bounds.e - bounds.w) * 0.62);
    const wide = { s: bounds.s - span, n: bounds.n + span, w: bounds.w - span * 1.7, e: bounds.e + span * 1.7 };
    const codes = Object.keys(idx.prefs).filter((c) => c !== state.pref && idx.prefs[c].bbs.some((x) => x[0] <= wide.n && x[2] >= wide.s && x[1] <= wide.e && x[3] >= wide.w));
    const others = await Promise.all(codes.map((c) => getJson(`data/geo/p${c}.json`)));
    const on = (s) => state.groups.has(s.g);
    const cityCounts = {};
    D.schools.forEach((s) => { if (s.p === state.pref && on(s) && s.cc) cityCounts[s.cc] = (cityCounts[s.cc] || 0) + 1; });
    const mb = mainBounds(state.pref).pad(0.04);
    return Object.assign(base, {
      bounds,
      locator: state.city ? { n: mb.getNorth(), s: mb.getSouth(), w: mb.getWest(), e: mb.getEast() } : null,
      local: [own].concat(others),
      cityCounts,
      points: D.schools.filter((s) => inRegion(s) && on(s) && s.la != null).map((s) => ({ la: s.la, ln: s.ln, g: s.g, rough: s.lv === 0 })),
    });
  }

  // 地図データが読めないとき：校数のグラフ（都道府県なら学校の多い市区町村、市区町村なら種類ごと）
  function chartSpec() {
    const base = regionBase("chart");
    const on = (s) => state.groups.has(s.g);
    let bars, barsTitle;
    if (state.city) {
      barsTitle = `${regionLabel()}の学校の数（種類ごと）`;
      bars = base.rows.filter((r) => state.groups.has(r.key)).map((r) => ({ name: GROUPS[r.key].label, n: r.n, color: GROUPS[r.key].color }));
    } else {
      const c = {};
      D.schools.forEach((s) => { if (s.p === state.pref && on(s) && s.cc) c[s.cc] = c[s.cc] || { name: s.c, n: 0 }, c[s.cc].n++; });
      bars = Object.values(c).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 10);
      barsTitle = `${prefName[state.pref]}で学校の多い市区町村（上位${bars.length}）`;
    }
    return Object.assign(base, { bars, barsTitle });
  }

  function imageKind() {
    const r = $("img-kinds").querySelector("input:checked");
    return r ? r.value : "schools";
  }

  // 選んだ種類の画像を作ってプレビューに出す
  let imageJob = 0;
  function renderImage() {
    const kind = imageKind();
    const job = ++imageJob;
    const img = $("img-preview");
    const save = $("img-save");
    save.hidden = true;
    $("img-ref-box").hidden = !(kind === "region" && state.city);
    $("img-status").textContent = "画像を作っています…";
    // 投稿文：全国の画像は全国の文、地域の画像は地域の文
    const text = kind === "region" ? regionShareText() : nationShareText();
    $("img-x").href = intentUrl(text);
    $("img-x-text").textContent = text;
    const fail = () => { if (job === imageJob) $("img-status").textContent = "画像を作れませんでした。ページを開き直してお試しください。"; };
    let fallback = false;
    const make = kind === "region" ? regionSpec().catch(() => { fallback = true; return chartSpec(); }) : new Promise((r) => setTimeout(() => r(imageSpec(kind)), 30));
    make.then((spec) => window.MapImage.render(spec).then((blob) => {
      if (job !== imageJob) return;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(blob);
      img.src = imageUrl;
      img.alt = `保存する画像のプレビュー：${spec.title}`;
      img.hidden = false;
      save.href = imageUrl;
      save.download = spec.file;
      save.hidden = false;
      $("img-status").textContent = (fallback ? "地図データを読み込めなかったため、校数のグラフで作りました。" : "") + `ファイル名：${spec.file}（1600×900ピクセル）`;
    })).catch(fail);
  }

  function openImage() {
    const dlg = $("img-dialog");
    const ind = indicator();
    const region = $("img-kinds").querySelector('input[value="region"]');
    region.disabled = !state.pref;
    $("img-kind-stats").textContent = `いま選んでいる統計「${short(ind, variantOf(ind, state.variant))}」の色分け`;
    $("img-kind-region").textContent = state.pref ? `${regionLabel()}の地図（境界・駅・学校の位置）と校数` : "地域を選ぶと使えます";
    if (state.pref) $("img-ref-label").textContent = `参考として${prefName[state.pref]}全体の${short(ind, variantOf(ind, state.variant))}（国の統計）を入れる`;
    $("img-ref").checked = false;
    const kind = state.pref ? "region" : state.view === "stats" ? "stats" : "schools";
    $("img-kinds").querySelector(`input[value="${kind}"]`).checked = true;
    $("img-saved").hidden = true;
    $("img-preview").hidden = true;
    dlg.showModal();
    $("img-kinds").querySelector("input:checked").focus(); // 矢印キーで種類を選び直せるよう、選ばれている種類に合わせる
    renderImage();
  }

  // 動作確認用
  function check() {
    return {
      total: D.schools.length,
      mapped: D.schools.filter((s) => s.la != null).length,
      zoom: map.getZoom(),
      mode: showCount() ? "県ごとの校数の色分け" : map.hasLayer(cluster) ? "学校の点" : "点なし",
      clusters: map.hasLayer(cluster) ? (() => { let n = 0; cluster._featureGroup.eachLayer((l) => { if (l.getChildCount && map.getBounds().contains(l.getLatLng())) n++; }); return n; })() : 0,
      inCluster: cluster.getLayers().length,
      state: { pref: state.pref, city: state.city, groups: [...state.groups], view: state.view, layer: state.layer, variant: state.variant },
      fill: showFill(),
      summary: $("summary").innerText.replace(/\s+/g, " ").trim(),
      list: filtered().length,
      url: location.search,
      share: $("share").dataset.text,
    };
  }
})();
