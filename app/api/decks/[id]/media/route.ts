import { loadDeck } from "@/lib/store/deck-store";
import { listMedia, saveMedia, MediaError, mediaMaxBytes } from "@/lib/store/media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) =>
  e instanceof MediaError
    ? Response.json({ error: e.message }, { status: e.status })
    : Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try { return Response.json({ media: await listMedia(id) }); } catch (e) { return fail(e); }
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  try { await loadDeck(id); } catch { return Response.json({ error: "not found" }, { status: 404 }); }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > mediaMaxBytes() + 64 * 1024) {
    return Response.json({ error: "file too large" }, { status: 413 });
  }
  let file: FormDataEntryValue | null;
  try { file = (await req.formData()).get("file"); } catch { return Response.json({ error: "expected multipart form data" }, { status: 400 }); }
  if (!(file instanceof File)) return Response.json({ error: "missing \"file\" field" }, { status: 400 });
  try {
    const info = await saveMedia(id, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json(info, { status: 201 });
  } catch (e) { return fail(e); }
}
