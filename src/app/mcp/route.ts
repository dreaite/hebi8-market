import { handleMcp } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

/** The agent's way in (design §6): MCP over Streamable HTTP, a personal token on every request. */
export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
