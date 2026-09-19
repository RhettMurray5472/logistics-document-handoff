import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import OpenAI from "openai";
import { ZodError } from "zod";
import { createInfraiAi, LogisticsSearch, NoDocumentsFoundError } from "./logistics_search.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const search = new LogisticsSearch(createInfraiAi(apiKey));
const port = Number(process.env.PORT ?? 3000);

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/documents") {
      sendJson(response, 201, await search.index(await readJson(request)));
      return;
    }
    if (request.method === "POST" && request.url === "/search") {
      sendJson(response, 200, await search.search(await readJson(request)));
      return;
    }
    sendJson(response, 404, { error: "Route not found" });
  } catch (error) {
    handleError(response, error);
  }
}).listen(port, () => {
  console.log(`Logistics search listening on http://localhost:${port}`);
});

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new RequestTooLargeError();
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidJsonError();
  }
}

function handleError(response: ServerResponse, error: unknown): void {
  if (error instanceof ZodError) {
    sendJson(response, 400, { error: "Invalid request", issues: error.issues });
  } else if (error instanceof InvalidJsonError) {
    sendJson(response, 400, { error: error.message });
  } else if (error instanceof RequestTooLargeError) {
    sendJson(response, 413, { error: error.message });
  } else if (error instanceof NoDocumentsFoundError) {
    sendJson(response, 404, { error: error.message });
  } else if (error instanceof OpenAI.APIError) {
    const status = error.status && error.status < 500 ? error.status : 502;
    sendJson(response, status, { error: error.message });
  } else {
    console.error(error);
    sendJson(response, 500, { error: "Unexpected service error" });
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

class InvalidJsonError extends Error {
  constructor() {
    super("Request body must be valid JSON");
  }
}

class RequestTooLargeError extends Error {
  constructor() {
    super("Request body exceeds 64 KiB");
  }
}
