"""公開する前の点検。1つでも不合格なら止まる。

python -I -X utf8 scripts/verify.py
"""
import json
import math
import re
import sys
from collections import Counter
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
results = []


def ok(name, cond, detail=""):
    results.append((bool(cond), name, detail))


load = lambda p: json.loads(Path(p).read_text("utf8"))
master = load(ROOT / "data/schools.json")
pub = load(DOCS / "data/schools.json")
stats = load(DOCS / "data/stats.json")
regions = load(DOCS / "data/regions.json")
geo = load(DOCS / "data/prefectures.json")
schools = pub["schools"]

# ---- 公開してはいけない情報 ----
ALLOWED_MASTER = {"id", "name", "type", "sub", "pref_code", "pref", "city_code", "city", "address", "address_basis", "lat", "lng", "location_level", "location_source", "website", "website_source", "list_basis", "checked", "status", "public"}
ok("台帳の項目は決めたものだけ", all(set(s) == ALLOWED_MASTER for s in master), "")
ALLOWED_PUB = {"i", "n", "t", "p", "b", "ck", "s", "cc", "c", "a", "ab", "an", "au", "la", "ln", "lv", "u", "st"}
ok("公開データの項目は決めたものだけ", all(set(s) <= ALLOWED_PUB for s in schools), "")

# 公開しない資料の語の一覧は、一覧そのものを公開しないよう、このリポジトリの外に置く
_private = ROOT.parent / "非公開ツール" / "banned_words.json"
PRIVATE = load(_private) if _private.exists() else {"words": [], "folders": []}
BANNED = PRIVATE["words"]

# 例外：出典ページの「学校ごとの数字を調べるには」（id="other-sites"）だけは、ほかの団体のサイトへのリンクを置いてよい。
# 数字は写さない（日付以外の数字があれば不合格）、リンク先は下の3つだけ、置き場所は出典ページだけ。
OTHER_SITES = re.compile(r'<section id="other-sites">.*?</section>', re.S)
OTHER_SITES_URLS = {
    "https://www.nisshinkyo.org/search/",
    "https://up-j.shigaku.go.jp/",
    "https://portraits.niad.ac.jp/",
}
OTHER_SITES_FILES = {"docs/sources.html", "scripts/site/pages/sources.html"}

hits = Counter()
other_bad = []
scan = [p for d in ("docs", "data", "config", "scripts") for p in (ROOT / d).rglob("*") if p.is_file() and p.suffix in (".json", ".js", ".html", ".css", ".py", ".md", ".csv", ".txt", ".yml")]
scan += [ROOT / "README.md", ROOT / ".gitignore"]
for p in scan:
    if p.name == "verify.py" or "vendor" in p.parts:
        continue
    tx = p.read_text("utf8", errors="ignore")
    rel = p.relative_to(ROOT).as_posix()
    blocks = OTHER_SITES.findall(tx)
    if blocks:
        if rel not in OTHER_SITES_FILES or len(blocks) != 1:
            other_bad.append(f"{rel}:場所か数")
        for b in blocks:
            urls = set(re.findall(r'href="([^"]+)"', b))
            if urls != OTHER_SITES_URLS:
                other_bad.append(f"{rel}:リンク先 {sorted(urls ^ OTHER_SITES_URLS)}")
            if re.search(r"\d", re.sub(r"\d{4}-\d{2}-\d{2}", "", re.sub(r'href="[^"]+"', "", b))):
                other_bad.append(f"{rel}:数字あり")
        tx = OTHER_SITES.sub("", tx)
    for w in BANNED:
        if w in tx:
            hits[f"{rel}:{w}"] += tx.count(w)
ok("公開しない資料・項目の語が残っていない", not hits and (BANNED or not _private.parent.exists()), str(dict(list(hits.items())[:8])))
_src = (DOCS / "sources.html").read_text("utf8")
ok("ほかの団体へのリンク集は出典ページの1か所だけで、数字を写していない", not other_bad and len(OTHER_SITES.findall(_src)) == 1, str(other_bad[:5]))

PERSONAL = re.compile(r"\b0\d{1,4}-\d{1,4}-\d{3,4}\b|[\w.+-]+@[\w-]+\.[\w.-]+")
tx = (DOCS / "data/schools.json").read_text("utf8")
ok("電話番号やメールアドレスが入っていない", not PERSONAL.search(tx), str(PERSONAL.findall(tx)[:3]))
ok("元の統計ファイルや非公開フォルダがない", not any((ROOT / f).exists() for f in PRIVATE["folders"]) and not list(DOCS.rglob("*.xlsx")), "")

# ---- 件数 ----
EXPECT = {"jp": 918, "univ": 825, "jc": 292, "kosen": 58, "senmon": 2665}
cnt = Counter(s["t"] for s in schools)
ok("種類ごとの校数", dict(cnt) == EXPECT, str(dict(cnt)))
ok("台帳と公開データの校数が同じ", len(master) == len(schools) == sum(EXPECT.values()), str(len(schools)))
ok("学校のIDが重ならない", len({s["i"] for s in schools}) == len(schools), "")
dup = Counter((s["t"], s["n"], s.get("a")) for s in schools if s.get("a"))
ok("同じ種類で校名と住所が同じ学校がない", not [k for k, v in dup.items() if v > 1], str([k for k, v in dup.items() if v > 1][:4]))
ok("短大・高専を大学に混ぜていない", cnt["univ"] == 825 and not any("短期大学" in s["n"] for s in schools if s["t"] == "univ"), "")

# ---- 根拠 ----
bases = pub["bases"]
ok("全校に学校一覧の根拠と確認日がある", all(s["b"] and s["ck"] for s in schools), "")
ok("住所のある学校に所在地の根拠がある", all(("ab" in s or ("an" in s and "au" in s)) for s in schools if s.get("a")), "")
ok("根拠のリンクがhttpで始まる", all(b["url"].startswith("http") for b in bases) and all(s.get("au", "http").startswith("http") for s in schools), "")
ok("公式サイトのリンクがhttpで始まる", all(s.get("u", "http").startswith("http") for s in schools), "")
ok("Googleマップの座標や住所を使っていない", not any("google" in (s.get("au") or "") for s in schools), "")

# ---- 位置が都道府県の中にあるか ----
def inside(lat, lng, rings):
    c = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                c = not c
            j = i
    return c


rings, boxes = {}, {}
for f in geo["features"]:
    polys = [f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"]
    rings[f["properties"]["code"]] = [p[0] for p in polys]
    xs = [c[0] for p in polys for c in p[0]]
    ys = [c[1] for p in polys for c in p[0]]
    boxes[f["properties"]["code"]] = (min(xs), max(xs), min(ys), max(ys))
out = []
for s in schools:
    if "la" not in s:
        continue
    if not inside(s["la"], s["ln"], rings[s["p"]]):
        x0, x1, y0, y1 = boxes[s["p"]]
        d = max(x0 - s["ln"], s["ln"] - x1, y0 - s["la"], s["la"] - y1, 0)
        out.append((s["i"], s["n"], round(d, 3)))
far = [o for o in out if o[2] > .02]
ok("位置が都道府県の範囲から大きく外れない", not far, str(far[:5]))
if out:
    print(f"参考：簡略化した県境の少し外に出る点 {len(out)} 校（海岸線の簡略化によるもの）")
mapped = sum(1 for s in schools if "la" in s)
ok("位置のある学校が98％以上", mapped / len(schools) > .98, f"{mapped}/{len(schools)}")

# ---- 統計 ----
codes = {f["properties"]["code"] for f in geo["features"]}
ok("都道府県の境界が47", len(codes) == 47, str(len(codes)))
for ind in stats["indicators"]:
    need = ("id", "label", "note", "as_of", "period", "scope", "source_name", "source_url", "processing", "terms", "public")
    ok(f"{ind['id']}：必要な項目と出典がある", all(ind.get(k) not in (None, "") for k in need) and ind["source_url"].startswith("https://"), "")
    for v in ind["variants"]:
        ok(f"{ind['id']}/{v['id']}：47都道府県の数字", set(v["values"]) == codes and all(isinstance(x, int) and x >= 0 for x in v["values"].values()), "")
        total = sum(v["values"].values()) + v.get("unallocated", 0)
        ok(f"{ind['id']}/{v['id']}：県の合計＝全国の値", total == v["national"], f"{total} / {v['national']}")
        ok(f"{ind['id']}/{v['id']}：階級が小さい順に4つ", len(v["breaks"]) == 4 and v["breaks"] == sorted(set(v["breaks"])), str(v["breaks"]))
ids = [i["id"] for i in stats["indicators"]]
ok("人数は3種類", ids == ["ryugaku", "foreign", "nihongo"], str(ids))
ref = {i["id"]: i for i in stats["indicators"]}
ok("発表値と一致（留学464,784／日本語指導84,759）", ref["ryugaku"]["variants"][0]["national"] == 464784 and ref["nihongo"]["variants"][0]["national"] == 84759, "")
ok("留学の都道府県不詳は414人", ref["ryugaku"]["variants"][0].get("unallocated") == 414, "")
ok("日本語指導の表示名に「公立学校」が入る", ref["nihongo"]["label"] == "公立学校で日本語指導が必要な児童生徒", ref["nihongo"]["label"])
ok("人数ごとに短い説明がある", all(i.get("note") for i in stats["indicators"]), "")
ok("居住地基準と日本国籍を含むことを明記", "学校の所在地ではありません" in ref["ryugaku"]["note"] and "日本国籍" in ref["nihongo"]["note"], "")
srcs = Counter(s["location_source"] for s in master if s["lat"] is not None)
ok("位置の取得元は国土交通省の位置参照情報だけ", all("位置参照情報 国土交通省" in k for k in srcs), str(srcs))
ok("白抜きの基準（町名の代表点）が公開データにある", all(s.get("lv") in (0, 1) for s in schools if "la" in s), "")
img = (DOCS / "map-image.js").read_text("utf8")
ok("保存画像は通信しない（タイル・送信なし）", not re.search(r"fetch\(|XMLHttpRequest|cyberjapandata|sendBeacon|new Image", img), "")
ok("保存画像に出典とクレジットがある", "国土数値情報" in img and "位置参照情報" in img and "siteUrl" in img, "")

# ---- 地図の表示（2026-11-07 改善指示書の第1・2段階） ----
sj = (DOCS / "site.js").read_text("utf8")
ih = (DOCS / "index.html").read_text("utf8")
sh_pre = (DOCS / "sources.html").read_text("utf8")
ok("地図に出すものは2種類（学校の数と場所・人数の分布）で、同時には出さない", all(f'data-view="{k}"' in ih for k in ("place", "stats")) and 'data-view="both"' not in ih and "aria-pressed" in ih, "")
ok("位置のない学校も公開データに残す（消さない）", sum("la" not in s for s in schools) == sum(s["lat"] is None for s in master), "")
ok("登録校数と地図に位置を表示できる校数を分けて出す", "地図に位置を表示できる" in sj, "")
ok("大学・専門学校は本部・本校の所在地と明記", "本部・本校の所在地" in sj, "")
ok("学校の所在地と国の統計を分けて見出しを付ける", "学校の所在地" in sj and "都道府県別の人数（国の統計）" in sj, "")
ok("統計は合算・単純比較できないと明記", "合算・単純比較できません" in sj, "")
ok("色分けは学校ごとの人数でないと明記", "学校ごとの人数ではありません" in sj, "")

# ---- 画像保存とX投稿（改善指示書の第3段階） ----
ok("保存画像は3種類（全国の学校分布・全国の人数分布・選択した地域）", all(f'name="img-kind" value="{k}"' in ih for k in ("schools", "stats", "region")), "")
ok("保存画像は1600×900", "W = 1600, H = 900" in img, "")
ok("保存画像に基準日を入れる", img.count("基準日") >= 3, "")
ok("全国の投稿文は指示書の文のまま", "あなたの地域に、日本語学校・大学・専門学校はどこに、何校ある？\\n\\n全国の学校の所在地と、国の統計による留学生等の人数を地図で確認できます。\\n\\n【テスト運用中】\\n${document.body.dataset.site}" in sj, "")
ok("投稿文のURLが公開サイト", 'data-site="https://yumaki5555.github.io/nihongo-school-map/"' in ih, "")
ok("画像が自動で添付されないと案内する", "画像は自動では添付されません。保存してからXで添付してください。" in ih, "")
ok("地域の投稿文はXの文字数に収める", "X_LIMIT = 280" in sj and "fitsX" in sj, "")

# ---- 地図・X画像の見やすさ（2026-11-08 視認性改善） ----
# 2026-11-10 ユーザー指示：全国を見たときも色分けでなく民泊マップのような点に。色・点の大きさは民泊マップに合わせる
ok("全国表示も学校の点で表す（都道府県の校数の色分け・数字の丸・まとめ表示なし）", "NATION_BELOW" not in sj and "showCount" not in sj and "markerClusterGroup" not in sj and "renderBubbles" not in sj and "cl-pref" not in sj, "")
ok("点の大きさは民泊マップと同じ（1校10/13/14/15/17px、同じ位置の校数で2pxずつ）", "z <= 9 ? 10 : z <= 11 ? 13 : z <= 13 ? 14 : z <= 15 ? 15 : 17" in sj and "tier(n) * 2" in sj, "")
ok("背景は民泊マップと同じ淡いグレー（OpenStreetMap Japan を灰色に）", "tile.openstreetmap.jp/styles/maptiler-basic-ja" in sj and "grayscale(.8) contrast(.72) brightness(1.15)" in sj, "")
ok("地図のページでまとめ表示の部品を読み込まない", all("markercluster" not in (DOCS / p).read_text(encoding="utf-8") for p in ["index.html", "map.html"] if (DOCS / p).exists()), "")
ok("保存画像に数字入りのまとめた丸がない", "drawBubble" not in img and "drawPill" not in img and "clusterPts" not in img, "")
gidx = load(DOCS / "data/geo/index.json")
geo_cities, geo_name, geo_poly = set(), {}, {}


def _ring(r, arcs):
    out = []
    for a in r:
        s = arcs[a] if a >= 0 else arcs[~a][::-1]
        out += s if not out else s[1:]
    return out


def _inside(x, y, rg):
    c = False
    for (x0, y0), (x1, y1) in zip(rg, rg[1:]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def _dist_m(x, y, rg):
    kx, ky, best = math.cos(math.radians(y)) * 111320, 110940, 1e18
    for (x0, y0), (x1, y1) in zip(rg, rg[1:]):
        ax, ay, bx, by, px, py = x0 * kx, y0 * ky, x1 * kx, y1 * ky, x * kx, y * ky
        dx, dy = bx - ax, by - ay
        u = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(px - ax - u * dx, py - ay - u * dy))
    return best


for c in sorted(gidx["prefs"]):
    gd = load(DOCS / f"data/geo/p{c}.json")
    for x in gd["cities"]:
        geo_cities.add(x["c"])
        geo_name[x["c"]] = x["n"]
        geo_poly[x["c"]] = [[_ring(r, gd["arcs"]) for r in poly] for poly in x["r"]]
ok("画像用の地図データが47都道府県分ある", sorted(gidx["prefs"]) == sorted(codes), str(len(gidx["prefs"])))
missing = sorted({s["cc"] for s in schools if s.get("cc")} - geo_cities)
ok("学校のある市区町村はすべて境界がある", not missing, str(missing[:5]))
# 市区町村の番号と名前が境界データと合う（名前の前の郡名は除いて比べる）。2026-11-08 環太平洋大学の番号違いを直したときに追加
bad_name = sorted({(s["cc"], s["c"]) for s in schools if s.get("cc") and not s["c"].endswith(geo_name.get(s["cc"], "(境界なし)"))})
ok("学校の市区町村の番号と名前が境界データと一致", not bad_name, str(bad_name[:5]))
# 点が自分の市区町村から大きく外れていない（境界は簡略化しているので、1km未満の外れは許す。48校は線の近くで外に出るが、国土地理院の逆ジオコーダで正しい市区町村の中と確認済み）
far_pts = []
for s in schools:
    if s.get("la") is None or not s.get("cc"):
        continue
    P = geo_poly[s["cc"]]
    if any(_inside(s["ln"], s["la"], q[0]) and not any(_inside(s["ln"], s["la"], h) for h in q[1:]) for q in P):
        continue
    d = min(_dist_m(s["ln"], s["la"], q[0]) for q in P)
    if d >= 1000:
        far_pts.append((s["i"], round(d)))
ok("学校の点が自分の市区町村から1km以上外れていない", not far_pts, str(far_pts[:5]))
ok("地域の画像は境界・駅を描き、地図が作れないときはグラフにする", "cityPath" in img and "stations" in img and "drawChart" in img and "chartSpec" in sj, "")
ok("市区町村の画像の都道府県の人数は「参考：○○全体」と分け、標準では入れない", "参考：${m.area}全体" in img and '$("img-ref").checked' in sj and 'id="img-ref"' in ih, "")
ok("画像に鉄道・境界の出典（国土数値情報）がある", "鉄道データ 2024年" in img and "KsjTmplt-N02-2024" in sh_pre, "")

# ---- 人口あたり・2県比較（改善指示書の第4段階） ----
rates = stats.get("rates", [])
ok("人口あたりは1種類（住民1万人あたりの留学）", [r["id"] for r in rates] == ["ryugaku_pop"], str([r["id"] for r in rates]))
for r in rates:
    d, num_ind = r["denominator"], ref[r["numerator"]["indicator"]]
    nv = next(v for v in num_ind["variants"] if v["id"] == r["numerator"]["variant"])
    ok(f"{r['id']}：分母は47都道府県の人口で、合計＝全国", set(d["values"]) == codes and all(isinstance(x, int) and x > 0 for x in d["values"].values()) and sum(d["values"].values()) == d["national"], "")
    ok(f"{r['id']}：分母は2026年1月1日の住民基本台帳人口（全国123,767,642人）", d["national"] == 123767642 and d["as_of"] == "2026-01-01", f"{d['national']} {d['as_of']}")
    gap = abs((date.fromisoformat(d["as_of"]) - date.fromisoformat(num_ind["as_of"])).days)
    ok(f"{r['id']}：分子と分母の基準日の差が31日以内", gap <= 31, f"{gap}日")
    calc = lambda n, base: float((Decimal(n) * r["per"] / Decimal(base)).quantize(Decimal("0.1"), ROUND_HALF_UP))
    ok(f"{r['id']}：47都道府県と全国の値を計算し直して一致", set(r["values"]) == codes and all(r["values"][c] == calc(nv["values"][c], d["values"][c]) for c in codes) and r["national"] == calc(nv["national"], d["national"]), "")
    ok(f"{r['id']}：計算式・端数処理・そろえた点・計算値の注記・出典がある", all(r.get(k) for k in ("formula", "rounding", "why", "terms", "period")) and "国の公表値ではなく" in r["note"] and d["source_url"].startswith("https://"), "")
rj = (DOCS / "ranking.js").read_text("utf8")
rh = (DOCS / "ranking.html").read_text("utf8")
sh = (DOCS / "sources.html").read_text("utf8")
ok("ランキングの人口あたりは計算値と明記し、計算式と分子・分母の出典を出す", "計算値です（国の公表値ではありません）" in rj and "rt.formula" in rj and "分子 <a" in rj and "分母 <a" in rj, "")
ok("ランキングの画像保存：5件・10件の切り替え（初期5件）、順位の意味・計算値・基準日を画像に書く", 'id="rk-img"' in rh and 'id="img-dialog"' in rh and 'data-top="5" aria-pressed="true"' in rh and 'data-top="10"' in rh and "map-image.js" in rh and "let imgTop = 5;" in rj and "順位は数の多さだけを表します" in rj and '"計算値です（国の公表値ではありません）")' in rj and "基準日 ${ind.period}" in rj, "")
ok("出典ページに人口あたりの計算式と分母の出典がある", rates and all(r["formula"] in sh and r["denominator"]["source_name"] in sh for r in rates), "")
cj = (DOCS / "compare.js").read_text("utf8")
ch = (DOCS / "compare.html").read_text("utf8")
ok("2県比較は「都道府県比較」のページにあり、トップとランキングには置かない（古いリンク #compare は案内）", 'id="cmp-a"' in ch and 'id="cmp-b"' in ch and "compare.js" in ch and "cmp-a" not in ih and "cmp-a" not in rh and 'location.hash === "#compare"' in rj and 'location.replace("compare.html"' in rj, "")
ok("2県比較は資料ごとに見出しと基準日を付け、ちがう資料は比べないと明記", "ind.period" in cj and "cmp-group" in cj and "ちがう資料の行どうしは比べたり足したりできません" in ch, "")
ok("2県比較の「比較のポイント」は決まった手順で作った文で、理由や良し悪しは分からないことを明記", 'id="cmp-say"' in ch and "比較のポイント" in ch and "function pointRyu" in cj and "表の数字から決まった手順で作った文です" in ch and "理由や、地域・学校の良し悪しは、この数からは分かりません" in ch, "")
ok("2県比較は1.5倍などの目安で多い・少ないを判定せず、倍率は丸める前の値（整数の分数）で計算する", "CONC" not in cj and "人口の割に" not in cj and "BigInt" in cj and "丸める前の値で計算しています" in ch, "")
ok("2県比較の倍率は多い県の名前と一緒に書き、色の見方を表の上に出す", 'id="cmp-legend"' in ch and "cmp-ratio${c.lv ?" in cj and "`${nm(q.side)} ${q.t}倍`" in cj and ".sx.lv4" in (DOCS / "style.css").read_text("utf8"), "")
ok("2県比較：外国籍の児童生徒の合計に、内訳にない義務教育学校・中等教育学校が入ることを書く", "義務教育学校・中等教育学校" in cj and "外国籍の児童生徒（小・中・高等学校など）" in cj, "")
ok("2県比較：同じ県は比べず案内し、選んだ県はURL（cmp=）に残す", "異なる都道府県を選択してください" in cj and "?cmp=${state.a}-${state.b}" in cj, "")
ok("2県比較：Xで共有と縦長の画像保存（ブラウザの中で作る）", 'id="cmp-share"' in ch and 'id="cmp-img"' in ch and 'id="img-dialog"' in ch and "map-image.js" in ch and 'kind: "compare"' in cj and "function renderCompare" in (DOCS / "map-image.js").read_text("utf8"), "")
_menus = {}
for _pg in ("index", "ranking", "compare", "nihongo", "foreign", "guide", "sources"):
    _h = (DOCS / f"{_pg}.html").read_text("utf8")
    _m = re.search(r'<nav class="site-menu"[^>]*>(.*?)</nav>', _h, re.S)
    _f = re.search(r'<footer class="site-foot">(.*?)</footer>', _h, re.S)
    _menus[_pg] = ([re.sub(r"<[^>]+>", "", t) for t in re.findall(r"<a [^>]*>(.*?)</a>", _m.group(1))] if _m else None, _f.group(1) if _f else "")
ok("メニューは 地図・ランキング・都道府県比較・日本語指導・外国籍の子ども・3分でわかる の順。出典とお問い合わせはメニューに入れず、どのページも下部にある",
   all(m == ["地図", "ランキング", "都道府県比較", "日本語指導", "外国籍の子ども", "3分でわかる"] and 'href="sources.html"' in f and "情報の訂正・お問い合わせ" in f for m, f in _menus.values()), str({k: v[0] for k, v in _menus.items()}))

# ---- 入口サイトが読む形 ----
ok("regions.json の形（prefs[県].n・cities・generated）", regions.get("generated") and len(regions["prefs"]) == 47 and all("n" in p and "cities" in p for p in regions["prefs"].values()), "")
ok("regions の校数の合計＝日本語学校の校数", sum(p["n"] for p in regions["prefs"].values()) == cnt["jp"], "")
ok("regions に人数が入っていない", not re.search(r"enr_|cap_|size_|nat_pairs", json.dumps(regions)), "")

# ---- ページ ----
for page in ("index", "ranking", "compare", "nihongo", "foreign", "guide", "sources", "map", "region", "school", "changes"):
    ok(f"{page}.html がある", (DOCS / f"{page}.html").exists(), "")
for page in ("index", "ranking", "compare", "nihongo", "foreign", "guide", "sources"):
    h = (DOCS / f"{page}.html").read_text("utf8")
    ok(f"{page}.html に置き換え忘れがない", "{{" not in h and "[[" not in h, "")
    miss = [r for r in re.findall(r'(?:src|href)="([^"#:?]+)(?:\?[^"]*)?"', h) if not (DOCS / r).exists()]
    ok(f"{page}.html の参照先がある", not miss, str(miss[:4]))
# ---- 日本語指導のページ（data/nihongo_shido.json は fetch_nihongo_shido.py で国の表と照合済み。ここでは公開用の写しを点検）----
nj = load(DOCS / "data/nihongo_shido.json")
NJ = {y["year"]: y for y in nj["years"]}
ok("日本語指導：都道府県は01〜47の47件で、名前の重複なし", sorted(nj["prefs"]) == [f"{i:02d}" for i in range(1, 48)] and len(set(nj["prefs"].values())) == 47, "")
ok("日本語指導：調査年は2005〜2025年の12回", sorted(NJ) == [2005, 2006, 2007, 2008, 2010, 2012, 2014, 2016, 2018, 2021, 2023, 2025], str(sorted(NJ)))
ok("日本語指導：2025年の公立の発表値（外国籍73,313・日本国籍11,446）", NJ[2025]["nat"] == {"f": 73313, "j": 11446}, str(NJ[2025]["nat"]))
ok("日本語指導：地図の人数（stats.json）と最新年の合計が同じ", ref["nihongo"]["variants"][0]["national"] == sum(NJ[2025]["nat"].values()), "")
ok("日本語指導：2018年は訂正後の値（40,755・10,371）", NJ[2018]["nat"] == {"f": 40755, "j": 10371}, str(NJ[2018]["nat"]))
ok("日本語指導：基準日（2010年まで9月1日・2012年から5月1日）", all(y["as_of"][5:] == ("09-01" if y["year"] <= 2010 else "05-01") for y in nj["years"]), "")
ok("日本語指導：都道府県の和＝全国（外国籍）", all(sum(y["pref"]["f"].values()) == y["nat"]["f"] for y in nj["years"]), "")
ok("日本語指導：都道府県の和＝全国（日本国籍・2012年から）", all((sum(y["pref"]["j"].values()) == y["nat"]["j"]) if y["pref"]["j"] else y["year"] < 2012 for y in nj["years"]), "")
ok("日本語指導：学校種別の和＝全国", all(sum(v or 0 for v in y["type"]["nat"][k]) == y["nat"][k] for y in nj["years"] for k in ("f", "j")), "")
ok("日本語指導：義務教育学校は2016年より前は区分なし（0にしない）", all((y["type"]["nat"]["f"][3] is None) == (y["year"] < 2016) for y in nj["years"]), "")
ok("日本語指導：言語別の和＝全国", all(sum(L["nat"]) == y["nat"][k] for y in nj["years"] for k, L in y["lang"].items() if L), "")
ok("日本語指導：ネパール語は2025年だけ（それ以前は0にしない）", all(("ネパール語" in L["cats"]) == (y["year"] == 2025) for y in nj["years"] for L in y["lang"].values() if L), "")
ok("日本語指導：すべての値に出典の表がある", all(y["src"] and all(s["url"].startswith("https://www.e-stat.go.jp/") for s in y["src"].values()) for y in nj["years"]), "")
navs = {pg: (DOCS / f"{pg}.html").read_text("utf8") for pg in ("index", "ranking", "compare", "nihongo", "foreign", "guide")}
ok("日本語指導：全ページのメニューで都道府県比較の次にある", all(re.search(r'href="compare.html"[^>]*><span>都道府県<wbr>比較</span></a><a href="nihongo.html"[^>]*><span>日本語<wbr>指導</span></a>', h) for h in navs.values()), "")
ok("日本語指導：3分でわかるからリンクがある", 'href="nihongo.html"' in navs["guide"].split("<main")[-1], "")

# ---- 外国籍の子どものページ（data/foreign_jido.json は fetch_foreign_jido.py で国の表と照合済み。ここでは公開用の写しを点検）----
fj = load(DOCS / "data/foreign_jido.json")
FJ = {y["year"]: y for y in fj["years"]}
FT = {t["id"]: t for t in fj["types"]}
ok("外国籍：都道府県は01〜47の47件で、名前の重複なし", sorted(fj["prefs"]) == [f"{i:02d}" for i in range(1, 48)] and len(set(fj["prefs"].values())) == 47, "")
ok("外国籍：調査年は2009〜2025年の毎年（17回）、基準日は5月1日", sorted(FJ) == list(range(2009, 2026)) and all(y["as_of"] == f"{y['year']}-05-01" for y in fj["years"]), str(sorted(FJ)))
ok("外国籍：2025年の全国（小97,536・中40,650・高20,864・義務1,414・中等388・特別支援2,116）", {k: sum(v) for k, v in FJ[2025]["nat"].items()} == {"elem": 97536, "mid": 40650, "high": 20864, "compul": 1414, "second": 388, "special": 2116}, "")
_fo = ref["foreign"]
ok("外国籍：地図の人数（stats.json の合計＝特別支援学校を除く5種類）と2025年が同じ（全国と47都道府県）", _fo["variants"][0]["national"] == sum(sum(FJ[2025]["nat"][t]) for t in ("elem", "mid", "high", "compul", "second")) and all(_fo["variants"][0]["values"][c] == sum(sum(FJ[2025]["pref"][t][c]) for t in ("elem", "mid", "high", "compul", "second")) for c in fj["prefs"]), "")
ok("外国籍：都道府県の和＝全国（国立・公立・私立それぞれ、全年・全種類）", all([sum(v[i] for v in y["pref"][t].values()) for i in range(3)] == y["nat"][t] for y in fj["years"] for t in FT if y["pref"][t]), "")
ok("外国籍：都道府県別の有無（小中2009年〜・義務2016年〜・高中等特支2018年〜。それより前は null で0にしない）", all((y["pref"][t] is not None) == (y["year"] >= FT[t]["pref_from"]) and (y["nat"][t] is not None) == (y["year"] >= FT[t]["from"]) for y in fj["years"] for t in FT), "")
ok("外国籍：義務教育学校は2016年から（それより前は区分なし）", FT["compul"]["from"] == 2016 and all(FJ[y]["nat"]["compul"] is None for y in range(2009, 2016)), "")
ok("外国籍：すべての値に出典の表（e-Stat）がある", all(all(s["url"].startswith("https://www.e-stat.go.jp/") for s in y["src"].values()) and set(y["src"]) == {f"{t}_{k}" for t in FT for k, have in (("nat", y["nat"][t]), ("pref", y["pref"][t])) if have} for y in fj["years"]), "")
ok("外国籍：元の表の食いちがい（2016年義務教育学校7県・2020年愛知県）を記録している", len(fj["known"]) == 8 and sum(k["fixed"] for k in fj["known"]) == 1, str(len(fj["known"])))
ok("外国籍：全ページのメニューで日本語指導の次にある", all(re.search(r'href="nihongo.html"[^>]*><span>日本語<wbr>指導</span></a><a href="foreign.html"[^>]*><span>外国籍の<wbr>子ども</span></a>', h) for h in navs.values()), "")
ok("外国籍：3分でわかる・地図・ランキングからリンクがある", 'href="foreign.html"' in navs["guide"].split("<main")[-1] and "foreign.html" in (DOCS / "site.js").read_text("utf8") and "foreign.html" in (DOCS / "ranking.js").read_text("utf8"), "")

# ---- 就学状況のページ（data/shugaku.json は fetch_shugaku.py で e-Stat の表・国の結果資料と照合済み。ここでは公開用の写しを点検）----
sg = load(DOCS / "data/shugaku.json")
SV, SY = sg["v"], sg["years"]
_m = [c for c in SV if len(c) == 5]
_p = [c for c in SV if len(c) == 2 and c != "00"]
ok("就学状況：市区町村1,741・都道府県47・全国（名前の表と同じ）", len(_m) == 1741 and sorted(_p) == [f"{i:02d}" for i in range(1, 48)] and set(_m) == set(sg["munis"]) and "00" in SV, f"{len(_m)}/{len(_p)}")
ok("就学状況：調査年は2019・2021〜2025年（2019年は全国だけ）", SY == [2019, 2021, 2022, 2023, 2024, 2025] and sg["y"]["2019"].get("nat_only") and all("2019" not in SV[c] for c in _m + _p), str(SY))
_ys = [str(y) for y in SY if y >= 2021]
ok("就学状況：都道府県＝市区町村の和、全国＝都道府県の和（全年・全区分、空欄は0として足す）", all(SV[p_][y] == [None if SV["00"][y][i] is None else sum((SV[m][y][i] or 0) for m in _m if m[:2] == p_) for i in range(8)] for p_ in _p for y in _ys) and all(SV["00"][y] == [None if SV["00"][y][i] is None else sum(SV[p_][y][i] for p_ in _p) for i in range(8)] for y in _ys), "")
ok("就学状況：各行で①〜⑥の和＝計", all(sum(x or 0 for x in r[:6]) == r[6] for c in SV for r in SV[c].values()), "")
_n25 = SV["00"]["2025"]
ok("就学状況：2025年の全国が国の発表と一致（住民票177,726・①150,786・計177,497・不就学の可能性9,153）", _n25[7] == 177726 and _n25[0] == 150786 and _n25[6] == 177497 and _n25[2] + _n25[4] + (_n25[7] - _n25[6]) == 9153, str(_n25))
ok("就学状況：全国の不就学の可能性（③＋⑤＋⑦）が国の年度別の表と一致（19,420・10,046・8,183・8,601・8,430・9,153）", [SV["00"][str(y)][2] + SV["00"][str(y)][4] + SV["00"][str(y)][7] - SV["00"][str(y)][6] for y in SY] == [19420, 10046, 8183, 8601, 8430, 9153], "")
ok("就学状況：⑥その他は2023年から（2019・2021・2022年は null で0にしない）", all((SV[c][y][5] is None) == (int(y) < 2023) for c in SV for y in SV[c]), "")
ok("就学状況：2025年の1人以上いる市区町村1,298・10人以上753（国の報道発表資料）", sum(SV[m]["2025"][7] >= 1 for m in _m) == 1298 and sum(SV[m]["2025"][7] >= 10 for m in _m) == 753, "")
ok("就学状況：すべての年に出典がある（2021年からは e-Stat の表）", all(sg["y"][str(y)]["src"]["url"].startswith("https://www.e-stat.go.jp/" if y >= 2021 else "https://www.mext.go.jp/") for y in SY), "")
ok("就学状況：2021年の仙台市の空欄（②〜⑤）を null のまま残している", SV["04100"]["2021"][1:5] == [None] * 4 and [b[0] for b in sg["y"]["2021"]["blanks"]] == ["04100"] * 4, "")
ok("就学状況：外国籍の子どものページと互いに切り替えられ、メニューは「外国籍の子ども」を現在地にする", 'href="shugaku.html"' in (DOCS / "foreign.html").read_text("utf8") and 'href="foreign.html" aria-current="page"' in (DOCS / "shugaku.html").read_text("utf8"), "")

# ---- 就学状況のページの「この地域の学校の数」（data/gakkosu.json は fetch_gakkosu.py で学校基本調査の表の県・全国の行と照合済み）----
gk = load(DOCS / "data/gakkosu.json")
GV = gk["v"]
_gy = [str(y) for y in gk["years"]]
_out = lambda p_, y, i: (gk["outside"].get(p_, {}).get(y) or [0, 0, 0])[i]
ok("学校の数：就学状況と同じ市区町村1,741・都道府県47・全国に、2021〜2025年の小・中・義務教育学校の数がある", set(GV) == set(SV) and gk["years"] == [2021, 2022, 2023, 2024, 2025] and all(set(GV[c]) == set(_gy) and all(len(r) == 3 and all(isinstance(x, int) and x >= 0 for x in r) for r in GV[c].values()) for c in GV), "")
ok("学校の数：都道府県＝市区町村の和（＋表の「大阪市外」）、全国＝都道府県の和", all(GV[p_][y][i] == sum(GV[m][y][i] for m in _m if m[:2] == p_) + _out(p_, y, i) for p_ in _p for y in _gy for i in range(3)) and all(GV["00"][y][i] == sum(GV[p_][y][i] for p_ in _p) for y in _gy for i in range(3)), "")
ok("学校の数：全国が学校基本調査と一致（2025年 小18,607・中9,827・義務261、2024年 小18,822・中9,882・義務238）", GV["00"]["2025"] == [18607, 9827, 261] and GV["00"]["2024"] == [18822, 9882, 238], str(GV["00"]["2025"]))
ok("学校の数：政令指定都市20市は区の合計", len(gk["wards"]) == 20 and all(len(c) == 5 for c in gk["wards"]), str(len(gk["wards"])))
ok("学校の数：すべての年・種類に出典の表（e-Stat）がある", all(set(gk["y"][y]["src"]) == set(gk["kinds"]) and all(s_["url"].startswith("https://www.e-stat.go.jp/") for s_ in gk["y"][y]["src"].values()) for y in _gy), "")
ok("学校の数：就学状況のページに欄と出典の文がある", 'id="sg-sch"' in (DOCS / "shugaku.html").read_text("utf8") and 'id="sg-sch-src"' in (DOCS / "shugaku.html").read_text("utf8") and "data/gakkosu.json" in (DOCS / "shugaku.js").read_text("utf8"), "")

size = sum(p.stat().st_size for p in DOCS.rglob("*") if p.is_file())
ok("公開ファイル全体が10MB未満", size < 10_000_000, f"{size // 1024}KB")

bad = [r for r in results if not r[0]]
print(f"点検 {len(results)} 項目：合格 {len(results) - len(bad)}、不合格 {len(bad)}")
for _, name, detail in bad:
    print("不合格:", name, detail)
if bad:
    sys.exit(1)
