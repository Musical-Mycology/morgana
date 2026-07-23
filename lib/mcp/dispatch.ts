import { TOOL_DEFS } from "./tool-defs";
import { callTool, ToolCallError } from "./tool-handlers";
import {
  errorResponse, successResponse,
  INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR,
  type JsonRpcRequest, type JsonRpcResponse,
} from "./jsonrpc";

const SERVER_INFO = { name: "morgana", version: "0.1.0" };

/** Handle one parsed JSON-RPC message. Returns null for notifications (no response expected). */
export async function dispatch(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;

  if (msg.method === "notifications/initialized") return null;

  if (typeof msg.method !== "string") {
    return errorResponse(id, INVALID_REQUEST, "missing method");
  }

  if (msg.method === "initialize") {
    const params = (msg.params ?? {}) as { protocolVersion?: string };
    return successResponse(id, {
      protocolVersion: params.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (msg.method === "tools/list") {
    return successResponse(id, { tools: TOOL_DEFS });
  }

  if (msg.method === "tools/call") {
    const params = (msg.params ?? {}) as { name?: string; arguments?: unknown };
    if (typeof params.name !== "string") {
      return errorResponse(id, INVALID_REQUEST, 'tools/call requires a string "name"');
    }
    try {
      const result = await callTool(params.name, params.arguments);
      return successResponse(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (err) {
      if (err instanceof ToolCallError) {
        return successResponse(id, { content: [{ type: "text", text: err.message }], isError: true });
      }
      return errorResponse(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
    }
  }

  return errorResponse(id, METHOD_NOT_FOUND, `unknown method: ${msg.method}`);
}
