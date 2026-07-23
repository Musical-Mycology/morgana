import { statDeck } from "@/lib/store/deck-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json(await statDeck(id));
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
