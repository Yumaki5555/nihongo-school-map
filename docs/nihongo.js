/* 日本語指導が必要な児童生徒のページ：人数の推移（全国・都道府県）と、内訳（言語別・都道府県別・学校種別。言語別・学校種別は2年の比較も）。
   データは data/nihongo_shido.json（scripts/fetch_nihongo_shido.py が国の表から作る。表示のたびに Excel は読まない） */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 外国籍＝青、日本国籍＝緑（全部のグラフで同じ。色覚の見分けやすさと背景とのコントラストを確かめた組み合わせ）
  const COLOR = { f: "#2B5FA8", j: "#3E9A4E", all: "#5F4615" };
  // 内訳の2年比較の色：国籍の青・緑と混ざらない茶の濃淡（過去の年の色も白地とのコントラスト3:1以上）
  const PAIR = { a: "#9A8455", b: "#3F3018" };
  const NAT = { all: "合計", f: "外国籍", j: "日本国籍", both: "外国籍と日本国籍" };
  const NAT_ONLY = { all: "合計（外国籍＋日本国籍）", f: "外国籍のみ", j: "日本国籍のみ" };
  const VIEW = { lang: "言語別", pref: "都道府県別", type: "学校種別" };
  const SITE_NAME = "日本語学校・留学生 全国マップ";
  const SURVEY = "文部科学省「日本語指導が必要な児童生徒の受入状況等に関する調査」";
  const QUICK = [5, 10, 20];
  // 2つの年の比較の過去の年：国籍の色を白と混ぜた薄い色（棒の枠は国籍の色のままにして、白地との見分けを保つ）
  const SHADE = { f: "#AABFDC", j: "#B2D7B8" };
  // 都道府県別の並べ方
  const RANK_BY = { all: "児童生徒数の合計（外国籍＋日本国籍）が多い順", f: "外国籍の児童生徒数が多い順", j: "日本国籍の児童生徒数が多い順" };
  // 読み取り文の主語（「全国の外国籍は」のように対象を抜かさない）
  const WHO = { all: "日本語指導が必要な児童生徒（外国籍＋日本国籍）", f: "日本語指導が必要な外国籍の児童生徒", j: "日本語指導が必要な日本国籍の児童生徒" };
  const PAGE47 = 12; // 全47件の画像は12件ずつに分けて保存する（文字を小さくしすぎないため）
  // s＝推移の区分、n＝内訳の国籍の区分（別々に持ち、URLでも別々に残す）。mode＝内訳を1年で見るか2年を比べるか
  const state = { pref: "", pref2: "", s: "all", a: null, b: null, v: "lang", y: null, n: "all", top: 10, mode: "one", ya: null, yb: null };
  let N, Y = {}, YEARS = [], LATEST, CODES = [], FIRST_J;
  let urlTimer = 0, imageUrl = "", imageJob = 0, imageWhich = "trend", imagePage = 0;

  fetch("data/nihongo_shido.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { N = d; init(); })
    .catch(() => { $("nj-loading").hidden = true; $("nj-error").hidden = false; });

  // ---- 共通 ----
  const md = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${Number(m[2])}月${Number(m[3])}日` : ""; };
  const jpDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : ""; };
  const ym = (iso) => { const m = /^(\d{4})-(\d{2})/.exec(iso || ""); return m ? `${m[1]}年${Number(m[2])}月` : ""; };
  const areaName = (code) => (code ? N.prefs[code] : "全国");
  const when = (o) => `${o.year}年（${o.fy}・${md(o.as_of)}現在）`;
  // 整数どうしの割り算を四捨五入（丸める前の値から。浮動小数の誤差を入れない）
  function roundDiv(n, d) { const s = n < 0 ? -1 : 1; const a = Math.abs(n); return s * Math.floor((2 * a + d) / (2 * d)); }
  const pctText = (part, whole) => (whole > 0 ? (roundDiv(part * 1000, whole) / 10).toFixed(1) + "％" : "—");
  function dateStamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }

  // 地域・区分の人数（データがない年は null。0 とは区別する）
  function val(y, code, s) {
    const o = Y[y];
    const f = code ? o.pref.f[code] : o.nat.f;
    const j = code ? (o.pref.j ? o.pref.j[code] : null) : o.nat.j;
    if (s === "f") return f;
    if (s === "j") return j;
    return j == null ? null : f + j;
  }
  const regions = () => (state.pref2 && state.pref ? [state.pref, state.pref2] : [state.pref]);
  // 推移の線を引ける年（「外国籍と日本国籍」は両方そろう年だけ）
  const availYears = (s) => YEARS.filter((y) => regions().every((c) => val(y, c, s === "both" ? "all" : s) != null));

  // 増減・増減率・倍率（過去の年が0人なら率と倍率は出さない。どちらかの年がデータなしなら null）
  function change(a, b) {
    if (a == null || b == null) return null;
    const d = b - a;
    if (a === 0) return { d, pct: null, ratio: null };
    return { d, pct: roundDiv(d * 1000, a), ratio: roundDiv(b * 100, a) };
  }
  // 文言は増加・減少・変化なしで切り替える（「−○人増加」のような書き方はしない）
  function changeText(a, b) {
    const c = change(a, b);
    if (!c) return { diff: "データなし", pct: "データなし", ratio: "データなし", na: true };
    const diff = moveWord(c.d);
    if (c.pct === null) return { diff, pct: "算出できません", ratio: "算出できません", zero: true };
    const word = c.d > 0 ? "増加" : "減少";
    const pct = c.d === 0 ? "0.0％（変化なし）" : c.pct === 0 ? `0.1％未満の${word}` : `${(Math.abs(c.pct) / 10).toFixed(1)}％${word}`;
    return { diff, pct, ratio: (c.ratio / 100).toFixed(2) + "倍", zero: false };
  }
  const moveWord = (d) => (d > 0 ? `${fmt(d)}人増加` : d < 0 ? `${fmt(-d)}人減少` : "変化なし");

  // 比べる年：b から n 年前にいちばん近い調査年（同じだけ近いときは古い方）。2年より離れていれば選べない
  function nearest(n, b, years) {
    let best = null;
    years.forEach((y) => { if (y >= b) return; const d = Math.abs(y - (b - n)); if (best === null || d < best.d) best = { y, d }; });
    return best && best.d <= 2 ? best.y : null;
  }
  const prevYear = (b, years) => nearest(QUICK[0], b, years) || years.filter((y) => y < b).pop() || years.find((y) => y !== b) || null;
  const quickYear = (n, b) => nearest(n, b, YEARS);
  // 推移の2つの年の比較の初期値：約20年前（なければ約10年前・約5年前・1つ前の調査）。年は埋め込まず、データの調査年から決める
  const defaultPast = (b) => quickYear(20, b) || quickYear(10, b) || quickYear(5, b) || YEARS.filter((y) => y < b).pop() || null;
  // 新しい年を変えて過去の年が新しい年以降になったら、それまでと同じくらいの年数前に直す（なければ初期値）
  const keepGap = (gap, b, fallback) => nearest(gap, b, YEARS) || fallback(b);
  // 地域を変える（地域の選択欄・ランキングの都道府県名・「全国に戻す」で共通）
  function setPref(code) { state.pref = code; if (state.pref2 === state.pref) state.pref2 = ""; }

  function init() {
    N.years.forEach((o) => { Y[o.year] = o; });
    YEARS = N.years.map((o) => o.year).sort((a, b) => a - b);
    LATEST = YEARS[YEARS.length - 1];
    FIRST_J = YEARS.find((y) => Y[y].pref.j);
    // 都道府県コードの順（01北海道〜47沖縄）。Object.keys のままだと「10」以降が先に来て、01〜09が最後に回るので並べ直す
    CODES = Object.keys(N.prefs).sort();
    $("nj-pref").innerHTML = '<option value="">全国</option>' + CODES.map((c) => `<option value="${c}">${esc(N.prefs[c])}</option>`).join("");
    readUrl();
    $("nj-lang-def").textContent = `言語別は「${N.lang_def.replace(/（.*）$/, "")}」の区分で、国籍や出身国を表すものではありません。`;
    $("nj-src-table").innerHTML = sourceTable();
    $("nj-pref").addEventListener("change", (e) => { setPref(e.target.value); render(); });
    $("nj-reset").addEventListener("click", () => { setPref(""); render(); $("nj-area-title").focus(); });
    // ランキングの都道府県名：地図へは移動せず、このページの地域をその都道府県にして、地域のデータへ移動
    $("nj-bars").addEventListener("click", (e) => { const b = e.target.closest("button[data-pref]"); if (!b) return; setPref(b.dataset.pref); render(); jumpTo("area"); });
    $("nj-pref2").addEventListener("change", (e) => { state.pref2 = e.target.value; render(); });
    seg("nj-s", "s", (v) => { state.s = v; });
    seg("nj-v", "v", (v) => { state.v = v; });
    seg("nj-n", "n", (v) => { state.n = v; });
    seg("nj-top", "top", (v) => { state.top = Number(v); });
    seg("nj-mode", "mode", (v) => { if (v === "two" && state.mode !== "two") { state.yb = state.y; state.ya = null; } if (v === "one" && state.mode === "two") state.y = state.yb; state.mode = v; });
    // 過去の年の選択肢は新しい年より前だけ。新しい年を過去の年以前に変えたら、過去の年を直す
    $("nj-a").addEventListener("change", (e) => { state.a = Number(e.target.value); render(); });
    $("nj-b").addEventListener("change", (e) => { const gap = state.b - state.a; state.b = Number(e.target.value); if (state.a >= state.b) state.a = keepGap(gap, state.b, defaultPast); render(); });
    $("nj-y").addEventListener("change", (e) => { state.y = Number(e.target.value); render(); });
    $("nj-ya").addEventListener("change", (e) => { state.ya = Number(e.target.value); render(); });
    $("nj-yb").addEventListener("change", (e) => { const gap = state.yb - state.ya; state.yb = Number(e.target.value); if (state.ya >= state.yb) state.ya = keepGap(gap, state.yb, (b) => prevYear(b, YEARS)); render(); });
    $("nj-quick").addEventListener("click", (e) => { const b = e.target.closest("button[data-a]"); if (b && !b.disabled) { state.a = Number(b.dataset.a); render(); } });
    // 冒頭の4つのボタン：推移へ移動、または内訳を切り替えて移動（選んだ地域はそのまま）
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

  // 見出しへ移動。画面の上に固定された帯があれば、その下に見出しが来るようにずらす
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
    if (["all", "f", "j", "both"].includes(p.get("s"))) state.s = p.get("s");
    const yr = (k) => { const n = Number(p.get(k)); return YEARS.includes(n) ? n : null; };
    state.a = yr("a"); state.b = yr("b"); state.y = yr("y");
    if (state.a && state.b && state.a > state.b) [state.a, state.b] = [state.b, state.a]; // 以前の逆向きのリンクも古い年→新しい年で開く
    if (VIEW[p.get("v")]) state.v = p.get("v");
    // 内訳の国籍。以前のリンクの m（都道府県別の順位の基準）・ln（言語別の国籍）も読む
    const n = p.get("n") || (state.v === "pref" ? p.get("m") : state.v === "lang" ? p.get("ln") : null);
    if (["all", "f", "j"].includes(n)) state.n = n;
    if (["5", "10", "47"].includes(p.get("top"))) state.top = Number(p.get("top"));
    const ys = /^(\d{4})-(\d{4})$/.exec(p.get("ys") || "");
    if (ys && YEARS.includes(+ys[1]) && YEARS.includes(+ys[2]) && ys[1] !== ys[2]) { state.mode = "two"; state.ya = Math.min(+ys[1], +ys[2]); state.yb = Math.max(+ys[1], +ys[2]); }
  }

  function query() {
    const p = new URLSearchParams();
    if (state.pref2 && state.pref) p.set("cmp", `${state.pref}-${state.pref2}`);
    else if (state.pref) p.set("pref", state.pref);
    if (state.s !== "all") p.set("s", state.s);
    if (state.a && state.a !== defaultPast(state.b)) p.set("a", state.a);
    if (state.b && state.b !== LATEST) p.set("b", state.b);
    if (state.v !== "lang") p.set("v", state.v);
    if (state.n !== "all") p.set("n", state.n);
    if (state.v !== "pref" && state.mode === "two") p.set("ys", `${state.ya}-${state.yb}`);
    else if (state.y && state.y !== LATEST) p.set("y", state.y);
    if (state.v === "pref" && state.top !== 10) p.set("top", state.top);
    const s = p.toString();
    return s ? "?" + s : "";
  }
  const pageUrl = (hash) => document.body.dataset.site + "nihongo.html" + query() + (hash ? "#" + hash : "");

  // ---- 全体の描き直し ----
  function render() {
    // 選べない組み合わせを直す（データのない年を選んだままにしない）
    // 2つの年の比較は外国籍・日本国籍を並べるので、どの調査年も選べる（数のない年は「データなし」と書く）。
    // URLに b がない＝最新の調査、a がない＝約20年前。過去の年は新しい年より前に限る
    if (!YEARS.includes(state.b) || state.b === YEARS[0]) state.b = LATEST;
    if (!YEARS.includes(state.a) || state.a >= state.b) state.a = defaultPast(state.b);
    if (!state.y || !YEARS.includes(state.y)) state.y = LATEST;
    if (state.mode === "two") {
      if (!YEARS.includes(state.yb)) state.yb = state.y;
      if (state.yb === YEARS[0]) state.yb = YEARS[1];
      if (!YEARS.includes(state.ya) || state.ya >= state.yb) state.ya = prevYear(state.yb, YEARS);
    }
    $("nj-pref").value = state.pref;
    $("nj-pref2").innerHTML = state.pref
      ? '<option value="">なし</option>' + CODES.filter((c) => c !== state.pref).map((c) => `<option value="${c}">${esc(N.prefs[c])}</option>`).join("")
      : '<option value="">（上の「地域」で都道府県を選ぶと選べます）</option>';
    $("nj-pref2").disabled = !state.pref;
    $("nj-pref2").value = state.pref2;
    pressed("nj-s", "s", state.s);
    pressed("nj-v", "v", state.v);
    pressed("nj-top", "top", String(state.top));
    renderKpi();
    renderTrend();
    renderBreakdown();
    // アドレス欄の更新は少し待ってから（続けて操作したときにブラウザが更新を止めないように）
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => history.replaceState(null, "", location.pathname + query() + location.hash), 200);
  }

  function pressed(id, key, v) { $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[key] === v))); }

  function renderKpi() {
    const o = Y[LATEST], c = state.pref;
    const f = val(LATEST, c, "f"), j = val(LATEST, c, "j");
    // 上のカードは常に最新の調査（下のグラフで選んだ過去の年と取りちがえないよう「最新」と書く）
    $("nj-area-title").textContent = `${areaName(c)}のデータ`;
    $("nj-reset").hidden = !c;
    $("nj-kpi-when").innerHTML = `<span class="nj-badge">${LATEST}年・最新</span> ${esc(o.fy)}・${md(o.as_of)}現在・公立学校`;
    const tile = (k, n, sub) => `<li class="nj-kpi-${k}"><span>${k === "all" ? "合計" : `<i class="nj-sw" style="background:${COLOR[k]}"></i>${NAT[k]}`}</span><b>${fmt(n)}<small>人</small></b>${sub ? `<small>${sub}</small>` : ""}</li>`;
    $("nj-kpis").innerHTML = tile("all", f + j, "外国籍＋日本国籍") + tile("f", f, `合計の${pctText(f, f + j)}`) + tile("j", j, `合計の${pctText(j, f + j)}`);
  }

  // ---- A 人数の推移 ----
  // 線の一覧：「外国籍と日本国籍」は地域ごとに2本（色＝国籍、点線＝2つ目の地域）
  const trendLines = () => regions().flatMap((c, i) => (state.s === "both" ? ["f", "j"] : [state.s]).map((k) => ({ c, k, i })));
  const lineName = (l) => `${areaName(l.c)}・${NAT[l.k]}`;

  function renderTrend() {
    const ys = availYears(state.s);
    const regs = regions();
    const L = trendLines();
    const both = state.s === "both";
    const msg = [];
    if (state.s !== "f" && state.pref) msg.push(both
      ? `都道府県別の日本国籍の人数は${FIRST_J}年から公表されています。それより前は外国籍の線だけを表示しています。`
      : `都道府県別の日本国籍の人数は${FIRST_J}年から公表されています。それより前の${NAT[state.s]}は表示できません（外国籍は2005年から選べます）。`);
    $("nj-trend-msg").hidden = !msg.length;
    $("nj-trend-msg").textContent = msg.join("");
    const M = trendModel();
    $("nj-trend-legend").innerHTML = M.series.map((se) => `<span class="nj-lg"><svg width="34" height="14" aria-hidden="true"><line x1="2" y1="7" x2="32" y2="7" stroke="${se.color}" stroke-width="2.5"${se.dash ? ' stroke-dasharray="6 4"' : ""}/>${se.marker === "square" ? `<rect x="13" y="3" width="8" height="8" fill="${se.color}"/>` : `<circle cx="17" cy="7" r="4" fill="${se.color}"/>`}</svg>${esc(se.name)}</span>`).join("") + '<span class="nj-unit">単位：人</span>';
    // 2つの年の比較：過去の年は新しい年より前だけ、新しい年は最初の調査より後だけを選べる（年の向きが逆にならない）
    const opt = (list, sel) => list.map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${y}年（${Y[y].fy}）</option>`).join("");
    $("nj-a").innerHTML = opt(YEARS.filter((y) => y < state.b), state.a);
    $("nj-b").innerHTML = opt(YEARS.slice(1), state.b);
    $("nj-quick").innerHTML = `<span class="fine">${state.b}年から数えて</span>` + QUICK.map((n) => {
      const y = quickYear(n, state.b);
      return `<button type="button" class="btn-x" data-a="${y || ""}"${y ? "" : " disabled"} aria-pressed="${y === state.a}">約${n}年前${y ? `（${y}年）` : "（該当なし）"}</button>`;
    }).join("");
    renderCompare(regs);
    // 読み取り文（推移の山だけ。比較の数はグラフに書いてあるので繰り返さない）
    let say = "";
    if (!both) {
      const peaks = regs.map((c) => ({ c, ...ys.map((y) => ({ y, v: val(y, c, state.s) })).reduce((m, p) => (p.v > m.v ? p : m)) }));
      say = peaks.length > 1
        ? `表示している調査年の中で最も多いのは、${peaks.map((p) => `${areaName(p.c)}が${p.y}年（${fmt(p.v)}人）`).join("、")}です。`
        : `表示している調査年の中で最も多いのは${peaks[0].y}年（${fmt(peaks[0].v)}人）です。`;
    }
    $("nj-trend-say").textContent = say;
    $("nj-trend-say").hidden = !say;
    $("nj-trend-note").textContent = "点は調査をした年です。線は調査と調査を結んだもので、その間の年の人数を表すものではありません。点線より左（2010年まで）は9月1日現在、右（2012年から）は5月1日現在です。";
    // 表
    const head = `<tr><th scope="col">調査年</th><th scope="col">基準日</th>${L.map((l) => `<th scope="col" class="num">${esc(areaName(l.c))}<br>${NAT[l.k]}</th>`).join("")}</tr>`;
    const body = YEARS.slice().reverse().map((y) => `<tr><th scope="row">${y}年（${Y[y].fy}）</th><td>${jpDate(Y[y].as_of)}</td>${L.map((l) => { const v = val(y, l.c, l.k); return `<td class="num">${v == null ? "—" : fmt(v) + "人"}</td>`; }).join("")}</tr>`).join("");
    $("nj-trend-table").innerHTML = `<table class="plain"><thead>${head}</thead><tbody>${body}</tbody></table><p class="fine">—：都道府県別の日本国籍が公表されていない年（0人ではありません）。</p>`;
    drawTrend();
    const text = `日本語指導が必要な児童生徒（公立学校）｜${regs.map(areaName).join("・")}の${NAT[state.s]}の推移\n${state.cmpLines.join("\n")}\n${SITE_NAME}`;
    setX("trend", text, pageUrl("trend"));
  }

  // ---- 2つの年の比較：外国籍・日本国籍ごとに2本の横棒（0から。全部の棒で同じ尺度）。過去の年は薄い色＋同じ色の枠 ----
  const val0 = (v) => (v == null ? "データなし" : fmt(v) + "人");
  function renderCompare(regs) {
    const a = state.a, b = state.b;
    $("nj-cmp-sub").innerHTML = `<b>${esc(regs.map(areaName).join("・"))}</b>｜${a}年 → ${b}年・公立学校`;
    const cells = regs.map((c) => ["f", "j"].map((k) => ({ c, k, va: val(a, c, k), vb: val(b, c, k) })));
    const max = Math.max(1, ...cells.flat().flatMap((x) => [x.va || 0, x.vb || 0]));
    const lines = [];
    const bar = (y, v, k, past) => `<li><span class="nj-cy">${y}年</span><span class="nj-ctrack">${v ? `<span class="nj-cbar" style="width:calc((100% - 5.5em) * ${(v / max).toFixed(4)});background:${past ? SHADE[k] : COLOR[k]};border-color:${COLOR[k]}"></span>` : ""}<span class="nj-cv${v == null ? " na" : ""}">${val0(v)}</span></span></li>`;
    let html = cells.map((row, i) => `<div class="nj-cg">${regs.length > 1 ? `<p class="nj-cg-h">${esc(areaName(regs[i]))}</p>` : ""}` + row.map((x) => {
      const t = changeText(x.va, x.vb);
      lines.push(`${areaName(x.c)}・${NAT[x.k]}：${a}年 ${val0(x.va)}→${b}年 ${val0(x.vb)}${t.na ? "" : t.zero ? `（${t.diff}）` : `（${t.ratio}・${t.diff}）`}`);
      const stat = t.na
        ? `<p class="nj-cratio nj-na"><small>人数の倍率・増減率</small><b>データなし</b><small>${x.va == null ? a : b}年の数がありません</small></p>`
        : (t.zero
          ? `<p class="nj-cratio nj-na"><small>人数の倍率・増減率</small><b>算出できません</b><small>${a}年が0人のため</small></p>`
          : `<p class="nj-cratio"><small>人数の倍率</small><b>${t.ratio}</b></p>`)
          + `<dl class="nj-cmore"><div><dt>人数の変化</dt><dd>${t.diff}</dd></div>${t.zero ? "" : `<div><dt>増減率</dt><dd>${t.pct}</dd></div>`}</dl>`;
      return `<div class="nj-cp"><h4><i class="nj-sw" style="background:${COLOR[x.k]}"></i>${NAT[x.k]}</h4>
        <div class="nj-cp-body"><ul class="nj-cbars">${bar(a, x.va, x.k, true)}${bar(b, x.vb, x.k, false)}</ul><div class="nj-cstat">${stat}</div></div></div>`;
    }).join("") + "</div>").join("");
    const da = md(Y[a].as_of), db = md(Y[b].as_of);
    const notes = [da === db ? `${a}年・${b}年とも${da}現在の人数です。` : `${a}年は${da}現在、${b}年は${db}現在の人数です。`];
    if (cells.flat().some((x) => x.va == null || x.vb == null)) notes.push(`都道府県別の日本国籍は${FIRST_J}年から公表されています。`);
    html += `<p class="fine nj-cnote">※${notes.join("")}</p>`;
    $("nj-result").innerHTML = html;
    state.cmpLines = lines;
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
    // 印：1つの区分なら地域で（丸＝1つ目・四角＝2つ目）、外国籍と日本国籍を並べるときは国籍で（丸＝外国籍・四角＝日本国籍）
    const series = trendLines().map((l) => ({ code: l.c, nat: l.k, name: lineName(l), dash: l.i > 0, marker: both ? (l.k === "f" ? "circle" : "square") : l.i ? "square" : "circle", color: COLOR[both ? l.k : state.s], points: YEARS.map((y) => ({ x: y, v: val(y, l.c, l.k), big: y === state.a || y === state.b })) }));
    const all = series.flatMap((s) => s.points.map((p) => p.v).filter((v) => v != null));
    const yMax = niceMax(Math.max(...all));
    const noData = state.pref && state.s !== "f" ? [YEARS[0] - 0.6, (FIRST_J + YEARS[YEARS.indexOf(FIRST_J) - 1]) / 2] : null;
    return { series, yMax, yTicks: ticks(yMax), x0: YEARS[0] - 0.6, x1: YEARS[YEARS.length - 1] + 0.6, xTicks: [2005, 2010, 2015, 2020, 2025], breakAt: 2011, noData };
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
    if (M.noData) s += `<rect x="${X(M.noData[0])}" y="${m.t}" width="${X(M.noData[1]) - X(M.noData[0])}" height="${H - m.t - m.b}" fill="#5C5140" opacity=".07"/><text x="${(X(M.noData[0]) + X(M.noData[1])) / 2}" y="${m.t + 30}" text-anchor="middle" class="nj-ax">${state.s === "both" ? "日本国籍なし" : "データなし"}</text>`;
    s += `<line x1="${X(M.breakAt)}" x2="${X(M.breakAt)}" y1="${m.t}" y2="${H - m.b}" stroke="#8A7A55" stroke-dasharray="4 4"/>`;
    M.series.forEach((se) => {
      let d = "", on = false;
      se.points.forEach((p) => { if (p.v == null) { on = false; return; } d += `${on ? "L" : "M"}${X(p.x).toFixed(1)},${Yp(p.v).toFixed(1)}`; on = true; });
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2"${se.dash ? ' stroke-dasharray="6 4"' : ""} stroke-linejoin="round"/>`;
      se.points.forEach((p) => {
        if (p.v == null) return;
        const r = p.big ? 5.5 : 4, x = X(p.x), y = Yp(p.v);
        s += se.marker === "square" ? `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${se.color}" stroke="#FFFDF6" stroke-width="2"/>` : `<circle cx="${x}" cy="${y}" r="${r}" fill="${se.color}" stroke="#FFFDF6" stroke-width="2"/>`;
      });
    });
    // 値の文字は選んだ2年だけ（線が1本のとき）
    if (M.series.length === 1) M.series[0].points.forEach((p) => { if (p.big && p.v != null) { const x = Math.min(W - m.r - 30, Math.max(m.l + 30, X(p.x))); s += `<text x="${x}" y="${Yp(p.v) - 10}" text-anchor="middle" class="nj-val">${fmt(p.v)}</text>`; } });
    s += `<line id="nj-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="#352D20" stroke-width="1" opacity="0"/><rect id="nj-hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/></svg><div class="nj-tip" id="nj-tip" hidden></div>`;
    box.innerHTML = s;
    const hit = $("nj-hit"), tip = $("nj-tip"), cross = $("nj-cross");
    const show = (ev) => {
      const rect = box.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const ys = YEARS.filter((y) => M.series.some((se) => val(y, se.code, se.nat) != null));
      const y = ys.reduce((b, k) => (Math.abs(X(k) - px) < Math.abs(X(b) - px) ? k : b), ys[0]);
      cross.setAttribute("x1", X(y)); cross.setAttribute("x2", X(y)); cross.setAttribute("opacity", ".35");
      tip.innerHTML = `<b>${y}年</b>（${esc(Y[y].fy)}・${md(Y[y].as_of)}現在）` + M.series.map((se) => { const v = val(y, se.code, se.nat); return `<br>${esc(se.name)}：${v == null ? "データなし" : fmt(v) + "人"}`; }).join("");
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
  const normName = (s) => (s === "フィリピノ語（タガログ語）" ? "フィリピノ語" : s); // 2012年までの表記。同じ区分
  const quote = (D, name) => (D.kind === "lang" ? `「${name}」` : name);
  const srcFor = (keys, k) => keys.filter((x) => k === "all" || !/_[fj]$/.test(x) || x.endsWith("_" + k));

  // 言語別・学校種別の、その年・地域の外国籍と日本国籍の数（ないものは null。0 とは区別する）
  function catSet(o, v, code) {
    if (v === "type") {
      const T = o.type;
      const f = code ? T.pref.f[code] : T.nat.f;
      const j = code ? (T.pref.j ? T.pref.j[code] : null) : T.nat.j;
      const cats = N.types.map((t) => (t.id === "special" ? o.special_label : t.label));
      return { o, v, area: code, fallback: false, f: f ? { kind: "学校種別", cats, v: f } : null, j: j ? { kind: "学校種別", cats, v: j } : null };
    }
    const F = o.lang.f, J = o.lang.j;
    const area = code && F && F.pref ? code : ""; // 都道府県別の言語（母語）別がない年は全国の数
    const get = (X) => { const v = !X ? null : area ? (X.pref ? X.pref[area] : null) : X.nat; return v ? { kind: X.kind, cats: X.cats, v } : null; };
    return { o, v, area, fallback: !!code && !area, f: get(F), j: get(J) };
  }

  // 国籍の区分が選べるか。選べないものだけ理由の文を入れる（外国籍はいつも選べる）
  function whyNot(set) {
    const o = set.o, why = {};
    if (set.v === "pref") { if (!o.pref.j) why.j = why.all = `${o.year}年は都道府県別の日本国籍の数が公表されていません（${FIRST_J}年から）`; return why; }
    if (!set.j) why.j = why.all = set.v === "lang" ? `${o.year}年は日本国籍の言語別が公表されていません（2014年から）` : `${o.year}年の${areaName(set.area)}は日本国籍の学校種別が公表されていません（都道府県別は${FIRST_J}年から）`;
    else if (set.f.kind !== set.j.kind || set.f.cats.join() !== set.j.cats.join()) why.all = `${o.year}年は外国籍が「${set.f.kind}」、日本国籍が「${set.j.kind}」の集計で、分け方がちがうため合計を出せません`;
    return why;
  }

  // 区分ごとの数。合計は外国籍＋日本国籍（分け方が同じ年だけ）
  function valsOf(set, k) {
    const g = k === "j" ? set.j : set.f;
    return g.cats.map((c, i) => {
      const f = set.f ? set.f.v[i] : null, j = set.j ? set.j.v[i] : null;
      const total = k === "f" ? f : k === "j" ? j : f == null && j == null ? null : (f || 0) + (j || 0);
      return { name: c, f: k === "j" ? null : f, j: k === "f" ? null : j, total, i };
    });
  }
  const byCount = (a, b) => (a.name === "その他") - (b.name === "その他") || (b.total ?? -1) - (a.total ?? -1) || a.i - b.i;

  function bdData() {
    if (state.v === "pref") return prefData(Y[state.y]);
    if (state.mode === "two") return pairData();
    return oneData(Y[state.y]);
  }

  function oneData(o) {
    const set = catSet(o, state.v, state.pref), why = whyNot(set);
    const k = why[state.n] ? "f" : state.n;
    const D = { kind: state.v, two: false, o, why, k, area: areaName(set.area), msgs: [], notes: [] };
    if (set.fallback) D.msgs.push(`${o.year}年の${set.f.kind}は都道府県別の数が公表されていないため、全国の数を表示しています。`);
    // 選んだ区分がない年は外国籍にして、グラフの前で知らせる
    if (k !== state.n) D.msgs.push(`この年の${D.area}は${why.j ? "日本国籍の内訳がない" : "外国籍と日本国籍で分け方がちがう"}ため、外国籍のみ表示しています。`);
    const rows = valsOf(set, k);
    if (state.v === "type") rows.forEach((r) => { if (r.total == null) r.none = "区分なし（2016年から）"; });
    else rows.sort(byCount);
    D.rows = rows;
    D.nats = k === "all" ? ["f", "j"] : [k];
    D.prefix = state.v === "type" ? "学校種別" : (k === "j" ? set.j : set.f).kind;
    D.head = `${D.prefix}：${D.area}・${when(o)}・${NAT_ONLY[k]}`;
    D.order = state.v === "lang" ? "人数の多い順（「その他」は末尾）" : "";
    D.title = `${D.prefix} 日本語指導が必要な児童生徒（公立学校）`;
    if (state.v === "lang") {
      if (o.year === 2025) D.notes.push("「ネパール語」は2025年から独立した区分です。それまでは「その他」に含まれます。");
      else if (o.year >= 2021) D.notes.push("この年は「ネパール語」の区分がなく、「その他」に含まれます。");
      if (D.prefix === "母語別") D.notes.push("2018年までの外国籍は「母語別」の集計で、2021年からの「言語別」とは分け方がちがいます。");
      D.notes.push("言語別の人数は国籍別の人数ではありません。「その他」は公式の区分で、複数の言語をまとめたものです。");
      D.srcKeys = srcFor(set.area ? ["lang_pref_f", "lang_pref_j"] : ["lang_f", "lang_j", "lang_pref_f", "lang_pref_j"], k);
    } else {
      if (o.year < 2016) D.notes.push("義務教育学校は2016年からの学校の種類です。この年は区分がありません（0人という意味ではありません）。");
      if (o.year <= 2006) D.notes.push("2006年までは「盲・聾・養護学校」、2007年からは「特別支援学校」の区分です。");
      D.notes.push("高等学校は全日制・定時制・通信制の計です。");
      D.srcKeys = srcFor(set.area ? ["pref_f", "pref_j"] : ["type", "type_f", "type_j", "pref_f", "pref_j"], k);
    }
    return D;
  }

  function prefData(o) {
    const why = whyNot({ o, v: "pref" });
    const k = why[state.n] ? "f" : state.n;
    const D = { kind: "pref", two: false, o, why, k, area: "全国", msgs: [], notes: [] };
    if (k !== state.n) D.msgs.push(`${o.year}年は都道府県別の日本国籍の数が公表されていないため、外国籍の児童生徒数が多い順に並べています（日本国籍の都道府県別は${FIRST_J}年から）。`);
    const all = CODES.map((c) => {
      const f = o.pref.f[c], j = o.pref.j ? o.pref.j[c] : null;
      const key = k === "f" ? f : k === "j" ? j : f + j;
      return { name: N.prefs[c], code: c, f: k !== "j" ? f : null, j: k !== "f" ? j : null, ff: f, jj: j, key, total: key };
    }).sort((a, b) => b.key - a.key || a.code.localeCompare(b.code));
    all.forEach((r, i) => { r.rank = i && all[i - 1].key === r.key ? all[i - 1].rank : i + 1; });
    D.allRows = all;
    D.rows = all.slice(0, state.top); // 同じ数でも表示件数でちょうど切る（割合もこの件数で計算する）
    D.nats = k === "all" ? ["f", "j"] : [k];
    if (state.pref && !D.rows.some((r) => r.code === state.pref)) D.extra = all.find((r) => r.code === state.pref);
    const endKey = D.rows[D.rows.length - 1].key;
    const tie = all.slice(D.rows.length).filter((r) => r.key === endKey).length;
    if (tie) D.notes.push(`${D.rows[D.rows.length - 1].rank}位と同じ数の都道府県がほかに${tie}あります（表示しておらず、上位${state.top}の割合にも含めていません）。`);
    D.prefix = "都道府県別";
    D.head = `都道府県別：${when(o)}・${RANK_BY[k]}・${state.top === 47 ? "全47都道府県" : `上位${state.top}`}`;
    D.order = "";
    D.title = "都道府県別 日本語指導が必要な児童生徒（公立学校）";
    D.notes.push("同じ数は同じ順位です。");
    D.srcKeys = srcFor(["pref_f", "pref_j"], k);
    return D;
  }

  // 2年の比較（同じ地域・同じ国籍の区分）。分け方が変わった項目は比べない
  function pairData() {
    const [lo, hi] = state.ya < state.yb ? [state.ya, state.yb] : [state.yb, state.ya];
    const A = Y[lo], B = Y[hi];
    const sa = catSet(A, state.v, state.pref), sb = catSet(B, state.v, state.pref);
    const wa = whyNot(sa), wb = whyNot(sb), why = {};
    ["all", "f", "j"].forEach((x) => { if (wa[x] || wb[x]) why[x] = wa[x] || wb[x]; });
    const k = why[state.n] ? "f" : state.n;
    const D = { kind: state.v, two: true, o: B, why, k, ya: lo, yb: hi, area: areaName(state.pref), msgs: [], notes: [], rows: [] };
    D.prefix = state.v === "type" ? "学校種別" : "言語別";
    D.head = `${D.prefix}の2年比較：${D.area}・${NAT_ONLY[k]}・${lo}年→${hi}年`;
    D.title = `${D.prefix}の2年比較 日本語指導が必要な児童生徒（公立学校）`;
    D.order = state.v === "lang" ? `${hi}年の人数の多い順（「その他」は末尾）` : "";
    D.srcKeys = srcFor(state.v === "lang" ? (state.pref ? ["lang_pref_f", "lang_pref_j"] : ["lang_f", "lang_j", "lang_pref_f", "lang_pref_j"]) : (state.pref ? ["pref_f", "pref_j"] : ["type", "type_f", "type_j", "pref_f", "pref_j"]), k);
    if (sa.fallback || sb.fallback) { D.error = `比べられません：${(sa.fallback ? A : B).year}年の${(sa.fallback ? sa : sb).f.kind}は都道府県別の数が公表されていないため、${D.area}の2年は比べられません。地域を「全国」にすると比べられます。`; return D; }
    const ga = k === "j" ? sa.j : sa.f, gb = k === "j" ? sb.j : sb.f;
    if (ga.kind !== gb.kind) { D.error = `比べられません：${NAT[k]}は${lo}年が「${ga.kind}」、${hi}年が「${gb.kind}」の集計で、分け方がちがいます（外国籍は2018年まで母語別、2021年から言語別）。`; return D; }
    if (k !== state.n) D.msgs.push(`${why[state.n]}。外国籍のみで比べています。`); // 比べられないときは理由だけを出す（上の2つ）
    const va = valsOf(sa, k), vb = valsOf(sb, k);
    const rows = [];
    if (state.v === "type") {
      vb.forEach((b, i) => {
        const a = va[i], r = { name: b.name, a: a.total, b: b.total, i };
        if (a.name !== b.name) { r.status = "changed"; r.why = `2007年に「${a.name}」から「${b.name}」に変わったため比べません`; }
        else if (a.total == null || b.total == null) { r.status = "none"; r.why = "義務教育学校は2016年からの区分です（それより前は区分なし）"; }
        else r.status = "ok";
        rows.push(r);
      });
    } else {
      const ma = new Map(va.map((r) => [normName(r.name), r.total])), mb = new Map(vb.map((r) => [normName(r.name), r.total]));
      const onlyB = [...mb.keys()].filter((x) => !ma.has(x)), onlyA = [...ma.keys()].filter((x) => !mb.has(x));
      [...mb.keys()].concat(onlyA).forEach((nm, i) => {
        const r = { name: nm, a: ma.has(nm) ? ma.get(nm) : null, b: mb.has(nm) ? mb.get(nm) : null, i };
        if (!ma.has(nm)) { r.status = "new"; r.why = `「${nm}」は${hi}年からの区分で、${lo}年は「その他」に含まれます（0人ではありません）`; }
        else if (!mb.has(nm)) { r.status = "gone"; r.why = `「${nm}」は${hi}年には独立した区分がありません`; }
        else if (nm === "その他" && onlyA.length + onlyB.length) { r.status = "changed"; r.why = `${onlyA.concat(onlyB).map((x) => `「${x}」`).join("・")}の区分が変わったため、「その他」の中身が2年でちがいます`; }
        else r.status = "ok";
        rows.push(r);
      });
      rows.forEach((r) => { r.total = r.b; });
      rows.sort(byCount);
      if (va.some((r) => r.name !== normName(r.name)) !== vb.some((r) => r.name !== normName(r.name))) D.notes.push("「フィリピノ語」は2012年まで「フィリピノ語（タガログ語）」と書かれていた同じ区分です。");
      D.notes.push("言語別の人数は国籍別の人数ではありません。「その他」は公式の区分で、複数の言語をまとめたものです。");
    }
    rows.forEach((r) => { if (r.status === "ok") { const c = change(r.a, r.b); r.d = c.d; r.pct = c.pct; } });
    D.rows = rows;
    D.ta = va.reduce((s, r) => s + (r.total || 0), 0);
    D.tb = vb.reduce((s, r) => s + (r.total || 0), 0);
    if (lo <= 2010 && hi >= 2012) D.notes.push("2010年までは9月1日現在、2012年からは5月1日現在の調査です（基準日がちがいます）。");
    return D;
  }

  function sayOf(D) {
    const o = D.o;
    if (D.error) return "";
    if (D.two) {
      const ok = D.rows.filter((r) => r.status === "ok");
      let s = `${D.area}の${WHO[D.k]}は、${D.ya}年→${D.yb}年で全体が${fmt(D.ta)}人→${fmt(D.tb)}人（${moveWord(D.tb - D.ta)}）です。`;
      if (ok.length) {
        const up = ok.filter((r) => r.d > 0).length, down = ok.filter((r) => r.d < 0).length;
        const mx = ok.reduce((m, r) => (r.d > m.d ? r : m)), mn = ok.reduce((m, r) => (r.d < m.d ? r : m));
        s += `比べられる${ok.length}項目のうち、増えたのは${up}項目、減ったのは${down}項目です。`;
        const parts = [];
        if (mx.d > 0) parts.push(`増加が最も大きいのは${quote(D, mx.name)}（${fmt(mx.d)}人増加）`);
        if (mn.d < 0) parts.push(`減少が最も大きいのは${quote(D, mn.name)}（${fmt(-mn.d)}人減少）`);
        if (parts.length) s += parts.join("、") + "です。";
      }
      const skip = D.rows.filter((r) => r.status === "changed" || r.status === "new" || r.status === "gone");
      if (skip.length) s += `${skip.map((r) => quote(D, r.name)).join("・")}は分け方が変わったため比べていません。`;
      return s;
    }
    if (D.kind === "pref") {
      const sum = D.allRows.reduce((s, r) => s + r.key, 0); // 同じ年・同じ国籍の区分の全国の数
      const top = D.rows[0], second = D.rows.find((r) => r.rank > top.rank);
      const same = D.rows.filter((r) => r.rank === top.rank);
      let s = `${o.year}年に${WHO[D.k]}が最も多いのは${same.map((r) => r.name).join("・")}（${fmt(top.key)}人${same.length > 1 ? "、同数" : ""}）${second ? `、次いで${second.name}（${fmt(second.key)}人）` : ""}です。`;
      if (state.top === 47) {
        const low = D.allRows[D.allRows.length - 1], lows = D.allRows.filter((r) => r.key === low.key);
        s += `全47都道府県の合計は${fmt(sum)}人で、最も少ないのは${lows.map((r) => r.name).join("・")}（${fmt(low.key)}人）です。`;
      } else s += `表示している上位${D.rows.length}都道府県で、全国（${fmt(sum)}人）の${pctText(D.rows.reduce((t, r) => t + r.key, 0), sum)}を占めます。`;
      return s;
    }
    const rows = D.rows.filter((r) => r.total != null);
    const sum = rows.reduce((s, r) => s + r.total, 0);
    const named = rows.filter((r) => r.name !== "その他").sort(byCount);
    const top = named[0], second = named[1];
    if (!top) return "";
    const lead = `${D.area}の${WHO[D.k]}（${o.year}年）は、`;
    if (D.kind === "lang") {
      let t = `${lead}「その他」を除くと「${top.name}」が最も多く${fmt(top.total)}人（全体の${pctText(top.total, sum)}）${second ? `、次いで「${second.name}」（${fmt(second.total)}人）` : ""}です。`;
      const other = rows.find((r) => r.name === "その他");
      if (other && other.total > top.total) t += `複数の言語をまとめた「その他」は${fmt(other.total)}人です。`;
      return t;
    }
    return `${lead}${top.name}が最も多く${fmt(top.total)}人（全体の${pctText(top.total, sum)}）${second ? `、次いで${second.name}（${fmt(second.total)}人）` : ""}です。`;
  }

  function renderBreakdown() {
    const two = state.v !== "pref" && state.mode === "two";
    const yopt = (sel, list) => list.slice().reverse().map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${y}年（${Y[y].fy}）</option>`).join("");
    $("nj-y").innerHTML = yopt(state.y, YEARS);
    // 2年の比較：過去の年は新しい年より前だけ、新しい年は最初の調査より後だけ
    $("nj-ya").innerHTML = yopt(state.ya, YEARS.filter((y) => y < state.yb));
    $("nj-yb").innerHTML = yopt(state.yb, YEARS.slice(1));
    // 今の内訳で使う操作欄だけ出す
    $("nj-mode-wrap").hidden = state.v === "pref";
    $("nj-y-wrap").hidden = two;
    $("nj-ya-wrap").hidden = !two;
    $("nj-yb-wrap").hidden = !two;
    $("nj-top-wrap").hidden = state.v !== "pref";
    pressed("nj-mode", "mode", two ? "two" : "one");
    const D = bdData();
    state.bd = D;
    // 国籍の区分：選べないものは押せなくして、理由を短く出す
    pressed("nj-n", "n", D.k);
    $("nj-n").querySelectorAll("button").forEach((b) => { const w = D.why[b.dataset.n]; b.disabled = !!w; b.title = w ? w + "。" : ""; });
    const off = ["all", "j"].filter((x) => D.why[x] && x !== state.n);
    const reasons = [...new Set(off.map((x) => D.why[x]))];
    $("nj-n-why").hidden = !off.length || D.k !== state.n;
    $("nj-n-why").textContent = off.length ? `${off.map((x) => NAT[x]).join("・")}は選べません：${reasons.join("。")}。` : "";
    $("nj-bd-head").textContent = D.head;
    const msgs = D.msgs.concat(D.error ? [D.error] : []);
    $("nj-bd-msg").hidden = !msgs.length;
    $("nj-bd-msg").innerHTML = msgs.map(esc).join("<br>");
    $("nj-img-bd").disabled = !!D.error;
    const o = D.o;
    if (D.error) {
      ["nj-bd-legend", "nj-bars", "nj-bd-say", "nj-bd-table"].forEach((id) => { $(id).innerHTML = ""; });
    } else if (D.two) renderPair(D);
    else renderOne(D);
    const src = D.srcKeys.map((k) => o.src[k]).filter(Boolean);
    $("nj-bd-note").innerHTML = D.notes.map(esc).join("") + ` 出典：${esc(SURVEY)} ${D.two ? `${esc(Y[D.ya].fy)}・` : ""}${esc(o.fy)}（e-Stat：${src.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(tabNo(s))}</a>`).join("・")}${src.some((s) => s.prev) ? "。2007年の表の前回の数" : ""}）`;
    // 共有文（画面の見出しと同じ対象を書く）
    let text;
    if (D.error) text = `${D.head}\n${SITE_NAME}`;
    else if (D.two) {
      const big = D.rows.filter((r) => r.status === "ok").sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3).map((r) => `${r.name} ${fmt(r.a)}人→${fmt(r.b)}人`).join("\n");
      text = `${D.prefix}の2年比較 日本語指導が必要な児童生徒（公立学校）｜${D.area}・${NAT_ONLY[D.k]}・${D.ya}年→${D.yb}年\n全体 ${fmt(D.ta)}人→${fmt(D.tb)}人（${moveWord(D.tb - D.ta)}）\n${big}\n${SITE_NAME}`;
    } else {
      const top3 = D.rows.filter((r) => r.total != null).slice(0, 3).map((r) => `${D.kind === "pref" ? r.rank + "位 " : ""}${r.name} ${fmt(r.total)}人`).join("\n");
      text = `${D.title}｜${D.area}・${o.year}年・${NAT_ONLY[D.k]}\n${top3}\n${SITE_NAME}`;
    }
    setX("bd", text, pageUrl("breakdown"));
  }

  // 棒の上に出す吹き出し（マウス・タップ・キーボード）
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

  function renderOne(D) {
    $("nj-bd-legend").innerHTML = D.nats.map((k) => `<span class="nj-lg"><i class="nj-sw" style="background:${COLOR[k]}"></i>${NAT[k]}</span>`).join("") + (D.order ? `<span class="nj-order">${D.order}</span>` : "") + '<span class="nj-unit">単位：人</span>';
    const rows = D.rows.concat(D.extra ? [D.extra] : []);
    const max = Math.max(1, ...rows.map((r) => r.total || 0));
    const segs = (r) => D.nats.map((k) => { const v = r[k]; return v ? `<span class="nj-seg" style="width:${(v / max) * 100}%;background:${COLOR[k]}"></span>` : ""; }).join("");
    const detail = (r) => (r.none ? r.none : D.nats.length > 1 ? `外国籍 ${fmt(r.f)}人・日本国籍 ${fmt(r.j)}人・合計 ${fmt(r.total)}人` : `${NAT[D.nats[0]]} ${fmt(r.total)}人`);
    $("nj-bars").innerHTML = `<ol class="nj-rows${D.kind === "pref" ? " nj-ranked" : ""}">` + rows.map((r, i) => {
      const name = D.kind === "pref"
        ? `<span class="nj-rank">${r.rank}</span><button type="button" class="nj-plink" data-pref="${r.code}" title="このページで${esc(r.name)}のデータを表示">${esc(r.name)}</button>`
        : esc(r.name);
      const sel = D.kind === "pref" && r.code === state.pref ? " nj-sel" : "";
      return `${D.extra && r === D.extra ? '<li class="nj-gap" aria-hidden="true">…</li>' : ""}<li class="nj-row${sel}" tabindex="0" data-i="${i}" aria-label="${esc(r.name)}：${esc(detail(r))}">
        <span class="nj-name">${name}</span><span class="nj-track">${segs(r)}</span><span class="nj-v">${r.none ? "—" : fmt(r.total) + "人"}</span></li>`;
    }).join("") + '</ol><div class="nj-tip" id="nj-btip" hidden></div>'
      + (D.kind === "pref" ? '<p class="nj-hint">都道府県名を押すと、このページでその地域のデータを表示します。</p>' : "");
    bindTips(rows, detail);
    $("nj-bd-say").textContent = sayOf(D);
    // 表（都道府県別は全47件。外国籍・日本国籍・合計をいつも並べる）
    const isPref = D.kind === "pref";
    const showNats = isPref ? ["f", "j"] : D.nats;
    const cell = (v) => `<td class="num">${v == null ? "—" : fmt(v) + "人"}</td>`;
    const body = (isPref ? D.allRows : rows).map((r) => `<tr${isPref && r.code === state.pref ? ' class="on"' : ""}>${isPref ? `<td class="num">${r.rank}</td>` : ""}<th scope="row">${esc(r.name)}</th>${showNats.map((k) => cell(isPref ? (k === "f" ? r.ff : r.jj) : r[k])).join("")}${showNats.length > 1 ? cell(isPref ? (r.jj == null ? null : r.ff + r.jj) : r.total) : ""}</tr>`).join("");
    const sum = (isPref ? D.allRows : rows).reduce((s, r) => s + (r.total || 0), 0);
    $("nj-bd-table").innerHTML = `<table class="plain"><thead><tr>${isPref ? '<th scope="col" class="num">順位</th>' : ""}<th scope="col">${isPref ? "都道府県" : D.kind === "lang" ? "言語" : "学校の種類"}</th>${showNats.map((k) => `<th scope="col" class="num">${NAT[k]}</th>`).join("")}${showNats.length > 1 ? '<th scope="col" class="num">合計</th>' : ""}</tr></thead><tbody>${body}</tbody></table>`
      + `<p class="fine">${isPref ? `全47都道府県を${RANK_BY[D.k]}に並べています（${NAT[D.k]}の全国 ${fmt(sum)}人）。` : `${NAT_ONLY[D.k]}の全体 ${fmt(sum)}人。${D.order ? D.order + "。" : ""}`}—：区分がない、または公表されていない数（0人ではありません）。</p>`;
  }

  function renderPair(D) {
    const order = D.order ? `<span class="nj-order">${D.order}</span>` : "";
    $("nj-bd-legend").innerHTML = `<span class="nj-lg"><i class="nj-sw" style="background:${PAIR.a}"></i>${D.ya}年（過去）</span><span class="nj-lg"><i class="nj-sw" style="background:${PAIR.b}"></i>${D.yb}年（新しい年）</span>${order}<span class="nj-unit">単位：人</span>`;
    const max = Math.max(1, ...D.rows.flatMap((r) => [r.a || 0, r.b || 0]));
    const bar = (v, c) => (v ? `<span class="nj-bar" style="width:${(v / max) * 100}%;background:${c}"></span>` : '<span class="nj-bar"></span>');
    const num = (v, r, which) => (v != null ? fmt(v) : which === "a" && r.status === "new" ? "その他に含む" : "区分なし");
    const diffText = (r) => {
      if (r.status !== "ok") return r.why;
      const t = changeText(r.a, r.b);
      return `${t.diff}（${t.zero ? "過去の年が0人のため増減率は算出できません" : `増減率 ${t.pct}`}）`;
    };
    const detail = (r) => `${D.ya}年 ${num(r.a, r, "a")}・${D.yb}年 ${num(r.b, r, "b")}／${diffText(r)}`;
    $("nj-bars").innerHTML = '<ol class="nj-rows">' + D.rows.map((r, i) => `<li class="nj-row nj-pair${r.status === "ok" ? "" : " nj-skip"}" tabindex="0" data-i="${i}" aria-label="${esc(r.name)}：${esc(detail(r))}">
        <span class="nj-name">${esc(r.name)}${r.status === "ok" ? "" : '<small>比べません</small>'}</span><span class="nj-track2">${bar(r.a, PAIR.a)}${bar(r.b, PAIR.b)}</span><span class="nj-v2"><span>${esc(num(r.a, r, "a"))}</span><b>${esc(num(r.b, r, "b"))}</b></span></li>`).join("") + '</ol><div class="nj-tip" id="nj-btip" hidden></div>';
    bindTips(D.rows, detail);
    $("nj-bd-say").textContent = sayOf(D);
    const pct = (r) => (r.status !== "ok" ? "—" : r.pct === null ? "算出できません（過去の年が0人）" : changeText(r.a, r.b).pct);
    const dif = (r) => (r.status !== "ok" ? "比べません" : moveWord(r.d));
    const td = (v, r, w) => `<td class="num">${v == null ? `<small>${esc(num(v, r, w))}</small>` : fmt(v) + "人"}</td>`;
    const tot = { name: "全体", a: D.ta, b: D.tb, status: "ok", ...change(D.ta, D.tb) };
    const body = D.rows.concat([tot]).map((r) => `<tr${r === tot ? ' class="on"' : ""}><th scope="row">${esc(r.name)}</th>${td(r.a, r, "a")}${td(r.b, r, "b")}<td class="num">${dif(r)}</td><td class="num">${pct(r)}</td></tr>`).join("");
    const whys = [...new Set(D.rows.filter((r) => r.status !== "ok").map((r) => r.why))];
    $("nj-bd-table").innerHTML = `<table class="plain"><thead><tr><th scope="col">${D.kind === "lang" ? "言語" : "学校の種類"}</th><th scope="col" class="num">${D.ya}年</th><th scope="col" class="num">${D.yb}年</th><th scope="col" class="num">人数の変化</th><th scope="col" class="num">増減率</th></tr></thead><tbody>${body}</tbody></table>`
      + `<p class="fine">${esc(NAT_ONLY[D.k])}。${whys.map((w) => esc(w) + "。").join("")}過去の年が0人の項目は、増減率を算出できません。</p>`;
  }

  function setX(k, text, url) {
    const a = $("nj-x-" + k);
    a.href = "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
    a.dataset.text = text + "\n" + url;
  }

  function sourceTable() {
    const rows = YEARS.slice().reverse().map((y) => {
      const o = Y[y];
      const pub = o.published ? `文部科学省 ${jpDate(o.published)}` : "—";
      const tabs = Object.values(o.src).filter((s) => !s.prev).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(tabNo(s))}</a>`).join("・");
      return `<tr><th scope="row">${y}年（${o.fy}）</th><td>${jpDate(o.as_of)}</td><td>${pub}<br><small>e-Stat掲載 ${ym(o.estat_posted)}</small></td><td><a href="${esc(o.estat_url)}" target="_blank" rel="noopener">e-Stat</a>：${tabs || "（2007年の表の前回の数）"}${o.note ? `<br><small>${esc(o.note)}</small>` : ""}</td></tr>`;
    }).join("");
    return `<table class="plain nj-src"><thead><tr><th scope="col">調査年</th><th scope="col">基準日</th><th scope="col">公表</th><th scope="col">使った表</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="fine">出典：${esc(SURVEY)}（各年度、<a href="${esc(N.estat_url)}" target="_blank" rel="noopener">e-Stat</a>）。公表日が確かめられない年は e-Stat に載った月だけを書いています。${esc(N.terms)}（${esc(N.checked)}）。数字は国の表のとおりで、合計（外国籍＋日本国籍）と都道府県の和だけを計算しています。</p>`;
  }

  // ---- 画像 ----
  // 表の番号の書き方をそろえる（「表番号1-1」「1-1-3」→「表1-1」「表1-1-3」。「参考1-1」はそのまま）
  const tabNo = (s) => { const t = s.title.split(" ")[0].replace(/^表番号/, "表"); return /^\d/.test(t) ? "表" + t : t; };
  function srcLine(o, keys, o2) {
    const t = keys.map((k) => o.src[k]).filter((s) => s && !s.prev).map(tabNo);
    return `出典：${SURVEY} ${o2 ? o2.fy + "・" : ""}${o.fy}${o2 ? "（e-Statの表から作成）" : t.length ? `（e-Stat ${t.join("・")}）` : "（2007年の表の前回の数）"}`;
  }
  const FOOT_SCOPE = "公立学校が対象。日本国籍の児童生徒も含みます。日本国籍の人数は帰化した人の数ではありません。";

  function trendSpec() {
    const M = trendModel();
    const regs = regions();
    const shown = YEARS.filter((y) => M.series.some((s) => val(y, s.code, s.nat) != null));
    const spec = Object.assign({ kind: "trend", siteName: SITE_NAME, siteUrl: document.body.dataset.site }, M);
    spec.title = "日本語指導が必要な児童生徒の推移（公立学校）";
    spec.subtitle = [`${regs.map(areaName).join("・")}｜${NAT[state.s]}｜調査年 ${shown[0]}〜${shown[shown.length - 1]}年`];
    spec.legend = M.series.map((s) => ({ line: true, color: s.color, dash: s.dash, marker: s.marker, label: s.name }));
    spec.unit = "単位：人";
    spec.breakLabel = ["9月1日現在", "5月1日現在"];
    spec.noDataLabel = "都道府県別の日本国籍は2012年から";
    spec.summary = state.cmpLines || [];
    spec.foot = [`出典：${SURVEY}（${shown[0]}〜${shown[shown.length - 1]}年の各年度。e-Statの表から作成）`, FOOT_SCOPE, "点は調査をした年です。線は調査と調査を結んだもので、その間の年の人数ではありません。"];
    spec.file = `nihongo-shido_trend_${regs.join("-") || "japan"}_${state.s}_${dateStamp()}.png`;
    return [spec];
  }

  function barsSpecs() {
    const D = state.bd, o = D.o;
    const base = { kind: "bars", siteName: SITE_NAME, siteUrl: document.body.dataset.site, unit: "単位：人" };
    if (D.two) {
      const A = Y[D.ya];
      const whys = [...new Set(D.rows.filter((r) => r.status !== "ok").map((r) => r.why))];
      return [Object.assign({}, base, {
        title: D.title,
        subtitle: [`${D.area}・${NAT_ONLY[D.k]}・${D.ya}年（${A.fy}）→${D.yb}年（${o.fy}）`, `全体 ${fmt(D.ta)}人→${fmt(D.tb)}人（${moveWord(D.tb - D.ta)}）`].concat(D.order ? [D.order] : []),
        legend: [{ color: PAIR.a, label: `${D.ya}年（過去）` }, { color: PAIR.b, label: `${D.yb}年（新しい年）` }],
        rows: D.rows.map((r) => ({
          name: r.status === "ok" ? r.name : r.name + "※",
          pair: [{ n: r.a || 0, color: PAIR.a, value: r.a == null ? "—" : fmt(r.a) }, { n: r.b || 0, color: PAIR.b, value: r.b == null ? "—" : fmt(r.b) }], // —の理由は注記に書く
          value: "",
          sub: r.status === "ok" ? `${changeText(r.a, r.b).diff}${r.pct === null ? "" : `（増減率 ${changeText(r.a, r.b).pct}）`}` : "比べません（分け方の変更）",
        })),
        foot: [srcLine(o, D.srcKeys, A)].concat(D.msgs, whys.length ? ["※は比べていない項目：" + whys.join("。") + "。"] : [], [FOOT_SCOPE]),
        file: `nihongo-shido_${D.kind}_2years_${D.k}_${state.pref || "japan"}_${D.ya}-${D.yb}_${dateStamp()}.png`,
        label: "",
      })];
    }
    const rowsAll = D.rows;
    const chunks = D.kind === "pref" && state.top === 47 ? [0, 1, 2, 3].map((k) => rowsAll.slice(k * PAGE47, (k + 1) * PAGE47)).filter((c) => c.length) : [rowsAll];
    const max = Math.max(...rowsAll.map((r) => r.total || 0));
    const nat = D.kind === "pref" ? null : D.rows.reduce((s, r) => ({ f: s.f + (r.f || 0), j: s.j + (r.j || 0) }), { f: 0, j: 0 });
    return chunks.map((rows, k) => {
      const range = chunks.length > 1 ? `${rows[0].rank}〜${rows[rows.length - 1].rank}位` : "";
      const sub = [`${D.area}・${o.year}年（${o.fy}）${md(o.as_of)}現在・${NAT_ONLY[D.k]}`];
      if (D.kind === "pref") sub.push(`${RANK_BY[D.k]}・${state.top === 47 ? `全47都道府県のうち${range}` : `上位${state.top}`}`);
      if (nat) sub.push(D.nats.length > 1 ? `合計 ${fmt(nat.f + nat.j)}人（外国籍 ${fmt(nat.f)}人・日本国籍 ${fmt(nat.j)}人）` : `${NAT[D.nats[0]]} ${fmt(nat.f + nat.j)}人`);
      if (D.order) sub.push(D.order);
      return Object.assign({}, base, {
        title: D.title, subtitle: sub,
        legend: D.nats.map((n) => ({ color: COLOR[n], label: NAT[n] })),
        rows: rows.map((r) => ({
          name: D.kind === "pref" ? `${r.rank}位 ${r.name}` : r.name,
          segs: D.nats.map((n) => ({ n: r[n] || 0, color: COLOR[n] })),
          value: r.none ? "区分なし" : fmt(r.total) + "人",
          sub: D.nats.length > 1 && !r.none ? `外国籍 ${fmt(r.f)}・日本国籍 ${fmt(r.j)}` : "",
        })),
        max,
        foot: [srcLine(o, D.srcKeys)].concat(D.msgs, [FOOT_SCOPE], D.kind === "lang" ? ["言語別の人数は国籍別の人数ではありません。「その他」は複数の言語をまとめた公式の区分です。"] : D.kind === "type" && o.year < 2016 ? ["義務教育学校は2016年からの区分（この年は区分なし）。"] : []),
        file: `nihongo-shido_${D.kind}_${D.k}_${D.kind === "pref" ? "top" + state.top + (chunks.length > 1 ? "-" + (k + 1) : "") : state.pref || "japan"}_${o.year}_${dateStamp()}.png`,
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
    window.__njImage = spec;
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
  window.__njCheck = () => ({ state: JSON.parse(JSON.stringify({ ...state, bd: undefined })), bd: state.bd && { kind: state.bd.kind, two: state.bd.two, k: state.bd.k, area: state.bd.area, error: state.bd.error, msgs: state.bd.msgs, rows: state.bd.rows.map((r) => (state.bd.two ? [r.name, r.a, r.b, r.status, r.d, r.pct] : [r.name, r.f, r.j, r.total, r.rank])) }, result: $("nj-result").innerText, say: [$("nj-trend-say").textContent, $("nj-bd-say").textContent], head: $("nj-bd-head").textContent, msg: $("nj-bd-msg").hidden ? "" : $("nj-bd-msg").textContent, url: location.search });
})();
