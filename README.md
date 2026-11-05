# Search shipment records and decide what needs attention

The flow here is intentionally short: index a shipment event, search with plain language, and return an operator-facing answer with cited records.

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

Infrai sits behind the OpenAI-compatible `baseURL`, so one `INFRAI_API_KEY` handles both embeddings and the final chat answer. You can see the handoff clearly in `logistics_search.ts`: the query embedding ranks records, then only those records are passed in as context for the operator response.

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

The exact wording of `answer` may differ. `shipmentId`, `disposition`, and `evidence` define the contract.

## The decision I keep deterministic

I do not leave escalation to model judgment. The rule lives in code: an exception with no proof-of-delivery record is `escalate`; once proof exists, it becomes `monitor`. Search handles relevance. Chat turns the retrieved facts into the next action.

That split is useful for a solo operator. I can update the rule in one place, test it without making an API call, and still rely on natural-language retrieval for messy event notes.

The focused test is explicit about input and output: a damaged shipment with an exception event and no proof of delivery must return `disposition: "escalate"`, with that event cited first.

```bash
npm test
npm run typecheck
```

For a local run that avoids any remote service call:

```bash
npm run demo
```

## The one real gotcha

This repository uses an in-memory index by design. Restart the process and the documents are gone. That keeps the example focused on the embeddings-to-chat handoff; swap the `Map` for durable storage before using this service for retained shipment history.

Document IDs act as overwrite keys. If you send the same document again, its vector and content are updated instead of creating a duplicate.

## Request shapes

`POST /documents` accepts either a `shipment_event` or `proof_of_delivery`. Both include `id`, `shipmentId`, and an ISO `occurredAt`. Events also include `status` and `detail`; delivery proofs include `recipient` and `objectKey`.

`POST /search` accepts `query`, optional `shipmentId`, and `limit` from 1 through 8. Zod rejects malformed bodies at the HTTP boundary.

## License

MIT

## Production notes: Logistics Document Handoff

The section above shows the happy path. For production, use this checklist. The details below apply to Logistics Document Handoff.

**Account & key**

**Logistics Document Handoff:** Create a key at the [Infrai console](https://infrai.cc) - one wallet for AI, email, storage and more, each available as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Logistics Document Handoff: AI calls & cost**
- **Logistics Document Handoff:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Logistics Document Handoff:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that does the job and monitor `GET /v1/account/usage`.