"""e-Stat の一覧ページを見て、サイトに載せている時点より新しい統計が出ていないかを確かめる。

見つかったものを、知らせ（Issue）の題名と本文の一覧として JSON に書き出す。なければ空の一覧。
今の時点が一覧に見つからないときは、ページの作りが変わったとみなして止まる（見落としを防ぐため）。
python -I -X utf8 scripts/check_new_stats.py 出力.json
"""
import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "nihongo-school-map-data-build"}
FILES = "https://www.e-stat.go.jp/stat-search/files?"
ERA = {"令和": 2018, "平成": 1988}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return unicodedata.normalize("NFKC", r.read().decode("utf8"))


def half_years(page):
    """在留外国人統計（月次）：一覧の「6月」「12月」のリンクから (年, 月) を集める"""
    return {(int(y), 6 if m == "12040606" else 12) for y, m in re.findall(r"year=(\d{4})0&(?:amp;)?month=(12040606|24101212)", page)}


def fiscal_years(page):
    """年度ごとの一覧：「■令和7年度」の見出しから年度（西暦）を集める。「(速報)」は数えない"""
    return {(ERA[e] + (1 if n == "元" else int(n)),) for e, n in re.findall(r"■\s*(令和|平成)(元|\d+)年度(?!\s*\(速報)", page)}


def wareki(p):
    return f"令和{p[0] - 2018}年度"


AFTER = "直したら手元で作り直し、点検に合格してから送信します。反映したら、この Issue を閉じてください。"
TARGETS = [
    {
        "id": "ryugaku", "name": "在留外国人統計（在留資格「留学」）", "parse": half_years,
        "url": FILES + "toukei=00250012&tstat=000001018034&tclass1=000001060399&layout=datalist&cycle=1",
        "now": lambda d: (int(d[:4]), int(d[5:7])), "label": lambda p: f"{p[0]}年{p[1]}月末",
        "todo": "`scripts/fetch_stats.py` の表の番号（`RYU_SID`・`RYU_CHECK_SID`）、在留外国人の総数の発表値、時点の表記と、`scripts/verify.py` の留学の発表値・都道府県不詳の人数を直します。",
    },
    {
        "id": "foreign", "name": "学校基本調査（外国籍の小中高校生）", "parse": fiscal_years,
        "url": FILES + "toukei=00400001&tstat=000001011528",
        "now": lambda d: (int(d[:4]),), "label": wareki,
        "todo": "サイトで使う都道府県別の表（旧報告書未掲載集計の「都道府県別 外国人児童数」など）が新しい年度にもあるか確かめてから、`scripts/fetch_stats.py` の表の番号（`SCHOOL`・`SCHOOL_CHECK`）と時点の表記を直します。",
    },
    {
        "id": "nihongo", "name": "日本語指導が必要な児童生徒の受入状況等に関する調査", "parse": fiscal_years,
        "url": FILES + "toukei=00400305&tstat=000001016761",
        "now": lambda d: (int(d[:4]),), "label": wareki,
        "todo": "`scripts/fetch_stats.py` の表の番号と発表値（`NIHONGO`、合計の 84,759 など）、時点の表記と、`scripts/verify.py` の日本語指導の発表値を直します。",
    },
]


def main():
    out_path = Path(sys.argv[1])
    stats = {i["id"]: i for i in json.loads((ROOT / "data" / "stats.json").read_text("utf8"))["indicators"]}
    found = []
    for t in TARGETS:
        now = t["now"](stats[t["id"]]["as_of"])
        periods = t["parse"](get(t["url"]))
        if now not in periods:
            sys.exit(f"{t['name']}：一覧に今の時点（{t['label'](now)}）が見つかりません。ページの作りが変わったかもしれません。{t['url']}")
        newest = max(periods)
        if newest > now:
            print(f"新しい発表あり：{t['name']} {t['label'](newest)}（サイトは {t['label'](now)}）")
            found.append({
                "title": f"新しい統計が出ています：{t['name']} {t['label'](newest)}",
                "body": f"e-Stat に、サイトに載せている時点（{t['label'](now)}）より新しい「{t['label'](newest)}」が出ています。\n\n"
                        f"- 一覧：{t['url']}\n\n新しい統計は自動ではサイトに入りません。{t['todo']}\n\n{AFTER}\n\n（毎月の自動点検で作られた Issue です）",
            })
        else:
            print(f"新しい発表なし：{t['name']}（最新 {t['label'](newest)}）")
        time.sleep(1)
    out_path.write_text(json.dumps(found, ensure_ascii=False, indent=1), "utf8")


if __name__ == "__main__":
    main()
