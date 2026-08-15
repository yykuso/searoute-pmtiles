import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const DETAILS_DIRS = [
  "details/seaRoute",
  "details/seaRoute_limited",
  "details/seaRoute_international",
  "details/seaRoute_KR",
];

const CONCURRENCY = 10;
const TIMEOUT_MS = 15000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; SearouteUrlHealthCheck/1.0; +https://github.com/yykuso/searoute-pmtiles)";

async function readJson(jsonPath) {
  const raw = await readFile(jsonPath, "utf8");
  return JSON.parse(raw);
}

async function collectUrlEntries() {
  const entries = [];

  for (const detailsDir of DETAILS_DIRS) {
    const detailsDirPath = path.join(repoRoot, detailsDir);
    const files = await readdir(detailsDirPath, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;

      const routeId = path.parse(file.name).name;
      const detailPath = path.join(detailsDirPath, file.name);
      const detail = await readJson(detailPath);
      const url = detail?.url;

      if (typeof url === "string" && url.trim() !== "") {
        entries.push({ layer: detailsDir, routeId, url, filePath: detailPath });
      }
    }
  }

  return entries;
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });

    // Some servers don't support HEAD properly; fall back to GET.
    if (!response.ok && (response.status === 405 || response.status === 501)) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
    }

    return { ok: response.ok, status: response.status, error: null };
  } catch (error) {
    return { ok: false, status: null, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(workers);

  return results;
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const entries = await collectUrlEntries();
  console.log(`checking ${entries.length} URLs (concurrency=${CONCURRENCY})...`);

  const results = await runWithConcurrency(entries, CONCURRENCY, async (entry) => {
    const result = await checkUrl(entry.url);

    // Progress output is NG-only by default; pass --verbose to also log OK.
    if (!result.ok || verbose) {
      const relativePath = path.relative(repoRoot, entry.filePath).replace(/\\/g, "/");
      const label = result.ok ? "OK" : "NG";
      const detail = result.error ? result.error : `status=${result.status}`;
      console.log(`[${label}] ${relativePath} (${entry.routeId}) ${entry.url} -> ${detail}`);
    }

    return { ...entry, ...result };
  });

  const failures = results.filter((result) => !result.ok);

  console.log("");
  console.log(`total=${results.length} ok=${results.length - failures.length} ng=${failures.length}`);

  if (failures.length > 0) {
    console.log("");
    console.log("failed URLs:");
    for (const failure of failures) {
      const relativePath = path.relative(repoRoot, failure.filePath).replace(/\\/g, "/");
      const detail = failure.error ? failure.error : `status=${failure.status}`;
      console.log(`- ${relativePath} (${failure.routeId}) ${failure.url} -> ${detail}`);
    }
  }

  const reportPath = path.join(repoRoot, "url-health-report.json");
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: results.length,
        okCount: results.length - failures.length,
        ngCount: failures.length,
        results: results.map(({ layer, routeId, url, status, ok, error }) => ({
          layer,
          routeId,
          url,
          status,
          ok,
          error,
        })),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log("");
  console.log(`report written to ${path.relative(repoRoot, reportPath)}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
