# searoute-pmtiles

このリポジトリは、航路データを PMTiles 形式で配布するためのデータ一式を管理します。
GeoJSON からベクタタイルを生成し、各レイヤーに対応する詳細 JSON とあわせて Cloudflare R2 へ公開する前提の構成です。

## 含まれるデータ

- `geojson/`: PMTiles の元になる GeoJSON データ
- `searoute.pmtiles`: GeoJSON から生成した配布用 PMTiles
- `details/`: 各レイヤーに対応する詳細情報 JSON
- `.github/workflows/deploy-r2.yml`: `main` への push を契機に R2 へ差分アップロードする Workflow

## PMTiles の生成


```
tippecanoe -zg -o searoute.pmtiles --force \
	-L seaRoute:geojson/seaRoute.geojson \
	-L seaRoute_limited:geojson/seaRoute_limited.geojson \
	-L seaRoute_international:geojson/seaRoute_international.geojson \
	-L seaRoute_KR:geojson/seaRoute_KR.geojson

docker run --rm \
	-v "$PWD:/data" \
	protomaps/go-pmtiles@sha256:dcec7fe1bdd371e28289f2e7cef419a0a402289e02640c094570d54beb29fa8a \
	verify /data/searoute.pmtiles
```

補足:

- 基準は `tippecanoe 2.79.0` です。
- 必要なら固定ズームも使えます（例: `-Z0 -z12`）。

```
tippecanoe -Z0 -z12 -o searoute.pmtiles --force \
	-L seaRoute:geojson/seaRoute.geojson \
	-L seaRoute_limited:geojson/seaRoute_limited.geojson \
	-L seaRoute_international:geojson/seaRoute_international.geojson \
	-L seaRoute_KR:geojson/seaRoute_KR.geojson
```

## 軽量 JSON の生成

以下のコマンドで、GeoJSON の各レイヤーを `routeId` 単位で 1 件に集約した軽量 JSON を生成します。
`details/<layer>/<routeId>.json` を `routeId` で左結合し、座標データは含みません。

レコードは次の項目のみを出力します。

- GeoJSON 由来: `routeId`
- details 由来: `businessName`, `routeName`, `info`, `shipName`（存在する場合のみ）

```
node scripts/generate-lightweight-json.mjs
```

生成先:

- `lightweight/seaRoute.json`
- `lightweight/seaRoute_limited.json`
- `lightweight/seaRoute_international.json`
- `lightweight/seaRoute_KR.json`

## デプロイ

GitHub Actions で `main` ブランチへの push 時に以下を Cloudflare R2 へ同期します。

- `searoute.pmtiles`
- `details/`
- `geojson/`
- `lightweight/`

認証には GitHub Secrets に登録した R2 のアクセス情報を使用します。