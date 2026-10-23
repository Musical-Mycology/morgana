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
  // Multipart overhead slack on top of the file cap.
  const limit = mediaMaxBytes() + 64 * 1024;
  const tooLarge = () => Response.json({ error: "file too large" }, { status: 413 });
  // Fast path: an honest Content-Length over the cap is refused without reading anything.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return tooLarge();
  // Content-Length can be absent (chunked) or a lie, so enforce the cap WHILE reading: never
  // buffer more than `limit` bytes before parsing.
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) { await reader.cancel().catch(() => {}); return tooLarge(); }
        chunks.push(value);
      }
    } catch { return Response.json({ error: "expected multipart form data" }, { status: 400 }); }
  }
  const buffered = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buffered.set(c, off); off += c.byteLength; }
  let file: FormDataEntryValue | null;
  try {
    file = (await new Response(buffered, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData()).get("file");
  } catch { return Response.json({ error: "expected multipart form data" }, { status: 400 }); }
  if (!(file instanceof File)) return Response.json({ error: "missing \"file\" field" }, { status: 400 });
  try {
    const info = await saveMedia(id, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json(info, { status: 201 });
  } catch (e) { return fail(e); }
}
