/* 外国籍の子ども（学校基本調査の外国人児童生徒）のページ：人数の推移（全国・都道府県）と、内訳（都道府県別・学校種別・国立公立私立別。学校種別・国立公立私立別は2年の比較も）。
   データは data/foreign_jido.json（scripts/fetch_foreign_jido.py が国の表から作り、照合済み）。
   画面の部品は日本語指導のページ（nihongo.js）と同じ作りで、見た目をそろえるため id と class も同じ名前（nj-）を使う */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 公立＝青、私立＝緑（日本語指導のページの国籍と同じ2色）、国立＝橙（白地とのコントラスト3:1以上）、合計＝茶
  const COLOR = { k: "#B8661C", p: "#2B5FA8", s: "#3E9A4E", all: "#5F4615" };
  const PAIR = { a: "#9A8455", b: "#3F3018" };
  const OWN = { all: "合計", k: "国立", p: "公立", s: "私立", both: "公立と私立" };
  const OWN_ONLY = { all: "国立・公立・私立の合計", p: "公立のみ", s: "私立のみ" };
  const VIEW = { pref: "都道府県別", type: "学校種別", owner: "国立・公立・私立別" };
  const SITE_NAME = "日本語学校・留学生 全国マップ";
  const SURVEY = "文部科学省「学校基本調査」";
  const QUICK = [1, 5, 10];
  const BACK = 5; // 比較元の初期値（比較先の5年前）
  const MAP_VARIANT = { elem: "elem", mid: "mid", high: "high" }; // 地図（index.html）の区分。ほかは地図の「合計」
  const PAGE47 = 12;
  // t＝推移の学校の種類、s＝推移の国立公立私立、bt＝内訳（都道府県別・国立公立私立別）の学校の種類、n＝内訳（都道府県別・学校種別）の国立公立私立
  const state = { pref: "", pref2: "", t: "all", s: "all", a: null, b: null, v: "pref", bt: "all", n: "all", y: null, top: 10, mode: "one", ya: null, yb: null };
  let N, Y = {}, YEARS = [], LATEST, CODES = [], TYPE = {}, TYPE_IDS = [], T = {}, T_IDS = [];
  let urlTimer = 0, imageUrl = "", imageJob = 0, imageWhich = "trend", imagePage = 0;

  fetch("data/foreign_jido.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { N = d; init(); })
    .catch(() => { $("nj-loading").hidden = true; $("nj-error").hidden = false; });

  // ---- 共通 ----
  const md = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${Number(m[2])}月${Number(m[3])}日` : ""; };
  const jpDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : ""; };
  const areaName = (code) => (code ? N.prefs[code] : "全国");
  const when = (o) => `${o.year}年（${o.fy}・${md(o.as_of)}現在）`;
  function roundDiv(n, d) { const s = n < 0 ? -1 : 1; const a = Math.abs(n); return s * Math.floor((2 * a + d) / (2 * d)); }
  const pctText = (part, whole) => (whole > 0 ? (roundDiv(part * 1000, whole) / 10).toFixed(1) + "％" : "—");
  function dateStamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }
  // 表示する対象の名前（例：外国籍の児童生徒（高等学校・私立））
  const what = (t, n) => `外国籍の児童生徒（${T[t].short}${n && n !== "all" ? "・" + OWN[n] : ""}）`;

  // ---- 人数 ----
  // その年・地域・学校の種類の [国立, 公立, 私立]。公表されていない年・区分がない年は null（0 とは区別する）。
  // 合計と「小・中学校」は、まだない学校の種類（2016年より前の義務教育学校）を除いて足す。1つでも公表されていなければ null
  function trip(y, code, t) {
    const o = Y[y];
    if (!T[t].ids) { if (y < TYPE[t].from) return null; const v = code ? (o.pref[t] ? o.pref[t][code] : null) : o.nat[t]; return v || null; }
    const acc = [0, 0, 0];
    for (const id of T[t].ids) {
      if (y < TYPE[id].from) continue;
      const v = code ? (o.pref[id] ? o.pref[id][code] : null) : o.nat[id];
      if (!v) return null;
      v.forEach((x, i) => { acc[i] += x; });
    }
    return acc;
  }
  const pick = (tr, s) => (tr == null ? null : s === "k" ? tr[0] : s === "p" ? tr[1] : s === "s" ? tr[2] : tr[0] + tr[1] + tr[2]);
  const val = (y, code, t, s) => pick(trip(y, code, t), s);
  // 選べない理由（なければ ""）。area が真なら都道府県別の数を使う
  function why(t, y, area) {
    if (!T[t].ids && y < TYPE[t].from) return `${T[t].label}は${TYPE[t].from}年にできた学校の種類で、${y}年は区分がありません`;
    if (area && y < T[t].pref_from) return `${y}年は都道府県別の${t === "all" || t === "em" ? "高等学校・中等教育学校・特別支援学校" : T[t].label}の数が公表されていません（${T[t].pref_from}年から）`;
    return "";
  }
  const regions = () => (state.pref2 && state.pref ? [state.pref, state.pref2] : [state.pref]);
  const availYears = (t, s) => YEARS.filter((y) => regions().every((c) => val(y, c, t, s === "both" ? "all" : s) != null));

  function change(a, b) {
    const d = b - a;
    if (a === 0) return { d, pct: null, ratio: null };
    return { d, pct: roundDiv(d * 1000, a), ratio: roundDiv(b * 100, a) };
  }
  function changeText(a, b) {
    const c = change(a, b);
    const diff = c.d > 0 ? `${fmt(c.d)}人増` : c.d < 0 ? `${fmt(-c.d)}人減` : "増減なし";
    if (c.pct === null) return { diff, pct: "計算できません", ratio: "計算できません", zero: true };
    const p = c.pct > 0 ? "+" + (c.pct / 10).toFixed(1) : c.pct < 0 ? "−" + (-c.pct / 10).toFixed(1) : "±0.0";
    return { diff, pct: p + "％", ratio: (c.ratio / 100).toFixed(2) + "倍", zero: false };
  }
  const moveWord = (d) => (d > 0 ? `${fmt(d)}人増加` : d < 0 ? `${fmt(-d)}人減少` : "増減なし");
  // 調査は毎年なので、n年前はちょうどその年だけ（なければ選べない）
  const nYearsAgo = (n, b, years) => (years.includes(b - n) ? b - n : null);
  const prevYear = (b, years) => nYearsAgo(BACK, b, years) || years.filter((y) => y < b)[0] || years.find((y) => y !== b) || null;

  function init() {
    N.years.forEach((o) => { Y[o.year] = o; });
    YEARS = N.years.map((o) => o.year).sort((a, b) => a - b);
    LATEST = YEARS[YEARS.length - 1];
    N.types.forEach((t) => { TYPE[t.id] = t; });
    TYPE_IDS = N.types.map((t) => t.id);
    // 学校の種類の選択肢：合計（6種類）、小・中学校（義務教育学校を含む。2009年から都道府県別で続けて見られる）、各種類
    const pf = (ids) => Math.max(...ids.map((i) => TYPE[i].pref_from));
    T = { all: { label: "合計（6種類の学校）", short: "合計", ids: TYPE_IDS, pref_from: pf(TYPE_IDS) }, em: { label: "小・中学校（義務教育学校を含む）", short: "小・中学校", ids: ["elem", "mid", "compul"], pref_from: pf(["elem", "mid"]) } };
    N.types.forEach((t) => { T[t.id] = { label: t.label, short: t.short || t.label, pref_from: t.pref_from }; });
    T_IDS = Object.keys(T);
    CODES = Object.keys(N.prefs).sort();
    $("nj-pref").innerHTML = '<option value="">全国</option>' + CODES.map((c) => `<option value="${c}">${esc(N.prefs[c])}</option>`).join("");
    $("nj-t").innerHTML = T_IDS.map((t) => `<option value="${t}">${esc(T[t].label)}</option>`).join("");
    readUrl();
    $("nj-src-table").innerHTML = sourceTable();
    $("nj-pref").addEventListener("change", (e) => { state.pref = e.target.value; if (state.pref2 === state.pref) state.pref2 = ""; render(); });
    $("nj-pref2").addEventListener("change", (e) => { state.pref2 = e.target.value; render(); });
    $("nj-t").addEventListener("change", (e) => { state.t = e.target.value; render(); });
    $("nj-bt").addEventListener("change", (e) => { state.bt = e.target.value; render(); });
    seg("nj-s", "s", (v) => { state.s = v; });
    seg("nj-v", "v", (v) => { state.v = v; });
    seg("nj-n", "n", (v) => { state.n = v; });
    seg("nj-top", "top", (v) => { state.top = Number(v); });
    seg("nj-mode", "mode", (v) => { if (v === "two" && state.mode !== "two") { state.yb = state.y; state.ya = null; } if (v === "one" && state.mode === "two") state.y = state.yb; state.mode = v; });
    $("nj-a").addEventListener("change", (e) => { state.a = Number(e.target.value); state.same = state.a === state.b; render(); });
    $("nj-b").addEventListener("change", (e) => { state.b = Number(e.target.value); state.same = state.a === state.b; render(); });
    $("nj-y").addEventListener("change", (e) => { state.y = Number(e.target.value); render(); });
    $("nj-ya").addEventListener("change", (e) => { state.ya = Number(e.target.value); state.sameBd = state.ya === state.yb; render(); });
    $("nj-yb").addEventListener("change", (e) => { state.yb = Number(e.target.value); state.sameBd = state.ya === state.yb; render(); });
    $("nj-quick").addEventListener("click", (e) => { const b = e.target.closest("button[data-a]"); if (b && !b.disabled) { state.a = Number(b.dataset.a); render(); } });
    $("nj-jump").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-go]");
      if (!b) return;
      if (b.dataset.go !== "trend") { state.v = b.dataset.go; render(); }
      jumpTo(b.dataset.go === "trend" ? "trend" : "breakdown");
    });
    $("nj-trend-acts").innerHTML = actButtons("trend");
    $("nj-bd-acts").innerHTML = actButtons("bd");
    $("nj-img-trend").addEventListener("click", () => openImage("trend"));
    $("nj-img-bd").addEventListener("click", () => openImage("bd"));
    $("img-close").addEventListener("click", () => $("img-dialog").close());
    $("img-save").addEventListener("click", () => { $("img-saved").hidden = false; });
    $("img-page").addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (b) { imagePage = Number(b.dataset.p); renderImage(); } });
    let lastW = 0;
    window.addEventListener("resize", () => { const w = $("nj-trend-chart").clientWidth; if (Math.abs(w - lastW) > 8) { lastW = w; drawTrend(); } });
    $("nj-loading").hidden = true;
    $("nj-main").hidden = false;
    render();
    lastW = $("nj-trend-chart").clientWidth;
    if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
  }

  function jumpTo(id) {
    const el = $(id);
    let off = 0;
    document.elementsFromPoint(window.innerWidth / 2, 2).forEach((e) => { const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") off = Math.max(off, e.getBoundingClientRect().bottom); });
    el.style.scrollMarginTop = Math.ceil(off) + 8 + "px";
    el.scrollIntoView({ block: "start" });
    const h = el.querySelector("h2");
    if (h) h.focus({ preventScroll: true });
    history.replaceState(null, "", location.pathname + query() + "#" + id);
  }

  function seg(id, key, set) {
    $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || b.disabled) return; set(b.dataset[key]); render(); });
  }

  function actButtons(k) {
    return `<button type="button" class="btn-x" id="nj-img-${k}"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 3v11m0 0l-4.5-4.5M12 14l4.5-4.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16v4h16v-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>画像を保存</button>`
      + `<a class="btn-x" id="nj-x-${k}" target="_blank" rel="noopener" title="投稿文の入ったXの画面を開きます。画像は付きません（「画像を保存」から保存して添付してください）"><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M18.2 2.3h3.3l-7.2 8.2 8.5 11.2h-6.6l-5.2-6.8-6 6.8H1.7l7.7-8.8L1.3 2.3H8l4.7 6.2 5.5-6.2zm-1.2 17.5h1.8L7.1 4.1H5.1l11.9 15.7z"/></svg>Xで共有</a>`;
  }

  // ---- URL（選んだ状態を残し、開き直すと同じ表示になる）----
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const code = (x) => { if (!x) return ""; if (N.prefs[x]) return x; const c = CODES.find((k) => N.prefs[k] === x); return c || ""; };
    state.pref = code(p.get("pref"));
    const cmp = p.get("cmp") || "";
    const two = /^(\d{2})-(\d{2})$/.exec(cmp);
    if (two && N.prefs[two[1]] && N.prefs[two[2]] && two[1] !== two[2]) { state.pref = two[1]; state.pref2 = two[2]; }
    else if (code(cmp) && state.pref && code(cmp) !== state.pref) state.pref2 = code(cmp);
    if (T[p.get("t")]) state.t = p.get("t");
    if (["all", "p", "s", "both"].includes(p.get("s"))) state.s = p.get("s");
    const yr = (k) => { const n = Number(p.get(k)); return YEARS.includes(n) ? n : null; };
    state.a = yr("a"); state.b = yr("b"); state.y = yr("y");
    if (VIEW[p.get("v")]) state.v = p.get("v");
    if (T[p.get("bt")]) state.bt = p.get("bt");
    if (["all", "p", "s"].includes(p.get("n"))) state.n = p.get("n");
    if (["5", "10", "47"].includes(p.get("top"))) state.top = Number(p.get("top"));
    const ys = /^(\d{4})-(\d{4})$/.exec(p.get("ys") || "");
    if (ys && YEARS.includes(+ys[1]) && YEARS.includes(+ys[2]) && ys[1] !== ys[2]) { state.mode = "two"; state.ya = +ys[1]; state.yb = +ys[2]; }
  }

  function query() {
    const p = new URLSearchParams();
    if (state.pref2 && state.pref) p.set("cmp", `${state.pref}-${state.pref2}`);
    else if (state.pref) p.set("pref", state.pref);
    if (state.t !== "all") p.set("t", state.t);
    if (state.s !== "all") p.set("s", state.s);
    if (state.a && state.a !== prevYear(state.b, availYears(state.t, state.s))) p.set("a", state.a);
    if (state.b && state.b !== LATEST) p.set("b", state.b);
    if (state.v !== "pref") p.set("v", state.v);
    if (state.v !== "type" && state.bt !== "all") p.set("bt", state.bt);
    if (state.v !== "owner" && state.n !== "all") p.set("n", state.n);
    if (state.v !== "pref" && state.mode === "two") p.set("ys", `${state.ya}-${state.yb}`);
    else if (state.y && state.y !== LATEST) p.set("y", state.y);
    if (state.v === "pref" && state.top !== 10) p.set("top", state.top);
    const s = p.toString();
    return s ? "?" + s : "";
  }
  const pageUrl = (hash) => document.body.dataset.site + "foreign.html" + query() + (hash ? "#" + hash : "");

  // ---- 全体の描き直し ----
  function render() {
    const ys = availYears(state.t, state.s);
    if (state.b == null) state.b = ys[ys.length - 1];
    if (!ys.includes(state.b) || (state.a != null && !ys.includes(state.a))) { state.b = ys[ys.length - 1]; state.a = null; }
    if (!ys.includes(state.a) || state.a === state.b) state.a = prevYear(state.b, ys);
    if (!state.y || !YEARS.includes(state.y)) state.y = LATEST;
    if (state.mode === "two") {
      if (!YEARS.includes(state.yb)) state.yb = state.y;
      if (!YEARS.includes(state.ya) || state.ya === state.yb) state.ya = prevYear(state.yb, YEARS);
    }
    $("nj-pref").value = state.pref;
    $("nj-pref2").innerHTML = state.pref
      ? '<option value="">なし</option>' + CODES.filter((c) => c !== state.pref).map((c) => `<option value="${c}">${esc(N.prefs[c])}</option>`).join("")
      : '<option value="">（上の「地域」で都道府県を選ぶと選べます）</option>';
    $("nj-pref2").disabled = !state.pref;
    $("nj-pref2").value = state.pref2;
    $("nj-t").value = state.t;
    pressed("nj-s", "s", state.s);
    pressed("nj-v", "v", state.v);
    pressed("nj-top", "top", String(state.top));
    renderKpi();
    renderTrend();
    renderBreakdown();
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => history.replaceState(null, "", location.pathname + query() + location.hash), 200);
  }

  function pressed(id, key, v) { $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[key] === v))); }

  function renderKpi() {
    const o = Y[LATEST], c = state.pref;
    const all = trip(LATEST, c, "all"), sum = pick(all, "all");
    $("nj-kpi-when").innerHTML = `<b>${esc(areaName(c))}</b> <span class="nj-badge">${LATEST}年・最新</span> ${esc(o.fy)}・${md(o.as_of)}現在・国立・公立・私立の学校`;
    const tile = (t, n, sub) => `<li${t === "all" ? ' class="nj-kpi-all"' : ""}><span>${esc(t === "all" ? "合計" : T[t].short)}</span><b>${fmt(n)}<small>人</small></b>${sub ? `<small>${sub}</small>` : ""}</li>`;
    $("nj-kpis").innerHTML = tile("all", sum, "6種類の学校") + ["elem", "mid", "high"].map((t) => { const n = val(LATEST, c, t, "all"); return tile(t, n, `合計の${pctText(n, sum)}`); }).join("");
    const rest = ["compul", "second", "special"].map((t) => `${T[t].label} ${fmt(val(LATEST, c, t, "all"))}人`).join("・");
    const sp = val(LATEST, c, "special", "all");
    $("nj-kpi-note").textContent = `合計のうち公立 ${fmt(all[1])}人（${pctText(all[1], sum)}）・私立 ${fmt(all[2])}人（${pctText(all[2], sum)}）・国立 ${fmt(all[0])}人。合計には${rest}も含みます。高等学校は全日制・定時制です。地図の「外国籍の小中高校生」は特別支援学校を含まないため ${fmt(sum - sp)}人です。`;
  }

  // ---- A 人数の推移 ----
  const trendLines = () => regions().flatMap((c, i) => (state.s === "both" ? ["p", "s"] : [state.s]).map((k) => ({ c, k, i })));
  const lineName = (l) => `${areaName(l.c)}・${T[state.t].short}${l.k === "all" ? "" : "・" + OWN[l.k]}`;
  // データのない年：都道府県別がまだない年、または学校の種類がまだない年
  function gapInfo() {
    const first = availYears(state.t, state.s)[0];
    if (!first || first === YEARS[0]) return null;
    const none = !T[state.t].ids && first === TYPE[state.t].from;
    return { first, label: none ? `区分なし（${first}年から）` : `都道府県別は${first}年から` };
  }

  function renderTrend() {
    const ys = availYears(state.t, state.s);
    const regs = regions();
    const L = trendLines();
    const both = state.s === "both";
    const msg = [];
    if (!T[state.t].ids && TYPE[state.t].from > YEARS[0]) msg.push(`${T[state.t].label}は${TYPE[state.t].from}年にできた学校の種類です。それより前は区分がありません（0人ではありません）。`);
    else if (state.pref && T[state.t].pref_from > YEARS[0]) msg.push(`都道府県別の${state.t === "all" ? "高等学校・中等教育学校・特別支援学校" : T[state.t].label}の数は${T[state.t].pref_from}年から公表されています。それより前は表示できません${state.t === "all" ? "（「小・中学校（義務教育学校を含む）」なら" + YEARS[0] + "年から見られます）" : "（全国は" + YEARS[0] + "年から見られます）"}。`);
    $("nj-trend-msg").hidden = !msg.length;
    $("nj-trend-msg").textContent = msg.join("");
    const M = trendModel();
    $("nj-trend-legend").innerHTML = M.series.map((se) => `<span class="nj-lg"><svg width="34" height="14" aria-hidden="true"><line x1="2" y1="7" x2="32" y2="7" stroke="${se.color}" stroke-width="2.5"${se.dash ? ' stroke-dasharray="6 4"' : ""}/>${se.marker === "square" ? `<rect x="13" y="3" width="8" height="8" fill="${se.color}"/>` : `<circle cx="17" cy="7" r="4" fill="${se.color}"/>`}</svg>${esc(se.name)}</span>`).join("") + '<span class="nj-unit">単位：人</span>';
    const opt = (sel) => ys.map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${y}年（${Y[y].fy}）</option>`).join("");
    $("nj-a").innerHTML = opt(state.a);
    $("nj-b").innerHTML = opt(state.b);
    $("nj-quick").innerHTML = QUICK.map((n) => {
      const y = nYearsAgo(n, state.b, ys);
      return `<button type="button" class="btn-x" data-a="${y || ""}"${y ? "" : " disabled"} aria-pressed="${y === state.a}">${n === 1 ? "前年" : n + "年前"}${y ? `（${y}年）` : "（データなし）"}</button>`;
    }).join("") + `<span class="fine">比較先：${state.b}年</span>`;
    let html = "";
    const lines = [];
    let say = "";
    if (!state.a || state.a === state.b) html = '<p class="cmp-msg">異なる2つの調査年を選んでください。</p>';
    else {
      const [a, b] = state.a < state.b ? [state.a, state.b] : [state.b, state.a];
      const ch = {};
      L.forEach((l) => {
        const va = val(a, l.c, state.t, l.k), vb = val(b, l.c, state.t, l.k);
        const t = changeText(va, vb);
        ch[l.c + l.k] = { va, vb, d: vb - va };
        html += `<div class="nj-res"><p class="nj-res-head"><b>${esc(lineName(l))}</b>：${a}年 ${fmt(va)}人 → ${b}年 ${fmt(vb)}人</p>
          <dl><div><dt>何人増減</dt><dd>${t.diff}</dd></div><div><dt>何％増減</dt><dd>${t.pct}</dd></div><div><dt>何倍</dt><dd>${t.ratio}</dd></div></dl>
          ${t.zero ? `<p class="fine">比較元（${a}年）が0人のため、増減率と倍率は計算できません。</p>` : ""}</div>`;
        lines.push(`${lineName(l)}：${a}年→${b}年 ${t.diff}${t.zero ? "" : `（${t.pct}、${t.ratio}）`}`);
      });
      if (state.a > state.b) html += '<p class="fine">比較元が新しい年なので、古い年→新しい年の順に並べ替えて計算しています。</p>';
      if ((state.t === "all" || state.t === "em") && a < TYPE.compul.from && b >= TYPE.compul.from) html += `<p class="fine">${a}年は義務教育学校がまだない年です（その子どもは小学校・中学校に数えられていました）。</p>`;
      const w = (c, k) => { const x = ch[c + k]; return `${moveWord(x.d)}（${fmt(x.va)}人→${fmt(x.vb)}人）`; };
      const tn = T[state.t].short;
      if (L.length === 1) {
        const x = ch[L[0].c + L[0].k], who = `${areaName(L[0].c)}の${what(state.t, L[0].k)}は、`;
        say = x.d === 0 ? `${who}${a}年も${b}年も${fmt(x.va)}人で、変わっていません。` : `${who}${a}年の${fmt(x.va)}人から${b}年の${fmt(x.vb)}人へ${fmt(Math.abs(x.d))}人${x.d > 0 ? "増えました" : "減りました"}。`;
      } else if (!both) say = `${a}年→${b}年の${what(state.t, state.s)}は、${regs.map((c) => `${areaName(c)}が${w(c, state.s)}`).join("、")}でした。`;
      else if (regs.length === 1) say = `${a}年→${b}年で、${areaName(regs[0])}の${tn}の外国籍の児童生徒は、公立が${w(regs[0], "p")}、私立が${w(regs[0], "s")}でした。`;
      else say = `${a}年→${b}年の${tn}の外国籍の児童生徒は、${regs.map((c) => `${areaName(c)}が公立${moveWord(ch[c + "p"].d)}・私立${moveWord(ch[c + "s"].d)}`).join("、")}でした。`;
    }
    if (state.same && state.a) html = `<p class="cmp-msg" role="status">比較元と比較先に同じ年は選べないため、比較元を${state.a}年にしました。</p>` + html;
    state.same = false;
    $("nj-result").innerHTML = html;
    state.cmpLines = lines;
    if (!both) {
      const peaks = regs.map((c) => ({ c, ...ys.map((y) => ({ y, v: val(y, c, state.t, state.s) })).reduce((m, p) => (p.v > m.v ? p : m)) }));
      say += peaks.length > 1
        ? `表示している調査年の中で最も多いのは、${peaks.map((p) => `${areaName(p.c)}が${p.y}年（${fmt(p.v)}人）`).join("、")}です。`
        : `表示している調査年の中で最も多いのは${peaks[0].y}年（${fmt(peaks[0].v)}人）です。`;
    }
    $("nj-trend-say").textContent = say;
    $("nj-trend-note").textContent = `点は各年5月1日現在の人数です（調査は毎年）。${state.t === "high" || state.t === "all" ? "高等学校は全日制・定時制の数です。" : ""}`;
    const head = `<tr><th scope="col">調査年</th><th scope="col">基準日</th>${L.map((l) => `<th scope="col" class="num">${esc(areaName(l.c))}<br>${esc(T[state.t].short)}${l.k === "all" ? "" : "・" + OWN[l.k]}</th>`).join("")}</tr>`;
    const body = YEARS.slice().reverse().map((y) => `<tr><th scope="row">${y}年（${Y[y].fy}）</th><td>${jpDate(Y[y].as_of)}</td>${L.map((l) => { const v = val(y, l.c, state.t, l.k); return `<td class="num">${v == null ? "—" : fmt(v) + "人"}</td>`; }).join("")}</tr>`).join("");
    $("nj-trend-table").innerHTML = `<table class="plain"><thead>${head}</thead><tbody>${body}</tbody></table><p class="fine">—：都道府県別が公表されていない年、または学校の種類がまだない年（0人ではありません）。</p>`;
    drawTrend();
    const text = `外国籍の児童生徒（学校基本調査）｜${regs.map(areaName).join("・")}の${T[state.t].short}${state.s === "all" ? "" : "・" + OWN[state.s]}の推移\n${lines.join("\n")}\n${SITE_NAME}`;
    setX("trend", text, pageUrl("trend"));
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v * 1.04) return k * p;
    return 10 * p;
  }
  function ticks(max) {
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    const step = [p / 5, p / 4, p / 2, p, p * 2].find((s) => max / s <= 6) || p * 2;
    const out = [];
    for (let t = 0; t <= max + 1e-9; t += step) out.push(Math.round(t));
    return out;
  }

  function trendModel() {
    const both = state.s === "both";
    const series = trendLines().map((l) => ({ code: l.c, nat: l.k, name: lineName(l), dash: l.i > 0, marker: both ? (l.k === "p" ? "circle" : "square") : l.i ? "square" : "circle", color: COLOR[both ? l.k : state.s], points: YEARS.map((y) => ({ x: y, v: val(y, l.c, state.t, l.k), big: y === state.a || y === state.b })) }));
    const all = series.flatMap((s) => s.points.map((p) => p.v).filter((v) => v != null));
    const yMax = niceMax(Math.max(...all));
    const g = gapInfo();
    const noData = g ? [YEARS[0] - 0.6, g.first - 0.5] : null;
    return { series, yMax, yTicks: ticks(yMax), x0: YEARS[0] - 0.6, x1: YEARS[YEARS.length - 1] + 0.6, xTicks: [2010, 2015, 2020, 2025], breakAt: null, noData, noDataText: g ? g.label : "" };
  }

  function drawTrend() {
    const box = $("nj-trend-chart");
    if (!box || !N) return;
    const M = trendModel();
    const W = Math.max(280, box.clientWidth), narrow = W < 520;
    const H = narrow ? 250 : 300;
    const m = { l: narrow ? 50 : 62, r: 12, t: 16, b: 28 };
    const X = (y) => m.l + ((y - M.x0) / (M.x1 - M.x0)) * (W - m.l - m.r);
    const Yp = (v) => H - m.b - (v / M.yMax) * (H - m.t - m.b);
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(M.series.map((x) => x.name).join("と"))}の推移の折れ線グラフ。数値は下の表で確かめられます。">`;
    M.yTicks.forEach((t) => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Yp(t)}" y2="${Yp(t)}" stroke="${t ? "#EFE4C6" : "#D5BA79"}" stroke-width="1"/><text x="${m.l - 6}" y="${Yp(t) + 4}" text-anchor="end" class="nj-ax">${t >= 10000 && narrow ? (t / 10000) + "万" : fmt(t)}</text>`; });
    M.xTicks.forEach((t) => { s += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle" class="nj-ax">${t}${narrow ? "" : "年"}</text>`; });
    if (M.noData) s += `<rect x="${X(M.noData[0])}" y="${m.t}" width="${X(M.noData[1]) - X(M.noData[0])}" height="${H - m.t - m.b}" fill="#5C5140" opacity=".07"/><text x="${(X(M.noData[0]) + X(M.noData[1])) / 2}" y="${m.t + 30}" text-anchor="middle" class="nj-ax">${esc(M.noDataText)}</text>`;
    M.series.forEach((se) => {
      let d = "", on = false;
      se.points.forEach((p) => { if (p.v == null) { on = false; return; } d += `${on ? "L" : "M"}${X(p.x).toFixed(1)},${Yp(p.v).toFixed(1)}`; on = true; });
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2"${se.dash ? ' stroke-dasharray="6 4"' : ""} stroke-linejoin="round"/>`;
      se.points.forEach((p) => {
        if (p.v == null) return;
        const r = p.big ? 5.5 : 3.5, x = X(p.x), y = Yp(p.v);
        s += se.marker === "square" ? `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${se.color}" stroke="#FFFDF6" stroke-width="2"/>` : `<circle cx="${x}" cy="${y}" r="${r}" fill="${se.color}" stroke="#FFFDF6" stroke-width="2"/>`;
      });
    });
    if (M.series.length === 1) M.series[0].points.forEach((p) => { if (p.big && p.v != null) { const x = Math.min(W - m.r - 30, Math.max(m.l + 30, X(p.x))); s += `<text x="${x}" y="${Yp(p.v) - 10}" text-anchor="middle" class="nj-val">${fmt(p.v)}</text>`; } });
    s += `<line id="nj-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="#352D20" stroke-width="1" opacity="0"/><rect id="nj-hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/></svg><div class="nj-tip" id="nj-tip" hidden></div>`;
    box.innerHTML = s;
    const hit = $("nj-hit"), tip = $("nj-tip"), cross = $("nj-cross");
    const show = (ev) => {
      const rect = box.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const ys = YEARS.filter((y) => M.series.some((se) => val(y, se.code, state.t, se.nat) != null));
      const y = ys.reduce((b, k) => (Math.abs(X(k) - px) < Math.abs(X(b) - px) ? k : b), ys[0]);
      cross.setAttribute("x1", X(y)); cross.setAttribute("x2", X(y)); cross.setAttribute("opacity", ".35");
      tip.innerHTML = `<b>${y}年</b>（${esc(Y[y].fy)}・${md(Y[y].as_of)}現在）` + M.series.map((se) => { const v = val(y, se.code, state.t, se.nat); return `<br>${esc(se.name)}：${v == null ? "データなし" : fmt(v) + "人"}`; }).join("");
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(W - tw, X(y) - tw / 2)) + "px";
      tip.style.top = "0px";
    };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { tip.hidden = true; cross.setAttribute("opacity", "0"); } });
  }

  // ---- B 内訳 ----
  // 都道府県別・国立公立私立別で使う学校の種類。選べない種類は「小・中学校」に替えて理由を出す
  function pickBt(years, area) {
    const reasons = {};
    T_IDS.forEach((t) => { const w = years.map((y) => why(t, y, area)).find(Boolean); if (w) reasons[t] = w; });
    const bt = reasons[state.bt] ? "em" : state.bt;
    return { bt, reasons, fellBack: bt !== state.bt };
  }
  const nats = (n) => (n === "all" ? ["k", "p", "s"] : [n]);
  const partsOf = (tr, n) => ({ k: n === "all" ? tr[0] : null, p: n === "all" || n === "p" ? tr[1] : null, s: n === "all" || n === "s" ? tr[2] : null });
  const srcKeys = (types, area) => types.flatMap((t) => (T[t].ids || [t])).filter((t, i, a) => a.indexOf(t) === i).map((t) => `${t}_${area ? "pref" : "nat"}`);

  function bdData() {
    if (state.v === "pref") return prefData(Y[state.y]);
    if (state.mode === "two") return pairData();
    return oneData(Y[state.y]);
  }

  function prefData(o) {
    const P = pickBt([o.year], true), bt = P.bt, n = state.n;
    const D = { kind: "pref", two: false, o, bt, P, n, area: "全国", msgs: [], notes: [] };
    if (P.fellBack) D.msgs.push(`${P.reasons[state.bt]}。${T.em.label}の多い順に並べています。`);
    const all = CODES.map((c) => {
      const tr = trip(o.year, c, bt);
      return { name: N.prefs[c], code: c, ...partsOf(tr, n), raw: tr, key: pick(tr, n), total: pick(tr, n) };
    }).sort((a, b) => b.key - a.key || a.code.localeCompare(b.code));
    all.forEach((r, i) => { r.rank = i && all[i - 1].key === r.key ? all[i - 1].rank : i + 1; });
    D.allRows = all;
    D.rows = all.slice(0, state.top);
    D.nats = nats(n);
    if (state.pref && !D.rows.some((r) => r.code === state.pref)) D.extra = all.find((r) => r.code === state.pref);
    const endKey = D.rows[D.rows.length - 1].key;
    const tie = all.slice(D.rows.length).filter((r) => r.key === endKey).length;
    if (tie) D.notes.push(`${D.rows[D.rows.length - 1].rank}位と同じ数の都道府県がほかに${tie}あります（表示しておらず、上位${state.top}の割合にも含めていません）。`);
    D.prefix = "都道府県別";
    D.head = `都道府県別：${when(o)}・${what(bt, n)}の多い順・${state.top === 47 ? "全47都道府県" : `上位${state.top}`}`;
    D.title = `都道府県別 ${what(bt, n)}`;
    D.notes.push("同じ数は同じ順位です。学校のある都道府県で数えた人数です。地域名を押すと、地図でその都道府県を開きます（地図の人数は最新の年で、「合計」は特別支援学校を含みません）。");
    D.srcKeys = srcKeys([bt], true);
    return D;
  }

  // 学校種別・国立公立私立別の行（その年・地域）。ない数は none に理由を入れる
  function catRows(o, kind, area, bt, n) {
    if (kind === "type") return TYPE_IDS.map((t, i) => {
      const tr = trip(o.year, area, t);
      const r = { name: T[t].label, id: t, i, raw: tr };
      if (tr == null) { r.none = o.year < TYPE[t].from ? `区分なし（${TYPE[t].from}年から）` : `都道府県別は${TYPE[t].pref_from}年から`; r.total = null; return r; }
      return Object.assign(r, partsOf(tr, n), { total: pick(tr, n) });
    });
    const tr = trip(o.year, area, bt);
    return ["k", "p", "s"].map((k, i) => ({ name: OWN[k], id: k, i, k: k === "k" ? tr[0] : null, p: k === "p" ? tr[1] : null, s: k === "s" ? tr[2] : null, total: pick(tr, k) }));
  }

  function oneData(o) {
    const kind = state.v, area = state.pref;
    const D = { kind, two: false, o, n: kind === "owner" ? "all" : state.n, area: areaName(area), msgs: [], notes: [] };
    if (kind === "owner") {
      D.P = pickBt([o.year], !!area); D.bt = D.P.bt;
      if (D.P.fellBack) D.msgs.push(`${D.P.reasons[state.bt]}。${T.em.label}で表示しています。`);
      D.rows = catRows(o, kind, area, D.bt);
      D.nats = ["k", "p", "s"];
      D.prefix = "国立・公立・私立別";
      D.head = `国立・公立・私立別：${D.area}・${when(o)}・${T[D.bt].short}`;
      D.title = `国立・公立・私立別 ${what(D.bt)}`;
      D.notes.push("国立・公立・私立の順に並べています。");
      if (D.bt === "all" || D.bt === "high") D.notes.push("高等学校は全日制・定時制の数です。");
      D.srcKeys = srcKeys([D.bt], !!area);
      return D;
    }
    D.rows = catRows(o, kind, area, null, D.n);
    D.nats = nats(D.n);
    if (area && o.year < T.all.pref_from) D.msgs.push(`${o.year}年は都道府県別の高等学校・中等教育学校・特別支援学校の数が公表されていません（${T.all.pref_from}年から）。—で表示しています。`);
    D.prefix = "学校種別";
    D.head = `学校種別：${D.area}・${when(o)}・${OWN_ONLY[D.n]}`;
    D.title = `学校種別 外国籍の児童生徒${D.n === "all" ? "" : "（" + OWN[D.n] + "）"}`;
    if (o.year < TYPE.compul.from) D.notes.push(`義務教育学校は${TYPE.compul.from}年からの学校の種類です。この年は区分がありません（0人という意味ではありません）。`);
    D.notes.push("高等学校は全日制・定時制の数です。特別支援学校は幼稚部から高等部までの在学者数です。");
    D.srcKeys = srcKeys(TYPE_IDS, !!area);
    return D;
  }

  // 2年の比較（同じ地域・同じ区分）。どちらかの年に数がない項目は比べない
  function pairData() {
    const [lo, hi] = state.ya < state.yb ? [state.ya, state.yb] : [state.yb, state.ya];
    const A = Y[lo], B = Y[hi], kind = state.v, area = state.pref;
    const D = { kind, two: true, o: B, n: kind === "owner" ? "all" : state.n, ya: lo, yb: hi, area: areaName(area), msgs: [], notes: [], rows: [] };
    if (state.sameBd) D.msgs.push(`比較元と比較先に同じ年は選べないため、比較元を${state.ya}年にしました。`);
    state.sameBd = false;
    if (state.ya > state.yb) D.msgs.push("比較元が新しい年なので、古い年→新しい年の順に並べ替えて比べています。");
    if (kind === "owner") {
      D.P = pickBt([lo, hi], !!area); D.bt = D.P.bt;
      if (D.P.fellBack) D.msgs.push(`${D.P.reasons[state.bt]}。${T.em.label}で比べています。`);
    }
    const ra = catRows(A, kind, area, D.bt, D.n), rb = catRows(B, kind, area, D.bt, D.n);
    D.rows = rb.map((b, i) => {
      const a = ra[i], r = { name: b.name, id: b.id, a: a.total, b: b.total, i };
      if (a.total == null || b.total == null) { r.status = "none"; r.why = `${b.name}は${(a.none || b.none)}のため比べません`; }
      else r.status = "ok";
      return r;
    });
    D.rows.forEach((r) => { r.total = r.b; if (r.status === "ok") { const c = change(r.a, r.b); r.d = c.d; r.pct = c.pct; } });
    // 全体は、両方の年に数がある項目だけで比べる（ない項目を0として足さない）
    const okRows = D.rows.filter((r) => r.status === "ok");
    D.ta = okRows.reduce((s, r) => s + r.a, 0);
    D.tb = okRows.reduce((s, r) => s + r.b, 0);
    D.partial = okRows.length < D.rows.length;
    if (kind === "owner") {
      D.prefix = "国立・公立・私立別";
      D.head = `国立・公立・私立別の2年比較：${D.area}・${T[D.bt].short}・${lo}年→${hi}年`;
      D.title = `国立・公立・私立別の2年比較 ${what(D.bt)}`;
      D.srcKeys = srcKeys([D.bt], !!area);
    } else {
      D.prefix = "学校種別";
      D.head = `学校種別の2年比較：${D.area}・${OWN_ONLY[D.n]}・${lo}年→${hi}年`;
      D.title = `学校種別の2年比較 外国籍の児童生徒${D.n === "all" ? "" : "（" + OWN[D.n] + "）"}`;
      D.srcKeys = srcKeys(TYPE_IDS, !!area);
      if (D.partial) D.notes.push("「全体」は、両方の年に数がある学校の種類だけの合計です。");
      if (lo < TYPE.compul.from && hi >= TYPE.compul.from) D.notes.push(`${lo}年は義務教育学校がまだなく、その子どもは小学校・中学校に数えられていました。`);
    }
    return D;
  }

  function sayOf(D) {
    const o = D.o;
    if (D.two) {
      const ok = D.rows.filter((r) => r.status === "ok");
      const subj = D.kind === "owner" ? what(D.bt) : `外国籍の児童生徒${D.n === "all" ? "" : "（" + OWN[D.n] + "）"}`;
      let s = `${D.area}の${subj}は、${D.ya}年→${D.yb}年で${D.partial ? "比べられる項目の合計" : "全体"}が${fmt(D.ta)}人→${fmt(D.tb)}人（${moveWord(D.tb - D.ta)}）です。`;
      if (ok.length) {
        const up = ok.filter((r) => r.d > 0).length, down = ok.filter((r) => r.d < 0).length;
        const mx = ok.reduce((m, r) => (r.d > m.d ? r : m)), mn = ok.reduce((m, r) => (r.d < m.d ? r : m));
        s += `比べられる${ok.length}項目のうち、増えたのは${up}項目、減ったのは${down}項目です。`;
        const parts = [];
        if (mx.d > 0) parts.push(`増加が最も大きいのは${mx.name}（${fmt(mx.d)}人増）`);
        if (mn.d < 0) parts.push(`減少が最も大きいのは${mn.name}（${fmt(-mn.d)}人減）`);
        if (parts.length) s += parts.join("、") + "です。";
      }
      const skip = D.rows.filter((r) => r.status !== "ok");
      if (skip.length) s += `${skip.map((r) => r.name).join("・")}は、どちらかの年に数がないため比べていません。`;
      return s;
    }
    if (D.kind === "pref") {
      const sum = D.allRows.reduce((s, r) => s + r.key, 0);
      const top = D.rows[0], second = D.rows.find((r) => r.rank > top.rank);
      const same = D.rows.filter((r) => r.rank === top.rank);
      let s = `${o.year}年の${what(D.bt, D.n)}で最も多いのは${same.map((r) => r.name).join("・")}（${fmt(top.key)}人${same.length > 1 ? "、同数" : ""}）${second ? `、次いで${second.name}（${fmt(second.key)}人）` : ""}です。`;
      if (state.top === 47) {
        const low = D.allRows[D.allRows.length - 1], lows = D.allRows.filter((r) => r.key === low.key);
        s += `全47都道府県の合計は${fmt(sum)}人で、最も少ないのは${lows.map((r) => r.name).join("・")}（${fmt(low.key)}人）です。`;
      } else s += `表示している上位${D.rows.length}都道府県で、全国（${fmt(sum)}人）の${pctText(D.rows.reduce((t, r) => t + r.key, 0), sum)}を占めます。`;
      return s;
    }
    const rows = D.rows.filter((r) => r.total != null);
    const sum = rows.reduce((s, r) => s + r.total, 0);
    if (D.kind === "owner") return `${D.area}の${what(D.bt)}は、${o.year}年に${fmt(sum)}人で、${["p", "s", "k"].map((k) => { const r = D.rows.find((x) => x.id === k); return `${r.name}が${fmt(r.total)}人（${pctText(r.total, sum)}）`; }).join("、")}です。`;
    const sorted = rows.slice().sort((a, b) => b.total - a.total || a.i - b.i);
    const top = sorted[0], second = sorted[1];
    if (!top) return "";
    return `${D.area}の外国籍の児童生徒${D.n === "all" ? "" : "（" + OWN[D.n] + "）"}（${o.year}年）は、${top.name}が最も多く${fmt(top.total)}人（表示している学校の${pctText(top.total, sum)}）${second ? `、次いで${second.name}（${fmt(second.total)}人）` : ""}です。`;
  }

  function renderBreakdown() {
    const two = state.v !== "pref" && state.mode === "two";
    const yopt = (sel) => YEARS.slice().reverse().map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${y}年（${Y[y].fy}）</option>`).join("");
    $("nj-y").innerHTML = yopt(state.y);
    $("nj-ya").innerHTML = yopt(state.ya);
    $("nj-yb").innerHTML = yopt(state.yb);
    $("nj-mode-wrap").hidden = state.v === "pref";
    $("nj-y-wrap").hidden = two;
    $("nj-ya-wrap").hidden = !two;
    $("nj-yb-wrap").hidden = !two;
    $("nj-top-wrap").hidden = state.v !== "pref";
    $("nj-n-wrap").hidden = state.v === "owner";
    $("nj-bt-wrap").hidden = state.v === "type";
    pressed("nj-mode", "mode", two ? "two" : "one");
    const D = bdData();
    state.bd = D;
    pressed("nj-n", "n", D.n);
    // 学校の種類：選べないものは押せなくして、理由を短く出す
    const R = D.P ? D.P.reasons : {};
    $("nj-bt").innerHTML = T_IDS.map((t) => `<option value="${t}"${R[t] ? " disabled" : ""}>${esc(T[t].label)}${R[t] ? "（選べません）" : ""}</option>`).join("");
    $("nj-bt").value = D.bt || state.bt;
    // 理由は「都道府県別がまだない」と「学校の種類がまだない」の2つにまとめて短く書く
    const off = T_IDS.filter((t) => R[t]);
    const yrs = D.two ? [D.ya, D.yb] : [D.o.year];
    const noneT = off.filter((t) => !T[t].ids && yrs.some((y) => y < TYPE[t].from)), prefT = off.filter((t) => !noneT.includes(t));
    const parts = [];
    if (prefT.length) parts.push(`${prefT.map((t) => T[t].short).join("・")}は、都道府県別の数が${Math.max(...prefT.map((t) => T[t].pref_from))}年からのため選べません`);
    if (noneT.length) parts.push(`${noneT.map((t) => T[t].short).join("・")}は${Math.max(...noneT.map((t) => TYPE[t].from))}年にできた学校の種類のため選べません`);
    $("nj-n-why").hidden = state.v === "type" || !off.length;
    $("nj-n-why").textContent = off.length ? `${yrs.join("年と")}年：${parts.join("。")}。` : "";
    $("nj-bd-head").textContent = D.head;
    $("nj-bd-msg").hidden = !D.msgs.length;
    $("nj-bd-msg").innerHTML = D.msgs.map(esc).join("<br>");
    const o = D.o;
    if (D.two) renderPair(D);
    else renderOne(D);
    $("nj-bd-note").innerHTML = D.notes.map(esc).join("") + ` 出典：${esc(SURVEY)} ${D.two ? `${esc(Y[D.ya].fy)}・` : ""}${esc(o.fy)}（e-Stat：${srcLinks(o, D.srcKeys, D.two ? Y[D.ya] : null)}）`;
    let text;
    if (D.two) {
      const big = D.rows.filter((r) => r.status === "ok").sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3).map((r) => `${r.name} ${fmt(r.a)}人→${fmt(r.b)}人`).join("\n");
      text = `${D.title}｜${D.area}・${D.ya}年→${D.yb}年\n${D.partial ? "比べられる項目の合計" : "全体"} ${fmt(D.ta)}人→${fmt(D.tb)}人（${moveWord(D.tb - D.ta)}）\n${big}\n${SITE_NAME}`;
    } else {
      const top3 = (D.kind === "owner" ? D.rows : D.rows.filter((r) => r.total != null)).slice(0, 3).map((r) => `${D.kind === "pref" ? r.rank + "位 " : ""}${r.name} ${fmt(r.total)}人`).join("\n");
      text = `${D.title}｜${D.area}・${o.year}年\n${top3}\n${SITE_NAME}`;
    }
    setX("bd", text, pageUrl("breakdown"));
  }

  function bindTips(rows, detail) {
    const tip = $("nj-btip"), wrap = $("nj-bars");
    const show = (li) => {
      const r = rows[Number(li.dataset.i)];
      tip.innerHTML = `<b>${esc(r.name)}</b><br>${esc(detail(r))}`;
      tip.hidden = false;
      tip.style.top = li.offsetTop + li.offsetHeight + 2 + "px";
      tip.style.left = Math.max(0, Math.min(wrap.clientWidth - tip.offsetWidth, li.querySelector(".nj-track, .nj-track2").offsetLeft)) + "px";
    };
    wrap.querySelectorAll(".nj-row").forEach((li) => {
      li.addEventListener("pointerenter", () => show(li));
      li.addEventListener("pointerdown", () => show(li));
      li.addEventListener("focus", () => show(li));
      li.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") tip.hidden = true; });
      li.addEventListener("blur", () => { tip.hidden = true; });
    });
  }

  const own3 = (tr) => `国立 ${fmt(tr[0])}人・公立 ${fmt(tr[1])}人・私立 ${fmt(tr[2])}人・合計 ${fmt(tr[0] + tr[1] + tr[2])}人`;

  function renderOne(D) {
    const isOwner = D.kind === "owner";
    $("nj-bd-legend").innerHTML = (isOwner ? "" : D.nats.map((k) => `<span class="nj-lg"><i class="nj-sw" style="background:${COLOR[k]}"></i>${OWN[k]}</span>`).join("")) + '<span class="nj-unit">単位：人</span>';
    const rows = D.rows.concat(D.extra ? [D.extra] : []);
    const max = Math.max(1, ...rows.map((r) => r.total || 0));
    const segs = (r) => D.nats.map((k) => { const v = r[k]; return v ? `<span class="nj-seg" style="width:${(v / max) * 100}%;background:${COLOR[k]}"></span>` : ""; }).join("");
    const detail = (r) => (r.none ? r.none : !isOwner && D.n === "all" ? own3(r.raw) : `${isOwner ? r.name : OWN[D.n]} ${fmt(r.total)}人`);
    $("nj-bars").innerHTML = `<ol class="nj-rows${D.kind === "pref" ? " nj-ranked" : ""}">` + rows.map((r, i) => {
      const name = D.kind === "pref"
        ? `<span class="nj-rank">${r.rank}</span><a href="index.html?pref=${r.code}&amp;view=stats&amp;layer=foreign&amp;variant=${MAP_VARIANT[D.bt] || "all"}" title="地図で${esc(r.name)}を開く">${esc(r.name)}</a>`
        : esc(r.name);
      const sel = D.kind === "pref" && r.code === state.pref ? " nj-sel" : "";
      return `${D.extra && r === D.extra ? '<li class="nj-gap" aria-hidden="true">…</li>' : ""}<li class="nj-row${sel}" tabindex="0" data-i="${i}" aria-label="${esc(r.name)}：${esc(detail(r))}">
        <span class="nj-name">${name}</span><span class="nj-track">${segs(r)}</span><span class="nj-v">${r.none ? "—" : fmt(r.total) + "人"}</span></li>`;
    }).join("") + '</ol><div class="nj-tip" id="nj-btip" hidden></div>';
    bindTips(rows, detail);
    $("nj-bd-say").textContent = sayOf(D);
    const cell = (v) => `<td class="num">${v == null ? "—" : fmt(v) + "人"}</td>`;
    if (isOwner) {
      const sum = D.rows.reduce((s, r) => s + r.total, 0);
      $("nj-bd-table").innerHTML = `<table class="plain"><thead><tr><th scope="col">区分</th><th scope="col" class="num">人数</th><th scope="col" class="num">割合</th></tr></thead><tbody>${D.rows.map((r) => `<tr><th scope="row">${esc(r.name)}</th>${cell(r.total)}<td class="num">${pctText(r.total, sum)}</td></tr>`).join("")}<tr class="on"><th scope="row">合計</th>${cell(sum)}<td class="num">100.0％</td></tr></tbody></table><p class="fine">${esc(T[D.bt].label)}。割合は小数第2位を四捨五入しているため、足して100％にならないことがあります。</p>`;
      return;
    }
    // 表（都道府県別は全47件、学校種別は6種類。国立・公立・私立・合計をいつも並べる）
    const isPref = D.kind === "pref";
    const list = isPref ? D.allRows : rows;
    const body = list.map((r) => `<tr${isPref && r.code === state.pref ? ' class="on"' : ""}>${isPref ? `<td class="num">${r.rank}</td>` : ""}<th scope="row">${esc(r.name)}</th>${r.raw ? r.raw.map(cell).join("") + cell(pick(r.raw, "all")) : cell(null).repeat(4)}</tr>`).join("");
    const sum = list.reduce((s, r) => s + (r.total || 0), 0);
    $("nj-bd-table").innerHTML = `<table class="plain"><thead><tr>${isPref ? '<th scope="col" class="num">順位</th>' : ""}<th scope="col">${isPref ? "都道府県" : "学校の種類"}</th><th scope="col" class="num">国立</th><th scope="col" class="num">公立</th><th scope="col" class="num">私立</th><th scope="col" class="num">合計</th></tr></thead><tbody>${body}</tbody></table>`
      + `<p class="fine">${isPref ? `全47都道府県を${OWN_ONLY[D.n]}の多い順に並べています（${T[D.bt].label}・${OWN_ONLY[D.n]}の全国 ${fmt(sum)}人）。` : `${OWN_ONLY[D.n]}の、表示している学校の合計 ${fmt(sum)}人。`}—：区分がない、または公表されていない数（0人ではありません）。</p>`;
  }

  function renderPair(D) {
    $("nj-bd-legend").innerHTML = `<span class="nj-lg"><i class="nj-sw" style="background:${PAIR.a}"></i>${D.ya}年（比較元）</span><span class="nj-lg"><i class="nj-sw" style="background:${PAIR.b}"></i>${D.yb}年（比較先）</span><span class="nj-unit">単位：人</span>`;
    const max = Math.max(1, ...D.rows.flatMap((r) => [r.a || 0, r.b || 0]));
    const bar = (v, c) => (v ? `<span class="nj-bar" style="width:${(v / max) * 100}%;background:${c}"></span>` : '<span class="nj-bar"></span>');
    const num = (v) => (v != null ? fmt(v) : "—");
    const diffText = (r) => {
      if (r.status !== "ok") return r.why;
      const t = changeText(r.a, r.b);
      return `${t.diff}（${t.zero ? "比較元が0人のため増減率なし" : t.pct}）`;
    };
    const detail = (r) => `${D.ya}年 ${num(r.a)}・${D.yb}年 ${num(r.b)}／${diffText(r)}`;
    $("nj-bars").innerHTML = '<ol class="nj-rows">' + D.rows.map((r, i) => `<li class="nj-row nj-pair${r.status === "ok" ? "" : " nj-skip"}" tabindex="0" data-i="${i}" aria-label="${esc(r.name)}：${esc(detail(r))}">
        <span class="nj-name">${esc(r.name)}${r.status === "ok" ? "" : '<small>比べません</small>'}</span><span class="nj-track2">${bar(r.a, PAIR.a)}${bar(r.b, PAIR.b)}</span><span class="nj-v2"><span>${esc(num(r.a))}</span><b>${esc(num(r.b))}</b></span></li>`).join("") + '</ol><div class="nj-tip" id="nj-btip" hidden></div>';
    bindTips(D.rows, detail);
    $("nj-bd-say").textContent = sayOf(D);
    const pct = (r) => (r.status !== "ok" ? "—" : r.pct === null ? "計算できません（比較元0人）" : changeText(r.a, r.b).pct);
    const dif = (r) => (r.status !== "ok" ? "比べません" : r.d > 0 ? `+${fmt(r.d)}人` : r.d < 0 ? `−${fmt(-r.d)}人` : "±0人");
    const td = (v) => `<td class="num">${v == null ? "—" : fmt(v) + "人"}</td>`;
    const tot = { name: D.partial ? "比べられる項目の合計" : "全体", a: D.ta, b: D.tb, status: "ok", ...change(D.ta, D.tb) };
    const body = D.rows.concat([tot]).map((r) => `<tr${r === tot ? ' class="on"' : ""}><th scope="row">${esc(r.name)}</th>${td(r.a)}${td(r.b)}<td class="num">${dif(r)}</td><td class="num">${pct(r)}</td></tr>`).join("");
    const whys = [...new Set(D.rows.filter((r) => r.status !== "ok").map((r) => r.why))];
    $("nj-bd-table").innerHTML = `<table class="plain"><thead><tr><th scope="col">${D.kind === "owner" ? "区分" : "学校の種類"}</th><th scope="col" class="num">${D.ya}年</th><th scope="col" class="num">${D.yb}年</th><th scope="col" class="num">増減</th><th scope="col" class="num">増減率</th></tr></thead><tbody>${body}</tbody></table>`
      + `<p class="fine">${esc(D.kind === "owner" ? T[D.bt].label : OWN_ONLY[D.n])}。${whys.map((w) => esc(w) + "。").join("")}比較元が0人の項目は増減率を計算しません。</p>`;
  }

  function setX(k, text, url) {
    const a = $("nj-x-" + k);
    a.href = "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
    a.dataset.text = text + "\n" + url;
  }

  // 出典の表へのリンク（学校の種類の名前で、全国の表と都道府県別の表を分けて書く）
  function srcLinks(o, keys, o2) {
    const part = (y, k) => { const s = y.src[k]; return s ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(TYPE[k.split("_")[0]].short || TYPE[k.split("_")[0]].label)}</a>` : ""; };
    const group = (y) => {
      const pref = keys.filter((k) => k.endsWith("_pref")), nat = keys.filter((k) => k.endsWith("_nat"));
      const txt = [];
      if (pref.length) txt.push(pref.map((k) => part(y, k)).filter(Boolean).join("・") + "の都道府県別の表");
      if (nat.length) txt.push(nat.map((k) => part(y, k)).filter(Boolean).join("・") + "の表");
      return txt.join("、");
    };
    return o2 ? `${o2.year}年：${group(o2)}／${o.year}年：${group(o)}` : group(o);
  }

  function sourceTable() {
    const rows = YEARS.slice().reverse().map((y) => {
      const o = Y[y];
      const links = (suf) => TYPE_IDS.map((t) => { const s = o.src[t + "_" + suf]; return s ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(TYPE[t].short || TYPE[t].label)}</a>` : ""; }).filter(Boolean).join("・");
      return `<tr><th scope="row">${y}年（${o.fy}）</th><td>${jpDate(o.as_of)}</td><td>都道府県別：${links("pref")}<br>全国：${links("nat") || "都道府県別の表の合計"}</td></tr>`;
    }).join("");
    // 元の表の欄どうしが合わなかったところ（同じ理由はまとめる）
    const known = {};
    (N.known || []).forEach((k) => { const key = JSON.stringify([k.year, k.type, k.note]); (known[key] = known[key] || []).push(k.pref); });
    const knownText = Object.entries(known).map(([key, ps]) => { const [y, t, note] = JSON.parse(key); return `${y}年の${TYPE[t].label}（${ps.join("・")}）：${note}。`; }).join("");
    return `<table class="plain nj-src"><thead><tr><th scope="col">調査年</th><th scope="col">基準日</th><th scope="col">使った表（e-Stat）</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="fine">出典：${esc(SURVEY)}（各年度、<a href="${esc(N.estat_url)}" target="_blank" rel="noopener">e-Stat</a>）。${esc(N.terms)}（${esc(N.checked)}）。数字は国の表のとおりで、国立・公立・私立の合計、学校の種類の合計、都道府県の和だけを計算しています。都道府県の和は、すべての年・学校の種類で全国の表と一致することを確かめています。</p>
      ${knownText ? `<p class="fine">元の表の欄どうしが合わなかったところ：${esc(knownText)}</p>` : ""}`;
  }

  // ---- 画像 ----
  function srcLine(o, keys, o2) {
    const names = (suf) => keys.filter((k) => k.endsWith(suf)).map((k) => TYPE[k.split("_")[0]].short || TYPE[k.split("_")[0]].label);
    const p = names("_pref"), n = names("_nat");
    return `出典：${SURVEY} ${o2 ? o2.fy + "・" : ""}${o.fy}（e-Stat ${[p.length ? p.join("・") + "の都道府県別の表" : "", n.length ? n.join("・") + "の表" : ""].filter(Boolean).join("、")}）`;
  }
  const FOOT_SCOPE = "学校のある都道府県で数えた人数。国立・公立・私立の学校。外国人学校（各種学校など）は含みません。";

  function trendSpec() {
    const M = trendModel();
    const regs = regions();
    const shown = YEARS.filter((y) => M.series.some((s) => val(y, s.code, state.t, s.nat) != null));
    const spec = Object.assign({ kind: "trend", siteName: SITE_NAME, siteUrl: document.body.dataset.site }, M);
    spec.title = "外国籍の児童生徒の推移";
    spec.subtitle = [`${regs.map(areaName).join("・")}｜${T[state.t].label}｜${OWN[state.s]}｜${shown[0]}〜${shown[shown.length - 1]}年`];
    spec.legend = M.series.map((s) => ({ line: true, color: s.color, dash: s.dash, marker: s.marker, label: s.name }));
    spec.unit = "単位：人";
    spec.noDataLabel = M.noDataText;
    spec.summary = state.cmpLines || [];
    spec.foot = [`出典：${SURVEY}（${shown[0]}〜${shown[shown.length - 1]}年の各年度。e-Statの表から作成）`, FOOT_SCOPE, "点は各年5月1日現在の人数です。" + (state.t === "high" || state.t === "all" ? "高等学校は全日制・定時制。" : "")];
    spec.file = `gaikoku-jido_trend_${regs.join("-") || "japan"}_${state.t}_${state.s}_${dateStamp()}.png`;
    return [spec];
  }

  function barsSpecs() {
    const D = state.bd, o = D.o;
    const base = { kind: "bars", siteName: SITE_NAME, siteUrl: document.body.dataset.site, unit: "単位：人" };
    const scope = D.kind === "owner" ? T[D.bt].label : OWN_ONLY[D.n];
    if (D.two) {
      const A = Y[D.ya];
      const whys = [...new Set(D.rows.filter((r) => r.status !== "ok").map((r) => r.why))];
      return [Object.assign({}, base, {
        title: D.title,
        subtitle: [`${D.area}・${scope}・${D.ya}年（${A.fy}）→${D.yb}年（${o.fy}）`, `${D.partial ? "比べられる項目の合計" : "全体"} ${fmt(D.ta)}人→${fmt(D.tb)}人（${moveWord(D.tb - D.ta)}）`],
        legend: [{ color: PAIR.a, label: `${D.ya}年（比較元）` }, { color: PAIR.b, label: `${D.yb}年（比較先）` }],
        rows: D.rows.map((r) => ({
          name: r.status === "ok" ? r.name : r.name + "※",
          pair: [{ n: r.a || 0, color: PAIR.a, value: r.a == null ? "—" : fmt(r.a) }, { n: r.b || 0, color: PAIR.b, value: r.b == null ? "—" : fmt(r.b) }],
          value: "",
          sub: r.status === "ok" ? `${changeText(r.a, r.b).diff}${r.pct === null ? "" : `（${changeText(r.a, r.b).pct}）`}` : "比べません（数がない年がある）",
        })),
        foot: [srcLine(o, D.srcKeys, A)].concat(D.msgs, whys.length ? ["※は比べていない項目：" + whys.join("。") + "。"] : [], [FOOT_SCOPE]),
        file: `gaikoku-jido_${D.kind}_2years_${D.kind === "owner" ? D.bt : D.n}_${state.pref || "japan"}_${D.ya}-${D.yb}_${dateStamp()}.png`,
        label: "",
      })];
    }
    const rowsAll = D.rows;
    const chunks = D.kind === "pref" && state.top === 47 ? [0, 1, 2, 3].map((k) => rowsAll.slice(k * PAGE47, (k + 1) * PAGE47)).filter((c) => c.length) : [rowsAll];
    const max = Math.max(...rowsAll.map((r) => r.total || 0));
    const shownSum = D.kind === "pref" ? null : rowsAll.reduce((s, r) => s + (r.total || 0), 0);
    return chunks.map((rows, k) => {
      const range = chunks.length > 1 ? `${rows[0].rank}〜${rows[rows.length - 1].rank}位` : "";
      const sub = [`${D.area}・${o.year}年（${o.fy}）${md(o.as_of)}現在・${D.kind === "pref" ? T[D.bt].label + "・" + OWN_ONLY[D.n] : scope}`];
      if (D.kind === "pref") sub.push(`多い順・${state.top === 47 ? `全47都道府県のうち${range}` : `上位${state.top}`}`);
      if (shownSum != null) sub.push(`合計 ${fmt(shownSum)}人`);
      return Object.assign({}, base, {
        title: D.title, subtitle: sub,
        legend: D.kind === "owner" ? [] : D.nats.map((n) => ({ color: COLOR[n], label: OWN[n] })),
        rows: rows.map((r) => ({
          name: D.kind === "pref" ? `${r.rank}位 ${r.name}` : r.name,
          segs: D.nats.map((n) => ({ n: r[n] || 0, color: COLOR[n] })),
          value: r.none ? "—" : fmt(r.total) + "人",
          sub: r.none ? r.none : D.kind !== "owner" && D.n === "all" ? `公立 ${fmt(r.raw[1])}・私立 ${fmt(r.raw[2])}・国立 ${fmt(r.raw[0])}` : D.kind === "owner" ? pctText(r.total, shownSum) : "",
        })),
        max,
        foot: [srcLine(o, D.srcKeys)].concat(D.msgs, [FOOT_SCOPE], D.kind === "type" ? ["高等学校は全日制・定時制。特別支援学校は幼稚部〜高等部の在学者数。"] : []),
        file: `gaikoku-jido_${D.kind}_${D.kind === "owner" ? D.bt : D.bt ? D.bt + "-" + D.n : D.n}_${D.kind === "pref" ? "top" + state.top + (chunks.length > 1 ? "-" + (k + 1) : "") : state.pref || "japan"}_${o.year}_${dateStamp()}.png`,
        label: range,
      });
    });
  }

  function openImage(which) {
    imageWhich = which;
    imagePage = 0;
    const a = $("nj-x-" + which);
    $("img-saved").hidden = true;
    $("img-preview").hidden = true;
    $("img-x").href = a.href;
    $("img-x-text").textContent = a.dataset.text;
    const D = state.bd;
    $("img-what").textContent = which === "trend" ? "いま表示している推移のグラフを、Xに載せやすい縦長の画像（1080×1350）にします。" : `いま表示している${D.two ? D.prefix + "の2年比較" : VIEW[state.v]}のグラフを、縦長の画像（1080×1350）にします。${!D.two && state.v === "pref" && state.top === 47 ? "全47件は字が小さくならないよう、12件ずつ4枚に分けて保存します。" : ""}`;
    $("img-dialog").showModal();
    renderImage();
  }

  function renderImage() {
    const specs = imageWhich === "trend" ? trendSpec() : barsSpecs();
    const pg = $("img-page");
    pg.hidden = specs.length < 2;
    pg.innerHTML = specs.length > 1 ? specs.map((s, i) => `<button type="button" data-p="${i}" aria-pressed="${i === imagePage}">${esc(s.label)}</button>`).join("") : "";
    const spec = specs[Math.min(imagePage, specs.length - 1)];
    window.__fgImage = spec;
    const job = ++imageJob, img = $("img-preview"), save = $("img-save");
    save.hidden = true;
    $("img-status").textContent = "画像を作っています…";
    window.MapImage.render(spec).then((blob) => {
      if (job !== imageJob) return;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(blob);
      img.src = imageUrl;
      img.alt = `保存する画像のプレビュー：${spec.title}`;
      img.hidden = false;
      save.href = imageUrl;
      save.download = spec.file;
      save.hidden = false;
      $("img-status").textContent = `ファイル名：${spec.file}（1080×1350ピクセル${spec.rows ? `・${spec.rows.length}件` : ""}）`;
    }).catch(() => { if (job === imageJob) $("img-status").textContent = "画像を作れませんでした。ページを開き直してお試しください。"; });
  }

  // 確認用（ブラウザの開発者ツールから）
  window.__fgCheck = () => ({ state: JSON.parse(JSON.stringify({ ...state, bd: undefined })), bd: state.bd && { kind: state.bd.kind, two: state.bd.two, n: state.bd.n, bt: state.bd.bt, area: state.bd.area, msgs: state.bd.msgs, ta: state.bd.ta, tb: state.bd.tb, rows: state.bd.rows.map((r) => (state.bd.two ? [r.name, r.a, r.b, r.status, r.d, r.pct] : [r.name, r.total, r.rank, r.none || ""])) }, result: $("nj-result").innerText, say: [$("nj-trend-say").textContent, $("nj-bd-say").textContent], head: $("nj-bd-head").textContent, msg: $("nj-bd-msg").hidden ? "" : $("nj-bd-msg").textContent, why: $("nj-n-why").hidden ? "" : $("nj-n-why").textContent, url: location.search });
  window.__fgVal = (y, code, t, s) => val(y, code, t, s);
})();
