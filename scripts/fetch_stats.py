"""公的統計（都道府県別）を e-Stat から取り込み、全国の値と突き合わせて data/stats.json に書く。

元のファイルは raw/（git に入らない）に置く。標準ライブラリだけで動く。
python -I -X utf8 scripts/fetch_stats.py
"""
import json
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "data" / "stats.json"
UA = {"User-Agent": "nihongo-school-map-data-build"}
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
CHECKED = "2026-11-07"
TERMS = "e-Stat 利用規約を確認済み。出典を示し、加工した内容を記載して利用"

PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split()
CODE = {p: f"{i + 1:02d}" for i, p in enumerate(PREFS)}


def stat_url(sid):
    return f"https://www.e-stat.go.jp/stat-search/files?stat_infid={sid}"


def fetch(sid):
    RAW.mkdir(exist_ok=True)
    p = RAW / f"{sid}.xlsx"
    if not p.exists():
        req = urllib.request.Request(f"https://www.e-stat.go.jp/stat-search/file-download?statInfId={sid}&fileKind=0", headers=UA)
        with urllib.request.urlopen(req, timeout=180) as r:
            p.write_bytes(r.read())
        time.sleep(0.6)
    return p


def clean(x):
    return re.sub(r"[\s　]", "", unicodedata.normalize("NFKC", str(x))) if x is not None else ""


def num(x):
    s = clean(x).replace(",", "")
    if re.fullmatch(r"-?\d+(\.0+)?", s):
        return int(float(s))
    return 0 if s in ("-", "－", "‐", "―") else None


def sheets(path):
    """振り仮名を除いて、シートごとの行を返す"""
    z = zipfile.ZipFile(path)
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si"):
            strings.append("".join(t.text or "" for part in si if part.tag != M + "rPh" for t in part.iter(M + "t")))
    rel = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    for s in ET.fromstring(z.read("xl/workbook.xml")).find(M + "sheets"):
        target = rel[s.get(RID)].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for r in ET.fromstring(z.read(target)).iter(M + "row"):
            row = {}
            for c in r.findall(M + "c"):
                col = re.match(r"[A-Z]+", c.get("r")).group(0)
                idx = 0
                for ch in col:
                    idx = idx * 26 + ord(ch) - 64
                v = c.find(M + "v")
                if v is not None:
                    row[idx - 1] = strings[int(v.text)] if c.get("t") == "s" else v.text
            rows.append([row.get(i) for i in range(max(row) + 1)] if row else [])
        yield s.get("name"), rows


def first_sheet(path):
    return next(sheets(path))[1]


def check(name, got, want):
    if got != want:
        sys.exit(f"合計が合いません：{name} 県の合計 {got} ／ 全国の値 {want}")
    print(f"  一致 {name}: {got:,}")


def pref_table(rows, header_word):
    """都道府県の行から、見出しが header_word の列の数字を読む。全国の行も返す"""
    cells = [[clean(c) for c in r] for r in rows]
    hdr = next(r for r in cells if header_word in r)
    col = hdr.index(header_word)
    vals, national = {}, None
    for r, raw in zip(cells, rows):
        label = next((c for c in r[:col] if c), "")
        if col >= len(raw):
            continue
        if label in CODE and CODE[label] not in vals:
            vals[CODE[label]] = num(raw[col])
        elif label in ("計", "合計", "全国", "総数") and national is None and num(raw[col]) is not None:
            national = num(raw[col])
    if len(vals) != 47 or any(v is None for v in vals.values()):
        sys.exit(f"都道府県の行が読めません：{len(vals)}")
    return vals, national


# ---- ① 在留外国人統計：在留資格「留学」----
RYU_SID, RYU_CHECK_SID = "000040472265", "000040472260"
print("① 在留資格「留学」")
z = zipfile.ZipFile(fetch(RYU_SID))
defs = ET.fromstring(z.read("xl/pivotCache/pivotCacheDefinition1.xml"))
fields = []
for cf in defs.iter(M + "cacheField"):
    si = cf.find(M + "sharedItems")
    fields.append((clean(cf.get("name")), [x.get("v") for x in (si if si is not None else [])]))
F_ST = next(i for i, f in enumerate(fields) if f[0] == "在留資格")
F_PF = next(i for i, f in enumerate(fields) if f[0] == "都道府県")
ryu, all_status = Counter(), 0
with z.open("xl/pivotCache/pivotCacheRecords1.xml") as f:
    for _, el in ET.iterparse(f):
        if el.tag == M + "r":
            v = list(el)
            n = int(float(v[-1].get("v") or 0))
            all_status += n
            if clean(fields[F_ST][1][int(v[F_ST].get("v"))]).endswith("留学"):
                ryu[clean(fields[F_PF][1][int(v[F_PF].get("v"))]).split(":")[-1]] += n
            el.clear()
unallocated = sum(v for k, v in ryu.items() if k not in CODE)
ryu_vals = {CODE[k]: v for k, v in ryu.items() if k in CODE}
if len(ryu_vals) != 47:
    sys.exit("留学：都道府県の数が47ではありません")
# 別の表（第1表：国籍・地域別 在留資格別）の総数と突き合わせる
rows = first_sheet(fetch(RYU_CHECK_SID))
cells = [[clean(c) for c in r] for r in rows]
nat = next(num(r[4]) for r, c in zip(rows, cells) if len(c) > 4 and c[1] == "総数" and c[2] == "総数" and c[3] == "留学")
check("留学（第1表の総数）", sum(ryu_vals.values()) + unallocated, nat)
check("在留外国人の総数（発表値）", all_status, 4125395)

# ---- ② 学校基本調査：外国人児童生徒数 ----
print("② 学校基本調査")
SCHOOL = {"elem": ("小学校", "000040393124"), "mid": ("中学校", "000040393164"), "high": ("高等学校", "000040393255"), "gimu": ("義務教育学校", "000040393224"), "chuto": ("中等教育学校", "000040393286")}
SCHOOL_CHECK = {"elem": "000040393705", "mid": "000040393732", "high": "000040393792", "gimu": "000040393759", "chuto": "000040393836"}
kihon = {}
for k, (name, sid) in SCHOOL.items():
    vals, national = pref_table(first_sheet(fetch(sid)), "計")
    if national is not None:
        check(name, sum(vals.values()), national)
    # 全国だけの表（報告書掲載集計）に同じ数字があるかを確かめる
    flat = {num(c) for r in first_sheet(fetch(SCHOOL_CHECK[k])) for c in r}
    if sum(vals.values()) not in flat:
        sys.exit(f"全国の表に同じ数字がありません：{name} {sum(vals.values())}")
    print(f"  一致 {name}（全国の表）: {sum(vals.values()):,}")
    kihon[k] = vals
total = {c: sum(kihon[k][c] for k in SCHOOL) for c in CODE.values()}
print(f"  合計（5種類）: {sum(total.values()):,}")

# ---- ③ 日本語指導が必要な児童生徒 ----
print("③ 日本語指導")
NIHONGO = {"foreign": ("000040478842", 73313), "japan": ("000040478846", 11446)}
nihongo = {}
for k, (sid, want) in NIHONGO.items():
    rows = first_sheet(fetch(sid))
    # 公立学校が対象であることは表の題名に書かれていないため、文科省の発表資料で確認した（2026-11-07）
    vals, national = pref_table(rows, "合計")
    if national is not None:
        check(f"{k}（表の全国の行）", sum(vals.values()), national)
    check(f"{k}（発表値）", sum(vals.values()), want)
    nihongo[k] = vals
nihongo_all = {c: nihongo["foreign"][c] + nihongo["japan"][c] for c in CODE.values()}
check("合計（発表値）", sum(nihongo_all.values()), 84759)

# ---- ④ 住民基本台帳の人口（人口あたりの分母）----
# 留学（2025年12月末）と基準日がそろう表だけを使う。そろわない時点に変えるときは POP_SID = None にすると人口あたりを出さない
POP_SID, POP_JP_SID, POP_FR_SID = "000040479047", "000040479051", "000040479055"  # 令和8年1月1日 総計／日本人住民／外国人住民（都道府県別）
POP_ASOF, POP_PERIOD, POP_TITLE = "2026-01-01", "2026年1月1日", "令和8年1月1日住民基本台帳人口"
RYU_ASOF, RYU_PERIOD = "2025-12-31", "2025年12月末"


def pop_table(sid):
    """住民基本台帳の都道府県別の表から「人口 計」の列を読む。合計の行も返す"""
    rows = first_sheet(fetch(sid))
    cells = [[clean(c) for c in r] for r in rows]
    if POP_TITLE not in cells[0][0]:
        sys.exit(f"住民基本台帳の表の時点が違います：{cells[0][0]}")
    h = next(i for i, r in enumerate(cells) if "計" in r)
    col = cells[h].index("計")
    if cells[h - 1][col] != "人口":
        sys.exit("住民基本台帳の表の列が読めません")
    vals, national = {}, None
    for r, raw in zip(cells, rows):
        name = next((c for c in r[:col] if c in CODE or c == "合計"), "")  # 左の列は団体コード・名前・男・女
        if not name or col >= len(raw):
            continue
        if name in CODE and CODE[name] not in vals:
            vals[CODE[name]] = num(raw[col])
        elif name == "合計" and national is None:
            national = num(raw[col])
    if len(vals) != 47 or any(v is None for v in vals.values()) or national is None:
        sys.exit(f"住民基本台帳の都道府県の行が読めません：{len(vals)}")
    return vals, national


def per10k(n, d):
    return float((Decimal(n) * 10000 / Decimal(d)).quantize(Decimal("0.1"), ROUND_HALF_UP))


rates = []
if POP_SID:
    print("④ 住民基本台帳の人口")
    gap = (date.fromisoformat(POP_ASOF) - date.fromisoformat(RYU_ASOF)).days
    if abs(gap) > 31:
        sys.exit(f"人口（{POP_ASOF}）と留学（{RYU_ASOF}）の基準日が{gap}日ずれています。そろう表に直すか、POP_SID = None にしてください")
    pop, pop_nat = pop_table(POP_SID)
    check("住民基本台帳の人口（総計）", sum(pop.values()), pop_nat)
    jp, jp_nat = pop_table(POP_JP_SID)
    fr, fr_nat = pop_table(POP_FR_SID)
    check("日本人住民＋外国人住民＝総計", jp_nat + fr_nat, pop_nat)
    bad = [c for c in CODE.values() if jp[c] + fr[c] != pop[c] or ryu_vals[c] > fr[c]]
    if bad:
        sys.exit(f"都道府県ごとの人口が合いません（または留学が外国人住民より多い）：{bad}")
    print("  一致 47都道府県ごとに 日本人住民＋外国人住民＝総計、留学≦外国人住民")
    ryu_nat = sum(ryu_vals.values()) + unallocated
    rates.append({
        "id": "ryugaku_pop", "label": "住民1万人あたりの在留資格「留学」の人数", "unit": "人", "per": 10000, "digits": 1,
        "numerator": {"indicator": "ryugaku", "variant": "all"},
        "period": f"{RYU_PERIOD}／{POP_PERIOD}",
        "formula": f"在留資格「留学」の人数（{RYU_PERIOD}）÷ 住民基本台帳の人口（{POP_PERIOD}）× 10,000",
        "rounding": "小数第2位を四捨五入",
        "note": "国の公表値ではなく、このサイトが2つの国の統計から計算した値です。",
        "why": f"どちらも住んでいる都道府県で数えた人数で、基準日の差は{gap}日です。在留資格「留学」の人も、原則として外国人住民として住民基本台帳に記録されます。",
        "national": per10k(ryu_nat, pop_nat),
        "values": {c: per10k(ryu_vals[c], pop[c]) for c in CODE.values()},
        "denominator": {
            "label": "住民基本台帳の人口（日本人住民と外国人住民の合計）", "as_of": POP_ASOF, "period": POP_PERIOD,
            "source_name": "総務省「住民基本台帳に基づく人口、人口動態及び世帯数」令和8年1月1日現在（e-Stat）", "source_url": stat_url(POP_SID),
            "national": pop_nat, "values": pop,
        },
        "terms": TERMS,
    })
    print(f"  全国 {rates[0]['national']}人（1万人あたり）")

MEXT_KIHON = "https://www.e-stat.go.jp/stat-search/files?toukei=00400001&tstat=000001011528"
MEXT_NIHONGO = "https://www.mext.go.jp/b_menu/houdou/31/09/1421569_00007.htm"
out = {
    "checked": CHECKED,
    "indicators": [
        {
            "id": "ryugaku", "label": "在留資格「留学」の人数", "note": "住んでいる都道府県で数えた人数です。学校の所在地ではありません。", "unit": "人", "as_of": RYU_ASOF, "period": RYU_PERIOD,
            "scope": "住んでいる都道府県で数えた人数です。学校の所在地ではありません。大学・専門学校・日本語学校の学生のほか、高校生なども含みます。",
            "source_name": "出入国在留管理庁「在留外国人統計」2025年12月末（e-Stat）", "source_url": stat_url(RYU_SID),
            "processing": f"「在留外国人統計テーブルデータ」の在留資格「留学」を都道府県ごとに合計して作成。住所が未定・不詳の{unallocated:,}人は都道府県に入れていません。",
            "terms": TERMS, "public": True,
            "variants": [{"id": "all", "label": "合計", "national": sum(ryu_vals.values()) + unallocated, "unallocated": unallocated, "url": stat_url(RYU_SID), "values": ryu_vals}],
        },
        {
            "id": "foreign", "label": "外国籍の小中高校生", "note": "国立・公立・私立の学校の外国人児童生徒です。特別支援学校や外国人学校などは含みません。", "unit": "人", "as_of": "2025-05-01", "period": "2025年5月1日",
            "scope": "国立・公立・私立の小学校、中学校、高等学校（全日制・定時制）、義務教育学校、中等教育学校の外国人児童生徒です。特別支援学校、高校の通信制、各種学校（外国人学校など）は含みません。",
            "source_name": "文部科学省「学校基本調査」令和7年度（e-Stat）", "source_url": MEXT_KIHON,
            "processing": "「合計」は小学校・中学校・高等学校・義務教育学校・中等教育学校の5つの表を足して作成。義務教育学校と中等教育学校は「合計」にだけ入れています。",
            "terms": TERMS, "public": True,
            "variants": [
                {"id": "all", "label": "合計", "national": sum(total.values()), "url": MEXT_KIHON, "values": total},
                {"id": "elem", "label": "小学校", "national": sum(kihon["elem"].values()), "url": stat_url(SCHOOL["elem"][1]), "values": kihon["elem"]},
                {"id": "mid", "label": "中学校", "national": sum(kihon["mid"].values()), "url": stat_url(SCHOOL["mid"][1]), "values": kihon["mid"]},
                {"id": "high", "label": "高等学校", "national": sum(kihon["high"].values()), "url": stat_url(SCHOOL["high"][1]), "values": kihon["high"]},
            ],
        },
        {
            "id": "nihongo", "label": "公立学校で日本語指導が必要な児童生徒", "note": "公立学校が対象で、日本国籍の児童生徒も含みます。外国籍の小中高校生の数とは別の統計です。", "unit": "人", "as_of": "2025-05-01", "period": "2025年5月1日",
            "scope": "公立の小・中・高等学校、義務教育学校、中等教育学校、特別支援学校の児童生徒です。日本国籍の児童生徒も含むので「外国人児童生徒の数」ではありません。",
            "source_name": "文部科学省「日本語指導が必要な児童生徒の受入状況等に関する調査」令和7年度（e-Stat）", "source_url": MEXT_NIHONGO,
            "processing": "「合計」は外国籍と日本国籍の表を足して作成（発表の全国値84,759人と一致）。",
            "terms": TERMS, "public": True,
            "variants": [
                {"id": "all", "label": "合計", "national": sum(nihongo_all.values()), "url": MEXT_NIHONGO, "values": nihongo_all},
                {"id": "foreign", "label": "外国籍", "national": sum(nihongo["foreign"].values()), "url": stat_url(NIHONGO["foreign"][0]), "values": nihongo["foreign"]},
                {"id": "japan", "label": "日本国籍", "national": sum(nihongo["japan"].values()), "url": stat_url(NIHONGO["japan"][0]), "values": nihongo["japan"]},
            ],
        },
    ],
    "rates": rates,
}
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf8")
print("書き出し", OUT)
