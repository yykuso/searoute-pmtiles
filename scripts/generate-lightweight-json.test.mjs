import test from "node:test";
import assert from "node:assert/strict";
import { extractPorts, buildRoutePageRecords } from "./generate-lightweight-json.mjs";

const multi = (portName1, portName2, a, b) => ({
  type: "Feature",
  properties: { routeId: 10101, portName1, portName2 },
  geometry: { type: "MultiLineString", coordinates: [[a, [0, 0]], [[1, 1], b]] },
});

test("extractPorts: 出現順・重複なし・小数第5位に丸める", () => {
  const features = [
    multi("稚内", "鴛泊", [141.682541234, 45.416171234], [141.2, 45.3]),
    multi("稚内", "香深", [141.1, 45.1], [141.3, 45.4]),
    {
      type: "Feature",
      properties: { routeId: 10101, portName1: "鴛泊", portName2: "香深" },
      geometry: { type: "LineString", coordinates: [[141.2, 45.3], [141.3, 45.4]] },
    },
  ];
  const ports = extractPorts(features);
  assert.deepEqual(ports.map((p) => p.name), ["稚内", "鴛泊", "香深"]);
  assert.deepEqual(ports[0], { name: "稚内", lon: 141.68254, lat: 45.41617 });
  assert.deepEqual(ports[1], { name: "鴛泊", lon: 141.2, lat: 45.3 });
  assert.deepEqual(ports[2], { name: "香深", lon: 141.3, lat: 45.4 });
});

test("extractPorts: portName2 がなければ終点を追加しない", () => {
  const features = [
    { properties: { portName1: "A" }, geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } },
  ];
  assert.deepEqual(extractPorts(features), [{ name: "A", lon: 1, lat: 2 }]);
});

test("extractPorts: 0 件なら空配列", () => {
  assert.deepEqual(extractPorts([]), []);
});

test("buildRoutePageRecords: routeId 文字列化・layer・詳細 JSON を反映", () => {
  const datasets = [
    {
      layer: "seaRoute",
      features: [multi("稚内", "鴛泊", [141.1, 45.1], [141.2, 45.2]), { properties: { routeId: 20202, portName1: "X" }, geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } }],
      detailsMap: new Map([["10101", { businessName: "H", freqInfo: "1日3往復", lastChecked: "2026-11-25", bbox: [1, 2, 3, 4] }]]),
    },
  ];
  const records = buildRoutePageRecords(datasets);
  assert.equal(records.length, 2);
  assert.equal(records[0].routeId, "10101");
  assert.equal(records[0].layer, "seaRoute");
  assert.equal(records[0].freqInfo, "1日3往復");
  assert.equal(records[0].lastChecked, "2026-11-25");
  assert.deepEqual(records[0].bbox, [1, 2, 3, 4]);
  assert.equal(records[0].ports.length, 2);
  assert.equal(records[1].routeId, "20202");
  assert.equal(records[1].businessName, undefined);
  assert.equal(records[1].ports.length, 1);
});

test("buildRoutePageRecords: 異なるレイヤーで routeId 重複なら throw", () => {
  const f = [{ properties: { routeId: 555 }, geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } }];
  assert.throws(
    () =>
      buildRoutePageRecords([
        { layer: "seaRoute", features: f, detailsMap: new Map() },
        { layer: "seaRoute_KR", features: f, detailsMap: new Map() },
      ]),
    /555/
  );
});
