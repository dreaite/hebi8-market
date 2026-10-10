/**
 * The MCP endpoint behind `/mcp` (design §6): Streamable HTTP, stateless. Every POST carries one
 * JSON-RPC message and gets its answer as JSON; there is no session and no server-to-client
 * stream, so nothing is kept between requests. The protocol (initialize, tools/list, tools/call,
 * ping, notifications, version negotiation) is the official SDK's; this file only says who is
 * asking and which tools there are.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { APP_INFO } from "../app-info";
import { tokenViewer, type Viewer } from "../viewer";
import { TOOLS, callTool } from "./tools";

const INSTRUCTIONS = `hebi8/market is one person's market watchlist: daily bars for the symbols they watch, a formula engine, and alerts the server judges on its own (after every 5-minute quote round, or after each daily sync) and pushes to their phone. Your part is to turn what the user wants to know into a formula or an alert; the server computes and keeps watch.

- Daily bars are the smallest unit. Weekly, monthly and quarterly bars are built from them. There are no intraday bars, so nothing below one day can be computed or alerted on.
- Everything is the vault of the person whose token you carry: their watchlist, aliases, alerts, notes and journal.
- A typical flow: overview → formula_reference → scan (which symbols does it hold on now) → test_formula (how often did it turn true before) → save_alert.
- An alert on one symbol is active as soon as you save it. An alert on the whole watchlist is saved as a draft and only the user can confirm it, on the page; tell them when you leave one.
- Notes and the journal are append-only for you.
- Errors come back in Chinese, as the app shows them to the user.`;

function serverFor(viewer: Viewer): Server {
  const server = new Server({ name: "hebi8-market", title: "hebi8/market", version: APP_INFO.version }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input, { io: "input" }) as { type: "object" }, annotations: { readOnlyHint: !t.write } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const result = await callTool(viewer, params.name, params.arguments);
    // the pages are rendered per request, but an open one keeps what it has until told otherwise
    if (!result.isError && TOOLS.some((t) => t.name === params.name && t.write)) revalidatePath("/", "layout");
    return { ...result };
  });
  return server;
}

const refused = (status: number, message: string, headers: Record<string, string> = {}) => Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status, headers });

/**
 * Answer one request. A personal token is required whatever the mode, single-user included: this
 * is the one way in that is not a browser, and the instance is public.
 */
export async function handleMcp(request: Request): Promise<Response> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const viewer = tokenViewer(bearer);
  if (!viewer) return refused(401, "Unauthorized: send `Authorization: Bearer <token>` with a token made on the settings page (Agent 接入).", { "WWW-Authenticate": 'Bearer realm="hebi8-market"' });
  // stateless: nothing to stream to (GET) and no session to end (DELETE)
  if (request.method !== "POST") return refused(405, "Method not allowed: POST one JSON-RPC message per request.", { Allow: "POST" });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = serverFor(viewer);
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    void server.close();
  }
}
