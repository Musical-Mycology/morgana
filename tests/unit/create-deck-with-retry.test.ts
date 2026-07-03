import { expect, test, vi } from "vitest";
import { createDeckWithRetry } from "@/lib/library/create-deck-with-retry";
import type { DeckDoc } from "@/engine/deck-doc";

function doc(id: string, title: string): DeckDoc {
  return { version: 1, meta: { id, title }, scenes: [] };
}

test("creates with the slugified id on the first attempt", async () => {
  const create = vi.fn(async (meta: { id: string; title: string }) => doc(meta.id, meta.title));
  const result = await createDeckWithRetry("Fall Product Reveal", create);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({ id: "fall-product-reveal", title: "Fall Product Reveal" });
  expect(result.meta.id).toBe("fall-product-reveal");
});

test("retries once with a -2 suffix when the first attempt rejects", async () => {
  const create = vi.fn()
    .mockRejectedValueOnce(new Error("deck already exists: demo"))
    .mockResolvedValueOnce(doc("demo-2", "Demo"));
  const result = await createDeckWithRetry("Demo", create);
  expect(create).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenNthCalledWith(2, { id: "demo-2", title: "Demo" });
  expect(result.meta.id).toBe("demo-2");
});

test("propagates the error when the retry also rejects", async () => {
  const create = vi.fn().mockRejectedValue(new Error("nope"));
  await expect(createDeckWithRetry("Demo", create)).rejects.toThrow("nope");
  expect(create).toHaveBeenCalledTimes(2);
});
