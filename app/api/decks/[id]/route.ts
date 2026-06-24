import { loadDeck, saveDeck, deleteDeck } from "@/lib/store/deck-store";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json(await loadDeck(id));
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  let doc: DeckDoc;
  try {
    doc = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (doc?.meta?.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  const v = validateDeckDoc(doc);
  if (!v.ok) return Response.json({ error: v.errors.join(", ") }, { status: 400 });
  try {
    await saveDeck(doc);
  } catch (err) {
    return Response.json({ error: String((err as Error).message) }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try { await deleteDeck(id); return Response.json({ ok: true }); }
  catch { return Response.json({ error: "not found" }, { status: 404 }); }
}
