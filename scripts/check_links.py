"""公開データとページにある外部リンクを全件確かめる。

python -I -X utf8 scripts/check_links.py <結果CSVの保存先>

1. Python で開く。開けなければ curl（Windowsの証明書の仕組みを使う）で開き直す。証明書の検証は外さない。
2. 開けないものは、同じサイトの https 版・www の有無・トップページを試して候補を出す。
3. ページの題名と冒頭に「見つかりません」等の語があるもの、別のドメインへ移ったものに印を付ける。
"""
import csv
import html
import json
import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
UA = "nihongo-school-map-linkcheck/1.0"
CTX = ssl.create_default_context()
CURL = shutil.which("curl.exe") or shutil.which("curl")
SOFT = re.compile(r"404|not found|ページが見つかりません|ページは存在しません|お探しのページ|削除されました|このドメイン|ドメインパーキング|for sale|parked|suspended|アカウント.{0,6}停止|閉鎖|閉校|閉業|サイトは移転|forbidden", re.I)
host_lock = defaultdict(lambda: threading.Semaphore(2))


def decode(b, charset):
    m = re.search(rb'charset=["\']?([\w-]+)', b[:3000])
    for enc in filter(None, [charset, m.group(1).decode("ascii", "ignore") if m else None, "utf8", "cp932", "euc_jp"]):
        try:
            return b.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return b.decode("utf8", "ignore")


def by_python(u):
    req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
            body = r.read(65536)
            ctype = r.headers.get_content_charset()
            return r.status, r.geturl(), decode(body, ctype) if "html" in (r.headers.get("content-type") or "") else ""
    except urllib.error.HTTPError as e:
        return e.code, u, ""
    except Exception as e:
        return 0, u, type(e).__name__


def by_curl(u):
    if not CURL:
        return 0, u, "curlなし"
    try:
        p = subprocess.run([CURL, "-sS", "-L", "-o", "NUL", "--max-time", "30", "-A", UA, "-w", "%{http_code} %{url_effective}", u], capture_output=True, timeout=40)
        out_text = p.stdout.decode("utf8", "replace").strip()
        err_text = p.stderr.decode("cp932", "replace").strip()  # curl の日本語メッセージで止まらないように
        code, _, final = out_text.partition(" ")
        return int(code or 0), final or u, err_text[:80]
    except Exception as e:
        return 0, u, type(e).__name__


def fetch(u):
    host = urllib.parse.urlsplit(u).netloc
    with host_lock[host]:
        st, final, text = by_python(u)
        err = ""
        if st != 200:
            time.sleep(1)
            st2, final2, msg = by_curl(u)
            if st2 == 200:
                return 200, final2, "", ""
            err = msg if st2 == 0 else ""
            st, final = (st2, final2) if st2 else (st, final)
        return st, final, text, err


def domain(u):
    h = urllib.parse.urlsplit(u).netloc.lower().split(":")[0]
    h = re.sub(r"^www\.", "", h)
    p = h.split(".")
    return ".".join(p[-3:]) if len(p) >= 3 and p[-1] == "jp" and p[-2] in ("ac", "co", "or", "ne", "go", "ed", "gr", "lg") else ".".join(p[-2:])


def variants(u):
    s = urllib.parse.urlsplit(u)
    hosts = {s.netloc, s.netloc[4:] if s.netloc.startswith("www.") else "www." + s.netloc}
    out = []
    for h in hosts:
        for sch in ("https", "http"):
            if s.path not in ("", "/"):
                out.append(urllib.parse.urlunsplit((sch, h, s.path, s.query, "")))
            out.append(f"{sch}://{h}/")
    seen = []
    for v in out:
        if v != u and v not in seen:
            seen.append(v)
    return seen[:8]


def judge(item):
    u, refs = item
    st, final, text, err = fetch(u)
    title = ""
    if text:
        m = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
        title = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()[:80] if m else ""
    head = title + " " + re.sub(r"<[^>]+>", " ", text[:6000]) if text else ""
    cat = "OK"
    if st != 200:
        cat = "要確認（拒否の可能性）" if st in (401, 403, 405, 406, 429, 503, 999) else "開けない"
    elif SOFT.search(title) or (len(text) < 3000 and SOFT.search(head)):
        cat = "内容を確認"
    elif domain(final) != domain(u):
        cat = "別ドメインへ移動"
    suggest = ""
    if cat == "開けない":
        for v in variants(u):
            s2, f2, t2, _ = fetch(v)
            if s2 == 200 and domain(f2) == domain(u):
                suggest = f2
                break
    names = sorted({r[1] for r in refs if r[1]})
    return {"url": u, "判定": cat, "状態": st, "移動先": final if final != u else "", "題名": title, "エラー": err, "候補": suggest, "種類": "・".join(sorted({r[0] for r in refs})), "件数": len(refs), "学校ID": " ".join(sorted({r[2] for r in refs if r[2]})[:12]), "学校名": " / ".join(names[:4])}


def collect():
    refs = defaultdict(list)
    data = json.loads((DOCS / "data/schools.json").read_text("utf8"))
    for s in data["schools"]:
        if s.get("u"):
            refs[s["u"]].append(("公式サイト", s["n"], s["i"]))
        if s.get("au"):
            refs[s["au"]].append(("所在地の根拠", s["n"], s["i"]))
    for b in data["bases"]:
        refs[b["url"]].append(("学校一覧の根拠", b["name"], ""))
    stats = json.loads((DOCS / "data/stats.json").read_text("utf8"))
    for i in stats["indicators"]:
        refs[i["source_url"]].append(("統計の出典", i["label"], ""))
        for v in i["variants"]:
            refs[v["url"]].append(("統計の表", i["label"] + "／" + v["label"], ""))
    for p in DOCS.glob("*.html"):
        for u in re.findall(r'href="(https?://[^"]+)"', p.read_text("utf8")):
            refs[html.unescape(u)].append(("ページ内", p.name, ""))
    return refs


def main():
    out = Path(sys.argv[1])
    refs = collect()
    print("確認するリンク", len(refs), "件", flush=True)
    rows = []
    with ThreadPoolExecutor(24) as ex:
        for i, r in enumerate(ex.map(judge, refs.items()), 1):
            rows.append(r)
            if i % 500 == 0:
                print(i, "件まで確認", flush=True)
    rows.sort(key=lambda r: (r["判定"] == "OK", r["判定"]))
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    tally = defaultdict(int)
    for r in rows:
        tally[r["判定"]] += 1
    print("結果", dict(tally), "→", out)


if __name__ == "__main__":
    main()
