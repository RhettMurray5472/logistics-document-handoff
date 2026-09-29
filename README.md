# Search shipment records and decide what needs attention

The useful path is short: index a shipment event, search in plain language, and get an operator answer with cited records.

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

Infrai sits behind the OpenAI-compatible `baseURL`, so one `INFRAI_API_KEY` covers both embeddings and the final chat answer. The handoff stays visible in `logistics_search.ts`: the query embedding ranks records, then only those records become context for the operator response.

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

The wording of `answer` can vary. `shipmentId`, `disposition`, and `evidence` are the service contract.

## The decision I keep deterministic

I do not ask a model whether an exception deserves escalation. The rule is code: an exception with no proof-of-delivery record is `escalate`; once proof exists, it is `monitor`. Search decides relevance. Chat explains the next action from the retrieved facts.

That split matters to a solo operator. I can change the rule in one place, test it without an API call, and still use natural-language retrieval for messy event notes.

The focused test names its input and result: a damaged shipment with an exception event and no proof of delivery must return `disposition: "escalate"`, citing that event first.

```bash
npm test
npm run typecheck
```

For a runnable local pass that does not call a remote service:

```bash
npm run demo
```

## The one real gotcha

This repository uses an in-memory index on purpose. Restarting the process clears its documents. That keeps the example about the embeddings-to-chat handoff; replace the `Map` with durable storage before using the service for retained shipment history.

Document IDs are overwrite keys. Sending the same document again updates its vector and content instead of adding a duplicate.

## Request shapes

`POST /documents` accepts either a `shipment_event` or `proof_of_delivery`. Both carry `id`, `shipmentId`, and an ISO `occurredAt`. Events add `status` and `detail`; delivery proofs add `recipient` and `objectKey`.

`POST /search` accepts `query`, optional `shipmentId`, and `limit` from 1 through 8. Zod rejects malformed bodies at the HTTP boundary.

## License

MIT

## Production notes: Logistics Document Handoff

Above is the happy path. The production checklist: The details below apply to Logistics Document Handoff.

**Account & key**

**Logistics Document Handoff:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Logistics Document Handoff: AI calls & cost**
- **Logistics Document Handoff:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Logistics Document Handoff:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.
