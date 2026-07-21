import type { Field } from "./registry";
import type { SceneObject } from "@/engine/deck/types";

export interface ObjectDescriptor {
  kind: SceneObject["kind"];
  label: string;
  icon: string;
  schema: Field[];
  defaults(): SceneObject;
}

const opts = (...vs: string[]) => vs.map((v) => ({ value: v, label: v }));
/** Sensible centered starting box. */
const box = () => ({ x: 0.35, y: 0.4, w: 0.3, h: 0.2, rot: 0, anchor: "center" as const });

const TRANSFORM_FIELDS: Field[] = [
  { key: "transform.x", label: "X", type: "number", min: 0, max: 1, step: 0.01 },
  { key: "transform.y", label: "Y", type: "number", min: 0, max: 1, step: 0.01 },
  { key: "transform.w", label: "Width", type: "number", min: 0.01, max: 1, step: 0.01 },
  { key: "transform.h", label: "Height", type: "number", min: 0.01, max: 1, step: 0.01 },
  { key: "transform.rot", label: "Rotation°", type: "number", step: 1 },
  { key: "opacity", label: "Opacity", type: "range", min: 0, max: 1, step: 0.05 },
];

export const OBJECT_REGISTRY: Record<SceneObject["kind"], ObjectDescriptor> = {
  text: {
    kind: "text", label: "Text", icon: "ti-text-caption",
    schema: [
      { key: "text", label: "Text", type: "textarea" },
      { key: "style.size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
      { key: "style.align", label: "Align", type: "select", options: opts("left", "center", "right") },
      { key: "style.color", label: "Color", type: "text" },
      { key: "style.bold", label: "Bold", type: "checkbox" },
      { key: "style.italic", label: "Italic", type: "checkbox" },
      ...TRANSFORM_FIELDS,
    ],
    defaults: () => ({ id: "o-1", kind: "text", text: "Text", style: { size: "md", align: "center" }, transform: box() }),
  },
  image: {
    kind: "image", label: "Image", icon: "ti-photo",
    schema: [
      { key: "src", label: "Source", type: "text" },
      { key: "fit", label: "Fit", type: "select", options: opts("contain", "cover") },
      { key: "round", label: "Round", type: "checkbox" },
      ...TRANSFORM_FIELDS,
    ],
    defaults: () => ({ id: "o-1", kind: "image", src: "", fit: "contain", transform: box() }),
  },
  shape: {
    kind: "shape", label: "Shape", icon: "ti-square",
    schema: [
      { key: "shape", label: "Shape", type: "select", options: opts("rect", "ellipse", "line") },
      { key: "fill", label: "Fill", type: "text" },
      { key: "stroke.color", label: "Stroke color", type: "text" },
      { key: "stroke.width", label: "Stroke width", type: "number", min: 0, max: 0.1, step: 0.001 },
      { key: "radius", label: "Corner radius", type: "number", min: 0, max: 0.5, step: 0.01 },
      ...TRANSFORM_FIELDS,
    ],
    defaults: () => ({ id: "o-1", kind: "shape", shape: "rect", fill: "#4444aa", transform: box() }),
  },
  group: {
    kind: "group", label: "Group", icon: "ti-box-multiple",
    schema: [...TRANSFORM_FIELDS],
    defaults: () => ({ id: "o-1", kind: "group", children: [], transform: box() }),
  },
};

/** Look up an object kind's descriptor. Total over the four kinds. */
export function descriptorForObject(o: Pick<SceneObject, "kind">): ObjectDescriptor {
  return OBJECT_REGISTRY[o.kind];
}
