import { dispatch } from "@/lib/mcp/dispatch";
import { verifyToken } from "@/lib/store/mcp-auth";
import { errorResponse, INVALID_REQUEST, PARSE_ERROR, type JsonRpcRequest } from "@/lib/mcp/jsonrpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerFrom(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function POST(req: Request) {
  if (!(await verifyToken(bearerFrom(req)))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(errorResponse(null, PARSE_ERROR, "invalid JSON body"), { status: 200 });
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const raw of messages) {
    const msg = raw as JsonRpcRequest;
    if (msg?.jsonrpc !== "2.0" || typeof msg?.method !== "string") {
      responses.push(errorResponse(msg?.id ?? null, INVALID_REQUEST, "invalid JSON-RPC message"));
      continue;
    }
    const res = await dispatch(msg);
    if (res) responses.push(res);
  }

  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? responses : responses[0]);
}

export async function GET() {
  return Response.json({ error: "this MCP server does not support server-initiated streams" }, { status: 405 });
}
