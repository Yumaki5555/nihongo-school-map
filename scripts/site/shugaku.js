/* 外国籍の子どもの就学状況（文部科学省「外国人の子供の就学状況等調査」）のページ：
   住民票上の学齢相当の外国籍の子どもについて、全国・都道府県・市区町村の就学状況（①〜⑥）、推移と2つの年の比較、内訳と地域の順位。
   データは data/shugaku.json（scripts/fetch_shugaku.py が e-Stat の市区町村別データから作り、全国は国の結果資料の表と照合済み）。
   画面の部品は日本語指導・外国籍の子どものページと同じ作りで、見た目をそろえるため id と class も同じ名前（nj-）を使う */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SITE_NAME = "日本語学校・留学生 全国マップ";
  const SURVEY = "文部科学省「外国人の子供の就学状況等調査」";
  // 区分（i＝データの並びの位置：①〜⑥, 計, 住民票上の人数）。色は白地とのコントラスト3:1以上
  const CATS = {
    juki: { i: 7, label: "住民票上の人数（学齢相当）", short: "住民票上の人数", color: "#5F4615" },
    c1: { i: 0, label: "①日本の小・中学校など（義務教育諸学校）", short: "①小・中学校など", color: "#2B5FA8" },
    c2: { i: 1, label: "②外国人学校", short: "②外国人学校", color: "#3E9A4E" },
    c3: { i: 2, label: "③不就学", short: "③不就学", color: "#B0362B" },
    c4: { i: 3, label: "④転居・出国（予定を含む）", short: "④転居・出国", color: "#6E675D" },
    c5: { i: 4, label: "⑤就学状況を確認できず", short: "⑤確認できず", color: "#B8661C" },
    c6: { i: 5, label: "⑥その他", short: "⑥その他", color: "#7A4FA0" },
    pos: { label: "不就学の可能性（国の数え方：③＋⑤＋⑦・全国のみ）", short: "不就学の可能性（③＋⑤＋⑦）", color: "#8A2E24" },
  };
  // 順位の画像の題名（「東京都｜市区町村別 外国人学校に通う外国籍の子どもの数」の形。区分の番号だけでは伝わらないので言葉で書く）
  const RANK_WHAT = {
    juki: "外国籍の子どもの数（小・中学校の年齢）",
    c1: "日本の小・中学校などに通う外国籍の子どもの数",
    c2: "外国人学校に通う外国籍の子どもの数",
    c3: "学校に通っていない外国籍の子どもの数（不就学）",
    c4: "転居・出国した外国籍の子どもの数（予定を含む）",
    c5: "就学状況を確認できない外国籍の子どもの数",
    c6: "就学状況が「その他」の外国籍の子どもの数",
  };
  const PARTS = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const TREND_CATS = ["juki"].concat(PARTS, ["pos"]);
  const RANK_CATS = ["juki"].concat(PARTS);
  const PAIR = { a: "#9A8455", b: "#3F3018" };
  const DEFAULT_A = 2021; // 2つの年の比較の初期値（市区町村別の数がある最初の年。2019年は全国だけで、⑦が大きいため）
  const PAGE = 12; // 画像1枚に入れる順位の件数（4枚まで）
  const FOOT_SCOPE = "住民票（住民基本台帳）上の学齢相当（小・中学校の年齢）の外国籍の子どもについて、住んでいる市区町村の教育委員会が答えた数。";
  const state = { area: "00", area2: "", s: "juki", a: null, b: null, aSet: false, v: "bd", r: "juki", y: null, mode: "one", ya: null, yb: null, top: 10 };
  let N, YEARS = [], LATEST, FIRST_MUNI, PREF_CODES = [], MUNI_BY_PREF = {}, INDEX = [];
  let urlTimer = 0, imageUrl = "", imageJob = 0, imageWhich = "trend", imagePage = 0;

  let G = null, ready = false; // G：小・中学校などの数（data/gakkosu.json）。読めなくてもページは出す
  fetch("data/shugaku.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { N = d; init(); ready = true; renderSchools(); })
    .catch(() => { $("nj-loading").hidden = true; $("nj-error").hidden = false; });
  fetch("data/gakkosu.json").then((r) => (r.ok ? r.json() : null)).then((d) => { G = d; if (ready) renderSchools(); }).catch(() => {});

  // ---- 共通 ----
  const md = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${Number(m[2])}月${Number(m[3])}日` : ""; };
  const jpDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : ""; };
  const Y = (y) => N.y[String(y)];
  const yLabel = (y) => `${y}年（${Y(y).fy}）`;
  const asOf = (y) => (Y(y).as_of ? `${md(Y(y).as_of)}現在` : "");
  const isMuni = (c) => c.length === 5;
  const prefOf = (c) => (c === "00" ? "" : c.slice(0, 2));
  const areaName = (c) => (c === "00" ? "全国" : isMuni(c) ? N.prefs[c.slice(0, 2)] + N.munis[c][1] : N.prefs[c]);
  const shortName = (c) => (isMuni(c) ? N.munis[c][1] : areaName(c));
  function roundDiv(n, d) { const s = n < 0 ? -1 : 1; const a = Math.abs(n); return s * Math.floor((2 * a + d) / (2 * d)); }
  const pctText = (part, whole) => (whole > 0 && part != null ? (roundDiv(part * 1000, whole) / 10).toFixed(1) + "％" : "—");
  function dateStamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }
  function shade(hex) { const n = parseInt(hex.slice(1), 16); return "#" + [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * 0.55).toString(16).padStart(2, "0")).join(""); }
  // 検索用に表記のゆれをそろえる（全角・半角、ヶ/ケ、檮/梼、竜/龍、空白）
  const norm = (s) => String(s).normalize("NFKC").replace(/[ヶヵ]/g, (c) => (c === "ヶ" ? "ケ" : "カ")).replace(/檮/g, "梼").replace(/竜/g, "龍").replace(/\s+/g, "");

  // ---- 人数 ----
  // その年・地域・区分の人数。表にない年（2019年の都道府県・市区町村）、区分がない年（2022年までの⑥）、空欄（回答なし）は null（0 とは区別する）
  function val(y, c, k) {
    const row = (N.v[c] || {})[String(y)];
    if (!row) return null;
    if (k === "pos") return c === "00" ? row[2] + row[4] + (row[7] - row[6]) : null; // 国の発表と同じ数え方（全国だけ）
    if (k === "c7") return row[7] - row[6];
    if (k === "tot") return row[6];
    return row[CATS[k].i];
  }
  // 値が null の理由
  function noneWhy(y, c, k) {
    if (k === "pos" && c !== "00") return "全国の数だけ";
    if (!(N.v[c] || {})[String(y)]) return Y(y).nat_only ? `${y}年は全国の数だけ` : "データなし";
    if (k === "c6" && val(y, c, "c6") == null) return "区分なし（2023年から）";
    return "空欄（回答なし）";
  }
  // 足した数に、空欄（回答なし）の市区町村の分が入っていないとき、その市区町村の名前
  function blankIn(y, c, k) {
    if (!CATS[k] || CATS[k].i == null || CATS[k].i > 5) return [];
    return (Y(y).blanks || []).filter((b) => b[1] === CATS[k].i && b[0] !== c && (c === "00" || b[0].slice(0, 2) === c)).map((b) => areaName(b[0]));
  }
  // その年・地域の ks の区分に、空欄（回答なし）の市区町村の分が入っていないときの注記
  function blankNote(y, c, ks) {
    const hit = ks.filter((k) => blankIn(y, c, k).length);
    const names = [...new Set(hit.flatMap((k) => blankIn(y, c, k)))];
    return names.length ? `${y}年の${areaName(c)}の${hit.map((k) => CATS[k].short.charAt(0)).join("・")}には、${names.join("・")}の空欄（回答なし）の分が入っていません。` : "";
  }
  const NOTE5 = "⑤は就学状況を確認できなかった子どもの数で、不就学と確定した人数ではありません。";
  const NOTEPOS = "不就学の可能性は③不就学・⑤確認できず・⑦住民票との差を合わせた国の指標で、不就学と確定した人数ではありません。";
  const NOTE2019 = "2019年度は⑦（住民票上の人数との差）が大きく、2021年度からとは把握状況がちがうため、比べるときは注意が必要です。";
  // e-Stat原表の県の行と市区町村の合計の差（data の known。2024年度の山形県・茨城県）。ys の年・cs の地域・ks の区分にかかわるものだけ（ks が null ならすべて）
  function knownFor(ys, cs, ks) {
    const want = ks && ks.map((k) => (k === "c7" ? "tot" : k));
    return (N.known || []).filter((x) => ys.includes(x.year) && cs.includes(x.pref) && (!want || x.diff.some((d) => want.includes(d.k))));
  }
  const knownYears = (list) => [...new Set(list.map((x) => x.year))].join("・");
  const knownMsg = (list) => `${knownYears(list)}年度は、e-Stat原表の県集計と市区町村の合計に差があります。このサイトでは、市区町村の合計を掲載しています。`;
  // 画面：注記。開くと、原表の県の行と掲載している数を表で見られる（差が生じた理由は書かない＝確かめられていない）
  function knownHtml(list) {
    if (!list.length) return "";
    const rows = list.flatMap((x) => x.diff.map((d) => `<tr><th scope="row">${x.year}年度・${esc(N.prefs[x.pref])}</th><td>${esc(d.k === "tot" ? "①〜⑥の計" : CATS[d.k].label)}</td><td class="num">${fmt(d.raw)}人</td><td class="num">${fmt(d.used)}人</td></tr>`)).join("");
    return `<details class="sg-known"><summary>${esc(knownMsg(list))}</summary><div class="tablewrap"><table class="plain"><thead><tr><th scope="col">年度・県</th><th scope="col">区分</th><th scope="col" class="num">原表の県の行</th><th scope="col" class="num">市区町村の合計（掲載）</th></tr></thead><tbody>${rows}</tbody></table></div><p class="fine">差が生じた理由は確認できていません。全国の数（市区町村の合計を足したもの）は、国の結果資料の表と一致します。</p></details>`;
  }
  // 画像：短い注記
  const knownShort = (list) => (list.length ? `${knownYears(list)}年度の${[...new Set(list.map((x) => N.prefs[x.pref]))].join("・")}は、e-Stat原表の県集計と市区町村の合計に差があります（市区町村の合計を掲載）。` : "");
  // X の投稿文などに使う人数の行（割合は入れない）。③と⑤を並べるので、⑤は「確認できず」と分かる名前にする
  const countLines = (y, c) => ["c1", "c2", "c3", "c5"].filter((k) => val(y, c, k) != null).map((k) => `${k === "c5" ? "⑤就学状況を確認できず" : CATS[k].short} ${fmt(val(y, c, k))}人`);
  const regions = () => (state.area2 ? [state.area, state.area2] : [state.area]);
  const availYears = (k) => YEARS.filter((y) => regions().every((c) => val(y, c, k) != null));

  // 増減・増減率・倍率（過去の年が0人なら率と倍率は出さない。どちらかの年がデータなしなら null）
  function change(a, b) {
    if (a == null || b == null) return null;
    const d = b - a;
    if (a === 0) return { d, pct: null, ratio: null };
    return { d, pct: roundDiv(d * 1000, a), ratio: roundDiv(b * 100, a) };
  }
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
  const defaultPast = (b, ys) => (ys.includes(DEFAULT_A) && DEFAULT_A < b ? DEFAULT_A : ys.find((y) => y < b) || null);
  const prevOf = (b, ys) => ys.filter((y) => y < b).pop() || null;

  function setArea(c) { state.area = c; if (state.area2 === c) state.area2 = ""; }

  function init() {
    YEARS = N.years.slice().sort((a, b) => a - b);
    LATEST = YEARS[YEARS.length - 1];
    FIRST_MUNI = YEARS.find((y) => !Y(y).nat_only);
    PREF_CODES = Object.keys(N.prefs).sort();
    Object.keys(N.munis).sort().forEach((c) => { (MUNI_BY_PREF[c.slice(0, 2)] = MUNI_BY_PREF[c.slice(0, 2)] || []).push(c); });
    INDEX = [{ c: "00", n: norm("全国"), k: norm("全国") }].concat(
      PREF_CODES.map((c) => ({ c, n: norm(N.prefs[c]), k: norm(N.prefs[c]) })),
      Object.keys(N.munis).sort().map((c) => ({ c, n: norm(N.munis[c][1]), k: norm(N.prefs[c.slice(0, 2)] + N.munis[c][1]) })));
    $("sg-pref").innerHTML = '<option value="00">全国</option>' + PREF_CODES.map((c) => `<option value="${c}">${esc(N.prefs[c])}</option>`).join("");
    $("sg-r").innerHTML = RANK_CATS.map((k) => `<option value="${k}">${esc(CATS[k].label)}</option>`).join("");
    readUrl();
    $("nj-src-table").innerHTML = sourceTable();
    $("sg-asof").textContent = `基準日：${YEARS.filter((y) => Y(y).as_of).map((y) => `${y}年は${jpDate(Y(y).as_of)}`).join("、")}現在です（国の発表資料で確認）。${YEARS.filter((y) => !Y(y).as_of).join("・")}年の基準日は国の資料で確かめられなかったため、書いていません。`;
    $("sg-pref").addEventListener("change", (e) => { setArea(e.target.value); render(); });
    $("sg-muni").addEventListener("change", (e) => { setArea(e.target.value || prefOf(state.area)); render(); });
    $("nj-reset").addEventListener("click", () => { setArea("00"); render(); $("nj-area-title").focus(); });
    search("sg-q", "sg-list", (c) => { setArea(c); render(); jumpTo("area"); });
    search("sg-q2", "sg-list2", (c) => { if (c !== state.area) { state.area2 = c; render(); } });
    $("sg-cur2").addEventListener("click", (e) => { if (e.target.closest("button")) { state.area2 = ""; render(); $("sg-q2").focus(); } });
    // 順位の地域名：このページの地域をその地域にして、地域のデータへ移動
    $("nj-bars").addEventListener("click", (e) => { const b = e.target.closest("button[data-c]"); if (!b) return; setArea(b.dataset.c); render(); jumpTo("area"); });
    $("sg-s").addEventListener("change", (e) => { state.s = e.target.value; render(); });
    $("sg-r").addEventListener("change", (e) => { state.r = e.target.value; render(); });
    seg("nj-v", "v", (v) => { state.v = v; });
    seg("nj-top", "top", (v) => { state.top = Number(v); });
    seg("nj-mode", "mode", (v) => { if (v === "two" && state.mode !== "two") { state.yb = state.y; state.ya = null; } if (v === "one" && state.mode === "two") state.y = state.yb; state.mode = v; });
    $("nj-a").addEventListener("change", (e) => { state.a = Number(e.target.value); state.aSet = true; render(); });
    $("nj-b").addEventListener("change", (e) => { state.b = Number(e.target.value); if (state.a >= state.b) state.a = null; render(); });
    $("nj-y").addEventListener("change", (e) => { state.y = Number(e.target.value); render(); });
    $("nj-ya").addEventListener("change", (e) => { state.ya = Number(e.target.value); render(); });
    $("nj-yb").addEventListener("change", (e) => { state.yb = Number(e.target.value); if (state.ya >= state.yb) state.ya = null; render(); });
    $("nj-quick").addEventListener("click", (e) => { const b = e.target.closest("button[data-a]"); if (b && !b.disabled) { state.a = Number(b.dataset.a); state.aSet = true; render(); } });
    $("nj-jump").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-go]");
      if (!b) return;
      if (b.dataset.go !== "trend") { state.v = b.dataset.go; render(); }
      jumpTo(b.dataset.go === "trend" ? "trend" : "breakdown");
    });
    $("nj-trend-acts").innerHTML = actButtons("trend");
    $("nj-bd-acts").innerHTML = actButtons("bd");
    $("nj-kpi-acts").innerHTML = actButtons("kpi");
    $("nj-img-kpi").addEventListener("click", () => openImage("kpi"));
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

  // ---- 地域の検索（入力すると候補を出す。上下キーで選び、Enter で決める）----
  function search(inputId, listId, pick) {
    const inp = $(inputId), list = $(listId);
    let items = [], cur = -1;
    const close = () => { list.hidden = true; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); cur = -1; };
    const draw = () => {
      list.innerHTML = items.length
        ? items.map((c, i) => `<li role="option" id="${listId}-${i}" data-c="${c}" aria-selected="${i === cur}">${esc(shortName(c))}<small>${c === "00" ? "" : isMuni(c) ? esc(N.prefs[c.slice(0, 2)]) : "都道府県"}</small></li>`).join("")
        : '<li class="sg-none" role="option" aria-disabled="true">見つかりません（漢字で入れてください）</li>';
      list.hidden = false;
      inp.setAttribute("aria-expanded", "true");
      if (cur >= 0) inp.setAttribute("aria-activedescendant", `${listId}-${cur}`); else inp.removeAttribute("aria-activedescendant");
    };
    const done = (c) => { inp.value = ""; close(); pick(c); };
    inp.addEventListener("input", () => {
      const q = norm(inp.value);
      if (!q) { close(); return; }
      const score = (x) => (x.n === q ? 0 : x.n.startsWith(q) ? 1 : x.k.startsWith(q) ? 2 : x.n.includes(q) ? 3 : x.k.includes(q) ? 4 : 9);
      items = INDEX.map((x) => ({ c: x.c, s: score(x) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s || a.c.length - b.c.length || (a.c < b.c ? -1 : 1)).slice(0, 12).map((x) => x.c);
      cur = items.length ? 0 : -1;
      draw();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (!list.hidden && cur >= 0) done(items[cur]); return; }
      if (list.hidden) return;
      if (e.key === "ArrowDown") { cur = Math.min(items.length - 1, cur + 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { cur = Math.max(0, cur - 1); draw(); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => { const li = e.target.closest("li[data-c]"); if (li) done(li.dataset.c); });
    inp.addEventListener("blur", () => setTimeout(close, 150));
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
    const code = (x) => (x && N.v[x] ? x : "");
    state.area = code(p.get("area")) || "00";
    const c2 = code(p.get("cmp"));
    if (c2 && c2 !== state.area) state.area2 = c2;
    if (TREND_CATS.includes(p.get("s"))) state.s = p.get("s");
    if (RANK_CATS.includes(p.get("r"))) state.r = p.get("r");
    const yr = (k) => { const n = Number(p.get(k)); return YEARS.includes(n) ? n : null; };
    state.a = yr("a"); state.b = yr("b"); state.y = yr("y");
    if (state.a && state.b && state.a > state.b) [state.a, state.b] = [state.b, state.a];
    state.aSet = !!state.a;
    if (["bd", "rank"].includes(p.get("v"))) state.v = p.get("v");
    if (["5", "10", "0"].includes(p.get("top"))) state.top = Number(p.get("top"));
    const ys = /^(\d{4})-(\d{4})$/.exec(p.get("ys") || "");
    if (ys && YEARS.includes(+ys[1]) && YEARS.includes(+ys[2]) && ys[1] !== ys[2]) { state.mode = "two"; state.ya = Math.min(+ys[1], +ys[2]); state.yb = Math.max(+ys[1], +ys[2]); }
  }

  function query() {
    const p = new URLSearchParams();
    if (state.area !== "00") p.set("area", state.area);
    if (state.area2) p.set("cmp", state.area2);
    if (state.s !== "juki") p.set("s", state.s);
    const ys = availYears(state.s);
    if (state.a && state.a !== defaultPast(state.b, ys)) p.set("a", state.a);
    if (state.b && state.b !== ys[ys.length - 1]) p.set("b", state.b);
    if (state.v !== "bd") p.set("v", state.v);
    if (state.v === "rank" && state.r !== "juki") p.set("r", state.r);
    if (state.v === "bd" && state.mode === "two") p.set("ys", `${state.ya}-${state.yb}`);
    else if (state.y && state.y !== LATEST) p.set("y", state.y);
    if (state.v === "rank" && state.top !== 10) p.set("top", state.top);
    const s = p.toString();
    return s ? "?" + s : "";
  }
  const pageUrl = (hash) => document.body.dataset.site + "shugaku.html" + query() + (hash ? "#" + hash : "");

  // ---- 全体の描き直し ----
  function render() {
    // 「不就学の可能性」は全国だけ。地域を変えて選べなくなったら住民票上の人数に戻す
    if (state.s === "pos" && regions().some((c) => c !== "00")) state.s = "juki";
    const ys = availYears(state.s);
    if (!ys.includes(state.b)) state.b = ys[ys.length - 1] || null;
    if (!state.aSet || !ys.includes(state.a) || state.a >= state.b) { state.a = defaultPast(state.b, ys); state.aSet = false; }
    const bys = bdYears();
    if (!bys.includes(state.y)) state.y = bys[bys.length - 1];
    if (state.mode === "two") {
      if (!bys.includes(state.yb) || state.yb === bys[0]) state.yb = bys[bys.length - 1];
      if (!bys.includes(state.ya) || state.ya >= state.yb) state.ya = defaultPast(state.yb, bys);
    }
    const p = prefOf(state.area);
    $("sg-pref").value = p || "00";
    $("sg-muni").innerHTML = p ? `<option value="">（${esc(N.prefs[p])}全体）</option>` + MUNI_BY_PREF[p].map((c) => `<option value="${c}">${esc(N.munis[c][1])}</option>`).join("") : '<option value="">（都道府県を選ぶと選べます）</option>';
    $("sg-muni").disabled = !p;
    $("sg-muni").value = isMuni(state.area) ? state.area : "";
    const natOnly = regions().every((c) => c === "00");
    $("sg-s").innerHTML = TREND_CATS.map((k) => `<option value="${k}"${k === "pos" && !natOnly ? " disabled" : ""}>${esc(CATS[k].label)}${k === "pos" && !natOnly ? "（地域では選べません）" : ""}</option>`).join("");
    $("sg-s").value = state.s;
    $("sg-r").value = state.r;
    $("sg-cur2").hidden = !state.area2;
    $("sg-cur2").innerHTML = state.area2 ? `比べる地域：<b>${esc(areaName(state.area2))}</b> <button type="button" class="btn-x">外す</button>` : "";
    pressed("nj-v", "v", state.v);
    pressed("nj-top", "top", String(state.top));
    renderKpi();
    renderTrend();
    renderBreakdown();
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => history.replaceState(null, "", location.pathname + query() + location.hash), 200);
  }

  function pressed(id, key, v) { $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[key] === v))); }

  // まとめ（3点）：対象の人数／前回の調査からの主な変化／読むときの注意。数字はデータから作り、理由や地域の良し悪しは書かない
  const prevSurvey = (y, c) => YEARS.filter((x) => x < y && val(x, c, "juki") != null).pop() || null;
  // まとめで使う数にかかわる、県集計の差（その年はすべての区分、前回の年は③⑤だけ）
  const summaryKnown = (y, c) => { const p = prevSurvey(y, c); return knownFor([y], [c], null).concat(p ? knownFor([p], [c], ["c3", "c5"]) : []); };
  function summary(y, c) {
    const juki = val(y, c, "juki"), tot = val(y, c, "tot"), nm = areaName(c);
    if (juki == null) return [];
    const out = [`${nm}の住民票上の学齢相当（小・中学校の年齢）の外国籍の子どもは、${y}年に${fmt(juki)}人です${juki && tot !== juki ? `（教育委員会が答えた①〜⑥の計は${fmt(tot)}人）` : ""}。`];
    const p = prevSurvey(y, c);
    const end = (d) => (d > 0 ? `${fmt(d)}人増えました。` : d < 0 ? `${fmt(-d)}人減りました。` : "変わりませんでした。");
    const mid = (d) => (d > 0 ? `${fmt(d)}人増えた` : d < 0 ? `${fmt(-d)}人減った` : "変わらなかった");
    if (p) {
      const dv = (k) => { const a = val(p, c, k), b = val(y, c, k); return a == null || b == null ? null : b - a; };
      let s = `前回の調査（${p}年）と比べると、住民票上の人数は${end(dv("juki"))}`;
      const d3 = dv("c3"), d5 = dv("c5");
      const w3 = "③不就学と報告された人数", w5 = "⑤就学状況を確認できなかった人数";
      if (d3 === 0 && d5 === 0) s += `${w3}と${w5}は、どちらも変わりませんでした。`;
      else if (d3 != null && d5 != null) s += Math.sign(d3) * Math.sign(d5) < 0 ? `${w3}は${mid(d3)}一方、${w5}は${end(d5)}` : `${w3}は${end(d3)}${w5}は${end(d5)}`;
      else if (d3 != null || d5 != null) s += `${d3 != null ? `${w3}は${end(d3)}` : `${w5}は${end(d5)}`}${d3 == null ? "③" : "⑤"}は比較できません（空欄の年があるため）。`;
      else s += "③・⑤は比較できません（空欄の年があるため）。";
      if (c === "00" && dv("pos") != null) s += `国の「不就学の可能性」（③＋⑤＋⑦）は${fmt(val(y, c, "pos"))}人で、${end(dv("pos"))}`;
      out.push(s);
    } else out.push("前回の調査の数がないため、変化は比較できません。");
    const notes = [];
    if (juki > 0) notes.push("⑤は不就学と確定した人数ではありません。増減の理由や地域の取り組みの良し悪しは、この統計だけでは判断できません。");
    if (tot > 0 && tot < 30) notes.push("人数が少ないため、割合や増減は数人のちがいで大きく変わります。");
    if (p === 2019) notes.push("2019年は⑦が大きく、把握状況がちがうため、比べるときは注意が必要です。");
    [p, y].filter(Boolean).forEach((yr) => { const t = blankNote(yr, c, ["c3", "c5"]); if (t) notes.push(t); });
    const kn = summaryKnown(y, c);
    if (kn.length) notes.push(`${knownYears(kn)}年度の${nm}は、e-Stat原表の県集計ではなく市区町村の合計を使っています（下の注記）。`);
    if (notes.length) out.push(notes.join(""));
    return out;
  }

  function renderKpi() {
    const c = state.area, y = LATEST;
    const juki = val(y, c, "juki"), tot = val(y, c, "tot");
    $("nj-area-title").textContent = `${areaName(c)}のデータ`;
    $("nj-reset").hidden = c === "00";
    $("nj-kpi-when").innerHTML = `<span class="nj-badge">${y}年・最新</span> ${esc(Y(y).fy)}${Y(y).as_of ? "・" + asOf(y) : ""}・住民票をもとにした数`;
    const tile = (k, v, sub, cls) => `<li${cls ? ` class="${cls}"` : ""}><span>${k ? `<i class="nj-sw" style="background:${CATS[k].color}"></i>` : ""}${esc(k ? CATS[k].short : "住民票上の人数")}</span><b>${v == null ? "—" : fmt(v)}<small>人</small></b>${sub ? `<small>${sub}</small>` : ""}</li>`;
    $("nj-kpis").innerHTML = tile(null, juki, "小・中学校の年齢", "nj-kpi-all") + PARTS.map((k) => { const v = val(y, c, k); return tile(k, v, v == null ? noneWhy(y, c, k) : tot > 0 ? `計の${pctText(v, tot)}` : "割合 —"); }).join("");
    $("sg-basis").textContent = tot > 0 ? `「計の○％」は、①〜⑥の計（教育委員会が答えた人数 ${fmt(tot)}人）に対する割合です。住民票上の人数に対する割合ではありません。` : "①〜⑥の計が0人のため、割合は出していません。";
    const segs = PARTS.map((k) => { const v = val(y, c, k) || 0; return v ? `<span class="nj-seg" style="width:${((v / tot) * 100).toFixed(3)}%;background:${CATS[k].color}"></span>` : ""; }).join("");
    const label = PARTS.map((k) => `${CATS[k].short} ${pctText(val(y, c, k), tot)}`).join("、");
    $("sg-comp").innerHTML = tot
      ? `<p class="sg-comp-h">①〜⑥の割合（計 ${fmt(tot)}人を100％として）</p><div class="nj-track sg-ctrack" role="img" aria-label="${esc(label)}">${segs}</div><div class="nj-legend">${PARTS.map((k) => `<span class="nj-lg"><i class="nj-sw" style="background:${CATS[k].color}"></i>${esc(CATS[k].short)} ${pctText(val(y, c, k), tot)}</span>`).join("")}</div>`
      : "";
    const pts = summary(y, c);
    $("sg-say").innerHTML = pts.length ? `<ul class="sg-points">${pts.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "";
    $("sg-say").hidden = !pts.length;
    const d7 = val(y, c, "c7");
    $("nj-kpi-note").textContent = d7 == null ? "" : `⑦住民票上の人数と①〜⑥の計の差：${fmt(d7)}人${d7 < 0 ? "（①〜⑥の計のほうが多い）" : ""}。⑦は差し引きの数で、割合の計算には入れていません。`;
    $("sg-kpi-known").innerHTML = knownHtml(summaryKnown(y, c));
    renderSchools();
    // X：人数だけ（割合は入れない）
    setX("kpi", `外国籍の子どもの就学状況｜${areaName(c)}・${y}年\n住民票上の人数（小・中学校の年齢）${juki == null ? "—" : fmt(juki) + "人"}\n${countLines(y, c).join("\n")}\n${SITE_NAME}`, pageUrl("area"));
  }

  // 地域のデータ（最新の年）の画像。注意書きは、この画像に出る数に関係するものだけ
  function kpiSpec() {
    const c = state.area, y = LATEST, tot = val(y, c, "tot"), juki = val(y, c, "juki"), d7 = val(y, c, "c7");
    const num = (v) => (v == null ? { value: "—", unit: "" } : { value: fmt(v), unit: "人" });
    const tiles = [Object.assign({ label: "住民票上の人数（小・中学校の年齢）", sub: "", main: true }, num(juki))].concat(PARTS.map((k) => {
      const v = val(y, c, k);
      return Object.assign({ label: CATS[k].short, color: CATS[k].color, sub: v == null ? noneWhy(y, c, k) : tot > 0 ? `計の${pctText(v, tot)}` : "" }, num(v));
    }));
    const facts = tot === 0 ? ["①〜⑥の計が0人のため、割合は出していません。"] : [];
    if (d7 != null) facts.push(`⑦住民票上の人数と①〜⑥の計の差：${d7 < 0 ? `−${fmt(-d7)}人（①〜⑥の計のほうが多い）` : fmt(d7) + "人"}`);
    if (c === "00") facts.push(`不就学の可能性（国の数え方：③＋⑤＋⑦）：${fmt(val(y, c, "pos"))}人`);
    const foot = [srcLine([y]), FOOT_SCOPE];
    if (val(y, c, "c5") > 0) foot.push(NOTE5);
    if (c === "00") foot.push(NOTEPOS);
    const bl = blankNote(y, c, PARTS);
    if (bl) foot.push(bl);
    const kn = knownShort(knownFor([y], [c], null));
    if (kn) foot.push(kn);
    if (tot > 0 && tot < 30) foot.push("人数が少ないため、割合は1人のちがいで大きく変わります。");
    // 参考：地域にある学校の数（学校基本調査。人数とは別の調査で、子どもが通う学校の数ではない）
    const sch = schoolInfo(c);
    const extra = sch ? {
      caption: `参考：${areaName(c)}にある学校の数（${sch.y}年）`,
      tiles: ["小学校", "中学校", "義務教育学校（小・中一貫）"].map((label, i) => ({ label, value: fmt(sch.now[i]), unit: "校", sub: `${sch.y0}年から${schoolMove(sch.now[i], sch.old[i])}` })),
    } : null;
    if (sch) foot.push(`学校の数：文部科学省「学校基本調査」（${sch.y0}・${sch.y}年度。e-Statの市町村別学校数）。国立・公立・私立の計で、学校がある市区町村で数えた数。人数とは別の調査です。${sch.short.join("")}`);
    return {
      extra,
      kind: "tiles", siteName: SITE_NAME, siteUrl: document.body.dataset.site,
      title: "外国籍の子どもの就学状況",
      subtitle: [`${areaName(c)}・${yLabel(y)}${asOf(y)}`],
      legend: [],
      tiles,
      bar: tot > 0 ? { caption: `割合は①〜⑥の計（${fmt(tot)}人）に対するもの（国の構成比と同じ）`, segs: PARTS.map((k) => ({ n: val(y, c, k) || 0, color: CATS[k].color, label: pctText(val(y, c, k), tot) })) } : null,
      facts,
      foot,
      file: `shugaku_area_${c}_${y}_${dateStamp()}.png`,
      label: "",
    };
  }

  // ---- A 人数の推移 ----
  const lineName = (c) => `${areaName(c)}・${CATS[state.s].short}`;

  function renderTrend() {
    const k = state.s, regs = regions(), ys = availYears(k);
    const msg = [];
    if (regs.some((c) => c !== "00") && YEARS[0] < FIRST_MUNI) msg.push(`都道府県・市区町村の数は${FIRST_MUNI}年からです（${YEARS.filter((y) => y < FIRST_MUNI).join("・")}年は全国の数だけ）。`);
    if (k === "c6") msg.push("⑥その他は2023年からの区分です。それより前は区分がありません（0人ではありません）。");
    if (k === "pos") msg.push("国の発表の数え方（③不就学＋⑤就学状況を確認できず＋⑦住民票上の人数との差）で、全国だけの数です。不就学と確定した人数ではありません。");
    $("nj-trend-msg").hidden = !msg.length;
    $("nj-trend-msg").textContent = msg.join("");
    $("nj-trend-legend").innerHTML = regs.map((c, i) => `<span class="nj-lg"><svg width="34" height="14" aria-hidden="true"><line x1="2" y1="7" x2="32" y2="7" stroke="${CATS[k].color}" stroke-width="2.5"${i ? ' stroke-dasharray="6 4"' : ""}/>${i ? `<rect x="13" y="3" width="8" height="8" fill="${CATS[k].color}"/>` : `<circle cx="17" cy="7" r="4" fill="${CATS[k].color}"/>`}</svg>${esc(lineName(c))}</span>`).join("") + '<span class="nj-unit">単位：人</span>';
    const opt = (list, sel) => list.map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${yLabel(y)}</option>`).join("");
    $("nj-a").innerHTML = opt(ys.filter((y) => y < state.b), state.a);
    $("nj-b").innerHTML = opt(ys.slice(1), state.b);
    const qb = (y, label) => `<button type="button" class="btn-x" data-a="${y || ""}"${y ? "" : " disabled"} aria-pressed="${y === state.a}">${label}${y ? `（${y}年）` : "（該当なし）"}</button>`;
    const prev = prevOf(state.b, ys), first = ys[0] < state.b ? ys[0] : null;
    $("nj-quick").innerHTML = `<span class="fine">${state.b || ""}年から数えて</span>` + qb(prev, "前回の調査") + (first && first !== prev ? qb(first, "最も古い年") : "");
    renderCompare(regs);
    // 読み取り文（推移の山だけ。比較の数はグラフに書いてあるので繰り返さない）。同じ人数の年は同率として全部書く。空欄の年があれば、確かめられる年の範囲を書く
    const sayOne = (c) => {
      const yv = YEARS.filter((y) => val(y, c, k) != null);
      if (!yv.length) return "";
      const blanks = YEARS.filter((y) => val(y, c, k) == null && val(y, c, "juki") != null && noneWhy(y, c, k) === "空欄（回答なし）");
      const span = yv.length > 1 ? `${yv[0]}〜${yv[yv.length - 1]}年` : `${yv[0]}年`;
      const who = regs.length > 1 ? `${areaName(c)}は、` : "";
      const mx = Math.max(...yv.map((y) => val(y, c, k)));
      if (mx === 0) return blanks.length ? `${who}数値を確認できる調査年（${yv.join("・")}年）では、すべて0人です（${blanks.join("・")}年は空欄）。` : `${who}掲載されているすべての調査年（${span}）で0人です。`;
      const tops = yv.filter((y) => val(y, c, k) === mx);
      const where = blanks.length ? `数値を確認できる調査年（${yv.join("・")}年。${blanks.join("・")}年は空欄）では` : `掲載されている調査年（${span}）では`;
      return `${who}${where}、${tops.length > 1 ? `${tops.join("・")}年が同数で最も多く、いずれも${fmt(mx)}人です。` : `${tops[0]}年が最も多く、${fmt(mx)}人です。`}`;
    };
    const say = regs.map(sayOne).join("");
    $("nj-trend-say").textContent = say;
    $("nj-trend-say").hidden = !say;
    const tn = ["点は各年度の調査の人数です。"];
    if (ys.includes(2019) && ys.includes(2021)) tn.push("2020年度は調査がありません（2019年と2021年を線でつないでいます）。");
    if (k === "c5") tn.push(NOTE5);
    if (regs.includes("00") && val(2019, "00", k) != null) tn.push(NOTE2019);
    regs.forEach((c) => YEARS.forEach((y) => { const t = blankNote(y, c, k === "pos" ? ["c3", "c5"] : [k]); if (t) tn.push(t); }));
    $("nj-trend-note").textContent = tn.join("");
    $("sg-trend-known").innerHTML = knownHtml(knownFor(YEARS, regs, [k]));
    // 表：地域ごとに、すべての区分を年ごとに並べる
    const td = (y, c, kk) => { const v = val(y, c, kk); return `<td class="num">${v == null ? "—" : fmt(v) + "人"}</td>`; };
    $("nj-trend-table").innerHTML = regs.map((c) => {
      const cols = ["juki"].concat(PARTS, ["tot", "c7"], c === "00" ? ["pos"] : []);
      const name = (kk) => (kk === "tot" ? "①〜⑥の計" : kk === "c7" ? "⑦住民票との差" : kk === "pos" ? "不就学の可能性（③＋⑤＋⑦）" : CATS[kk].short);
      const rows = YEARS.slice().reverse().filter((y) => val(y, c, "juki") != null).map((y) => `<tr><th scope="row">${yLabel(y)}</th>${cols.map((kk) => td(y, c, kk)).join("")}</tr>`).join("");
      return `<p class="nj-tt"><b>${esc(areaName(c))}</b></p><table class="plain"><thead><tr><th scope="col">調査年</th>${cols.map((kk) => `<th scope="col" class="num">${esc(name(kk))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
    }).join("") + '<p class="fine">—：区分がない年（⑥は2023年から）、または空欄（回答なし）。0人ではありません。⑦がマイナスのときは、①〜⑥の計のほうが住民票上の人数より多いことを表します。</p>';
    drawTrend();
    const xn = [k === "c5" ? "※⑤は不就学と確定した人数ではありません" : "", k === "pos" ? "※③＋⑤＋⑦の国の指標で、確定した不就学人数ではありません" : "", state.a === 2019 ? "※2019年度は⑦が大きく、把握状況が異なります" : ""].filter(Boolean);
    const text = `外国籍の子どもの就学状況（文部科学省の調査）｜${regs.map(areaName).join("・")}の${CATS[k].short}の推移\n${(state.cmpLines || []).concat(xn).join("\n")}\n${SITE_NAME}`;
    setX("trend", text, pageUrl("trend"));
  }

  // ---- 2つの年の比較：地域ごとに2本の横棒（0から。全部の棒で同じ尺度）。過去の年は薄い色＋同じ色の枠 ----
  const val0 = (v) => (v == null ? "データなし" : fmt(v) + "人");
  function renderCompare(regs) {
    const a = state.a, b = state.b, k = state.s, col = CATS[k].color, areas = esc(regs.map(areaName).join("・"));
    state.cmpLines = [];
    $("nj-cmp-title").textContent = k === "juki" ? "住民票上の人数はどう変わった？" : `${CATS[k].short}の人数はどう変わった？`;
    if (!a || !b) {
      $("nj-cmp-sub").innerHTML = `<b>${areas}</b>｜${esc(CATS[k].label)}`;
      $("nj-result").innerHTML = '<p class="cmp-msg">今の地域と区分では、比べられる2つの年がありません。</p>';
      return;
    }
    $("nj-cmp-sub").innerHTML = `<b>${areas}</b>｜${a}年 → ${b}年・${esc(CATS[k].label)}`;
    const cells = regs.map((c) => ({ c, va: val(a, c, k), vb: val(b, c, k) }));
    const max = Math.max(1, ...cells.flatMap((x) => [x.va || 0, x.vb || 0]));
    const bar = (y, v, past) => `<li><span class="nj-cy">${y}年</span><span class="nj-ctrack">${v ? `<span class="nj-cbar" style="width:calc((100% - 5.5em) * ${(v / max).toFixed(4)});background:${past ? shade(col) : col};border-color:${col}"></span>` : ""}<span class="nj-cv${v == null ? " na" : ""}">${val0(v)}</span></span></li>`;
    let html = cells.map((x) => {
      const t = changeText(x.va, x.vb);
      state.cmpLines.push(`${lineName(x.c)}：${a}年 ${val0(x.va)}→${b}年 ${val0(x.vb)}${t.na ? "" : t.zero ? `（${t.diff}）` : `（${t.ratio}・${t.diff}）`}`);
      const stat = t.na
        ? `<p class="nj-cratio nj-na"><small>人数の倍率・増減率</small><b>データなし</b><small>${x.va == null ? a : b}年の数がありません</small></p>`
        : (t.zero
          ? `<p class="nj-cratio nj-na"><small>人数の倍率・増減率</small><b>算出できません</b><small>${a}年が0人のため</small></p>`
          : `<p class="nj-cratio"><small>人数の倍率</small><b>${t.ratio}</b></p>`)
          + `<dl class="nj-cmore"><div><dt>人数の変化</dt><dd>${t.diff}</dd></div>${t.zero ? "" : `<div><dt>増減率</dt><dd>${t.pct}</dd></div>`}</dl>`;
      return `<div class="nj-cg">${regs.length > 1 ? `<p class="nj-cg-h">${esc(areaName(x.c))}</p>` : ""}<div class="nj-cp"><h4><i class="nj-sw" style="background:${col}"></i>${esc(CATS[k].short)}</h4>
        <div class="nj-cp-body"><ul class="nj-cbars">${bar(a, x.va, true)}${bar(b, x.vb, false)}</ul><div class="nj-cstat">${stat}</div></div></div></div>`;
    }).join("");
    const notes = [];
    if (a === 2019) notes.push(NOTE2019);
    const kn = knownFor([a, b], regs, [k]);
    if (kn.length) notes.push(`${knownYears(kn)}年度の${[...new Set(kn.map((x) => N.prefs[x.pref]))].join("・")}は市区町村の合計で比べています（上の注記）。`);
    if (cells.some((x) => x.va != null && x.vb != null && Math.max(x.va, x.vb) < 30)) notes.push("人数が少ないため、倍率や増減率は数人のちがいで大きく変わります。");
    const bl = [...new Set(regs.flatMap((c) => blankIn(a, c, k).concat(blankIn(b, c, k))))];
    if (bl.length) notes.push(`${bl.join("・")}の空欄（回答なし）の分は入っていません。`);
    if (notes.length) html += `<p class="fine nj-cnote">※${notes.join("")}</p>`;
    $("nj-result").innerHTML = html;
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
    for (let t = 0; t <= max + 1e-9; t += Math.max(1, step)) out.push(Math.round(t));
    return out;
  }

  function trendModel() {
    const k = state.s;
    const series = regions().map((c, i) => ({ code: c, name: lineName(c), dash: i > 0, marker: i ? "square" : "circle", color: CATS[k].color, points: YEARS.map((y) => ({ x: y, v: val(y, c, k), big: y === state.a || y === state.b })) }));
    const all = series.flatMap((s) => s.points.map((p) => p.v).filter((v) => v != null));
    const yMax = niceMax(all.length ? Math.max(...all) : 0);
    const xs = YEARS.filter((y) => series.some((s) => val(y, s.code, k) != null));
    const x0 = (xs[0] || YEARS[0]) - 0.6, x1 = (xs[xs.length - 1] || LATEST) + 0.6;
    return { series, yMax, yTicks: ticks(yMax), x0, x1, xTicks: xs, breakAt: null, noData: null, noDataText: "" };
  }

  function drawTrend() {
    const box = $("nj-trend-chart");
    if (!box || !N) return;
    const M = trendModel(), k = state.s;
    const W = Math.max(280, box.clientWidth), narrow = W < 520;
    const H = narrow ? 250 : 300;
    const m = { l: narrow ? 50 : 62, r: 12, t: 16, b: 28 };
    const X = (y) => m.l + ((y - M.x0) / (M.x1 - M.x0)) * (W - m.l - m.r);
    const Yp = (v) => H - m.b - (v / M.yMax) * (H - m.t - m.b);
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(M.series.map((x) => x.name).join("と"))}の推移の折れ線グラフ。数値は下の表で確かめられます。">`;
    M.yTicks.forEach((t) => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Yp(t)}" y2="${Yp(t)}" stroke="${t ? "#EFE4C6" : "#D5BA79"}" stroke-width="1"/><text x="${m.l - 6}" y="${Yp(t) + 4}" text-anchor="end" class="nj-ax">${t >= 10000 && narrow ? (t / 10000) + "万" : fmt(t)}</text>`; });
    M.xTicks.forEach((t) => { s += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle" class="nj-ax">${t}${narrow ? "" : "年"}</text>`; });
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
    if (!M.xTicks.length) return;
    const show = (ev) => {
      const rect = box.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const y = M.xTicks.reduce((b, t) => (Math.abs(X(t) - px) < Math.abs(X(b) - px) ? t : b), M.xTicks[0]);
      cross.setAttribute("x1", X(y)); cross.setAttribute("x2", X(y)); cross.setAttribute("opacity", ".35");
      tip.innerHTML = `<b>${y}年</b>（${esc(Y(y).fy)}${Y(y).as_of ? "・" + asOf(y) : ""}）` + M.series.map((se) => { const v = val(y, se.code, k); return `<br>${esc(se.name)}：${v == null ? esc(noneWhy(y, se.code, k)) : fmt(v) + "人"}`; }).join("");
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(W - tw, X(y) - tw / 2)) + "px";
      tip.style.top = "0px";
    };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { tip.hidden = true; cross.setAttribute("opacity", "0"); } });
  }

  // ---- B 内訳と地域の順位 ----
  // 内訳＝今の地域で数のある年。順位＝都道府県・市区町村の数のある年（並べる区分の数がある年）
  function bdYears() {
    if (state.v === "rank") { const sc = rankScope(); return YEARS.filter((y) => y >= FIRST_MUNI && val(y, sc.parent, state.r) != null); }
    return YEARS.filter((y) => val(y, state.area, "juki") != null);
  }
  function rankScope() {
    if (state.area === "00") return { kind: "pref", codes: PREF_CODES, label: "都道府県別", unit: "都道府県", parent: "00" };
    const p = prefOf(state.area);
    return { kind: "muni", codes: MUNI_BY_PREF[p], label: `${N.prefs[p]}の市区町村別`, unit: "市区町村", parent: p };
  }

  function bdData() {
    const c = state.area, msgs = [], notes = [];
    if (state.v === "rank") {
      const sc = rankScope(), y = state.y, k = state.r;
      const all = sc.codes.map((cc) => ({ c: cc, name: shortName(cc), v: val(y, cc, k), juki: val(y, cc, "juki"), tot: val(y, cc, "tot") }));
      all.sort((a, b) => (b.v == null ? -1 : b.v) - (a.v == null ? -1 : a.v) || (a.c < b.c ? -1 : 1));
      all.forEach((r, i) => { r.rank = i && r.v === all[i - 1].v ? all[i - 1].rank : i + 1; });
      const pos = all.filter((r) => r.v > 0), zeros = all.filter((r) => r.v === 0).length, nulls = all.filter((r) => r.v == null);
      const rows = state.top ? pos.slice(0, state.top) : pos;
      const sel = isMuni(c) ? all.find((r) => r.c === c) : null;
      const extra = sel && !rows.includes(sel) ? sel : null;
      if (nulls.length) msgs.push(`${nulls.map((r) => r.name).join("・")}は空欄（回答なし）のため並べていません。`);
      // 表示件数の境目で同じ人数の地域が切れるとき
      if (state.top && pos.length > state.top && pos[state.top].v === pos[state.top - 1].v) notes.push(`${pos[state.top - 1].rank}位と同じ人数の${sc.unit}が、グラフに載せた分のほかにもあります（すべて表に載せています）。`);
      if (zeros) notes.push(`0人の${sc.unit}が${zeros}件あります（グラフでは省略し、表に載せています）。`);
      const bnotes = sc.kind === "pref" ? PREF_CODES.map((p) => blankNote(y, p, [k])).filter(Boolean) : [];
      notes.push(...bnotes);
      // 上位3件の占める割合：3位と同じ人数の地域が4位以下にもあるとき（同順位の一部だけを選ぶことになる）は出さない
      const parentV = val(y, sc.parent, k), n = 3;
      let share = "";
      if (parentV > 0 && pos.length > n && pos[n].v !== pos[n - 1].v) {
        const sum = pos.slice(0, n).reduce((a, r) => a + r.v, 0);
        share = `上位${n}${sc.unit}（${pos.slice(0, n).map((r) => r.name).join("・")}）の合計${fmt(sum)}人は、${sc.kind === "pref" ? "全国" : N.prefs[sc.parent]}の${CATS[k].short}${fmt(parentV)}人の${pctText(sum, parentV)}です。`;
      }
      const known = sc.kind === "pref" ? knownFor([y], PREF_CODES, [k]) : share ? knownFor([y], [sc.parent], [k]) : [];
      return { kind: "rank", sc, y, k, rows, all, extra, zeros, msgs, notes, bnotes, known, share, title: `${sc.kind === "pref" ? "全国" : N.prefs[sc.parent]}｜${sc.unit}別 ${RANK_WHAT[k]}`, head: `${sc.label}・${CATS[k].label}が多い順（${yLabel(y)}）` };
    }
    const two = state.mode === "two";
    if (two) {
      const ya = state.ya, yb = state.yb;
      const rows = PARTS.map((k) => {
        const a = val(ya, c, k), b = val(yb, c, k);
        const ok = a != null && b != null;
        return { k, name: CATS[k].short, a, b, status: ok ? "ok" : "skip", why: ok ? "" : `${a == null ? ya : yb}年は${noneWhy(a == null ? ya : yb, c, k)}`, ...(ok ? change(a, b) : {}) };
      });
      const okRows = rows.filter((r) => r.status === "ok");
      const ta = okRows.reduce((s, r) => s + r.a, 0), tb = okRows.reduce((s, r) => s + r.b, 0);
      const bl = [...new Set(PARTS.flatMap((k) => blankIn(ya, c, k).concat(blankIn(yb, c, k))))];
      if (bl.length) notes.push(`${bl.join("・")}の空欄（回答なし）の分は入っていません。`);
      return { kind: "bd", two: true, ya, yb, rows, ta, tb, partial: okRows.length < rows.length, msgs, notes, known: knownFor([ya, yb], [c], null), area: areaName(c), title: "外国籍の子どもの就学状況の内訳（2年の比較）", head: `${areaName(c)}・${ya}年→${yb}年の就学状況の内訳（①〜⑥）` };
    }
    const y = state.y, tot = val(y, c, "tot");
    const rows = PARTS.map((k) => { const v = val(y, c, k); return { k, name: CATS[k].label, short: CATS[k].short, v, none: v == null ? noneWhy(y, c, k) : "" }; });
    const bl = [...new Set(PARTS.flatMap((k) => blankIn(y, c, k)))];
    if (bl.length) notes.push(`${bl.join("・")}の②〜⑤は空欄（回答なし）で、この数に入っていません。`);
    return { kind: "bd", two: false, y, rows, tot, juki: val(y, c, "juki"), d7: val(y, c, "c7"), msgs, notes, known: knownFor([y], [c], null), area: areaName(c), title: "外国籍の子どもの就学状況の内訳", head: `${areaName(c)}・${yLabel(y)}の就学状況の内訳（①〜⑥の計 ${fmt(tot)}人）` };
  }

  function sayOf(D) {
    if (D.kind === "rank") {
      // 最多は表示件数ではなく、順位表の全件から決める（同じ人数は同率）
      const tops = D.all.filter((r) => r.rank === 1 && r.v > 0);
      if (!tops.length) return `${D.sc.label}で、${D.y}年に${CATS[D.k].short}が1人以上の${D.sc.unit}はありません。`;
      const s = tops.length > 5
        ? `${D.sc.label}で${CATS[D.k].short}が最も多いのは${fmt(tops[0].v)}人で、${tops.length}${D.sc.unit}が同率最多です（すべて表で確認できます）。`
        : `${D.sc.label}で${CATS[D.k].short}が最も多いのは${tops.map((r) => r.name).join("・")}（${tops.length > 1 ? "同率・" : ""}${fmt(tops[0].v)}人）です。`;
      return s + D.share;
    }
    if (D.two) {
      const ok = D.rows.filter((r) => r.status === "ok");
      if (!ok.length) return `${D.ya}年と${D.yb}年では、比較できる区分がありません。`;
      const moved = ok.filter((r) => r.d);
      if (!moved.length) return `${D.ya}年と${D.yb}年で、比較できる区分の人数は変わっていません。`;
      const mx = Math.max(...moved.map((r) => Math.abs(r.d))), bigs = moved.filter((r) => Math.abs(r.d) === mx);
      const one = (r) => `${r.name}（${fmt(r.a)}人→${fmt(r.b)}人、${moveWord(r.d)}）`;
      return `${D.ya}年から${D.yb}年にかけて、人数の変化がいちばん大きいのは${bigs.map(one).join("と")}です${bigs.length > 1 ? "（変化の大きさが同じ）" : ""}。`;
    }
    return D.y === LATEST ? "" : summary(D.y, state.area).join(""); // 最新の年は上の「地域のデータ」に同じ文があるので出さない
  }

  function renderBreakdown() {
    const rank = state.v === "rank", two = !rank && state.mode === "two";
    const bys = bdYears();
    const yopt = (sel, list) => list.slice().reverse().map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${yLabel(y)}</option>`).join("");
    $("nj-y").innerHTML = yopt(state.y, bys);
    $("nj-ya").innerHTML = yopt(state.ya, bys.filter((y) => y < state.yb));
    $("nj-yb").innerHTML = yopt(state.yb, bys.slice(1));
    $("nj-mode-wrap").hidden = rank;
    $("nj-y-wrap").hidden = two;
    $("nj-ya-wrap").hidden = !two;
    $("nj-yb-wrap").hidden = !two;
    $("nj-top-wrap").hidden = !rank;
    $("sg-r-wrap").hidden = !rank;
    pressed("nj-mode", "mode", two ? "two" : "one");
    const D = bdData();
    state.bd = D;
    $("nj-bd-head").textContent = D.head;
    $("nj-bd-msg").hidden = !D.msgs.length;
    $("nj-bd-msg").textContent = D.msgs.join("");
    if (rank) renderRank(D); else if (two) renderPair(D); else renderOne(D);
    $("nj-bd-say").textContent = sayOf(D);
    $("nj-bd-say").hidden = !$("nj-bd-say").textContent;
    $("sg-bd-known").innerHTML = knownHtml(D.known);
    const ys = rank || !two ? [D.y] : [D.ya, D.yb];
    $("nj-bd-note").innerHTML = D.notes.map(esc).join("") + ` 出典：${esc(SURVEY)} ${ys.map((y) => `<a href="${esc(Y(y).src.url)}" target="_blank" rel="noopener" title="${esc(Y(y).src.title)}">${esc(Y(y).fy)}</a>`).join("・")}${Y(ys[0]).nat_only ? "（国の結果資料）" : "（e-Stat の市区町村別データ）"}`;
    let text;
    if (rank) text = `${D.title}｜${D.y}年\n${D.rows.slice(0, 3).map((r) => `${r.rank}位 ${r.name} ${fmt(r.v)}人`).join("\n")}${D.k === "c5" ? "\n※⑤は不就学と確定した人数ではありません" : ""}\n${SITE_NAME}`;
    else if (two) text = `${D.title}｜${D.area}・${D.ya}年→${D.yb}年\n${D.rows.filter((r) => r.status === "ok").map((r) => `${r.name} ${fmt(r.a)}人→${fmt(r.b)}人`).slice(0, 4).join("\n")}\n${SITE_NAME}`;
    else text = `${D.title}｜${D.area}・${D.y}年\n住民票上の人数 ${fmt(D.juki)}人\n${countLines(D.y, state.area).join("\n")}\n${SITE_NAME}`; // 人数だけ（割合は入れない）
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
  const cell = (v) => `<td class="num">${v == null ? "—" : fmt(v) + "人"}</td>`;

  function renderOne(D) {
    $("nj-bd-legend").innerHTML = '<span class="nj-unit">単位：人・割合は①〜⑥の計に対するもの</span>';
    const max = Math.max(1, ...D.rows.map((r) => r.v || 0));
    const detail = (r) => (r.none ? r.none : `${fmt(r.v)}人（①〜⑥の計の${pctText(r.v, D.tot)}）`);
    $("nj-bars").innerHTML = '<ol class="nj-rows">' + D.rows.map((r, i) => `<li class="nj-row" tabindex="0" data-i="${i}" aria-label="${esc(r.name)}：${esc(detail(r))}">
        <span class="nj-name">${esc(r.short)}</span><span class="nj-track">${r.v ? `<span class="nj-seg" style="width:${(r.v / max) * 100}%;background:${CATS[r.k].color}"></span>` : ""}</span><span class="nj-v">${r.none ? "—" : `${fmt(r.v)}人<small class="sg-pct">${pctText(r.v, D.tot)}</small>`}</span></li>`).join("") + '</ol><div class="nj-tip" id="nj-btip" hidden></div>';
    bindTips(D.rows, detail);
    $("nj-bd-table").innerHTML = `<table class="plain"><thead><tr><th scope="col">区分</th><th scope="col" class="num">人数</th><th scope="col" class="num">割合</th></tr></thead><tbody>${D.rows.map((r) => `<tr><th scope="row">${esc(r.name)}</th>${cell(r.v)}<td class="num">${r.v == null ? "—" : pctText(r.v, D.tot)}</td></tr>`).join("")}<tr class="on"><th scope="row">①〜⑥の計</th>${cell(D.tot)}<td class="num">${D.tot > 0 ? "100.0％" : "—"}</td></tr><tr><th scope="row">住民票上の人数（学齢相当）</th>${cell(D.juki)}<td class="num">—</td></tr><tr><th scope="row">⑦住民票上の人数との差（参考）</th>${cell(D.d7)}<td class="num">—</td></tr></tbody></table><p class="fine">割合は①〜⑥の計に対するもので、小数第2位を四捨五入しているため、足して100％にならないことがあります。—：区分がない年、または空欄（回答なし）。</p>`;
  }

  function renderPair(D) {
    $("nj-bd-legend").innerHTML = `<span class="nj-lg"><i class="nj-sw" style="background:${PAIR.a}"></i>${D.ya}年（過去）</span><span class="nj-lg"><i class="nj-sw" style="background:${PAIR.b}"></i>${D.yb}年（新しい年）</span><span class="nj-unit">単位：人</span>`;
    const max = Math.max(1, ...D.rows.flatMap((r) => [r.a || 0, r.b || 0]));
    const bar = (v, c) => (v ? `<span class="nj-bar" style="width:${(v / max) * 100}%;background:${c}"></span>` : '<span class="nj-bar"></span>');
    const num = (v) => (v != null ? fmt(v) : "—");
    const diffText = (r) => { if (r.status !== "ok") return r.why; const t = changeText(r.a, r.b); return `${t.diff}（${t.zero ? "過去の年が0人のため増減率は算出できません" : `増減率 ${t.pct}`}）`; };
    const detail = (r) => `${D.ya}年 ${num(r.a)}・${D.yb}年 ${num(r.b)}／${diffText(r)}`;
    $("nj-bars").innerHTML = '<ol class="nj-rows">' + D.rows.map((r, i) => `<li class="nj-row nj-pair${r.status === "ok" ? "" : " nj-skip"}" tabindex="0" data-i="${i}" aria-label="${esc(r.name)}：${esc(detail(r))}">
        <span class="nj-name">${esc(r.name)}${r.status === "ok" ? "" : "<small>比べません</small>"}</span><span class="nj-track2">${bar(r.a, PAIR.a)}${bar(r.b, PAIR.b)}</span><span class="nj-v2"><span>${esc(num(r.a))}</span><b>${esc(num(r.b))}</b></span></li>`).join("") + '</ol><div class="nj-tip" id="nj-btip" hidden></div>';
    bindTips(D.rows, detail);
    const pct = (r) => (r.status !== "ok" ? "—" : r.pct === null ? "算出できません（過去の年が0人）" : changeText(r.a, r.b).pct);
    const dif = (r) => (r.status !== "ok" ? "比べません" : moveWord(r.d));
    const tot = { name: D.partial ? "比べられる区分の合計" : "①〜⑥の計", a: D.ta, b: D.tb, status: "ok", ...change(D.ta, D.tb) };
    const body = D.rows.concat([tot]).map((r) => `<tr${r === tot ? ' class="on"' : ""}><th scope="row">${esc(r.name)}</th>${cell(r.a)}${cell(r.b)}<td class="num">${dif(r)}</td><td class="num">${pct(r)}</td></tr>`).join("");
    const whys = [...new Set(D.rows.filter((r) => r.status !== "ok").map((r) => r.why))];
    $("nj-bd-table").innerHTML = `<table class="plain"><thead><tr><th scope="col">区分</th><th scope="col" class="num">${D.ya}年</th><th scope="col" class="num">${D.yb}年</th><th scope="col" class="num">人数の変化</th><th scope="col" class="num">増減率</th></tr></thead><tbody>${body}</tbody></table>`
      + `<p class="fine">${whys.map((w) => esc(w) + "のため比べません。").join("")}過去の年が0人の区分は、増減率を算出できません。</p>`;
  }

  function renderRank(D) {
    $("nj-bd-legend").innerHTML = `<span class="nj-lg"><i class="nj-sw" style="background:${CATS[D.k].color}"></i>${esc(CATS[D.k].short)}</span><span class="nj-unit">単位：人</span>`;
    const rows = D.rows.concat(D.extra ? [D.extra] : []);
    const max = Math.max(1, ...rows.map((r) => r.v || 0));
    const detail = (r) => (r.v == null ? "空欄（回答なし）" : `${fmt(r.v)}人${D.k === "juki" ? "" : `（その地域の①〜⑥の計の${pctText(r.v, r.tot)}）`}・住民票上の人数 ${fmt(r.juki)}人`);
    $("nj-bars").innerHTML = rows.length ? '<ol class="nj-rows nj-ranked">' + rows.map((r, i) => {
      const sel = r.c === state.area ? " nj-sel" : "";
      return `${D.extra && r === D.extra ? '<li class="nj-gap" aria-hidden="true">…</li>' : ""}<li class="nj-row${sel}" tabindex="0" data-i="${i}" aria-label="${r.rank}位 ${esc(r.name)}：${esc(detail(r))}">
        <span class="nj-name"><span class="nj-rank">${r.rank}</span><button type="button" class="nj-plink" data-c="${r.c}" title="このページで${esc(areaName(r.c))}のデータを表示">${esc(r.name)}</button></span><span class="nj-track">${r.v ? `<span class="nj-seg" style="width:${(r.v / max) * 100}%;background:${CATS[D.k].color}"></span>` : ""}</span><span class="nj-v">${r.v == null ? "—" : fmt(r.v) + "人"}</span></li>`;
    }).join("") + '</ol><div class="nj-tip" id="nj-btip" hidden></div><p class="nj-hint">地域の名前を押すと、このページでその地域のデータを表示します。</p>' : "";
    if (rows.length) bindTips(rows, detail);
    const cols = ["juki"].concat(PARTS, ["tot"]);
    const name = (k) => (k === "tot" ? "①〜⑥の計" : CATS[k].short);
    const body = D.all.map((r) => `<tr${r.c === state.area ? ' class="on"' : ""}><td class="num">${r.v == null ? "—" : r.rank}</td><th scope="row">${esc(r.name)}</th>${cols.map((k) => cell(val(D.y, r.c, k))).join("")}</tr>`).join("");
    $("nj-bd-table").innerHTML = `<table class="plain"><thead><tr><th scope="col" class="num">順位</th><th scope="col">${D.sc.unit}</th>${cols.map((k) => `<th scope="col" class="num">${esc(name(k))}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`
      + `<p class="fine">全${D.all.length}件を${esc(CATS[D.k].short)}が多い順に並べています（同じ人数は同じ順位）。—：区分がない年、または空欄（回答なし）。</p>`;
  }

  function setX(k, text, url) {
    const a = $("nj-x-" + k);
    a.href = "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
    a.dataset.text = text + "\n" + url;
  }

  function sourceTable() {
    const rows = YEARS.slice().reverse().map((y) => {
      const o = Y(y), s = o.src;
      return `<tr><th scope="row">${yLabel(y)}</th><td>${o.as_of ? jpDate(o.as_of) : "—"}</td><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${s.updated ? `（e-Stat、${jpDate(s.updated)}更新）` : ""}</td></tr>`;
    }).join("");
    return `<table class="plain nj-src"><thead><tr><th scope="col">調査年</th><th scope="col">基準日</th><th scope="col">使った表</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="fine">出典：${esc(SURVEY)}（各年度、<a href="${esc(N.estat_url)}" target="_blank" rel="noopener">e-Stat</a>）。${esc(N.terms)}（${esc(N.checked)}）。数字は国の表のとおりです。計算しているのは、2021年度からの都道府県・全国（市区町村の和）と、⑦（住民票上の人数 − ①〜⑥の計）だけです。2019年度の全国は、国の結果資料の表の数です。区分の説明は<a href="${esc(N.mext.url)}" target="_blank" rel="noopener">${esc(N.mext.title)}</a>（${esc(jpDate(N.mext.date))}）によります。基準日の「—」は、国の資料で確かめられなかった年です。</p>
      ${knownHtml(N.known || [])}`;
  }

  // ---- 学校の数（学校基本調査の市町村別学校数。参考として出す。就学状況の人数とは別の調査） ----
  // 地域の学校の数（最新の年と最初の年）と注記。ページの欄と画像で同じものを使う。数がなければ null
  const schoolMove = (now, old) => { const d = now - old; return d ? `${fmt(Math.abs(d))}校${d > 0 ? "増" : "減"}` : "変わらず"; };
  function schoolInfo(c) {
    const row = G && ready ? G.v[c] : null;
    if (!row) return null;
    const ys = G.years.slice().sort((a, b) => a - b), y = ys[ys.length - 1], y0 = ys[0], now = row[String(y)], old = row[String(y0)];
    const notes = [], short = []; // short：画像の注記用の短い文
    if ((G.wards || []).includes(c)) { notes.push("政令指定都市なので、区ごとの数を足しています。"); short.push("政令指定都市は区の数の和。"); }
    Object.keys(G.outside || {}).forEach((p) => {
      const o = G.outside[p], v = o[String(y)] || [0, 0, 0], t = G.kinds.map((k, i) => (v[i] ? `${k}${fmt(v[i])}校` : "")).filter(Boolean).join("・");
      if (!t) return;
      const city = o.name.replace(/外$/, ""), inCity = isMuni(c) && c.slice(0, 2) === p && N.munis[c][1] === city;
      if (c === "00" || c === p) notes.push(`${c === "00" ? "全国と" : ""}${N.prefs[p]}の数には、e-Statの表で「${o.name}」とされている市立の学校（${t}）を含みます。どの市町村にあるかが表にないため、市町村の数には入れていません。`);
      if (c === "00" || c === p) short.push(`${c === "00" ? "全国・" : ""}${N.prefs[p]}の数には、所在地が表にない${city}立の学校（${t}）を含みます。`);
      else if (inCity) notes.push(`e-Statの表で「${o.name}」とされている市立の学校（${t}）は、どの市町村にあるかが表にないため、${city}の数に入れていません（${N.prefs[p]}の数には含みます）。`);
      if (inCity) short.push(`所在地が表にない市立の学校（${t}）は含みません。`);
    });
    return { ys, y, y0, now, old, notes, short };
  }

  function renderSchools() {
    const box = $("sg-sch"), c = state.area, S = schoolInfo(c);
    if (!S) { box.hidden = true; return; }
    const { ys, y, y0, now, old, notes } = S;
    const LABEL = ["小学校", "中学校", "義務教育学校<small>（小・中一貫）</small>"];
    const items = G.kinds.map((k, i) => `<li><span>${LABEL[i]}</span><b>${fmt(now[i])}<small>校</small></b><small>${y0}年の${fmt(old[i])}校から${schoolMove(now[i], old[i])}</small></li>`).join("");
    box.innerHTML = `<h3 class="sg-sch-h">${esc(areaName(c))}にある学校の数<small>（参考・${y}年）</small></h3><ul class="nj-kpis sg-sch-list">${items}</ul>
      <p class="fine">${esc(jpDate(G.y[y].as_of))}現在（${esc(G.y[y].fy)}）。文部科学省「学校基本調査」の市町村別の学校数で、国立・公立・私立の計（分校を含む）です。学校がある市区町村で数えています。${esc(notes.join(""))}上の外国籍の子どもの人数とは別の調査の数で、子どもが通っている学校の数ではありません。</p>`;
    box.hidden = false;
    const src = $("sg-sch-src");
    if (src && !src.textContent) {
      const s = G.y[y].src;
      src.innerHTML = `学校の数：文部科学省「学校基本調査」（${ys[0]}〜${y}年度の各年5月1日現在。<a href="${esc(G.estat_url)}" target="_blank" rel="noopener">e-Stat</a> の市町村別学校数）。${y}年度の表：${G.kinds.map((k) => `<a href="${esc(s[k].url)}" target="_blank" rel="noopener">${esc(k)}</a>`).join("・")}。数は表の「計」で、政令指定都市は区の数を足しています（計算はこの足し算だけです）。都道府県・全国は表の数です（表の市区町村の行の合計と一致することを確かめています）。${esc(G.terms)}（${esc(G.checked)}）。`;
    }
  }

  // ---- 画像 ----
  const srcLine = (ys) => `出典：${SURVEY}（${ys.map((y) => Y(y).fy).join("・")}。${ys.some((y) => Y(y).nat_only) ? "国の結果資料・" : ""}e-Statの市区町村別データから作成）`;

  function trendSpec() {
    const M = trendModel(), regs = regions(), k = state.s;
    const shown = M.xTicks;
    const spec = Object.assign({ kind: "trend", siteName: SITE_NAME, siteUrl: document.body.dataset.site }, M);
    spec.title = "外国籍の子どもの就学状況の推移";
    spec.subtitle = [`${regs.map(areaName).join("・")}｜${CATS[k].label}｜${shown[0]}〜${shown[shown.length - 1]}年`];
    spec.legend = M.series.map((s) => ({ line: true, color: s.color, dash: s.dash, marker: s.marker, label: s.name }));
    spec.unit = "単位：人";
    spec.noDataLabel = "";
    spec.summary = state.cmpLines || [];
    spec.foot = [srcLine(shown), FOOT_SCOPE, shown.includes(2019) && shown.includes(2021) ? "2020年度は調査なし。" : "", k === "c5" ? NOTE5 : "", k === "pos" ? NOTEPOS : "", shown.includes(2019) ? NOTE2019 : ""]
      .concat(regs.flatMap((c) => shown.map((y) => blankNote(y, c, k === "pos" ? ["c3", "c5"] : [k]))), [knownShort(knownFor(shown, regs, [k]))]).filter(Boolean);
    spec.file = `shugaku_trend_${regs.join("-")}_${k}_${dateStamp()}.png`;
    return [spec];
  }

  function barsSpecs() {
    const D = state.bd;
    const base = { kind: "bars", siteName: SITE_NAME, siteUrl: document.body.dataset.site, unit: "単位：人" };
    if (D.kind === "rank") {
      const list = D.rows.slice(0, PAGE * 4);
      const chunks = list.length > PAGE ? [0, 1, 2, 3].map((i) => list.slice(i * PAGE, (i + 1) * PAGE)).filter((c) => c.length) : [list];
      const max = Math.max(1, ...list.map((r) => r.v || 0));
      return chunks.map((rows, i) => {
        const range = chunks.length > 1 ? `${rows[0].rank}〜${rows[rows.length - 1].rank}位` : "";
        return Object.assign({}, base, {
          title: D.title,
          subtitle: [`${yLabel(D.y)}・人数が多い順${range ? "・" + range : ""}`, `調査の区分：${CATS[D.k].label}`],
          legend: [],
          rows: rows.map((r) => ({ name: `${r.rank}位 ${r.name}`, segs: [{ n: r.v || 0, color: CATS[D.k].color }], value: fmt(r.v) + "人", sub: D.k === "juki" ? "" : `住民票上の人数 ${fmt(r.juki)}人` })),
          max,
          foot: [srcLine([D.y]), FOOT_SCOPE].concat(D.rows.length > list.length ? [`上位${list.length}件までを載せています。`] : [], D.k === "c5" ? [NOTE5] : [], D.bnotes, [knownShort(D.known)]).filter(Boolean),
          file: `shugaku_rank_${D.sc.parent}_${D.k}_${D.y}${chunks.length > 1 ? "-" + (i + 1) : ""}_${dateStamp()}.png`,
          label: range,
        });
      });
    }
    if (D.two) {
      const whys = [...new Set(D.rows.filter((r) => r.status !== "ok").map((r) => r.why))];
      return [Object.assign({}, base, {
        title: D.title,
        subtitle: [`${D.area}・${yLabel(D.ya)}→${yLabel(D.yb)}`, `${D.partial ? "比べられる区分の合計" : "①〜⑥の計"} ${fmt(D.ta)}人→${fmt(D.tb)}人（${moveWord(D.tb - D.ta)}）`],
        legend: [{ color: PAIR.a, label: `${D.ya}年（過去）` }, { color: PAIR.b, label: `${D.yb}年（新しい年）` }],
        rows: D.rows.map((r) => ({
          name: r.status === "ok" ? r.name : r.name + "※",
          pair: [{ n: r.a || 0, color: PAIR.a, value: r.a == null ? "—" : fmt(r.a) }, { n: r.b || 0, color: PAIR.b, value: r.b == null ? "—" : fmt(r.b) }],
          value: "",
          sub: r.status === "ok" ? `${changeText(r.a, r.b).diff}${r.pct === null ? "" : `（増減率 ${changeText(r.a, r.b).pct}）`}` : "比べません",
        })),
        foot: [srcLine([D.ya, D.yb]), FOOT_SCOPE].concat(whys.length ? ["※は比べていない区分：" + whys.join("。") + "。"] : [], D.rows.some((r) => r.k === "c5" && (r.a > 0 || r.b > 0)) ? [NOTE5] : [], D.notes, [knownShort(D.known)]).filter(Boolean),
        file: `shugaku_breakdown_2years_${state.area}_${D.ya}-${D.yb}_${dateStamp()}.png`,
        label: "",
      })];
    }
    return [Object.assign({}, base, {
      title: D.title,
      subtitle: [`${D.area}・${yLabel(D.y)}${asOf(D.y) ? asOf(D.y) : ""}`, `住民票上の人数 ${fmt(D.juki)}人・①〜⑥の計 ${fmt(D.tot)}人`],
      legend: [],
      rows: D.rows.map((r) => ({ name: r.short, segs: [{ n: r.v || 0, color: CATS[r.k].color }], value: r.none ? "—" : fmt(r.v) + "人", sub: r.none ? r.none : D.tot > 0 ? `計の${pctText(r.v, D.tot)}` : "" })),
      max: Math.max(1, ...D.rows.map((r) => r.v || 0)),
      foot: [srcLine([D.y]), FOOT_SCOPE, D.tot > 0 ? "割合は①〜⑥の計に対するもの。" : "①〜⑥の計が0人のため、割合は出していません。", val(D.y, state.area, "c5") > 0 ? NOTE5 : ""].concat(D.notes, [knownShort(D.known)]).filter(Boolean),
      file: `shugaku_breakdown_${state.area}_${D.y}_${dateStamp()}.png`,
      label: "",
    })];
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
    $("img-what").textContent = which === "trend" ? "いま表示している推移のグラフを、Xに載せやすい縦長の画像（1080×1350）にします。" : which === "kpi" ? `いま表示している${areaName(state.area)}のデータ（${LATEST}年の人数と割合）を、Xに載せやすい縦長の画像（1080×1350）にします。` : `いま表示している${D.kind === "rank" ? "地域の順位" : D.two ? "内訳の2年比較" : "就学状況の内訳"}のグラフを、縦長の画像（1080×1350）にします。${D.kind === "rank" && D.rows.length > PAGE ? `字が小さくならないよう、${PAGE}件ずつ分けて保存します（${PAGE * 4}件まで）。` : ""}`;
    $("img-dialog").showModal();
    renderImage();
  }

  function renderImage() {
    const specs = imageWhich === "trend" ? trendSpec() : imageWhich === "kpi" ? [kpiSpec()] : barsSpecs();
    const pg = $("img-page");
    pg.hidden = specs.length < 2;
    pg.innerHTML = specs.length > 1 ? specs.map((s, i) => `<button type="button" data-p="${i}" aria-pressed="${i === imagePage}">${esc(s.label)}</button>`).join("") : "";
    const spec = specs[Math.min(imagePage, specs.length - 1)];
    window.__sgImage = spec;
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
  window.__sgCheck = () => ({ state: JSON.parse(JSON.stringify({ ...state, bd: undefined })), result: $("nj-result").innerText, say: [$("sg-say").textContent, $("nj-trend-say").textContent, $("nj-bd-say").textContent], head: $("nj-bd-head").textContent, url: location.search });
  window.__sgVal = (y, c, k) => val(y, c, k);
  window.__sgSet = (o) => { Object.assign(state, o); render(); return window.__sgCheck(); };
})();
