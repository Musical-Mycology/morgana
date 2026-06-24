import { listDecks, createDeck } from "@/lib/store/deck-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await listDecks());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const doc = await createDeck({ id: body.id, title: body.title, treatment: body.treatment });
    return Response.json(doc, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
