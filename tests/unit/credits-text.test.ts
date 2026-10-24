import { expect, test } from "vitest";
import { formatCredits, parseCredits } from "@/lib/editor/credits-text";

test("parse: Role: Name, Name; a line with no colon is one name; blank lines are ignored", () => {
  expect(parseCredits("Directed by: Ann Lee\n\n  Music:  Bo Chen ,Cy Diaz \nThanks for watching, everyone\n")).toEqual([
    { role: "Directed by", names: ["Ann Lee"] },
    { role: "Music", names: ["Bo Chen", "Cy Diaz"] },
    { names: ["Thanks for watching, everyone"] },
  ]);
});

test("parse: an empty role means none; a trailing comma or a bare role drops empty names", () => {
  expect(parseCredits(": A, B")).toEqual([{ names: ["A", "B"] }]);
  expect(parseCredits("Cast: A, ")).toEqual([{ role: "Cast", names: ["A"] }]);
  expect(parseCredits("Special thanks:")).toEqual([{ role: "Special thanks", names: [] }]);
  expect(parseCredits("   \n\n")).toEqual([]);
});

test("format writes one line per item", () => {
  expect(formatCredits([{ role: "Music", names: ["Bo", "Cy"] }, { names: ["Thanks"] }])).toBe("Music: Bo, Cy\nThanks");
});

test("round trip: parse(format(items)) === items, role-less multi-name and colon names included", () => {
  const items = [
    { role: "Directed by", names: ["Ann Lee"] },
    { names: ["A", "B"] },
    { names: ["Time: 3:10"] },
    { role: "Special thanks", names: [] },
    { names: [] },
    { names: ["Solo"] },
  ];
  expect(parseCredits(formatCredits(items))).toEqual(items);
  const text = "Directed by: Ann Lee\nMusic: Bo Chen, Cy Diaz\nThanks";
  expect(formatCredits(parseCredits(text))).toBe(text);
});
