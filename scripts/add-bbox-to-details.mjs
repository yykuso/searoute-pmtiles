import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const DATASETS = [
  { geojson: "geojson/seaRoute.geojson", detailsDir: "details/seaRoute" },
  { geojson: "geojson/seaRoute_limited.geojson", detailsDir: "details/seaRoute_limited" },
  { geojson: "geojson/seaRoute_international.geojson", detailsDir: "details/seaRoute_international" },
  { geojson: "geojson/seaRoute_KR.geojson", detailsDir: "details/seaRoute_KR" },
];

async function readJson(jsonPath) {
  const raw = await readFile(jsonPath, "utf8");
  return JSON.parse(raw);
}

function extendBbox(bbox, [lon, lat]) {
  bbox[0] = Math.min(bbox[0], lon);
  bbox[1] = Math.min(bbox[1], lat);
  bbox[2] = Math.max(bbox[2], lon);
  bbox[3] = Math.max(bbox[3], lat);
}

function collectCoordinates(geometry, bbox) {
  if (!geometry) return;

  switch (geometry.type) {
    case "LineString":
    case "MultiPoint":
      for (const position of geometry.coordinates) extendBbox(bbox, position);
      break;
    case "MultiLineString":
    case "Polygon":
      for (const line of geometry.coordinates) {
        for (const position of line) extendBbox(bbox, position);
      }
      break;
    case "MultiPolygon":
      for (const polygon of geometry.coordinates) {
        for (const line of polygon) {
          for (const position of line) extendBbox(bbox, position);
        }
      }
      break;
    case "Point":
      extendBbox(bbox, geometry.coordinates);
      break;
    case "GeometryCollection":
      for (const sub of geometry.geometries) collectCoordinates(sub, bbox);
      break;
    default:
      break;
  }
}

function buildBboxMap(features) {
  const bboxMap = new Map();

  for (const feature of features) {
    const routeId = feature?.properties?.routeId;
    if (routeId === undefined || routeId === null) continue;

    const routeIdKey = String(routeId);
    let bbox = bboxMap.get(routeIdKey);
    if (!bbox) {
      bbox = [Infinity, Infinity, -Infinity, -Infinity];
      bboxMap.set(routeIdKey, bbox);
    }

    collectCoordinates(feature.geometry, bbox);
  }

  return bboxMap;
}

async function updateDataset(dataset) {
  const geojsonPath = path.join(repoRoot, dataset.geojson);
  const detailsDirPath = path.join(repoRoot, dataset.detailsDir);

  const geojson = await readJson(geojsonPath);
  const features = Array.isArray(geojson.features) ? geojson.features : [];
  const bboxMap = buildBboxMap(features);

  let updatedCount = 0;
  let missingBboxCount = 0;

  const entries = await readdir(detailsDirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const routeId = path.parse(entry.name).name;
    const bbox = bboxMap.get(routeId);
    if (!bbox) {
      missingBboxCount += 1;
      continue;
    }

    const detailPath = path.join(detailsDirPath, entry.name);
    const detail = await readJson(detailPath);
    detail.bbox = bbox;

    await writeFile(detailPath, `${JSON.stringify(detail, null, 2)}\n`, "utf8");
    updatedCount += 1;
  }

  console.log(
    `[${dataset.detailsDir}] updated ${updatedCount} files (missingBbox=${missingBboxCount})`
  );
}

async function main() {
  for (const dataset of DATASETS) {
    await updateDataset(dataset);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
