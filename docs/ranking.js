/* ランキングのページ：都道府県（校数・人数・人口あたり）と市区町村（校数のみ）を多い順に並べる。下で2つの都道府県を横に並べる */
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
  const CMP = ["13", "27"]; // 比べる2県の初期値
  const KINDS = ["jp", "univ", "jc", "kosen", "senmon"];
  const state = { m: "jp", unit: "pref", pref: "", a: CMP[0], b: CMP[1] };
  let D, S, R;
  let last = null; // いま表示しているランキング（画像用）
  let imageUrl = "";
  let imageJob = 0;
  let imgTop = 5; // 画像に入れる件数（上位5件／上位10件。初期は5件）。表の件数は変えない

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
    const cm = (p.get("cmp") || "").split("-");
    if (R.prefs[cm[0]] && R.prefs[cm[1]]) { state.a = cm[0]; state.b = cm[1]; }
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
    ["a", "b"].forEach((k) => {
      const el = $("cmp-" + k);
      el.innerHTML = pf.innerHTML.replace('<option value="">全国</option>', "");
      el.addEventListener("change", () => { state[k] = el.value; drawCompare(); });
    });
    $("rk-img").addEventListener("click", openImage);
    $("img-close").addEventListener("click", () => $("img-dialog").close());
    $("img-save").addEventListener("click", () => { $("img-saved").hidden = false; });
    $("img-top").addEventListener("click", (e) => { const b = e.target.closest("button[data-top]"); if (b) { imgTop = Number(b.dataset.top); renderImage(); } });
    $("img-dialog").addEventListener("close", () => { imageJob++; $("img-preview").removeAttribute("src"); if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = ""; });
    draw();
    drawCompare();
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
    if (withCmp && (state.a !== CMP[0] || state.b !== CMP[1])) q.set("cmp", state.a + "-" + state.b);
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

  // 全国の順位（同じ数は同じ順位）
  function rankOf(values, code) { return 1 + Object.values(values).filter((x) => x > values[code]).length; }

  // 2つの都道府県：同じ資料・同じ基準日の数だけを、資料ごとの見出しの下で横に並べる。
  // 「何倍？」の列は、多い側の色（1つ目＝青、2つ目＝オレンジ）で、開きが大きいほど濃く塗る。
  // 人口（住民の数）を物差しにして、人口の差より大きく開いている項目を「人口の割に多い」とする。
  const CONC = 1.5; // 人口あたりにして、これ以上ちがえば「人口の割に多い」
  const SMALL = 5; // 少ないほうがこれ未満の行は、1つの違いで倍率が大きく動くので判断に使わない
  const STEPS = [1.5, 2, 3]; // 色の濃さの区切り（1.1倍〜／1.5倍〜／2倍〜／3倍〜の4段階）
  const SHORT = {
    jp: "日本語学校", univ: "大学", jc: "短大", kosen: "高専", senmon: "専門学校", "ryugaku:all": "留学生",
    "foreign:all": "外国籍の小中高校生", "foreign:elem": ["外国籍の小学生", "小学生"], "foreign:mid": ["外国籍の中学生", "中学生"], "foreign:high": ["外国籍の高校生", "高校生"],
    "nihongo:all": "日本語指導が必要な子ども", "nihongo:foreign": ["日本語指導が必要な外国籍の子ども", "外国籍"], "nihongo:japan": ["日本語指導が必要な日本国籍の子ども", "日本国籍"],
  };
  const shortOf = (i) => { const s = SHORT[i.key]; return Array.isArray(s) ? s[0] : s || i.full; };
  function level(q) { return !q.r || q.win === "near" ? 0 : 1 + STEPS.filter((v) => q.r >= v).length; }
  function popOf() { return (S.rates || []).map((r) => r.denominator).find((d) => d && d.values) || null; }

  function drawCompare() {
    const { a, b } = state;
    $("cmp-a").value = a;
    $("cmp-b").value = b;
    $("cmp-ha").textContent = R.prefs[a].name;
    $("cmp-hb").textContent = R.prefs[b].name;
    const check = [];
    const items = []; // 「ひとことで」を作るための行の一覧
    let gName = "";
    const name = (w) => R.prefs[w === "x" ? a : b].name;
    const pop = popOf();
    // 人口でくらべてよいのは、人口あたりの計算値（rates）の分子になっている行だけ（数え方が人口とそろうもの）
    const PERKEYS = (S.rates || []).map((r) => `${r.numerator.indicator}:${r.numerator.variant}`);
    const P = pop && pop.values[a] > 0 && pop.values[b] > 0 ? pop.values[a] / pop.values[b] : null; // 人口の比（1つ目÷2つ目）
    const cell = (values, code, show) => `<td class="num">${show(values[code])}<small>全国${rankOf(values, code)}位</small></td>`;
    const group = (title, sub, gname) => { gName = gname || ""; return `<tr class="cmp-group"><th scope="colgroup" colspan="4">${esc(title)}<small>${sub}</small></th></tr>`; };
    // ref：人口の行と人口あたりの行（それ自体が物差しなので「人口の割に」は付けない）
    const row = (label, values, show, full, key, ref) => {
      const x = values[a], y = values[b], q = rel(x, y);
      const k = P && x > 0 && y > 0 ? x / y / P : null; // 人口あたりにした比（1つ目÷2つ目）
      const usable = !ref && PERKEYS.includes(key) && k !== null && Math.min(x, y) >= SMALL;
      const conc = usable ? (k >= CONC ? "x" : k <= 1 / CONC ? "y" : "") : "";
      let main = q.win === "near" ? "ほぼ同じ" : q.t, sub = "";
      if (q.win === "na") { main = "—"; sub = "数がありません"; }
      else if (q.win === "eq") main = x === 0 ? "どちらも0" : "同じ";
      else if (q.zero) { main = "—"; sub = "片方が0で計算できません"; }
      // 少ないほうが SMALL 未満の行は、倍率が当てにならないので色を付けない
      const tiny = !ref && !q.zero && q.win !== "na" && q.win !== "eq" && Math.min(x, y) < SMALL;
      if (tiny) sub = "数が少ないので参考";
      // 人口の割に多い側が、数そのものが多い側（セルの色）と同じなら名前を省く
      if (conc) sub = conc === q.side && q.win !== "near" ? "★人口の割にも多い" : `★人口の割には${esc(name(conc))}`;
      const lv = tiny || q.zero || q.win === "na" || q.win === "eq" ? 0 : level(q);
      const more = q.side && q.win !== "eq" && q.win !== "na" ? `${name(q.side)}のほうが多い` : "";
      check.push([label, x, y, main, key, conc, lv]);
      items.push({ g: gName, label, full: full || label, key, x, y, q, k, usable, conc, ref: !!ref });
      return `<tr${ref ? ' class="cmp-ref"' : ""}><th scope="row">${esc(label)}</th>${cell(values, a, show)}${cell(values, b, show)}`
        + `<td class="num cmp-ratio${lv ? ` s${q.side} lv${lv}` : ""}${conc ? " conc" : ""}"${more ? ` title="${esc(more)}"` : ""}>${main}`
        + `${more ? `<span class="vh">（${esc(more)}）</span>` : ""}${sub ? `<small>${sub}</small>` : ""}</td></tr>`;
    };
    const cnt = {};
    KINDS.forEach((t) => { cnt[t] = {}; Object.keys(R.prefs).forEach((c) => { cnt[t][c] = 0; }); });
    D.schools.forEach((s) => { if (cnt[s.t]) cnt[s.t][s.p]++; });
    let h = "";
    if (pop) {
      h += group("人口（くらべる物差し）", `${esc(pop.source_name)}・基準日 ${esc(pop.period)}。在留資格「留学」の人数の開きが、この人口の差より大きいかどうかで「人口の割に多い」を決めています。学校の数や子どもの人数は、数える対象がちがうのでこの物差しを使いません。`, "");
      h += row("住民の数", pop.values, (n) => fmt(n) + "人", "住民の数", "pop", true);
    }
    h += group("学校の数", `国の一覧で数えた校数・確認日 ${esc(D.generated)}。大学・短大・高専・専門学校は本部・本校の所在地で数えています。`, "学校の数");
    KINDS.forEach((t) => { h += row(SCHOOL[t].label.replace(/の数$/, ""), cnt[t], (n) => fmt(n) + "校", SCHOOL[t].label, t); });
    S.indicators.forEach((ind) => {
      h += group(ind.label, `${esc(ind.source_name)}・基準日 ${esc(ind.period)}。${esc(ind.note)}`, ind.label);
      ind.variants.forEach((v) => { h += row(v.id === "all" ? "合計" : v.label, v.values, (n) => fmt(n) + "人", v.id === "all" ? (ind.variants.length > 1 ? `${ind.label}（合計）` : ind.label) : `${ind.label}（${v.label}）`, `${ind.id}:${v.id}`); });
    });
    (S.rates || []).forEach((r) => {
      h += group(r.label + "（計算値）", `国の公表値ではありません。${esc(r.formula)}（${esc(r.rounding)}）。`, "");
      h += row("住民1万人あたり", r.values, (n) => dec(n, r.digits) + "人", r.label, "rate:" + r.id, true);
    });
    $("cmp-body").innerHTML = h;
    $("cmp-same").hidden = a !== b;
    const sw = (s) => `<i class="cmp-sw">${[1, 2, 3, 4].map((l) => `<b class="s${s} lv${l}"></b>`).join("")}</i>`;
    $("cmp-legend").innerHTML = `<span>${sw("x")}${esc(name("x"))}のほうが多い</span><span>${sw("y")}${esc(name("y"))}のほうが多い</span><span>色が濃いほど開きが大きい（左から1.1倍〜・1.5倍〜・2倍〜・3倍〜）。色なしは、ほぼ同じか、数が少なくて倍率が当てにならない行。★は、人口の割にも多いこと（留学生の行だけで判断）。</span>`;
    const say = a === b ? null : sayCompare(items, name, P);
    $("cmp-say").hidden = !say;
    $("cmp-say").innerHTML = say ? `<h3>ひとことで言うと</h3><p class="cmp-lead">${say.lead}</p><ul>${say.li.map((s) => `<li>${s}</li>`).join("")}</ul>`
      + `<p class="fine">表の数字から決まった手順で作った文です（人が書いた解説ではありません）。「人口の割に多い」は、人口と数え方がそろう在留資格「留学」の人数だけで判断し、住民1万人あたりにしたとき${CONC}倍以上ちがうときです（どちらも住んでいる都道府県で数え、基準日の差は1日）。数の大きさをくらべているだけで、なぜ多いのかという理由や、地域・学校の良し悪しは、この数からは分かりません。</p>` : "";
    syncUrl();
    window.__cmpCheck = { a, b, P, rows: check, x: say ? say.X : [], y: say ? say.Y : [], lead: say ? say.lead.replace(/<[^>]+>/g, "") : "", li: say ? say.li.map((s) => s.replace(/<[^>]+>/g, "")) : [] };
  }

  // 2つの数の関係。win は x（1つ目が多い）/ y / eq（同じ）/ near（四捨五入で1.0倍）/ na（数がない）。
  // 倍率は多いほう÷少ないほう（10倍未満は小数第1位、10倍以上は整数に四捨五入）
  function rel(x, y) {
    if (typeof x !== "number" || typeof y !== "number") return { win: "na" };
    if (x === y) return { win: "eq" };
    const side = x > y ? "x" : "y";
    const small = Math.min(x, y);
    if (small <= 0) return { win: side, side, zero: true };
    const r = Math.max(x, y) / small;
    const t = r < 10 ? (Math.round(r * 10) / 10).toFixed(1) : String(Math.round(r));
    return { win: t === "1.0" ? "near" : side, side, r: Number(t), t: t + "倍" };
  }

  // 「ひとことで」：人口を物差しにして、留学生（人口と数え方がそろう行）が人口の差以上に開いているかを短く言う。
  // 学校の数や子どもの人数は、総人口とは数える対象がちがうので判断しない（第4段階の決まり）。理由や良し悪しは言わない
  function sayCompare(items, name, P) {
    if (!P) return null;
    const pq = rel(P, 1);
    const popTx = pq.win === "x" || pq.win === "y" ? `${esc(name(pq.side))}が${pq.t}` : "ほぼ同じ";
    const lead = [], li = [], X = [], Y = [];
    (S.rates || []).forEach((r) => {
      const raw = items.find((i) => i.key === `${r.numerator.indicator}:${r.numerator.variant}`);
      const per = items.find((i) => i.key === "rate:" + r.id);
      if (!raw || raw.q.win === "na") return;
      const nm = esc(shortOf(raw));
      if (!raw.usable) { lead.push(`${nm}の数が少ないので、人口とくらべた判断はできません。`); return; }
      const rt = raw.q.win === "near" || raw.q.win === "eq" ? "ほぼ同じ" : `${esc(name(raw.q.side))}が${raw.q.t}`;
      if (raw.conc) {
        (raw.conc === "x" ? X : Y).push(raw.key);
        const S2 = esc(name(raw.conc));
        if (raw.q.win === raw.conc) lead.push(`${nm}は、人口の差（${popTx}）を超えて、<b>${S2}に集まっています</b>（${raw.q.t}）。`);
        else if (raw.q.win === "x" || raw.q.win === "y") lead.push(`${nm}の数は${esc(name(raw.q.side))}のほうが多いものの（${raw.q.t}）、人口の差（${popTx}）ほどではなく、<b>人口の割には${S2}のほうが多い</b>です。`);
        else lead.push(`${nm}の数はほぼ同じですが、人口は${popTx}なので、<b>人口の割には${S2}のほうが多い</b>です。`);
      } else {
        lead.push(`${nm}の差（${rt}）は、人口の差（${popTx}）とくらべて大きくは変わらず、<b>人口の割にどちらかに特に多いとまでは言えません</b>。`);
      }
      if (per && typeof per.x === "number" && typeof per.y === "number") {
        const pt = per.q.win === "x" || per.q.win === "y" ? `${esc(name(per.q.side))}が${per.q.t}` : "ほぼ同じ";
        li.push(`住民1万人あたりの${nm}：${esc(name("x"))} ${dec(per.x, r.digits)}人、${esc(name("y"))} ${dec(per.y, r.digits)}人（${pt}）`);
      }
    });
    if (!lead.length) return null;
    li.push("学校の数や子どもの人数は、総人口とは数える対象がちがうので、人口の割に多いかどうかは判断していません。開きの大きさは表の色で見てください。");
    return { lead: lead.join(""), li, X, Y };
  }
})();
