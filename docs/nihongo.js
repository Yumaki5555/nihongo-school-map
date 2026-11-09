/* 日本語指導が必要な児童生徒のページ：人数の推移（全国・都道府県）と、内訳（言語別・都道府県別・学校種別）。
   データは data/nihongo_shido.json（scripts/fetch_nihongo_shido.py が国の表から作る。表示のたびに Excel は読まない） */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 外国籍＝青、日本国籍＝緑（全部のグラフで同じ。色覚の見分けやすさと背景とのコントラストを確かめた組み合わせ）
  const COLOR = { f: "#2B5FA8", j: "#3E9A4E", all: "#5F4615" };
  const NAT = { all: "合計", f: "外国籍", j: "日本国籍" };
  const VIEW = { lang: "言語別", pref: "都道府県別", type: "学校種別" };
  const SITE_NAME = "日本語学校・留学生 全国マップ";
  const SURVEY = "文部科学省「日本語指導が必要な児童生徒の受入状況等に関する調査」";
  const QUICK = [5, 10, 20];
  const PAGE47 = 12; // 全47件の画像は12件ずつに分けて保存する（文字を小さくしすぎないため）
  const state = { pref: "", pref2: "", s: "all", a: null, b: null, v: "lang", y: null, m: "all", top: 10, ln: "f" };
  let N, Y = {}, YEARS = [], LATEST;
  let urlTimer = 0, imageUrl = "", imageJob = 0, imageWhich = "trend", imagePage = 0;

  fetch("data/nihongo_shido.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { N = d; init(); })
    .catch(() => { $("nj-loading").hidden = true; $("nj-error").hidden = false; });

  // ---- 共通 ----
  const md = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${Number(m[2])}月${Number(m[3])}日` : ""; };
  const jpDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : ""; };
  const ym = (iso) => { const m = /^(\d{4})-(\d{2})/.exec(iso || ""); return m ? `${m[1]}年${Number(m[2])}月` : ""; };
  const areaName = (code) => (code ? N.prefs[code] : "全国");
  const yearText = (y) => `${y}年（${Y[y].fy}・${md(Y[y].as_of)}現在）`;
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
  const availYears = (s) => YEARS.filter((y) => regions().every((c) => val(y, c, s) != null));

  // 増減・増減率・倍率（比較元が0人なら率と倍率は出さない）
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

  // 比べる年：b から n 年前にいちばん近い調査年（同じだけ近いときは古い方）。2年より離れていれば選べない
  function nearest(n, b, years) {
    let best = null;
    years.forEach((y) => { if (y >= b) return; const d = Math.abs(y - (b - n)); if (best === null || d < best.d) best = { y, d }; });
    return best && best.d <= 2 ? best.y : null;
  }

  function init() {
    N.years.forEach((o) => { Y[o.year] = o; });
    YEARS = N.years.map((o) => o.year).sort((a, b) => a - b);
    LATEST = YEARS[YEARS.length - 1];
    const codes = Object.keys(N.prefs);
    $("nj-pref").innerHTML = '<option value="">全国</option>' + codes.map((c) => `<option value="${c}">${esc(N.prefs[c])}</option>`).join("");
    readUrl();
    $("nj-lang-def").textContent = `言語別は「${N.lang_def.replace(/（.*）$/, "")}」の区分で、国籍や出身国を表すものではありません。`;
    $("nj-src-table").innerHTML = sourceTable();
    $("nj-pref").addEventListener("change", (e) => { state.pref = e.target.value; if (state.pref2 === state.pref) state.pref2 = ""; render(); });
    $("nj-pref2").addEventListener("change", (e) => { state.pref2 = e.target.value; render(); });
    seg("nj-s", "s", (v) => { state.s = v; });
    seg("nj-v", "v", (v) => { state.v = v; });
    seg("nj-m", "m", (v) => { state.m = v; });
    seg("nj-top", "top", (v) => { state.top = Number(v); });
    seg("nj-ln", "ln", (v) => { state.ln = v; });
    $("nj-a").addEventListener("change", (e) => { state.a = Number(e.target.value); render(); });
    $("nj-b").addEventListener("change", (e) => { state.b = Number(e.target.value); render(); });
    $("nj-y").addEventListener("change", (e) => { state.y = Number(e.target.value); render(); });
    $("nj-quick").addEventListener("click", (e) => { const b = e.target.closest("button[data-a]"); if (b && !b.disabled) { state.a = Number(b.dataset.a); render(); } });
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
    const code = (x) => { if (!x) return ""; if (N.prefs[x]) return x; const c = Object.keys(N.prefs).find((k) => N.prefs[k] === x); return c || ""; };
    state.pref = code(p.get("pref"));
    const cmp = p.get("cmp") || "";
    const two = /^(\d{2})-(\d{2})$/.exec(cmp);
    if (two && N.prefs[two[1]] && N.prefs[two[2]] && two[1] !== two[2]) { state.pref = two[1]; state.pref2 = two[2]; }
    else if (code(cmp) && state.pref && code(cmp) !== state.pref) state.pref2 = code(cmp);
    if (["all", "f", "j"].includes(p.get("s"))) state.s = p.get("s");
    const yr = (k) => { const n = Number(p.get(k)); return YEARS.includes(n) ? n : null; };
    state.a = yr("a"); state.b = yr("b"); state.y = yr("y");
    if (VIEW[p.get("v")]) state.v = p.get("v");
    if (["all", "f", "j"].includes(p.get("m"))) state.m = p.get("m");
    if (["5", "10", "47"].includes(p.get("top"))) state.top = Number(p.get("top"));
    if (["f", "j"].includes(p.get("ln"))) state.ln = p.get("ln");
  }

  function query() {
    const p = new URLSearchParams();
    if (state.pref2 && state.pref) p.set("cmp", `${state.pref}-${state.pref2}`);
    else if (state.pref) p.set("pref", state.pref);
    if (state.s !== "all") p.set("s", state.s);
    if (state.a && state.a !== nearest(QUICK[0], state.b, availYears(state.s))) p.set("a", state.a);
    if (state.b && state.b !== LATEST) p.set("b", state.b);
    if (state.v !== "lang") p.set("v", state.v);
    if (state.y && state.y !== LATEST) p.set("y", state.y);
    if (state.v === "pref") { if (state.m !== "all") p.set("m", state.m); if (state.top !== 10) p.set("top", state.top); }
    if (state.v === "lang" && state.ln !== "f") p.set("ln", state.ln);
    const s = p.toString();
    return s ? "?" + s : "";
  }
  const pageUrl = (hash) => document.body.dataset.site + "nihongo.html" + query() + (hash ? "#" + hash : "");

  // ---- 全体の描き直し ----
  function render() {
    // 選べない組み合わせを直す（データのない年を選んだままにしない）
    const ys = availYears(state.s);
    if (!ys.includes(state.b)) state.b = ys[ys.length - 1];
    if (!ys.includes(state.a) || state.a === state.b) state.a = nearest(QUICK[0], state.b, ys) || ys.find((y) => y !== state.b) || null;
    if (!state.y || !YEARS.includes(state.y)) state.y = LATEST;
    if (state.v === "pref" && !Y[state.y].pref.j && state.m !== "f") state.forcedM = true; else state.forcedM = false;
    $("nj-pref").value = state.pref;
    $("nj-pref2").innerHTML = state.pref
      ? '<option value="">なし</option>' + Object.keys(N.prefs).filter((c) => c !== state.pref).map((c) => `<option value="${c}">${esc(N.prefs[c])}</option>`).join("")
      : '<option value="">（上の「地域」で都道府県を選ぶと選べます）</option>';
    $("nj-pref2").disabled = !state.pref;
    $("nj-pref2").value = state.pref2;
    pressed("nj-s", "s", state.s);
    pressed("nj-v", "v", state.v);
    pressed("nj-m", "m", state.forcedM ? "f" : state.m);
    pressed("nj-top", "top", String(state.top));
    $("nj-m").querySelectorAll("button").forEach((b) => { b.disabled = !Y[state.y].pref.j && b.dataset.m !== "f"; });
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
    $("nj-kpi-when").innerHTML = `<b>${esc(areaName(c))}</b>・最新の調査：${esc(yearText(LATEST))}・公立学校`;
    const tile = (k, n, sub) => `<li class="nj-kpi-${k}"><span>${k === "all" ? "合計" : `<i class="nj-sw" style="background:${COLOR[k]}"></i>${NAT[k]}`}</span><b>${fmt(n)}<small>人</small></b>${sub ? `<small>${sub}</small>` : ""}</li>`;
    $("nj-kpis").innerHTML = tile("all", f + j, "外国籍＋日本国籍") + tile("f", f, `合計の${pctText(f, f + j)}`) + tile("j", j, `合計の${pctText(j, f + j)}`);
    $("nj-scope").textContent = `対象：公立の小・中・高等学校、義務教育学校、中等教育学校、特別支援学校（日本国籍の子どもも含む）。最新の調査は${o.year}年（${o.fy}）${md(o.as_of)}現在。日本語学校の留学生の数とは別の統計です。`;
  }

  // ---- A 人数の推移 ----
  function renderTrend() {
    const ys = availYears(state.s);
    const regs = regions();
    const msg = [];
    if (state.s !== "f" && state.pref) msg.push(`都道府県別の日本国籍の人数は${YEARS.find((y) => Y[y].pref.j)}年から公表されています。それより前の${NAT[state.s]}は表示できません（外国籍は2005年から選べます）。`);
    $("nj-trend-msg").hidden = !msg.length;
    $("nj-trend-msg").textContent = msg.join("");
    $("nj-trend-legend").innerHTML = regs.map((c, i) => `<span class="nj-lg"><svg width="34" height="14" aria-hidden="true"><line x1="2" y1="7" x2="32" y2="7" stroke="${COLOR[state.s]}" stroke-width="2.5"${i ? ' stroke-dasharray="6 4"' : ""}/>${i ? `<rect x="13" y="3" width="8" height="8" fill="${COLOR[state.s]}"/>` : `<circle cx="17" cy="7" r="4" fill="${COLOR[state.s]}"/>`}</svg>${esc(areaName(c))}・${NAT[state.s]}</span>`).join("") + '<span class="nj-unit">単位：人</span>';
    const opt = (sel) => ys.map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${y}年（${Y[y].fy}）</option>`).join("");
    $("nj-a").innerHTML = opt(state.a);
    $("nj-b").innerHTML = opt(state.b);
    $("nj-quick").innerHTML = QUICK.map((n) => {
      const y = nearest(n, state.b, ys);
      return `<button type="button" class="btn-x" data-a="${y || ""}"${y ? "" : " disabled"} aria-pressed="${y === state.a}">約${n}年前${y ? `（${y}年）` : "（データなし）"}</button>`;
    }).join("") + `<span class="fine">比較先：${state.b}年</span>`;
    // 比較の結果
    let html = "";
    const lines = [];
    if (!state.a || state.a === state.b) html = '<p class="cmp-msg">異なる2つの調査年を選んでください。</p>';
    else {
      const [a, b] = state.a < state.b ? [state.a, state.b] : [state.b, state.a];
      regs.forEach((c) => {
        const va = val(a, c, state.s), vb = val(b, c, state.s);
        const t = changeText(va, vb);
        html += `<div class="nj-res"><p class="nj-res-head"><b>${esc(areaName(c))}・${NAT[state.s]}</b>：${a}年 ${fmt(va)}人 → ${b}年 ${fmt(vb)}人</p>
          <dl><div><dt>何人増減</dt><dd>${t.diff}</dd></div><div><dt>何％増減</dt><dd>${t.pct}</dd></div><div><dt>何倍</dt><dd>${t.ratio}</dd></div></dl>
          ${t.zero ? `<p class="fine">比較元（${a}年）が0人のため、増減率と倍率は計算できません。</p>` : ""}</div>`;
        lines.push(`${areaName(c)}：${a}年→${b}年 ${t.diff}${t.zero ? "" : `（${t.pct}、${t.ratio}）`}`);
      });
      if (a <= 2010 && b >= 2012) html += '<p class="fine">2010年までは9月1日現在、2012年からは5月1日現在の調査です（基準日がちがいます）。</p>';
      if (state.a > state.b) html += '<p class="fine">比較元が新しい年なので、古い年→新しい年の順に並べ替えて計算しています。</p>';
    }
    $("nj-result").innerHTML = html;
    state.cmpLines = lines;
    // 読み取り文（表示中の数から決まった手順で作る。理由や良し悪しは書かない）
    const c0 = regs[0];
    const pts = ys.map((y) => ({ y, v: val(y, c0, state.s) }));
    const mx = pts.reduce((m, p) => (p.v > m.v ? p : m), pts[0]);
    let say = "";
    if (state.a && state.a !== state.b) {
      const [a, b] = state.a < state.b ? [state.a, state.b] : [state.b, state.a];
      const t = changeText(val(a, c0, state.s), val(b, c0, state.s));
      say = `${areaName(c0)}の${NAT[state.s]}は、${a}年の${fmt(val(a, c0, state.s))}人から${b}年の${fmt(val(b, c0, state.s))}人へ${t.diff.replace("増", "増えました").replace("減", "減りました").replace("増減なし", "変わっていません")}。`;
    }
    say += `表示している調査年の中で最も多いのは${mx.y}年（${fmt(mx.v)}人）です。`;
    $("nj-trend-say").textContent = say;
    $("nj-trend-note").textContent = "点は調査をした年です。線は調査と調査を結んだもので、その間の年の人数を表すものではありません。点線より左（2010年まで）は9月1日現在、右（2012年から）は5月1日現在です。";
    // 表
    const head = `<tr><th scope="col">調査年</th><th scope="col">基準日</th>${regs.map((c) => `<th scope="col" class="num">${esc(areaName(c))}<br>${NAT[state.s]}</th>`).join("")}</tr>`;
    const body = YEARS.slice().reverse().map((y) => `<tr><th scope="row">${y}年（${Y[y].fy}）</th><td>${jpDate(Y[y].as_of)}</td>${regs.map((c) => { const v = val(y, c, state.s); return `<td class="num">${v == null ? "—" : fmt(v) + "人"}</td>`; }).join("")}</tr>`).join("");
    $("nj-trend-table").innerHTML = `<table class="plain"><thead>${head}</thead><tbody>${body}</tbody></table><p class="fine">—：都道府県別の日本国籍が公表されていない年（0人ではありません）。</p>`;
    drawTrend();
    const text = `日本語指導が必要な児童生徒（公立学校）｜${regs.map(areaName).join("・")}の${NAT[state.s]}の推移\n${lines.join("\n")}\n${SITE_NAME}`;
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
    const regs = regions();
    const series = regs.map((c, i) => ({ code: c, name: areaName(c), dash: i > 0, marker: i ? "square" : "circle", color: COLOR[state.s], points: YEARS.map((y) => ({ x: y, v: val(y, c, state.s), big: y === state.a || y === state.b })) }));
    const all = series.flatMap((s) => s.points.map((p) => p.v).filter((v) => v != null));
    const yMax = niceMax(Math.max(...all));
    const firstJ = YEARS.find((y) => Y[y].pref.j);
    const noData = state.pref && state.s !== "f" ? [YEARS[0] - 0.6, (firstJ + YEARS[YEARS.indexOf(firstJ) - 1]) / 2] : null;
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
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(M.series.map((x) => x.name).join("と"))}の${NAT[state.s]}の推移の折れ線グラフ。数値は下の表で確かめられます。">`;
    M.yTicks.forEach((t) => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Yp(t)}" y2="${Yp(t)}" stroke="${t ? "#EFE4C6" : "#D5BA79"}" stroke-width="1"/><text x="${m.l - 6}" y="${Yp(t) + 4}" text-anchor="end" class="nj-ax">${t >= 10000 && narrow ? (t / 10000) + "万" : fmt(t)}</text>`; });
    M.xTicks.forEach((t) => { s += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle" class="nj-ax">${t}${narrow ? "" : "年"}</text>`; });
    if (M.noData) s += `<rect x="${X(M.noData[0])}" y="${m.t}" width="${X(M.noData[1]) - X(M.noData[0])}" height="${H - m.t - m.b}" fill="#5C5140" opacity=".07"/><text x="${(X(M.noData[0]) + X(M.noData[1])) / 2}" y="${m.t + 30}" text-anchor="middle" class="nj-ax">データなし</text>`;
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
    // 値の文字は選んだ2年だけ（1地域のとき）
    if (M.series.length === 1) M.series[0].points.forEach((p) => { if (p.big && p.v != null) { const x = Math.min(W - m.r - 30, Math.max(m.l + 30, X(p.x))); s += `<text x="${x}" y="${Yp(p.v) - 10}" text-anchor="middle" class="nj-val">${fmt(p.v)}</text>`; } });
    s += `<line id="nj-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="#352D20" stroke-width="1" opacity="0"/><rect id="nj-hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/></svg><div class="nj-tip" id="nj-tip" hidden></div>`;
    box.innerHTML = s;
    const hit = $("nj-hit"), tip = $("nj-tip"), cross = $("nj-cross");
    const show = (ev) => {
      const rect = box.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const ys = YEARS.filter((y) => M.series.some((se) => val(y, se.code, state.s) != null));
      const y = ys.reduce((b, k) => (Math.abs(X(k) - px) < Math.abs(X(b) - px) ? k : b), ys[0]);
      cross.setAttribute("x1", X(y)); cross.setAttribute("x2", X(y)); cross.setAttribute("opacity", ".35");
      tip.innerHTML = `<b>${y}年</b>（${esc(Y[y].fy)}・${md(Y[y].as_of)}現在）` + M.series.map((se) => { const v = val(y, se.code, state.s); return `<br>${esc(se.name)}：${v == null ? "データなし" : fmt(v) + "人"}`; }).join("");
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
  function bdData() {
    const o = Y[state.y], code = state.pref;
    const when = `${o.year}年（${o.fy}）${md(o.as_of)}現在`;
    if (state.v === "pref") return prefData(o, when);
    if (state.v === "type") return typeData(o, code, when);
    return langData(o, code, when);
  }

  function rowOf(name, f, j) { const t = f == null && j == null ? null : (f || 0) + (j || 0); return { name, f, j, total: t }; }

  function langData(o, code, when) {
    const L = o.lang, F = L.f, J = L.j;
    const out = { kind: "lang", notes: [], nats: [] };
    let usePref = !!code;
    if (code && !(F && F.pref)) { usePref = false; out.national = `この内訳は全国集計です。${o.year}年の言語（母語）別は、都道府県別の数が公表されていません。`; }
    const pick = (x) => (!x ? null : usePref ? (x.pref ? x.pref[code] : null) : x.nat);
    const fv = pick(F), jv = pick(J);
    if (usePref && J && !J.pref) out.notes.push(`${o.year}年の日本国籍の言語別は都道府県別の数がありません。`);
    if (!J) out.notes.push(`${o.year}年は日本国籍の児童生徒の言語別が公表されていません（外国籍だけ表示）。`);
    const same = F && J && F.kind === J.kind && F.cats.join() === J.cats.join() && fv && jv;
    out.area = usePref ? areaName(code) : "全国";
    let rows;
    if (same) {
      out.nats = ["f", "j"];
      rows = F.cats.map((c, i) => rowOf(c, fv[i], jv[i]));
      out.kindText = F.kind;
    } else {
      const nat = jv && J && state.ln === "j" ? "j" : "f";
      const X = nat === "f" ? F : J, v = nat === "f" ? fv : jv;
      out.nats = [nat];
      out.toggle = !!(F && J && fv && jv);
      if (out.toggle) out.notes.push(`${o.year}年は外国籍が「${F.kind}」、日本国籍が「${J.kind}」の集計で、分け方がちがうため積み上げずに片方ずつ表示しています。`);
      rows = X.cats.map((c, i) => rowOf(c, nat === "f" ? v[i] : null, nat === "j" ? v[i] : null));
      out.kindText = X.kind;
    }
    // 合計の多い順。「その他」は複数の言語をまとめた区分なので最後
    rows = rows.map((r, i) => ({ ...r, i })).sort((a, b) => (a.name === "その他") - (b.name === "その他") || b.total - a.total || a.i - b.i);
    out.rows = rows;
    out.title = `${out.kindText === "母語別" ? "母語別" : "言語別"} 日本語指導が必要な児童生徒`;
    out.head = `${out.area}・${when}・${out.kindText}`;
    if (o.year === 2025) out.notes.push("「ネパール語」は2025年から独立した区分です。それまでは「その他」に含まれます。");
    else if (o.year >= 2021) out.notes.push("この年は「ネパール語」の区分がなく、「その他」に含まれます。");
    if (out.kindText === "母語別") out.notes.push("2018年までの外国籍は「母語別」の集計で、2021年からの「言語別」とは分け方がちがいます。");
    out.notes.push("言語別の人数は国籍別の人数ではありません。「その他」は公式の区分で、複数の言語をまとめたものです。");
    out.srcKeys = usePref ? ["lang_pref_f", "lang_pref_j"] : ["lang_f", "lang_j", "lang_pref_f", "lang_pref_j"];
    return out;
  }

  function typeData(o, code, when) {
    const T = o.type;
    const out = { kind: "type", notes: [], area: areaName(code) };
    const fv = code ? T.pref.f[code] : T.nat.f;
    const jv = code ? (T.pref.j ? T.pref.j[code] : null) : T.nat.j;
    if (code && !T.pref.j) out.notes.push(`${o.year}年の日本国籍は、学校種別の都道府県別が公表されていません（全国の数だけ）。${areaName(code)}は外国籍だけ表示しています。`);
    out.nats = jv ? ["f", "j"] : ["f"];
    out.rows = N.types.map((t, i) => {
      const r = rowOf(t.id === "special" ? o.special_label : t.label, fv[i], jv ? jv[i] : null);
      if (fv[i] == null) r.none = "区分なし（2016年から）";
      return r;
    });
    out.title = "学校種別 日本語指導が必要な児童生徒";
    out.head = `${out.area}・${when}・学校種別`;
    if (o.year < 2016) out.notes.push("義務教育学校は2016年からの学校の種類です。この年は区分がありません（0人という意味ではありません）。");
    if (o.year <= 2006) out.notes.push("2006年までは「盲・聾・養護学校」、2007年からは「特別支援学校」の区分です。");
    out.notes.push("高等学校は全日制・定時制・通信制の計です。");
    out.srcKeys = code ? ["pref_f", "pref_j"] : ["type", "type_f", "type_j", "pref_f", "pref_j"];
    return out;
  }

  function prefData(o, when) {
    const out = { kind: "pref", notes: [], area: "全国" };
    const m = o.pref.j ? state.m : "f";
    if (m !== state.m) out.notes.push(`${o.year}年は都道府県別の日本国籍の数が公表されていないため、外国籍の多い順に並べています（日本国籍の都道府県別は2012年から）。`);
    out.metric = m;
    const all = Object.keys(N.prefs).map((c) => {
      const f = o.pref.f[c], j = o.pref.j ? o.pref.j[c] : null;
      const r = rowOf(N.prefs[c], m !== "j" ? f : null, m !== "f" ? j : null);
      r.code = c; r.ff = f; r.jj = j;
      r.key = m === "f" ? f : m === "j" ? j : f + j;
      return r;
    }).sort((a, b) => b.key - a.key || a.code.localeCompare(b.code));
    all.forEach((r, i) => { r.rank = i && all[i - 1].key === r.key ? all[i - 1].rank : i + 1; });
    out.allRows = all;
    out.rows = all.slice(0, state.top);
    out.nats = m === "all" ? ["f", "j"] : [m];
    if (state.pref && !out.rows.some((r) => r.code === state.pref)) out.extra = all.find((r) => r.code === state.pref);
    const endKey = out.rows[out.rows.length - 1].key;
    const tie = all.slice(out.rows.length).filter((r) => r.key === endKey).length;
    if (tie) out.notes.push(`${state.top}位と同じ数の都道府県がほかに${tie}あります（表示していません）。`);
    out.title = `都道府県別 日本語指導が必要な児童生徒（${NAT[m]}）`;
    out.head = `${when}・${NAT[m]}の多い順・${state.top === 47 ? "全47都道府県" : `上位${state.top}`}`;
    out.notes.push("同じ数は同じ順位です。地域名を押すと、地図でその都道府県を開きます（地図の人数は最新の調査）。");
    out.srcKeys = ["pref_f", "pref_j"];
    return out;
  }

  function sayOf(D, o) {
    const rows = D.rows.filter((r) => r.total != null);
    const sum = D.kind === "pref" ? D.allRows.reduce((s, r) => s + r.key, 0) : rows.reduce((s, r) => s + r.total, 0);
    if (D.kind === "pref") {
      const top = D.rows[0], second = D.rows.find((r) => r.rank > top.rank);
      const same = D.rows.filter((r) => r.rank === top.rank);
      const n10 = D.allRows.slice(0, 10).reduce((s, r) => s + r.key, 0);
      return `${o.year}年の${NAT[D.metric]}で最も多いのは${same.map((r) => r.name).join("・")}（${fmt(top.key)}人${same.length > 1 ? "、同数" : ""}）${second ? `、次いで${second.name}（${fmt(second.key)}人）` : ""}です。上位10都道府県で全国の${pctText(n10, sum)}を占めます。`;
    }
    const named = rows.filter((r) => r.name !== "その他");
    const top = named[0], second = named[1];
    const what = D.kind === "lang" ? `「${top.name}」` : top.name;
    let t = `${D.area}で最も多いのは${what}で${fmt(top.total)}人（全体の${pctText(top.total, sum)}）${second ? `、次いで${D.kind === "lang" ? `「${second.name}」` : second.name}（${fmt(second.total)}人）` : ""}です。`;
    const other = rows.find((r) => r.name === "その他");
    if (other && other.total > top.total) t += `複数の言語をまとめた「その他」は${fmt(other.total)}人です。`;
    return t;
  }

  function renderBreakdown() {
    const o = Y[state.y];
    $("nj-y").innerHTML = YEARS.slice().reverse().map((y) => `<option value="${y}"${y === state.y ? " selected" : ""}>${y}年（${Y[y].fy}）</option>`).join("");
    $("nj-pref-tools").hidden = state.v !== "pref";
    const D = bdData();
    state.bd = D;
    $("nj-ln-tools").hidden = !D.toggle;
    pressed("nj-ln", "ln", D.nats[0]);
    $("nj-bd-head").textContent = `${VIEW[state.v]}：${D.head}`;
    $("nj-bd-msg").hidden = !D.national;
    $("nj-bd-msg").textContent = D.national || "";
    $("nj-bd-legend").innerHTML = D.nats.map((k) => `<span class="nj-lg"><i class="nj-sw" style="background:${COLOR[k]}"></i>${NAT[k]}</span>`).join("") + '<span class="nj-unit">単位：人</span>';
    const rows = D.rows.concat(D.extra ? [D.extra] : []);
    const max = Math.max(1, ...D.rows.map((r) => r.total || 0), D.extra ? D.extra.total : 0);
    const segs = (r) => D.nats.map((k) => { const v = r[k]; return v ? `<span class="nj-seg" style="width:${(v / max) * 100}%;background:${COLOR[k]}"></span>` : ""; }).join("");
    const detail = (r) => (r.none ? r.none : D.nats.length > 1 ? `外国籍 ${fmt(r.f)}人・日本国籍 ${fmt(r.j)}人・合計 ${fmt(r.total)}人` : `${NAT[D.nats[0]]} ${fmt(r.total)}人`);
    $("nj-bars").innerHTML = `<ol class="nj-rows${D.kind === "pref" ? " nj-ranked" : ""}">` + rows.map((r, i) => {
      const name = D.kind === "pref"
        ? `<span class="nj-rank">${r.rank}</span><a href="index.html?pref=${r.code}&amp;view=stats&amp;layer=nihongo${D.metric === "f" ? "&amp;variant=foreign" : D.metric === "j" ? "&amp;variant=japan" : ""}" title="地図で${esc(r.name)}を開く">${esc(r.name)}</a>`
        : esc(r.name);
      const sel = D.kind === "pref" && r.code === state.pref ? " nj-sel" : "";
      return `${D.extra && r === D.extra ? '<li class="nj-gap" aria-hidden="true">…</li>' : ""}<li class="nj-row${sel}" tabindex="0" data-i="${i}" aria-label="${esc(r.name)}：${esc(detail(r))}">
        <span class="nj-name">${name}</span><span class="nj-track">${segs(r)}</span><span class="nj-v">${r.none ? "—" : fmt(r.total) + "人"}</span></li>`;
    }).join("") + '</ol><div class="nj-tip" id="nj-btip" hidden></div>';
    // マウス・タップ・キーボードで内訳を出す
    const tip = $("nj-btip"), wrap = $("nj-bars");
    const show = (li) => {
      const r = rows[Number(li.dataset.i)];
      tip.innerHTML = `<b>${esc(r.name)}</b><br>${esc(detail(r))}`;
      tip.hidden = false;
      tip.style.top = li.offsetTop + li.offsetHeight + 2 + "px";
      tip.style.left = Math.max(0, Math.min(wrap.clientWidth - tip.offsetWidth, li.querySelector(".nj-track").offsetLeft)) + "px";
    };
    wrap.querySelectorAll(".nj-row").forEach((li) => {
      li.addEventListener("pointerenter", () => show(li));
      li.addEventListener("pointerdown", () => show(li));
      li.addEventListener("focus", () => show(li));
      li.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") tip.hidden = true; });
      li.addEventListener("blur", () => { tip.hidden = true; });
    });
    $("nj-bd-say").textContent = sayOf(D, o);
    const src = D.srcKeys.map((k) => o.src[k]).filter(Boolean);
    $("nj-bd-note").innerHTML = D.notes.map(esc).join("") + ` 出典：${esc(SURVEY)} ${esc(o.fy)}（e-Stat：${src.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(tabNo(s))}</a>`).join("・")}${src.some((s) => s.prev) ? "。2007年の表の前回の数" : ""}）`;
    // 表
    const showNats = D.kind === "pref" ? ["f", "j"] : D.nats;
    const cell = (v) => `<td class="num">${v == null ? "—" : fmt(v) + "人"}</td>`;
    const body = (D.kind === "pref" ? D.allRows : rows).map((r) => `<tr${D.kind === "pref" && r.code === state.pref ? ' class="on"' : ""}>${D.kind === "pref" ? `<td class="num">${r.rank}</td>` : ""}<th scope="row">${esc(r.name)}</th>${showNats.map((k) => cell(D.kind === "pref" ? (k === "f" ? r.ff : r.jj) : r[k])).join("")}${showNats.length > 1 ? cell(D.kind === "pref" ? (r.jj == null ? null : r.ff + r.jj) : r.total) : ""}</tr>`).join("");
    $("nj-bd-table").innerHTML = `<table class="plain"><thead><tr>${D.kind === "pref" ? '<th scope="col" class="num">順位</th>' : ""}<th scope="col">${D.kind === "pref" ? "都道府県" : D.kind === "lang" ? "言語" : "学校の種類"}</th>${showNats.map((k) => `<th scope="col" class="num">${NAT[k]}</th>`).join("")}${showNats.length > 1 ? '<th scope="col" class="num">合計</th>' : ""}</tr></thead><tbody>${body}</tbody></table>`
      + `<p class="fine">${D.kind === "pref" ? `全47都道府県を${NAT[D.metric]}の多い順に並べています。` : ""}—：区分がない、または公表されていない数（0人ではありません）。</p>`;
    const top3 = D.rows.filter((r) => r.total != null).slice(0, 3).map((r, i) => `${D.kind === "pref" ? r.rank + "位 " : ""}${r.name} ${fmt(D.kind === "pref" ? r.key : r.total)}人`).join("\n");
    setX("bd", `${D.title}（公立学校）｜${D.kind === "pref" ? "全国" : D.area}・${o.year}年\n${top3}\n${SITE_NAME}`, pageUrl("breakdown"));
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
  function srcLine(o, keys) {
    const t = keys.map((k) => o.src[k]).filter((s) => s && !s.prev).map(tabNo);
    return `出典：${SURVEY} ${o.fy}${t.length ? `（e-Stat ${t.join("・")}）` : "（2007年の表の前回の数）"}`;
  }

  function trendSpec() {
    const M = trendModel();
    const regs = regions();
    const ys = availYears(state.s);
    const spec = Object.assign({ kind: "trend", siteName: SITE_NAME, siteUrl: document.body.dataset.site }, M);
    spec.title = "日本語指導が必要な児童生徒の推移（公立学校）";
    spec.subtitle = [`${regs.map(areaName).join("・")}｜${NAT[state.s]}｜調査年 ${ys[0]}〜${ys[ys.length - 1]}年`];
    spec.legend = M.series.map((s) => ({ line: true, color: s.color, dash: s.dash, marker: s.marker, label: `${s.name}・${NAT[state.s]}` }));
    spec.unit = "単位：人";
    spec.breakLabel = ["9月1日現在", "5月1日現在"];
    spec.noDataLabel = "都道府県別の日本国籍は2012年から";
    spec.summary = state.cmpLines || [];
    spec.foot = [
      `出典：${SURVEY}（${ys[0]}〜${ys[ys.length - 1]}年の各年度。e-Statの表から作成）`,
      "公立学校が対象。日本国籍の児童生徒も含みます。日本国籍の人数は帰化した人の数ではありません。",
      "点は調査をした年です。線は調査と調査を結んだもので、その間の年の人数ではありません。",
    ];
    spec.file = `nihongo-shido_trend_${regs.join("-") || "japan"}_${state.s}_${dateStamp()}.png`;
    return [spec];
  }

  function barsSpecs() {
    const D = state.bd, o = Y[state.y];
    const rowsAll = D.kind === "pref" ? D.rows : D.rows;
    const chunks = D.kind === "pref" && state.top === 47 ? [0, 1, 2, 3].map((k) => rowsAll.slice(k * PAGE47, (k + 1) * PAGE47)).filter((c) => c.length) : [rowsAll];
    const max = Math.max(...rowsAll.map((r) => r.total || 0));
    const nat = D.kind === "pref" ? null : D.rows.reduce((s, r) => ({ f: s.f + (r.f || 0), j: s.j + (r.j || 0) }), { f: 0, j: 0 });
    return chunks.map((rows, k) => {
      const range = chunks.length > 1 ? `（${rows[0].rank}〜${rows[rows.length - 1].rank}位）` : "";
      const sub = [`${D.kind === "pref" ? "全国" : D.area}・${o.year}年（${o.fy}）${md(o.as_of)}現在`];
      if (D.kind === "pref") sub.push(`${NAT[D.metric]}の多い順・${state.top === 47 ? `全47都道府県のうち${range.replace(/[（）]/g, "")}` : `上位${state.top}`}`);
      if (nat) sub.push(D.nats.length > 1 ? `合計 ${fmt(nat.f + nat.j)}人（外国籍 ${fmt(nat.f)}人・日本国籍 ${fmt(nat.j)}人）` : `${NAT[D.nats[0]]} ${fmt(nat.f + nat.j)}人`);
      return {
        kind: "bars", siteName: SITE_NAME, siteUrl: document.body.dataset.site,
        title: D.kind === "pref" ? `都道府県別 日本語指導が必要な児童生徒（公立学校・${NAT[D.metric]}）` : `${D.title}（公立学校）`, subtitle: sub, unit: "単位：人",
        legend: D.nats.map((n) => ({ color: COLOR[n], label: NAT[n] })),
        rows: rows.map((r) => ({
          name: D.kind === "pref" ? `${r.rank}位 ${r.name}` : r.name,
          segs: D.nats.map((n) => ({ n: r[n] || 0, color: COLOR[n] })),
          value: r.none ? "区分なし" : fmt(r.total) + "人",
          sub: D.nats.length > 1 && !r.none ? `外国籍 ${fmt(r.f)}・日本国籍 ${fmt(r.j)}` : "",
        })),
        max,
        foot: [srcLine(o, D.srcKeys), "公立学校が対象。日本国籍の児童生徒も含みます。日本国籍の人数は帰化した人の数ではありません。"].concat(D.kind === "lang" ? ["言語別の人数は国籍別の人数ではありません。「その他」は複数の言語をまとめた公式の区分です。"] : D.kind === "type" && o.year < 2016 ? ["義務教育学校は2016年からの区分（この年は区分なし）。"] : []),
        file: `nihongo-shido_${D.kind}_${D.kind === "pref" ? D.metric + "_top" + state.top + (chunks.length > 1 ? "-" + (k + 1) : "") : state.pref || "japan"}_${o.year}_${dateStamp()}.png`,
        label: chunks.length > 1 ? `${rows[0].rank}〜${rows[rows.length - 1].rank}位` : "",
      };
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
    $("img-what").textContent = which === "trend" ? "いま表示している推移のグラフを、Xに載せやすい縦長の画像（1080×1350）にします。" : `いま表示している${VIEW[state.v]}のグラフを、縦長の画像（1080×1350）にします。${state.v === "pref" && state.top === 47 ? "全47件は字が小さくならないよう、12件ずつ4枚に分けて保存します。" : ""}`;
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
  window.__njCheck = () => ({ state: JSON.parse(JSON.stringify({ ...state, bd: undefined })), bd: state.bd && { kind: state.bd.kind, area: state.bd.area, nats: state.bd.nats, rows: state.bd.rows.map((r) => [r.name, r.f, r.j, r.total, r.rank]) }, result: $("nj-result").innerText, say: [$("nj-trend-say").textContent, $("nj-bd-say").textContent], url: location.search });
})();
