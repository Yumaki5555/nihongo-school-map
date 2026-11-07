# 日本語学校・留学生 全国マップ

地域の学校の場所と、外国人留学生などの公的統計を地図で確認できるサイトです。

https://yumaki5555.github.io/nihongo-school-map/

## 作り方

```bash
python -I -X utf8 scripts/fetch_stats.py
python -I -X utf8 scripts/build_site.py
python -I -X utf8 scripts/verify.py
```

- `data/schools.json`：学校の台帳（公開してよい項目のみ）
- `data/stats.json`：都道府県別の統計（出典・基準日・利用条件つき）と、住民1万人あたりの留学の人数（計算値。分母は住民基本台帳の人口）
- `scripts/site/`：画面のもと。`docs/` は自動で作るので直接直さない
- `config/link_fixes.json`：開けなくなったリンクの直し先
- `scripts/check_links.py`：サイトの全リンクを確かめる（`python -I -X utf8 scripts/check_links.py 結果.csv`）

毎月2日の朝（日本時間）に `.github/workflows/monthly-stats.yml` が同じ手順を自動で実行します。点検に合格し、統計の中身が変わったときだけ公開します。新しい年度の統計は自動では入らないので、e-Stat に出たら Issue で知らせます（`scripts/check_new_stats.py`）。

国の公開資料をもとに作っていますが、国の機関が運営するサイトではありません。

出典と利用条件は [出典のページ](https://yumaki5555.github.io/nihongo-school-map/sources.html) にまとめています。
