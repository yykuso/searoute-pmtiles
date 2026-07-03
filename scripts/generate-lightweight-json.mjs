import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

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

      return {
        routeId: routeIdValueMap.get(routeIdKey),
        ...(businessName ? { businessName } : {}),
        ...(routeName ? { routeName } : {}),
        ...(info ? { info } : {}),
        ...(shipName ? { shipName } : {}),
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

  console.log(
    `[${dataset.layer}] generated ${dataset.output} (records=${records.length}, features=${features.length}, missingDetails=${missingDetailsCount})`
  );
}

async function main() {
  for (const dataset of DATASETS) {
    await generateDataset(dataset);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
