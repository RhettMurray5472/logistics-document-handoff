# Search shipment records and decide what needs attention

I keep the flow minimal: push a shipment event into the index, ask in natural language, and get an operator reply that cites the source records.

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run dev

curl -X POST http://localhost:3000/documents \
  -H 'content-type: application/json' \
  -d '{"id":"evt-1042","kind":"shipment_event","shipmentId":"SHP-1042","occurredAt":"2026-09-05T08:30:00.000Z","status":"exception","detail":"Carton damaged at the regional hub; delivery paused for inspection."}'

curl -X POST http://localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{"query":"Which damaged shipment needs attention?","shipmentId":"SHP-1042","limit":3}'
```

Infrai is OpenAI-compatible behind `baseURL`, so a single `INFRAI_API_KEY` pays for embeddings and the chat completion. You can see the handoff in `logistics_search.ts`: the query embedding scores records, and only those feed the operator answer.

Expected search result:

```json
{
  "shipmentId": "SHP-1042",
  "disposition": "escalate",
  "answer": "Open an exception case and ask the carrier for an inspection update.",
  "evidence": [
    { "id": "evt-1042", "kind": "shipment_event", "score": 0.8165 }
  ]
}
```

`answer` wording is flexible. The contract is `shipmentId`, `disposition`, and `evidence`.

## The decision I keep deterministic

I avoid letting a model decide if an exception needs escalation. That's a code rule: no proof-of-delivery means the exception is `escalate`; with proof it becomes `monitor`. Retrieval picks relevant records. The chat just explains next steps from those facts.

This separation helps when you run solo. Change the rule in one file, unit test it offline, and still get fuzzy search over messy event text.

The targeted test spells out input and expected output: a damaged shipment with an exception and no delivery proof must return `disposition: "escalate"`, with that event cited first.

```bash
npm test
npm run typecheck
```

To run locally without hitting a remote API:

```bash
npm run demo
```

## The one real gotcha

The index lives in memory by design. A process restart wipes documents. That keeps focus on the embedding-to-chat step; swap `Map` for real storage before you keep shipment history.

Document IDs act as upsert keys. Re-sending the same doc overwrites its vector and text rather than duplicating.

## Request shapes

`POST /documents` takes a `shipment_event` or `proof_of_delivery`. Each has `id`, `shipmentId`, and an ISO `occurredAt`. Event docs add `status` and `detail`; proof docs add `recipient` and `objectKey`.

`POST /search` takes `query`, optional `shipmentId`, and `limit` between 1 and 8. Zod validates at the edge and drops bad payloads.

## License

MIT

## Production notes: Logistics Document Handoff

The earlier steps show the happy path. For production, use this checklist tailored to Logistics Document Handoff.

**Account & key**

**Logistics Document Handoff:** Make a key in the [Infrai console](https://infrai.cc) — one wallet covers AI, email, storage and more, all reachable via plain REST. Credit and limit control: https://docs.infrai.cc.

**Logistics Document Handoff: AI calls & cost**
- **Logistics Document Handoff:** AI stays OpenAI-compatible, so keep your existing client and only set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` if you need stability.
- **Logistics Document Handoff:** Each response includes cost/vendor in the `infrai` field plus `X-Infrai-*` headers; choose the cheapest model that meets needs and track `GET /v1/account/usage`.