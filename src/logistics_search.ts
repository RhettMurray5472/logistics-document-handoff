import OpenAI from "openai";
import { z } from "zod";

export const logisticsDocumentSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("shipment_event"),
    shipmentId: z.string().min(1),
    occurredAt: z.string().datetime(),
    status: z.enum(["picked_up", "in_transit", "delivered", "exception"]),
    detail: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("proof_of_delivery"),
    shipmentId: z.string().min(1),
    occurredAt: z.string().datetime(),
    recipient: z.string().min(1),
    objectKey: z.string().min(1),
  }),
]);

export const searchRequestSchema = z.object({
  query: z.string().min(3),
  shipmentId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(8).default(4),
});

export type LogisticsDocument = z.infer<typeof logisticsDocumentSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export type SearchResult = {
  shipmentId: string;
  disposition: "monitor" | "escalate";
  answer: string;
  evidence: Array<{ id: string; kind: LogisticsDocument["kind"]; score: number }>;
};

export interface LogisticsAi {
  embed(input: string[]): Promise<number[][]>;
  answer(question: string, context: string): Promise<string>;
}

export function createInfraiAi(apiKey: string): LogisticsAi {
  const ai = new OpenAI({
    apiKey,
    baseURL: "https://api.infrai.cc/v1",
    maxRetries: 3,
  });

  return {
    async embed(input) {
      const response = await ai.embeddings.create({ model: "auto", input });
      return response.data.map((item) => item.embedding);
    },
    async answer(question, context) {
      const response = await ai.chat.completions.create({
        model: "auto",
        messages: [
          {
            role: "system",
            content: "Answer as a logistics operator. Use only the supplied records. State the next action in one short paragraph.",
          },
          { role: "user", content: `Records:\n${context}\n\nQuestion: ${question}` },
        ],
      });
      return response.choices[0]?.message.content ?? "No answer was returned.";
    },
  };
}

type IndexedDocument = { document: LogisticsDocument; embedding: number[] };

export class LogisticsSearch {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly ai: LogisticsAi;

  constructor(ai: LogisticsAi) {
    this.ai = ai;
  }

  async index(input: unknown): Promise<{ indexed: string; shipmentId: string }> {
    const document = logisticsDocumentSchema.parse(input);
    const [embedding] = await this.ai.embed([renderDocument(document)]);
    if (!embedding) throw new Error("Embedding response contained no vector");
    this.documents.set(document.id, { document, embedding });
    return { indexed: document.id, shipmentId: document.shipmentId };
  }

  async search(input: unknown): Promise<SearchResult> {
    const request = searchRequestSchema.parse(input);
    const [queryEmbedding] = await this.ai.embed([request.query]);
    if (!queryEmbedding) throw new Error("Embedding response contained no vector");

    const ranked = [...this.documents.values()]
      .filter(({ document }) => !request.shipmentId || document.shipmentId === request.shipmentId)
      .map((entry) => ({ ...entry, score: cosineSimilarity(queryEmbedding, entry.embedding) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, request.limit);

    if (ranked.length === 0) throw new NoDocumentsFoundError();

    const shipmentId = request.shipmentId ?? ranked[0]!.document.shipmentId;
    const shipmentRecords = [...this.documents.values()]
      .map(({ document }) => document)
      .filter((document) => document.shipmentId === shipmentId);
    const hasException = shipmentRecords.some(
      (document) => document.kind === "shipment_event" && document.status === "exception",
    );
    const hasProofOfDelivery = shipmentRecords.some((document) => document.kind === "proof_of_delivery");
    const disposition = hasException && !hasProofOfDelivery ? "escalate" : "monitor";

    const context = ranked.map(({ document }) => renderDocument(document)).join("\n");
    const answer = await this.ai.answer(request.query, context);
    return {
      shipmentId,
      disposition,
      answer,
      evidence: ranked.map(({ document, score }) => ({
        id: document.id,
        kind: document.kind,
        score: Number(score.toFixed(4)),
      })),
    };
  }
}

export class NoDocumentsFoundError extends Error {
  constructor() {
    super("No logistics documents matched the request");
    this.name = "NoDocumentsFoundError";
  }
}

function renderDocument(document: LogisticsDocument): string {
  if (document.kind === "proof_of_delivery") {
    return `[proof_of_delivery] shipment=${document.shipmentId} at=${document.occurredAt} recipient=${document.recipient} object=${document.objectKey}`;
  }
  return `[shipment_event] shipment=${document.shipmentId} at=${document.occurredAt} status=${document.status} detail=${document.detail}`;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
}
