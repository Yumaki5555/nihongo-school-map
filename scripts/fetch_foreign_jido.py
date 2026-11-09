"""文部科学省「学校基本調査」の外国人児童生徒の表を e-Stat から取り込み、
外国籍の子どものページ（foreign.html）用に data/foreign_jido.json を書く。

python -I -X utf8 scripts/fetch_foreign_jido.py

- 元の表は raw/foreign_jido/（git に入らない）。無いものだけ取りに行く（月1回の自動更新では動かさない）。
- 都道府県別は e-Stat の「報告書未掲載集計」などの表（小学校・中学校は2009年から、義務教育学校は2016年から、
  高等学校・中等教育学校・特別支援学校は2018年から）。全国は報告書の表（2009年からすべて）。
- 使う数は「計（国公私立）」の国立・公立・私立。計は3つの和で、表の計の欄と照合する。
- 数字は推測しない。表がない年・区分は null（0 にしない）。
- 照合：都道府県が47件そろう、計＝国立＋公立＋私立、都道府県の和＝全国の表、表の「計」の行、
  2025年＝地図の数（data/stats.json）。食いちがいがあれば止まる（KNOWN に書いた元の表の誤りだけは、理由を残して通す）。
- 表の番号は e-Stat の検索（学校基本調査・年ごと・「外国人」を含む表）で集め、表題で学校の種類と全国・都道府県別を見分けた（2026-11-09）。
"""
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw" / "foreign_jido"
OUT = ROOT / "data" / "foreign_jido.json"
UA = {"User-Agent": "nihongo-school-map-data-build"}
CHECKED = "2026-11-09"
TERMS = "e-Stat 利用規約を確認済み。出典を示し、加工した内容を記載して利用"
ESTAT = "https://www.e-stat.go.jp/stat-search/files?toukei=00400001&tstat=000001011528"

PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split()
CODE = {p: f"{i + 1:02d}" for i, p in enumerate(PREFS)}
# from＝その学校の種類がある最初の年、pref_from＝都道府県別の表がある最初の年
TYPES = [
    {"id": "elem", "label": "小学校", "from": 2009, "pref_from": 2009},
    {"id": "mid", "label": "中学校", "from": 2009, "pref_from": 2009},
    {"id": "high", "label": "高等学校（全日制・定時制）", "short": "高等学校", "from": 2009, "pref_from": 2018},
    {"id": "compul", "label": "義務教育学校", "from": 2016, "pref_from": 2016},
    {"id": "second", "label": "中等教育学校", "from": 2009, "pref_from": 2018},
    {"id": "special", "label": "特別支援学校", "from": 2009, "pref_from": 2018},
]
# 元の表の誤りで照合が合わないもの {(年, 表の key, 都道府県コード): 理由}。値は国立・公立・私立の欄を使う
_K16 = "元の表の「計」の欄が0になっています。国立・公立・私立の欄の和が全国の表と一致するため、その欄を使っています"
KNOWN = {(2016, "compul_pref", c): _K16 for c in ("03", "08", "12", "13", "14", "27", "28")}
# 元の表の欄どうしが合わず、同じ資料のほかの欄から値が1つに決まるもの {(年, 表の key, 都道府県コード): (元の [計,国,公,私], 直した値, 理由)}
FIX = {
    (2020, "compul_pref", "23"): ([1, 0, 0, 0], [1, 0, 1, 0], "元の表の愛知県の行は計1人で、国立・公立・私立の欄がすべて0人です。全国の表の公立（613人）と都道府県の公立の和（612人）の差から、公立1人としています"),
}

# 使う表 {年: {学校の種類_nat（全国）/_pref（都道府県別）: (statInfId, 表題)}}
TABLES = {
    2009: {
        "elem_nat": ("000006196728", "30 外国人児童数"),
        "elem_pref": ("000007567605", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000006196755", "57 外国人生徒数"),
        "mid_pref": ("000007567644", "中学校都道府県別外国人生徒数"),
        "high_nat": ("000006196789", "91 外国人生徒数"),
        "second_nat": ("000006196834", "136 外国人生徒数"),
        "special_nat": ("000006196860", "162 外国人在学者数"),
    },
    2010: {
        "elem_nat": ("000008349709", "30 外国人児童数"),
        "elem_pref": ("000012449233", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000008349736", "57 外国人生徒数"),
        "mid_pref": ("000012449272", "中学校都道府県別外国人生徒数"),
        "high_nat": ("000008349770", "91 外国人生徒数"),
        "second_nat": ("000008349815", "136 外国人生徒数"),
        "special_nat": ("000008349841", "162 外国人在学者数"),
    },
    2011: {
        "elem_nat": ("000012683585", "30 外国人児童数"),
        "elem_pref": ("000013171730", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000012683612", "57 外国人生徒数"),
        "mid_pref": ("000013171769", "中学校都道府県別外国人生徒数"),
        "high_nat": ("000012683646", "91 外国人生徒数"),
        "second_nat": ("000012683691", "136 外国人生徒数"),
        "special_nat": ("000012683717", "162 外国人在学者数"),
    },
    2012: {
        "elem_nat": ("000018428485", "31 外国人児童数"),
        "elem_pref": ("000020400163", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000018428512", "58 外国人生徒数"),
        "mid_pref": ("000020400202", "中学校都道府県別外国人生徒数"),
        "high_nat": ("000018428546", "92 外国人生徒数"),
        "second_nat": ("000018428591", "137 外国人生徒数"),
        "special_nat": ("000018428617", "163 外国人在学者数"),
    },
    2013: {
        "elem_nat": ("000023609890", "31 外国人児童数"),
        "elem_pref": ("000023616342", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000023609917", "58 外国人生徒数"),
        "mid_pref": ("000023616381", "中学校都道府県別外国人生徒数"),
        "high_nat": ("000023609951", "92 外国人生徒数"),
        "second_nat": ("000023609996", "137 外国人生徒数"),
        "special_nat": ("000023610022", "163 外国人在学者数"),
    },
    2014: {
        "elem_nat": ("000027596980", "31 外国人児童数"),
        "elem_pref": ("000027601556", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000027597007", "58 外国人生徒数"),
        "mid_pref": ("000027601595", "中学校都道府県別外国人生徒数"),
        "high_nat": ("000027597041", "92 外国人生徒数"),
        "second_nat": ("000027597086", "137 外国人生徒数"),
        "special_nat": ("000027597112", "163 外国人在学者数"),
    },
    2015: {
        "elem_nat": ("000031357848", "49 外国人児童数"),
        "elem_pref": ("000031393616", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000031357875", "76 外国人生徒数"),
        "mid_pref": ("000031393655", "中学校都道府県別外国人生徒数"),
        "high_nat": ("000031357909", "110 外国人生徒数"),
        "second_nat": ("000031357954", "155 外国人生徒数"),
        "special_nat": ("000031357980", "181 外国人在学者数"),
    },
    2016: {
        "elem_nat": ("000031504581", "52 外国人児童数"),
        "elem_pref": ("000031543705", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000031504608", "79 外国人生徒数"),
        "mid_pref": ("000031543743", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000031504635", "106 外国人児童生徒数"),
        "compul_pref": ("000031543783", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000031504668", "139 外国人生徒数"),
        "second_nat": ("000031504712", "183 外国人生徒数"),
        "special_nat": ("000031504738", "209 外国人在学者数"),
    },
    2017: {
        "elem_nat": ("000031656682", "52 外国人児童数"),
        "elem_pref": ("000031685831", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000031656709", "79 外国人生徒数"),
        "mid_pref": ("000031685869", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000031656736", "106 外国人児童生徒数"),
        "compul_pref": ("000031685909", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000031656769", "139 外国人生徒数"),
        "second_nat": ("000031656813", "183 外国人生徒数"),
        "special_nat": ("000031656839", "209 外国人在学者数"),
    },
    2018: {
        "elem_nat": ("000031776367", "52 外国人児童数"),
        "elem_pref": ("000031812273", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000031776394", "79 外国人生徒数"),
        "mid_pref": ("000031812311", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000031776421", "106 外国人児童生徒数"),
        "compul_pref": ("000031812351", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000031776454", "139 外国人生徒数"),
        "high_pref": ("000032030586", "高等学校都道府県別外国人生徒数"),
        "second_nat": ("000031776498", "183 外国人生徒数"),
        "second_pref": ("000032009671", "中等教育学校都道府県別外国人生徒数"),
        "special_nat": ("000031776524", "209 外国人在学者数"),
        "special_pref": ("000032030608", "特別支援学校都道府県別外国人在学者数"),
    },
    2019: {
        "elem_nat": ("000031893727", "52 外国人児童数"),
        "elem_pref": ("000031930130", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000031893754", "79 外国人生徒数"),
        "mid_pref": ("000031930170", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000031893781", "106 外国人児童生徒数"),
        "compul_pref": ("000031930210", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000031893814", "139 外国人生徒数"),
        "high_pref": ("000031930241", "高等学校都道府県別外国人生徒数"),
        "second_nat": ("000031893858", "183 外国人生徒数"),
        "second_pref": ("000031930272", "中等教育学校都道府県別外国人生徒数"),
        "special_nat": ("000031893884", "209 外国人在学者数"),
        "special_pref": ("000031930290", "特別支援学校都道府県別外国人在学者数"),
    },
    2020: {
        "elem_nat": ("000032040435", "52 外国人児童数"),
        "elem_pref": ("000032072399", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000032040462", "79 外国人生徒数"),
        "mid_pref": ("000032072439", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000032040489", "106 外国人児童生徒数"),
        "compul_pref": ("000032072479", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000032040522", "139 外国人生徒数"),
        "high_pref": ("000032072510", "高等学校都道府県別外国人生徒数"),
        "second_nat": ("000032040566", "183 外国人生徒数"),
        "second_pref": ("000032072541", "中等教育学校都道府県別外国人生徒数"),
        "special_nat": ("000032040592", "209 外国人在学者数"),
        "special_pref": ("000032072559", "特別支援学校都道府県別外国人在学者数"),
    },
    2021: {
        "elem_nat": ("000032155904", "52 外国人児童数"),
        "elem_pref": ("000032188953", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000032155931", "79 外国人生徒数"),
        "mid_pref": ("000032188991", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000032155958", "106 外国人児童生徒数"),
        "compul_pref": ("000032189030", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000032155991", "139 外国人生徒数"),
        "high_pref": ("000032202004", "高等学校都道府県別外国人生徒数"),
        "second_nat": ("000032156035", "183 外国人生徒数"),
        "second_pref": ("000032202005", "中等教育学校都道府県別外国人生徒数"),
        "special_nat": ("000032156061", "209 外国人在学者数"),
        "special_pref": ("000032202008", "特別支援学校都道府県別外国人在学者数"),
    },
    2022: {
        "elem_nat": ("000032264737", "52 外国人児童数"),
        "elem_pref": ("000040041938", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000032264764", "79 外国人生徒数"),
        "mid_pref": ("000040041978", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000032264791", "106 外国人児童生徒数"),
        "compul_pref": ("000040042018", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000032264824", "139 外国人生徒数"),
        "high_pref": ("000040042049", "高等学校都道府県別外国人生徒数"),
        "second_nat": ("000032264868", "183 外国人生徒数"),
        "second_pref": ("000040042080", "中等教育学校都道府県別外国人生徒数"),
        "special_nat": ("000032264894", "209 外国人在学者数"),
        "special_pref": ("000040042098", "特別支援学校都道府県別外国人在学者数"),
    },
    2023: {
        "elem_nat": ("000040127833", "52 外国人児童数"),
        "elem_pref": ("000040127866", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000040127929", "79 外国人生徒数"),
        "mid_pref": ("000040127963", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000040128025", "106 外国人児童生徒数"),
        "compul_pref": ("000040128059", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000040128127", "139 外国人生徒数"),
        "high_pref": ("000040128153", "高等学校都道府県別外国人生徒数"),
        "second_nat": ("000040128255", "183 外国人生徒数"),
        "second_pref": ("000040128276", "中等教育学校都道府県別外国人生徒数"),
        "special_nat": ("000040128297", "209 外国人在学者数"),
        "special_pref": ("000040128318", "特別支援学校都道府県別外国人在学者数"),
    },
    2024: {
        "elem_nat": ("000040230486", "52 外国人児童数"),
        "elem_pref": ("000040230827", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000040230513", "79 外国人生徒数"),
        "mid_pref": ("000040230867", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000040230540", "106 外国人児童生徒数"),
        "compul_pref": ("000040230907", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000040230573", "139 外国人生徒数"),
        "high_pref": ("000040230938", "高等学校都道府県別外国人生徒数"),
        "second_nat": ("000040230617", "183 外国人生徒数"),
        "second_pref": ("000040230969", "中等教育学校都道府県別外国人生徒数"),
        "special_nat": ("000040230643", "209 外国人在学者数"),
        "special_pref": ("000040230987", "特別支援学校都道府県別外国人在学者数"),
    },
    2025: {
        "elem_nat": ("000040393705", "52 外国人児童数"),
        "elem_pref": ("000040393124", "小学校都道府県別外国人児童数"),
        "mid_nat": ("000040393732", "79 外国人生徒数"),
        "mid_pref": ("000040393164", "中学校都道府県別外国人生徒数"),
        "compul_nat": ("000040393759", "106 外国人児童生徒数"),
        "compul_pref": ("000040393224", "義務教育学校都道府県別外国人児童生徒数"),
        "high_nat": ("000040393792", "139 外国人生徒数"),
        "high_pref": ("000040393255", "高等学校都道府県別外国人生徒数"),
        "second_nat": ("000040393836", "183 外国人生徒数"),
        "second_pref": ("000040393286", "中等教育学校都道府県別外国人生徒数"),
        "special_nat": ("000040393862", "209 外国人在学者数"),
        "special_pref": ("000040393304", "特別支援学校都道府県別外国人在学者数"),
    },
}

DASH = {"-", "－", "‐", "—", "―", "−"}


def fy(y):
    if y <= 2018:
        return f"平成{y - 1988}年度"
    return "令和元年度" if y == 2019 else f"令和{y - 2018}年度"


def norm(s):
    return "".join(str(s).split()).replace("　", "") if s is not None else ""


def num(c):
    """数の欄。「-」は0（学校基本調査の表の0の書き方）。数でなければ None"""
    if isinstance(c, (int, float)) and not isinstance(c, bool):
        if c != int(c):
            raise ValueError(f"整数でない値 {c}")
        return int(c)
    t = norm(c)
    if t in DASH:
        return 0
    if t.replace(",", "").isdigit():
        return int(t.replace(",", ""))
    return None


def fetch(sid):
    RAW.mkdir(parents=True, exist_ok=True)
    hit = list(RAW.glob(sid + ".*"))
    if hit:
        return hit[0].read_bytes()
    b = urllib.request.urlopen(urllib.request.Request(f"https://www.e-stat.go.jp/stat-search/file-download?statInfId={sid}&fileKind=0", headers=UA), timeout=60).read()
    (RAW / (sid + (".xlsx" if b[:2] == b"PK" else ".xls"))).write_bytes(b)
    time.sleep(1)
    return b


def rows_of(b):
    if b[:2] == b"PK":
        import openpyxl
        ws = openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True).worksheets[0]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    import xlrd
    ws = xlrd.open_workbook(file_contents=b).sheet_by_index(0)
    return [ws.row_values(i) for i in range(ws.nrows)]


def first4(cells, strict=False):
    """数の欄のうち最初の4つ（計・国立・公立・私立）。足りなければ None。
    strict のときは「計＝国立＋公立＋私立」になる最初の4つの並び（2015〜2020年の中学校の全国の表は、行の先頭に別の数が隠れて入っているため）"""
    v = [x for x in (num(c) for c in cells) if x is not None]
    if len(v) < 4:
        return None
    if strict:
        for i in range(len(v) - 3):
            if v[i] == v[i + 1] + v[i + 2] + v[i + 3]:
                return v[i:i + 4]
    return v[:4]


def parse_pref(rows):
    """最初のまとまり（計（国公私立））の47都道府県と、あれば「計」の行"""
    out, total = {}, None
    for r in rows:
        idx = next((i for i, c in enumerate(r) if norm(c)), None)
        if idx is None:
            continue
        name = norm(r[idx])
        if name in CODE and CODE[name] not in out:
            v = first4(r[idx + 1:])
            if v is None:
                raise ValueError(f"{name} の数が読めない: {r}")
            out[CODE[name]] = v
            if len(out) == 47:
                break
        elif name == "計" and not out:
            total = first4(r[idx + 1:])
    if len(out) != 47:
        raise ValueError(f"都道府県が {len(out)} 件")
    return out, total


def parse_nat(rows):
    """見出し（国立・公立・私立）の下で、最初に数が4つ並ぶ行"""
    seen = False
    for r in rows:
        cells = [norm(c) for c in r]
        if "国立" in cells and "私立" in cells:
            seen = True
            continue
        if seen:
            v = first4(r, strict=True)
            if v:
                return v
    raise ValueError("全国の数が読めない")


def main():
    stats = json.loads((ROOT / "data" / "stats.json").read_text("utf8"))
    fo = next(i for i in stats["indicators"] if i["id"] == "foreign")
    problems, known_used, years = [], [], []
    for y, tabs in sorted(TABLES.items()):
        o = {"year": y, "fy": fy(y), "as_of": f"{y}-05-01", "nat": {}, "pref": {}, "src": {}}
        for t in TYPES:
            tid = t["id"]
            o["nat"][tid] = None
            o["pref"][tid] = None
            if y < t["from"]:
                if f"{tid}_nat" in tabs or f"{tid}_pref" in tabs:
                    problems.append(f"{y} {tid}: まだない学校の種類なのに表がある")
                continue
            if f"{tid}_nat" not in tabs:
                problems.append(f"{y} {tid}: 全国の表がない")
                continue
            if (f"{tid}_pref" in tabs) != (y >= t["pref_from"]):
                problems.append(f"{y} {tid}: 都道府県別の表の有無が想定とちがう")
            for kind in ("nat", "pref"):
                key = f"{tid}_{kind}"
                if key not in tabs:
                    continue
                sid, title = tabs[key]
                o["src"][key] = {"id": sid, "title": title, "url": f"https://www.e-stat.go.jp/stat-search/files?stat_infid={sid}"}
                rows = rows_of(fetch(sid))
                if kind == "nat":
                    v = parse_nat(rows)
                    if v[0] != sum(v[1:]):
                        problems.append(f"{y} {key}: 計 {v[0]} ≠ 国公私の和 {sum(v[1:])}")
                    o["nat"][tid] = v[1:]
                else:
                    pv, total = parse_pref(rows)
                    for (fy_, fk, fc), (orig, fixed, why) in FIX.items():
                        if (fy_, fk) == (y, key):
                            if pv[fc] != orig:
                                problems.append(f"{y} {key} {PREFS[int(fc) - 1]}: FIX の元の値 {orig} と表 {pv[fc]} がちがう（表が直された？）")
                            else:
                                pv[fc] = fixed
                                known_used.append((y, key, fc))
                    for c, v in pv.items():
                        if v[0] != sum(v[1:]):
                            if (y, key, c) in KNOWN:
                                known_used.append((y, key, c))
                            else:
                                problems.append(f"{y} {key} {PREFS[int(c) - 1]}: 計 {v[0]} ≠ 国公私の和 {sum(v[1:])} {v}")
                    o["pref"][tid] = {c: v[1:] for c, v in sorted(pv.items())}
                    s = [sum(v[i] for v in o["pref"][tid].values()) for i in range(3)]
                    if total and total[1:] != s:
                        problems.append(f"{y} {key}: 表の計の行 {total} ≠ 都道府県の和 {s}")
            if o["pref"][tid] is not None and o["nat"][tid] is not None:
                s = [sum(v[i] for v in o["pref"][tid].values()) for i in range(3)]
                if s != o["nat"][tid]:
                    problems.append(f"{y} {tid}: 都道府県の和 {s} ≠ 全国の表 {o['nat'][tid]}")
        years.append(o)
    # 2025年＝地図の数（stats.json の「外国籍の小中高校生」。合計は特別支援学校を除く5種類）
    last = years[-1]
    var = {v["id"]: v for v in fo["variants"]}
    def tot(tid, c=None):
        return sum(last["pref"][tid][c]) if c else sum(last["nat"][tid])
    for vid, tids in (("elem", ["elem"]), ("mid", ["mid"]), ("high", ["high"]), ("all", ["elem", "mid", "high", "compul", "second"])):
        if var[vid]["national"] != sum(tot(t) for t in tids):
            problems.append(f"2025 {vid}: 地図の全国 {var[vid]['national']} ≠ {sum(tot(t) for t in tids)}")
        bad = [c for c in CODE.values() if var[vid]["values"][c] != sum(tot(t, c) for t in tids)]
        if bad:
            problems.append(f"2025 {vid}: 地図と合わない都道府県 {bad}")
    if (set(KNOWN) | set(FIX)) - set(known_used):
        problems.append(f"KNOWN・FIX に使われなかった項目がある: {sorted((set(KNOWN) | set(FIX)) - set(known_used))}")
    if problems:
        print("照合で止めました：")
        for p in problems:
            print(" ", p)
        sys.exit(1)
    data = {
        "id": "foreign_jido", "title": "外国籍の児童生徒", "survey": "文部科学省「学校基本調査」",
        "scope": "国立・公立・私立の小学校・中学校・高等学校（全日制・定時制）・義務教育学校・中等教育学校・特別支援学校",
        "estat_url": ESTAT, "checked": CHECKED, "terms": TERMS,
        "known": [{"year": y, "type": k.split("_")[0], "pref": PREFS[int(c) - 1], "fixed": (y, k, c) in FIX, "note": KNOWN.get((y, k, c)) or FIX[(y, k, c)][2]} for y, k, c in known_used],
        "prefs": {CODE[p]: p for p in PREFS}, "types": TYPES, "years": years,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf8")
    n = sum(len(o["src"]) for o in years)
    print(f"書きました：{OUT.name}（{len(years)}年・表{n}件、照合の食いちがい0件、元の表の誤りとして通したもの{len(known_used)}件）")
    for o in years:
        print(o["year"], "全国合計", sum(sum(v) for v in o["nat"].values() if v), {k: sum(v) for k, v in o["nat"].items() if v})


if __name__ == "__main__":
    main()
