import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

// 詳細ページ用の集約 JSON に含めるレイヤー（seaRoute_limited は含めない）
const ROUTE_PAGE_LAYERS = ["seaRoute", "seaRoute_international", "seaRoute_KR"];
const ROUTE_PAGES_OUTPUT = "lightweight/routePages.json";

const DATASETS = [
  {
    layer: "seaRoute",
    geojson: "geojson/seaRoute.geojson",
    detailsDir: "details/seaRoute",
    output: "lightweight/seaRoute.json",
  },
  {
    layer: "seaRoute_limited",
    geojson: "geojson/seaRoute_limited.geojson",
    detailsDir: "details/seaRoute_limited",
    output: "lightweight/seaRoute_limited.json",
  },
  {
    layer: "seaRoute_international",
    geojson: "geojson/seaRoute_international.geojson",
    detailsDir: "details/seaRoute_international",
    output: "lightweight/seaRoute_international.json",
  },
  {
    layer: "seaRoute_KR",
    geojson: "geojson/seaRoute_KR.geojson",
    detailsDir: "details/seaRoute_KR",
    output: "lightweight/seaRoute_KR.json",
  },
];

async function readJson(jsonPath) {
  const raw = await readFile(jsonPath, "utf8");
  return JSON.parse(raw);
}

async function loadDetailsMap(detailsDirPath) {
  const detailsMap = new Map();
  const entries = await readdir(detailsDirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const routeId = path.parse(entry.name).name;
    const detailPath = path.join(detailsDirPath, entry.name);
    const detail = await readJson(detailPath);
    detailsMap.set(routeId, detail);
  }

  return detailsMap;
}

function buildLightweightRecords(features, detailsMap) {
  const routeIdSet = new Set();
  const routeIdValueMap = new Map();
  let missingDetailsCount = 0;
  let skippedFeaturesCount = 0;

  for (const feature of features) {
    const properties = feature?.properties ?? {};
    const routeId = properties.routeId;
    if (routeId === undefined || routeId === null) {
      skippedFeaturesCount += 1;
      continue;
    }

    const routeIdKey = String(routeId);
    routeIdSet.add(routeIdKey);
    if (!routeIdValueMap.has(routeIdKey)) {
      routeIdValueMap.set(routeIdKey, routeId);
    }
  }

  const records = Array.from(routeIdSet)
    .map((routeIdKey) => {
      const detail = detailsMap.has(routeIdKey) ? detailsMap.get(routeIdKey) : null;

      if (detail === null) {
        missingDetailsCount += 1;
      }

      const businessName = detail?.businessName;
      const routeName = detail?.routeName;
      const info = detail?.info;
      const shipName = detail?.shipName;
      // 運航状況（season: 季節運航 / suspend: 運休）。一覧画面の色分けに使う。url は容量を増やすので入れない
      const note = detail?.note;

      return {
        routeId: routeIdValueMap.get(routeIdKey),
        ...(businessName ? { businessName } : {}),
        ...(routeName ? { routeName } : {}),
        ...(info ? { info } : {}),
        ...(shipName ? { shipName } : {}),
        ...(note ? { note } : {}),
      };
    })
    .sort((a, b) => {
      const aNumber = Number(a.routeId);
      const bNumber = Number(b.routeId);

      if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
        return aNumber - bNumber;
      }

      return String(a.routeId).localeCompare(String(b.routeId));
    });

  return { records, missingDetailsCount, skippedFeaturesCount };
}

function round5(value) {
  return Math.round(value * 1e5) / 1e5;
}

function compareRouteId(a, b) {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }
  return String(a).localeCompare(String(b));
}

// フィーチャーの始点（最初の線の最初の座標）と終点（最後の線の最後の座標）
function getEndpoints(geometry) {
  let lines = [];
  if (geometry?.type === "LineString") {
    lines = [geometry.coordinates];
  } else if (geometry?.type === "MultiLineString") {
    lines = geometry.coordinates;
  }
  lines = (lines ?? []).filter((line) => Array.isArray(line) && line.length > 0);
  if (lines.length === 0) {
    return { start: null, end: null };
  }
  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];
  return { start: firstLine[0], end: lastLine[lastLine.length - 1] };
}

// 発着港を出現順・港名で重複なしに取り出す（座標は最初に出た位置を小数第5位に丸める）
export function extractPorts(features) {
  const ports = [];
  const seen = new Set();
  const add = (name, coord) => {
    if (!name || seen.has(name) || !Array.isArray(coord)) {
      return;
    }
    seen.add(name);
    ports.push({ name, lon: round5(coord[0]), lat: round5(coord[1]) });
  };

  for (const feature of features ?? []) {
    const properties = feature?.properties ?? {};
    const { start, end } = getEndpoints(feature?.geometry);
    add(properties.portName1, start);
    add(properties.portName2, end);
  }
  return ports;
}

const DETAIL_KEYS = [
  "businessName",
  "routeName",
  "url",
  "info",
  "freq",
  "freqInfo",
  "car",
  "bike",
  "bicycle",
  "shipName",
  "note",
  "bbox",
  "lastChecked",
];

export function buildRoutePageRecords(datasets) {
  const records = [];
  const layerByRouteId = new Map();

  for (const { layer, features, detailsMap } of datasets) {
    const featuresByRouteId = new Map();
    for (const feature of features) {
      const routeId = feature?.properties?.routeId;
      if (routeId === undefined || routeId === null) {
        continue;
      }
      const key = String(routeId);
      if (!featuresByRouteId.has(key)) {
        featuresByRouteId.set(key, []);
      }
      featuresByRouteId.get(key).push(feature);
    }

    for (const [routeId, routeFeatures] of featuresByRouteId) {
      if (layerByRouteId.has(routeId)) {
        throw new Error(
          `routeId ${routeId} が重複しています（${layerByRouteId.get(routeId)} と ${layer}）`
        );
      }
      layerByRouteId.set(routeId, layer);

      const detail = detailsMap?.get(routeId) ?? {};
      const picked = {};
      for (const key of DETAIL_KEYS) {
        const value = detail[key];
        if (value !== undefined && value !== null && value !== "") {
          picked[key] = value;
        }
      }
      records.push({ routeId, layer, ...picked, ports: extractPorts(routeFeatures) });
    }
  }

  return records.sort((a, b) => compareRouteId(a.routeId, b.routeId));
}

async function generateDataset(dataset) {
  const geojsonPath = path.join(repoRoot, dataset.geojson);
  const detailsDirPath = path.join(repoRoot, dataset.detailsDir);
  const outputPath = path.join(repoRoot, dataset.output);

  const geojson = await readJson(geojsonPath);
  const features = Array.isArray(geojson.features) ? geojson.features : [];
  const detailsMap = await loadDetailsMap(detailsDirPath);
  const { records, missingDetailsCount, skippedFeaturesCount } = buildLightweightRecords(features, detailsMap);

  const output = {
    layer: dataset.layer,
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    totalFeatures: features.length,
    missingDetailsCount,
    skippedFeaturesCount,
    records,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  const loaded = { layer: dataset.layer, features, detailsMap };

  console.log(
    `[${dataset.layer}] generated ${dataset.output} (records=${records.length}, features=${features.length}, missingDetails=${missingDetailsCount})`
  );
  return loaded;
}

async function generateRoutePages(loadedDatasets) {
  const targets = loadedDatasets.filter((d) => ROUTE_PAGE_LAYERS.includes(d.layer));
  const records = buildRoutePageRecords(targets);
  const output = {
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    records,
  };
  const outputPath = path.join(repoRoot, ROUTE_PAGES_OUTPUT);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output)}
`, "utf8");
  console.log(`[routePages] generated ${ROUTE_PAGES_OUTPUT} (records=${records.length})`);
}

async function main() {
  const loaded = [];
  for (const dataset of DATASETS) {
    loaded.push(await generateDataset(dataset));
  }
  await generateRoutePages(loaded);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
