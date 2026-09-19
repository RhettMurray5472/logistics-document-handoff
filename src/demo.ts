import { LogisticsSearch, type LogisticsAi } from "./logistics_search.js";

const terms = ["damaged", "exception", "delivered", "signature"];
const demoAi: LogisticsAi = {
  async embed(inputs) {
    return inputs.map((input) => terms.map((term) => Number(input.toLowerCase().includes(term))));
  },
  async answer(_question, context) {
    return context.includes("status=exception")
      ? "Open an exception case and ask the carrier for an inspection update."
      : "Keep monitoring the shipment timeline.";
  },
};

const search = new LogisticsSearch(demoAi);
await search.index({
  id: "evt-1042",
  kind: "shipment_event",
  shipmentId: "SHP-1042",
  occurredAt: "2026-09-05T08:30:00.000Z",
  status: "exception",
  detail: "Carton damaged at the regional hub; delivery paused for inspection.",
});

const result = await search.search({
  query: "Which damaged shipment needs attention?",
  shipmentId: "SHP-1042",
  limit: 3,
});
console.log(JSON.stringify(result, null, 2));
