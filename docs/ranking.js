/* ランキングのページ：都道府県（校数・人数・人口あたり）と市区町村（校数のみ）を多い順に並べる。2県比較は compare.js */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const dec = (n, d) => Number(n).toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SCHOOL = {
    jp: { label: "日本語学校の数", img: "日本語学校数", types: ["jp"], map: "jp" },
    higher: { label: "大学・短大・高専の数", img: "大学・短大・高専の数", types: ["univ", "jc", "kosen"], map: "higher" },
    univ: { label: "大学の数", img: "大学数", types: ["univ"], map: "higher" },
    jc: { label: "短大の数", img: "短大数", types: ["jc"], map: "higher" },
    kosen: { label: "高専の数", img: "高専数", types: ["kosen"], map: "higher" },
    senmon: { label: "専門学校の数", img: "専門学校数", types: ["senmon"], map: "senmon" },
  };
  const CITY_TOP = 50;
  const SITE_NAME = "日本語学校・留学生 全国マップ";
  const KINDS = ["jp", "univ", "jc", "kosen", "senmon"];
  const state = { m: "jp", unit: "pref", pref: "" };
  let D, S, R;
  let last = null; // いま表示しているランキング（画像用）
  let imageUrl = "";
  let imageJob = 0;
  let imgTop = 5; // 画像に入れる件数（上位5件／上位10件。初期は5件）。表の件数は変えない

  // 2県比較は「都道府県比較」のページ（compare.html）に移した。古いリンク（ranking.html#compare）はそちらへ
  if (location.hash === "#compare") {
    const c = new URLSearchParams(location.search).get("cmp");
    location.replace("compare.html" + (c ? "?cmp=" + encodeURIComponent(c) : ""));
    return;
  }

  Promise.all(["data/schools.json", "data/stats.json", "data/regions.json"].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); })))
    .then(([d, s, r]) => { D = d; S = s; R = r; init(); })
    .catch(() => { $("rk-info").textContent = "データを読み込めませんでした。ページを開き直してください。"; });

  function isSchool() { return !!SCHOOL[state.m]; }

  // 人口あたり（計算値）。m は "rate:ID"
  function rate() { return state.m.startsWith("rate:") ? (S.rates || []).find((r) => "rate:" + r.id === state.m) || null : null; }

  function people() {
    const [id, vid] = state.m.split(":");
    const ind = S.indicators.find((i) => i.id === id);
    if (!ind) return null;
    return { ind, v: ind.variants.find((x) => x.id === vid) || ind.variants[0] };
  }

  function init() {
    const p = new URLSearchParams(location.search);
    const m = p.get("m") || "";
    if (SCHOOL[m] || (S.rates || []).some((r) => "rate:" + r.id === m) || (m.includes(":") && S.indicators.some((i) => i.id === m.split(":")[0]))) state.m = m;
    if (p.get("unit") === "city" && SCHOOL[state.m]) state.unit = "city";
    if (R.prefs[p.get("pref")]) state.pref = p.get("pref");
    const sel = $("rk-metric");
    let html = '<optgroup label="学校の数">' + Object.keys(SCHOOL).map((k) => `<option value="${k}">${SCHOOL[k].label}</option>`).join("") + "</optgroup><optgroup label=\"都道府県の人数\">";
    S.indicators.forEach((i) => i.variants.forEach((v) => { html += `<option value="${i.id}:${v.id}">${esc(i.label)}${v.id === "all" ? "" : `（${esc(v.label)}）`}</option>`; }));
    html += "</optgroup>";
    if ((S.rates || []).length) html += '<optgroup label="人口あたり（計算値）">' + S.rates.map((r) => `<option value="rate:${r.id}">${esc(r.label)}</option>`).join("") + "</optgroup>";
    sel.innerHTML = html;
    sel.value = state.m;
    sel.addEventListener("change", () => { state.m = sel.value; if (!isSchool()) state.unit = "pref"; draw(); });
    $("rk-unit").addEventListener("change", (e) => { state.unit = e.target.value; draw(); });
    const pf = $("rk-pref");
    Object.keys(R.prefs).sort().forEach((c) => pf.insertAdjacentHTML("beforeend", `<option value="${c}">${esc(R.prefs[c].name)}</option>`));
    pf.value = state.pref;
    pf.addEventListener("change", () => { state.pref = pf.value; draw(); });
    $("rk-img").addEventListener("click", openImage);
    $("img-close").addEventListener("click", () => $("img-dialog").close());
    $("img-save").addEventListener("click", () => { $("img-saved").hidden = false; });
    $("img-top").addEventListener("click", (e) => { const b = e.target.closest("button[data-top]"); if (b) { imgTop = Number(b.dataset.top); renderImage(); } });
    $("img-dialog").addEventListener("close", () => { imageJob++; $("img-preview").removeAttribute("src"); if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = ""; });
    draw();
  }

  // 同じ数は同じ順位にする
  function ranked(rows) {
    rows.sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
    rows.forEach((r, i) => { r.rank = i && rows[i - 1].n === r.n ? rows[i - 1].rank : i + 1; });
    return rows;
  }

  function schoolRows() {
    const def = SCHOOL[state.m];
    const c = {};
    if (state.unit === "pref") {
      Object.keys(R.prefs).forEach((code) => { c[code] = { code, name: R.prefs[code].name, n: 0, href: `index.html?pref=${code}&types=${def.map}` }; });
      D.schools.forEach((s) => { if (def.types.includes(s.t)) c[s.p].n++; });
    } else {
      D.schools.forEach((s) => {
        if (!def.types.includes(s.t) || !s.cc || (state.pref && s.p !== state.pref)) return;
        if (!c[s.cc]) c[s.cc] = { code: s.cc, name: R.prefs[s.p].name + " " + s.c, city: s.c, pref: R.prefs[s.p].name, n: 0, href: `index.html?pref=${s.p}&city=${s.cc}&types=${def.map}` };
        c[s.cc].n++;
      });
    }
    return ranked(Object.values(c));
  }

  function peopleRows() {
    const { ind, v } = people();
    return ranked(Object.keys(R.prefs).map((code) => ({ code, name: R.prefs[code].name, n: v.values[code], href: `index.html?pref=${code}&view=stats&layer=${ind.id}${v.id === "all" ? "" : "&variant=" + v.id}` })));
  }

  function rateRows() {
    const r = rate();
    return ranked(Object.keys(R.prefs).map((code) => ({ code, name: R.prefs[code].name, n: r.values[code], href: `index.html?pref=${code}&view=stats&layer=${r.numerator.indicator}` })));
  }

  function query(withCmp) {
    const q = new URLSearchParams({ m: state.m });
    if (isSchool() && state.unit === "city") { q.set("unit", "city"); if (state.pref) q.set("pref", state.pref); }
    return q.toString().replace("%3A", ":");
  }

  function syncUrl() { history.replaceState(null, "", location.pathname + "?" + query(true) + location.hash); }

  function draw() {
    const school = isSchool();
    const rt = rate();
    const val = (n) => (rt ? dec(n, rt.digits) : fmt(n));
    $("rk-unit").value = state.unit;
    $("rk-unit").disabled = !school;
    $("rk-pref").hidden = !(school && state.unit === "city");
    const rows = school ? schoolRows() : rt ? rateRows() : peopleRows();
    const unit = school ? "校" : "人";
    const city = school && state.unit === "city";
    const shown = city && !state.pref ? rows.filter((r) => r.rank <= CITY_TOP) : rows;
    const max = Math.max(1, ...shown.map((r) => r.n));
    const area = city ? (state.pref ? R.prefs[state.pref].name + "の市区町村" : "全国の市区町村") : "都道府県";
    const title = school ? SCHOOL[state.m].label : rt ? rt.label + "（計算値）" : people().ind.label + (people().v.id === "all" ? "" : `（${people().v.label}）`);
    $("rk-title").textContent = `${area}別 ${title}`;
    $("rk-body").innerHTML = shown.map((r) => `<tr><td class="rk-no">${r.rank}</td><td><a href="${r.href}">${esc(r.name)}</a><span class="rk-bar" aria-hidden="true"><i style="width:${(r.n / max * 100).toFixed(1)}%"></i></span></td><td class="num">${val(r.n)}${unit}</td></tr>`).join("");
    let foot = "";
    let info = "";
    let period = "";
    if (school) {
      const total = D.schools.filter((s) => SCHOOL[state.m].types.includes(s.t)).length;
      foot = city ? "" : `<tr><th scope="row" colspan="2">全国</th><td class="num">${fmt(total)}校</td></tr>`;
      period = `確認日 ${D.generated}`;
      info = `国の一覧に載っている学校を数えました（${period}）。大学・短大・高専・専門学校は本部の所在地で数えています。${city ? `所在地を確認中の学校は入っていません。${state.pref ? "" : `全国は上位${CITY_TOP}位まで表示しています。`}` : ""}<a href="sources.html">出典</a>`;
    } else if (rt) {
      const d = rt.denominator;
      const n = S.indicators.find((i) => i.id === rt.numerator.indicator);
      const nv = n.variants.find((v) => v.id === rt.numerator.variant);
      foot = `<tr><th scope="row" colspan="2">全国</th><td class="num">${val(rt.national)}人${nv.unallocated ? `<small>（都道府県不詳${fmt(nv.unallocated)}人を含めて計算）</small>` : ""}</td></tr>`;
      period = rt.period;
      info = `<strong>計算値です（国の公表値ではありません）。</strong>計算式：${esc(rt.formula)}（${esc(rt.rounding)}）。${esc(rt.why)}出典：分子 <a href="${esc(nv.url)}" target="_blank" rel="noopener">${esc(n.source_name)}</a>／分母 <a href="${esc(d.source_url)}" target="_blank" rel="noopener">${esc(d.source_name)}</a>`;
    } else {
      const { ind, v } = people();
      foot = `<tr><th scope="row" colspan="2">全国</th><td class="num">${fmt(v.national)}人${v.unallocated ? `<small>（都道府県不詳${fmt(v.unallocated)}人を含む）</small>` : ""}</td></tr>`;
      period = ind.period;
      info = `基準日：${esc(ind.period)}。${esc(ind.note)}<a href="${esc(v.url)}" target="_blank" rel="noopener">出典：${esc(ind.source_name)}</a>`;
      // 日本語指導：推移と言語別・学校種別などの内訳のページへ（並べ方の区分を引き継ぐ）
      if (ind.id === "foreign") info += `　<a href="foreign.html?v=pref${["elem", "mid", "high"].includes(v.id) ? "&bt=" + v.id : ""}#breakdown">人数の内訳・推移を見る</a>`;
      if (ind.id === "nihongo") info += `　<a href="nihongo.html?v=pref${{ foreign: "&m=f", japan: "&m=j" }[v.id] || ""}#breakdown">人数の内訳・推移を見る</a>`;
    }
    $("rk-foot").innerHTML = foot;
    $("rk-info").innerHTML = info;
    const top = rows.slice(0, 3).map((r) => `${r.rank}位 ${r.name} ${val(r.n)}${unit}`).join("\n");
    const url = document.body.dataset.site + "ranking.html?" + query(false);
    syncUrl();
    const text = `${area}別 ${title}（${period}）\n${top}\n日本語学校・留学生 全国マップ`;
    const a = $("rk-share");
    a.href = "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
    a.dataset.text = text;
    last = { rows, area, title, unit, val, school, rt, city, text: text + "\n" + url, href: a.href };
    window.__rankCheck = { rows: rows.length, shown: shown.length, top: rows.slice(0, 3), total: rows.reduce((s, r) => s + r.n, 0), text };
  }

  // ---- 画像保存（いま表示しているランキングの上位 IMG_TOP 件） ----
  function jpDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : iso;
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  // 画像の中身：上位 top 件（対象が少なければある分だけ）。同じ数は表と同じ並び（多い順、同じ数は地域番号の順）
  function imageSpec(top) {
    const { rows, unit, val, school, rt, city } = last;
    const shown = rows.slice(0, top);
    const endN = shown.length ? shown[shown.length - 1].n : null;
    // 最後の行と同じ数で、画像に入りきらない地域の数
    const more = rows.slice(shown.length).filter((r) => r.n === endN).length;
    const tie = more > 0 || shown.some((r, i) => i && shown[i - 1].n === r.n);
    const place = city && state.pref ? R.prefs[state.pref].name : "全国";
    const scope = city ? `学校のある${fmt(rows.length)}市区町村` : `${rows.length}都道府県`;
    const parts = [rows.length > shown.length ? `${scope}のうち上位${shown.length}件` : `${scope}すべて（${shown.length}件）`];
    const foot = [];
    let what;
    if (school) {
      const def = SCHOOL[state.m];
      what = def.img;
      if (!city) parts.push(`全国 ${fmt(D.schools.filter((s) => def.types.includes(s.t)).length)}校`);
      parts.push(`確認日 ${jpDate(D.generated)}`);
      const agencies = [...new Set(D.bases.map((b) => b.name.split("「")[0]))].join("・");
      foot.push(`数えたもの：国の一覧（${agencies}）に載っている学校の所在地。人数ではありません。`);
      const notes = (state.m === "jp" ? "" : "本部・本校の所在地で数えています。") + (city ? "所在地を確認中の学校は入っていません。" : "");
      if (notes) foot.push(notes);
    } else if (rt) {
      const n = S.indicators.find((i) => i.id === rt.numerator.indicator);
      what = rt.label + "（計算値）";
      parts.push(`全国 ${val(rt.national)}人`, "計算値です（国の公表値ではありません）");
      foot.push(`計算式：${rt.formula}（${rt.rounding}）`);
      foot.push(`分子：${n.source_name}／分母：${rt.denominator.source_name}`);
    } else {
      const { ind, v } = people();
      what = last.title;
      parts.push(`全国 ${fmt(v.national)}人`, `基準日 ${ind.period}`);
      foot.push(`統計：${ind.source_name}／基準日 ${ind.period}`);
      foot.push(ind.note + (v.unallocated ? `全国の数には都道府県不詳の${fmt(v.unallocated)}人を含みます。` : ""));
    }
    if (tie) foot.push("同じ数は同じ順位とし、地域番号の順に並べています。" + (more ? `最後の行と同じ数の地域がほかに${more}件あります（画像には入れていません）。` : ""));
    foot.push("順位は数の多さだけを表します（地域への影響や学校の評価ではありません）。");
    const key = state.m.replace(":", "-") + (city ? "_city" + (state.pref ? "-" + state.pref : "") : "");
    return {
      kind: "ranking",
      siteName: SITE_NAME,
      siteUrl: document.body.dataset.site,
      title: `${place}｜${city ? "市区町村" : "都道府県"}別 ${what}`,
      subtitle: parts.join("・"),
      // 県を選んだ市区町村は県名を題名にだけ書く。全国の市区町村は県名を小さく添える
      rows: shown.map((r) => ({ name: city ? r.city : r.name, pre: city && !state.pref ? r.pref : "", n: r.n, value: val(r.n) + unit })),
      foot,
      file: `nihongo-map_ranking_${key}_top${top}_${dateStamp()}.png`,
    };
  }

  function openImage() {
    if (!last) return;
    $("img-saved").hidden = true;
    $("img-preview").hidden = true;
    $("img-x").href = last.href;
    $("img-x-text").textContent = last.text;
    $("img-dialog").showModal();
    renderImage();
  }

  // 件数を切り替えたらすぐ作り直す（前のプレビューは新しい画像ができるまで残す）
  function renderImage() {
    const img = $("img-preview");
    const save = $("img-save");
    const job = ++imageJob;
    $("img-top").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.top) === imgTop)));
    save.hidden = true;
    $("img-status").textContent = "画像を作っています…";
    const spec = imageSpec(imgTop);
    window.__rankImage = spec;
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
      $("img-status").textContent = `ファイル名：${spec.file}（1080×1350ピクセル・${spec.rows.length}件）`;
    }).catch(() => { if (job === imageJob) $("img-status").textContent = "画像を作れませんでした。ページを開き直してお試しください。"; });
  }

})();
