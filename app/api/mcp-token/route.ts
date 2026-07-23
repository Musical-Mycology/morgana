import { getOrCreateToken, regenerateToken } from "@/lib/store/mcp-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ token: await getOrCreateToken() });
}

export async function POST() {
  return Response.json({ token: await regenerateToken() });
}
