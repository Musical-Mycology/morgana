import { loadDeck, saveDeck, deleteDeck } from "@/lib/store/deck-store";
import { validateDeckDoc } from "@/engine/deck-doc";

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
  const doc = await req.json();
  if (doc?.meta?.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  const v = validateDeckDoc(doc);
  if (!v.ok) return Response.json({ error: v.errors.join(", ") }, { status: 400 });
  await saveDeck(doc);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try { await deleteDeck(id); return Response.json({ ok: true }); }
  catch { return Response.json({ error: "not found" }, { status: 404 }); }
}
