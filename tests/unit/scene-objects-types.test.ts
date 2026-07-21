import { expect, test } from "vitest";
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

// A deck exercising all four object kinds incl. a nested group.
const withObjects = (): DeckDoc => ({
  version: 1,
  meta: { id: "d", title: "D" },
  scenes: [
    {
      id: "s1",
      objects: [
        { id: "bg", kind: "shape", shape: "rect", fill: "#222", transform: { x: 0, y: 0, w: 1, h: 1 } },
        { id: "logo", kind: "image", src: "logo.png", fit: "contain", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        {
          id: "grp",
          kind: "group",
          transform: { x: 0.3, y: 0.3, w: 0.4, h: 0.3 },
          children: [
            { id: "title", kind: "text", text: "Hi", style: { size: "lg", align: "center" }, transform: { x: 0.3, y: 0.3, w: 0.4, h: 0.15 } },
          ],
        },
      ],
      beats: [{ id: "b1", timeline: [] }],
    },
  ],
});

test("SceneObject tree round-trips through JSON unchanged", () => {
  const doc = withObjects();
  const round = JSON.parse(JSON.stringify(doc)) as DeckDoc;
  expect(round).toEqual(doc);
  // Depth-first document order is preserved (bg=backmost … grp=topmost).
  expect(round.scenes[0].objects!.map((o: SceneObject) => o.id)).toEqual(["bg", "logo", "grp"]);
});

test("a legacy object-less deck round-trips byte-identical", () => {
  const legacy: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [] }] }] };
  expect(JSON.stringify(JSON.parse(JSON.stringify(legacy)))).toBe(JSON.stringify(legacy));
  expect("objects" in legacy.scenes[0]).toBe(false);
});
