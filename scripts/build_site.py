"""data/ の公開用データと scripts/site/ から docs/ を作り直す。

python -I -X utf8 scripts/build_site.py
"""
import hashlib
import json
import math
import shutil
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "scripts" / "site"
DOCS = ROOT / "docs"
CFG = json.loads((ROOT / "config" / "site.json").read_text("utf8"))
SCHOOLS = [s for s in json.loads((ROOT / "data" / "schools.json").read_text("utf8")) if s["public"]]
STATS = json.loads((ROOT / "data" / "stats.json").read_text("utf8"))
TYPE_LABEL = {"jp": "日本語学校", "univ": "大学", "jc": "短大", "kosen": "高専", "senmon": "専門学校"}
HIGHER = ("univ", "jc", "kosen")
FILES = ("site.js", "map-image.js", "ranking.js", "compare.js", "nihongo.js", "foreign.js", "shugaku.js", "style.css")
# リンク点検で開けなかったURLの直し先（config/link_fixes.json）。null は公式サイトのリンクを出さない
_fix = ROOT / "config" / "link_fixes.json"
FIX = json.loads(_fix.read_text("utf8")) if _fix.exists() else {"website": {}, "address_basis": {}}


def nice(v):
    """2桁に丸めて、凡例で読みやすい区切りにする"""
    if v <= 0:
        return 0
    m = 10 ** max(0, int(math.floor(math.log10(v))) - 1)
    return int(round(v / m) * m)


def breaks(values):
    """人数の階級（5段階）。都道府県が同じくらいずつ入る区切りを丸める"""
    xs = sorted(v for v in values if v and v > 0)
    out = []
    for q in (.2, .4, .6, .8):
        b = nice(xs[min(len(xs) - 1, int(len(xs) * q))])
        if out and b <= out[-1]:
            b = out[-1] + max(1, nice(out[-1] * .1))
        out.append(b)
    return out


def write_json(rel, obj):
    p = DOCS / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf8")


def public_schools():
    bases, index = [], {}

    def base(b):
        k = b["name"] + "|" + b["url"]
        if k not in index:
            index[k] = len(bases)
            bases.append({"name": b["name"], "url": b["url"]})
        return index[k]

    out = []
    for s in SCHOOLS:
        r = {"i": s["id"], "n": s["name"], "t": s["type"], "p": s["pref_code"], "b": [base(b) for b in s["list_basis"]], "ck": s["checked"]}
        if s["sub"]:
            r["s"] = s["sub"]
        if s["city_code"]:
            r["cc"], r["c"] = s["city_code"], s["city"]
        if s["address"]:
            r["a"] = s["address"]
            ab = s["address_basis"]
            k = ab["name"] + "|" + ab["url"]
            if k in index or s["type"] != "jp":
                r["ab"] = base(ab)
            else:
                r["an"], r["au"] = ab["name"], FIX["address_basis"].get(ab["url"], ab["url"])
        if s["lat"] is not None:
            r["la"], r["ln"], r["lv"] = s["lat"], s["lng"], s["location_level"]
        site = FIX.get("website_by_id", {}).get(s["id"]) or FIX["website"].get(s["website"], s["website"])
        if site:
            r["u"] = site
        if s["status"]:
            r["st"] = s["status"]
        out.append(r)
    return {"generated": CFG["checked"], "bases": bases, "schools": out}


def regions():
    prefs = {}
    names = {}
    for s in SCHOOLS:
        names[s["pref_code"]] = s["pref"]
    for code in sorted(names):
        group = [s for s in SCHOOLS if s["pref_code"] == code]
        jp = [s for s in group if s["type"] == "jp"]
        cities = defaultdict(lambda: {"n": 0})
        for s in jp:
            if s["city_code"]:
                c = cities[s["city_code"]]
                c["n"] += 1
                c["name"] = s["city"]
        cnt = Counter(s["type"] for s in group)
        prefs[code] = {
            "name": names[code], "n": cnt["jp"], "higher": {t: cnt[t] for t in HIGHER}, "senmon": cnt["senmon"],
            "no_city": sum(1 for s in jp if not s["city_code"]),
            "cities": [{"code": k, "name": v["name"], "n": v["n"]} for k, v in sorted(cities.items())],
        }
    return {"generated": CFG["checked"], "national": dict(Counter(s["type"] for s in SCHOOLS)), "prefs": prefs}


def public_stats():
    out = json.loads(json.dumps(STATS))
    out["indicators"] = [i for i in out["indicators"] if i["public"]]
    for ind in out["indicators"]:
        for v in ind["variants"]:
            v["breaks"] = breaks(list(v["values"].values()))
    return out


def fmt(n):
    return f"{n:,}"


def build_pages(stats):
    inds = {i["id"]: i for i in stats["indicators"]}
    cnt = Counter(s["type"] for s in SCHOOLS)
    higher = sum(cnt[t] for t in HIGHER)
    no_addr = sum(1 for s in SCHOOLS if s["type"] == "jp" and not s["address"])
    no_pos = sum(1 for s in SCHOOLS if s["lat"] is None)
    rows = []
    for ind in stats["indicators"]:
        v = ind["variants"][0]
        rows.append(
            f'<tr><th scope="row">{ind["label"]}</th><td>{ind["scope"]}</td><td class="num"><a href="{v["url"]}" target="_blank" rel="noopener">{fmt(v["national"])}人</a><br><small>{ind["period"]}</small></td></tr>')
    guide_table = "".join(rows)
    src_rows = []
    for ind in stats["indicators"]:
        links = "／".join(f'<a href="{v["url"]}" target="_blank" rel="noopener">{v["label"]}</a>' for v in ind["variants"])
        src_rows.append(
            f'<section class="src"><h3>{ind["label"]}</h3><dl>'
            f'<dt>出典</dt><dd><a href="{ind["source_url"]}" target="_blank" rel="noopener">{ind["source_name"]}</a></dd>'
            f'<dt>基準日</dt><dd>{ind["period"]}</dd><dt>対象</dt><dd>{ind["scope"]}</dd>'
            f'<dt>加工内容</dt><dd>{ind["processing"]}</dd><dt>元の表</dt><dd>{links}</dd><dt>利用条件</dt><dd>{ind["terms"]}（{stats["checked"]}）</dd></dl></section>')
    for r in stats.get("rates", []):
        n, d = inds[r["numerator"]["indicator"]], r["denominator"]
        src_rows.append(
            f'<section class="src"><h3>{r["label"]}（計算値）</h3><dl>'
            f'<dt>計算式</dt><dd>{r["formula"]}（{r["rounding"]}）</dd>'
            f'<dt>分子</dt><dd><a href="{n["source_url"]}" target="_blank" rel="noopener">{n["source_name"]}</a>（基準日 {n["period"]}）</dd>'
            f'<dt>分母</dt><dd><a href="{d["source_url"]}" target="_blank" rel="noopener">{d["source_name"]}</a>（基準日 {d["period"]}）。{d["label"]}</dd>'
            f'<dt>そろえた点</dt><dd>{r["why"]}</dd><dt>注意</dt><dd>{r["note"]}ランキングのページで見られます。'
            f'外国籍の小中高校生と日本語指導の人数は、住民の人口とは対象（年齢や学校の種類）がそろわないため、人口あたりを出していません。</dd>'
            f'<dt>利用条件</dt><dd>{r["terms"]}（{stats["checked"]}）</dd></dl></section>')
    repl = {
        "{{n_jp}}": fmt(cnt["jp"]), "{{n_higher}}": fmt(higher), "{{n_univ}}": fmt(cnt["univ"]), "{{n_jc}}": fmt(cnt["jc"]), "{{n_kosen}}": fmt(cnt["kosen"]),
        "{{n_senmon}}": fmt(cnt["senmon"]), "{{n_total}}": fmt(len(SCHOOLS)), "{{no_addr}}": fmt(no_addr), "{{no_pos}}": fmt(no_pos),
        "{{guide_table}}": guide_table, "{{source_sections}}": "".join(src_rows), "{{checked}}": CFG["checked"],
        "{{gaiku_ver}}": CFG["location_versions"]["gaiku"], "{{oaza_ver}}": CFG["location_versions"]["oaza"],
        "{{report_url}}": CFG["report_url"],
    }
    tpl = (SITE / "pages" / "_template.html").read_text("utf8")
    # 改行の違いで値が変わらないようにする（手元の Windows と GitHub の自動更新で同じ結果にするため）
    hashes = {name: hashlib.md5((SITE / name).read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:8] for name in FILES}
    pages = {
        "index": ("日本語学校・留学生 全国マップ", "地域の学校の場所と、外国人留学生などの公的統計を地図で確認できます。", "", True),
        "ranking": ("ランキング｜日本語学校・留学生 全国マップ", "都道府県と市区町村の学校の数、都道府県の人数を多い順に並べます。", "ランキング", False),
        "compare": ("都道府県比較｜日本語学校・留学生 全国マップ", "2つの都道府県を選んで、学校の数と国の統計の人数を資料ごとに並べ、どちらが何倍多いかを示します。", "都道府県比較", False),
        "nihongo": ("日本語指導｜日本語学校・留学生 全国マップ", "公立学校で日本語指導が必要な児童生徒について、国の調査から人数と変化（推移・言語別・都道府県別・学校種別）を確認できます。", "日本語指導", False),
        "foreign": ("外国籍の子ども｜日本語学校・留学生 全国マップ", "小・中・高等学校などに通う外国籍の児童生徒について、国の調査（学校基本調査）から人数と変化（推移・都道府県別・学校種別・国立公立私立別）を確認できます。", "外国籍の子ども", False),
        "shugaku": ("外国籍の子どもの就学状況｜日本語学校・留学生 全国マップ", "住民票がある小・中学校の年齢の外国籍の子どもについて、国の調査（外国人の子供の就学状況等調査）から、市区町村ごとの就学状況（学校に在籍・不就学・確認できずなど）と推移を確認できます。", "就学状況", False),
        "guide": ("3分でわかる 日本語学校と留学生", "地図の点と色の見方、3つの人数のちがいを短く説明します。", "3分でわかる", False),
        "sources": ("出典・利用条件", "地図で使っている資料、基準日、加工内容、利用条件をまとめています。", "出典", False),
    }
    for pid, (title, desc, _nav, with_map) in pages.items():
        body = (SITE / "pages" / f"{pid}.html").read_text("utf8")
        nav = "".join(
            f'<a href="{p}.html"{" aria-current=\"page\"" if p == pid or (p, pid) == ("foreign", "shugaku") else ""}><span>{label}</span></a>'
            # <wbr> はスマホでメニューを1行におさめるときに2行に折ってよい位置（CSS の word-break: keep-all と組み合わせる）
            for p, label in (("index", "地図"), ("ranking", "ランキング"), ("compare", "都道府県<wbr>比較"), ("nihongo", "日本語<wbr>指導"), ("foreign", "外国籍の<wbr>子ども"), ("guide", "3分で<wbr>わかる")))
        html = tpl.replace("[[title]]", title).replace("[[desc]]", desc).replace("[[pid]]", pid).replace("[[nav]]", nav).replace("[[body]]", body)
        html = html.replace("[[page_url]]", CFG["site_url"] + ("" if pid == "index" else f"{pid}.html")).replace("[[site_name]]", CFG["site_name"]).replace("[[site_url]]", CFG["site_url"])
        html = html.replace("[[css]]", hashes["style.css"]).replace("[[js]]", hashes["site.js"])
        map_head = '<link rel="stylesheet" href="vendor/leaflet.css">' if with_map else ""
        map_foot = f'<script src="vendor/leaflet.js"></script><script src="map-image.js?v={hashes["map-image.js"]}"></script><script src="site.js?v={hashes["site.js"]}"></script>' if with_map else ""
        if pid == "ranking":
            map_foot = f'<script src="map-image.js?v={hashes["map-image.js"]}"></script><script src="ranking.js?v={hashes["ranking.js"]}"></script>'
        if pid == "compare":
            map_foot = f'<script src="map-image.js?v={hashes["map-image.js"]}"></script><script src="compare.js?v={hashes["compare.js"]}"></script>'
        if pid == "nihongo":
            map_foot = f'<script src="map-image.js?v={hashes["map-image.js"]}"></script><script src="nihongo.js?v={hashes["nihongo.js"]}"></script>'
        if pid == "foreign":
            map_foot = f'<script src="map-image.js?v={hashes["map-image.js"]}"></script><script src="foreign.js?v={hashes["foreign.js"]}"></script>'
        if pid == "shugaku":
            map_foot = f'<script src="map-image.js?v={hashes["map-image.js"]}"></script><script src="shugaku.js?v={hashes["shugaku.js"]}"></script>'
        html = html.replace("[[map_head]]", map_head).replace("[[map_foot]]", map_foot)
        for k, v in repl.items():
            html = html.replace(k, v)
        (DOCS / f"{pid}.html").write_text(html, "utf8")
    # 以前のページのURLは、地図のページへ案内する
    redirect = (SITE / "pages" / "_redirect.html").read_text("utf8")
    for old in ("map", "region", "school", "changes"):
        (DOCS / f"{old}.html").write_text(redirect, "utf8")


def clear(folder):
    """ファイルは全部消す。同期ソフトなどが使用中の空フォルダは残ってもよいので、消せなくても止めない。"""
    for p in folder.iterdir():
        if p.is_dir():
            clear(p)
            try:
                p.rmdir()
            except OSError:
                pass
        else:
            p.unlink()


def main():
    DOCS.mkdir(exist_ok=True)
    clear(DOCS)
    (DOCS / ".nojekyll").write_text("", "utf8")
    shutil.copytree(SITE / "vendor", DOCS / "vendor", dirs_exist_ok=True)
    for f in (SITE / "assets").iterdir():
        shutil.copy(f, DOCS / f.name)
    for name in FILES:
        shutil.copy(SITE / name, DOCS / name)
    (DOCS / "data").mkdir(exist_ok=True)
    shutil.copy(ROOT / "data" / "geo" / "prefectures.json", DOCS / "data" / "prefectures.json")
    # 画像保存用の地図データ（都道府県ごとの市区町村の境界・線路・駅。scripts/build_geo.py で作る）
    (DOCS / "data" / "geo").mkdir(exist_ok=True)
    for f in sorted((ROOT / "data" / "geo").glob("p[0-9][0-9].json")) + [ROOT / "data" / "geo" / "index.json"]:
        shutil.copy(f, DOCS / "data" / "geo" / f.name)
    stats = public_stats()
    write_json("data/schools.json", public_schools())
    write_json("data/stats.json", stats)
    write_json("data/regions.json", regions())
    # 日本語指導が必要な児童生徒（scripts/fetch_nihongo_shido.py が国の表から作り、照合済み）
    write_json("data/nihongo_shido.json", json.loads((ROOT / "data" / "nihongo_shido.json").read_text("utf8")))
    # 外国籍の児童生徒（scripts/fetch_foreign_jido.py が学校基本調査の表から作り、照合済み）
    write_json("data/foreign_jido.json", json.loads((ROOT / "data" / "foreign_jido.json").read_text("utf8")))
    # 外国人の子供の就学状況（scripts/fetch_shugaku.py が e-Stat の市区町村別データから作り、全国は国の表と照合済み）
    write_json("data/shugaku.json", json.loads((ROOT / "data" / "shugaku.json").read_text("utf8")))
    # 小・中学校などの数（scripts/fetch_gakkosu.py が学校基本調査の市町村別学校数から作り、県・全国の行と照合済み）
    write_json("data/gakkosu.json", json.loads((ROOT / "data" / "gakkosu.json").read_text("utf8")))
    build_pages(stats)
    print("作成", DOCS, "ファイル数", sum(1 for f in DOCS.rglob("*") if f.is_file()), "schools.json KB", (DOCS / "data/schools.json").stat().st_size // 1024)


if __name__ == "__main__":
    main()
