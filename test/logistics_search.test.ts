import assert from "node:assert/strict";
import test from "node:test";
import { LogisticsSearch, type LogisticsAi } from "../src/logistics_search.js";

const ai: LogisticsAi = {
  async embed(inputs) {
    return inputs.map((input) => [
      Number(input.includes("damaged") || input.includes("exception")),
      Number(input.includes("recipient") || input.includes("signature")),
    ]);
  },
  async answer(_question, context) {
    return `Operator reviewed: ${context}`;
  },
};

test("an exception without proof of delivery is escalated and cites the exception event", async () => {
  const search = new LogisticsSearch(ai);
  await search.index({
    id: "evt-exception",
    kind: "shipment_event",
    shipmentId: "SHP-9",
    occurredAt: "2026-09-05T08:30:00.000Z",
    status: "exception",
    detail: "damaged carton held for inspection",
  });
  await search.index({
    id: "evt-transit",
    kind: "shipment_event",
    shipmentId: "SHP-9",
    occurredAt: "2026-09-04T10:00:00.000Z",
    status: "in_transit",
    detail: "departed origin facility",
  });

  const result = await search.search({
    query: "damaged shipment exception",
    shipmentId: "SHP-9",
    limit: 1,
  });

  assert.equal(result.disposition, "escalate");
  assert.equal(result.evidence[0]?.id, "evt-exception");
  assert.match(result.answer, /status=exception/);
});

test("proof of delivery keeps a completed exception case in monitoring", async () => {
  const search = new LogisticsSearch(ai);
  await search.index({
    id: "evt-exception",
    kind: "shipment_event",
    shipmentId: "SHP-10",
    occurredAt: "2026-09-05T08:30:00.000Z",
    status: "exception",
    detail: "damaged label replaced",
  });
  await search.index({
    id: "pod-10",
    kind: "proof_of_delivery",
    shipmentId: "SHP-10",
    occurredAt: "2026-09-05T12:00:00.000Z",
    recipient: "M. Chen",
    objectKey: "pod/SHP-10.pdf",
  });

  const result = await search.search({
    query: "signature recipient",
    shipmentId: "SHP-10",
    limit: 2,
  });

  assert.equal(result.disposition, "monitor");
  assert.equal(result.evidence[0]?.kind, "proof_of_delivery");
});
