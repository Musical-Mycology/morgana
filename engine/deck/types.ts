/** Layout archetypes implemented in the first build. Extend as more land. */
export type LayoutId = "title" | "sectionLead" | "closing" | "cinematic";

/** Per-slide opt-in effects. */
export type EffectId = "spores" | "glow" | "burst";

/** Text-color theme for a slide. "light" = dark ink on light ground; "dark" = light ink on dark ground. */
export type SlideTheme = "light" | "dark";

/** Visual treatment for a slide. Drives nightlight + theme + a CSS skin.
 *  cover = bright-day brand splash; warm = night/dark cinematic; paper = day/cream print-friendly. */
export type SlideTreatment = "cover" | "warm" | "paper";

export interface SlideMeta {
  /** Unique, URL/debug-friendly id. */
  id: string;
  layout: LayoutId;
  /** 0 = full day, 1 = full night. */
  nightlight: number;
  /** Text color theme (defaults to "light" if omitted). */
  theme?: SlideTheme;
  /** Visual treatment; set by flattenStory from the scene's treatment. */
  treatment?: SlideTreatment;
  /** Opt-in effects for this slide. */
  effects?: EffectId[];
  /** Slot keys to reveal in order on slide entry. Omit = reveal together. */
  build?: string[];
}

export interface TitleSlots {
  eyebrow?: string;
  title: string;
  /** Optional accent line under the title (same color as the eyebrow). */
  note?: string;
  subtitle?: string;
}

export interface SectionLeadSlots {
  eyebrow?: string;
  title: string;
  lead: string;
}

export interface ClosingSlots {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  downloadLabel: string;
  downloadHref: string;
}

export type Slide =
  | (SlideMeta & { layout: "title"; slots: TitleSlots })
  | (SlideMeta & { layout: "sectionLead"; slots: SectionLeadSlots })
  | (SlideMeta & { layout: "closing"; slots: ClosingSlots })
  | (SlideMeta & { layout: "cinematic"; slots: CinematicSlideSlots });

export type Deck = Slide[];

/** Slot keys required per layout (used by validate.ts). */
export const REQUIRED_SLOTS: Record<LayoutId, string[]> = {
  title: ["title"],
  sectionLead: ["title", "lead"],
  closing: ["title", "downloadLabel", "downloadHref"],
  cinematic: ["sceneId", "beat"],
};

import type { StoryAsset } from "./story-assets";

/** How an art panel change is animated. */
export type ArtMode = "cut" | "fade" | "crossfade" | "morph" | "dissolve";

export interface ArtTransition {
  /** Panel(s) brought to the top of the layer stack. */
  to: StoryAsset | StoryAsset[];
  mode: ArtMode;
  /** Override the per-mode default duration. */
  durationMs?: number;
  /** Layers to leave beneath the new panel (e.g. keep "3.02" under "3.03"). */
  keep?: StoryAsset[];
  /** Layers to fade away as part of this transition. */
  out?: StoryAsset[];
}

export type TextIn =
  // line-level
  | "flyUp" | "fade" | "fadeSide" | "cursive"
  // per-letter / per-word (GSAP SplitText). letterFly direction follows `align`.
  | "letterFly" | "letterUp" | "wordUp" | "blurIn" | "typewriter";
export type TextSize = "lg" | "md" | "sm";
/** Text justification within the box; also sets letterFly's fly-in direction. */
export type TextAlign = "left" | "right" | "center";
/** How a media tile reveals on entry (the media action's `in`). */
export type MediaIn = "fade" | "flyUp" | "pop" | "fadeSide";

/** Live particle effects (GSAP note sprites). */
export type EffectName = "noteEmit" | "noteSwirl";
export interface EffectCue {
  effect: EffectName;
  action: "start" | "stop" | "expand";
  /** 0..1 density/intensity hint. */
  intensity?: number;
}

/** One auto-played step inside a beat's timeline. */
export type Action =
  // append: reveal this fragment INLINE on the current line (same sentence) instead of a
  // new line — for word-by-word builds. Reveals best with char/opacity effects (typewriter/fade).
  // tone: per-line color override. Default ("light") is cream ink for dark grounds;
  // "dark" switches to brand dark-brown ink + a light halo so the line stays legible
  // on a LIGHT art panel (e.g. the closing musicians).
  // reveal: force this line's `in` animation even when the deck suppresses text-in transitions
  // (instantText, the investor deck) — opts a single line back into motion.
  | { kind: "text"; value: string; in: TextIn; size?: TextSize; align?: TextAlign; speed?: number; dots?: true; pos?: StagePoint; append?: true; tone?: SlideTheme; screenOnly?: true; reveal?: true }
  | { kind: "rotateList"; items: string[]; size?: TextSize }
  | { kind: "clear" }
  | { kind: "art"; art: ArtTransition }
  | { kind: "nightlight"; to: number; durationMs?: number }
  | { kind: "cue"; cue: EffectCue }
  // Placeable directional note emitter. dir = compass degrees (0=up, 90=right, clockwise);
  // var = ± degrees of randomness (0=laser, 180=full circle); decay = note lifetime ms;
  // freq = notes/sec. color is any CSS HEX. Stop them all with { kind: "stop_notes" }.
  | { kind: "note_emitter"; color: string; pos: StagePoint; dir: number; var?: number; decay: number; freq: number }
  // Notes orbiting an ellipse centered at `pos`. width/height = ellipse size (0–1 of the
  // stage); hex = palette the notes cycle through; bounce 0–1 adds springy hops; notes =
  // ring count (default 8); speed = ms per orbit (default 6000). Stop with stop_circle (rings
  // only) or stop_notes (all note sources).
  | { kind: "note_circle"; pos: StagePoint; width: number; height: number; hex: string[]; bounce?: number; notes?: number; speed?: number }
  | { kind: "stop_notes" }
  | { kind: "stop_circle" }
  // Pause the beat's timeline until the next forward input, which RESUMES this beat
  // (instead of advancing to the next slide). Use for intra-beat click-stepping.
  | { kind: "click_gate" }
  // Spawn (fade in) the nav arrows. A beat that contains a reveal_arrows action starts with
  // its arrows hidden until this fires.
  | { kind: "reveal_arrows" }
  // One-time pulse of a single arrow to `scale`× (default 3) then back to small.
  // which: "next" = forward/front arrow, "prev" = back arrow.
  | { kind: "pulse_arrow"; which: "next" | "prev"; scale?: number }
  | { kind: "wait"; ms: number }
  // Fade the current text (shared box + free line-boxes) out over durationMs
  // (default 500), then clear it. Unlike `clear`, which is instant.
  | { kind: "fade_out"; durationMs?: number }
  // Running-total counter (e.g. the "What we need" ask). counter_show mounts a positioned
  // counter at `pos` with an initial `value` (default 0), optional `$`-style `prefix`, and an
  // optional `label`. counter_to tweens to an absolute value; counter_add tweens by ±delta —
  // the digits "spin" via GSAP. counter_hide fades it out. One counter per beat.
  | { kind: "counter_show"; pos: StagePoint; value?: number; prefix?: string; label?: string; size?: TextSize }
  | { kind: "counter_to"; value: number; durationMs?: number }
  | { kind: "counter_add"; delta: number; durationMs?: number }
  | { kind: "counter_hide"; durationMs?: number }
  // Positioned media tiles (headshots, logos, stubbed callout panels): small elements that
  // reveal, persist, and can fly to a new position — independent of the full-frame ArtStage.
  // `id` keys the tile for later media_move/media_out. Omit `src` to render a labeled
  // placeholder box (`label`). `width` = fraction of stage width (default 0.18). `round` crops
  // to a circle (headshots). Tiles are centered on `pos`.
  | { kind: "media"; id: string; pos: StagePoint; src?: string; label?: string; width?: number; in?: MediaIn; round?: boolean; durationMs?: number; panel?: PanelSpec }
  | { kind: "media_move"; id: string; to: StagePoint; scale?: number; durationMs?: number }
  | { kind: "media_out"; id?: string; durationMs?: number }
  // Object animation verbs (sub-project #3a). Each targets a Scene.objects node by its
  // scene-unique `id`. reveal = entrance, move = emphasis (move/scale/rotate), out = exit.
  // An object referenced by an obj_reveal anywhere in the scene starts hidden until that
  // reveal fires; an object no obj_reveal targets is visible from scene start.
  | { kind: "obj_reveal"; target: string; in?: MediaIn; durationMs?: number }
  | { kind: "obj_move"; target: string; to: ObjectMoveTarget; durationMs?: number }
  | { kind: "obj_out"; target: string; out?: ObjectOut; durationMs?: number }
  // Reveal the closing "Watch again" button. The fin beat keeps it hidden until
  // this fires (mirrors reveal_arrows).
  | { kind: "reveal_again" };

/** One row in a data panel (e.g. a ledger line or a metric). */
export interface PanelRow { label: string; value: string; tone?: "pos" | "neg" | "muted"; }

/** A native typographic data panel (replaces placeholder callout image tiles). */
export interface PanelSpec {
  kind: "ledger" | "metrics" | "terms";
  title?: string;
  rows?: PanelRow[];
  total?: { label: string; value: string };
  note?: string;
}

/** A point on the 16:9 stage, normalized 0–1 (0,0 = top-left, 1,1 = bottom-right).
 *  Same coordinate space as note-emit anchors (PANEL_ANCHORS). */
export interface StagePoint { x: number; y: number }

/** Rotation/scale origin for an object's transform. */
export type ObjectAnchor = "center" | "top-left";

/** An object's placement on the fixed 16:9 stage, normalized 0–1 (same space as StagePoint). */
export interface ObjectTransform {
  x: number; y: number;   // top-left, 0–1 fraction of stage
  w: number; h: number;   // size, 0–1 fraction of stage (w,h > 0)
  rot?: number;           // degrees clockwise, default 0
  anchor?: ObjectAnchor;  // rotation/scale origin, default "center"
}

/** Partial object transform for obj_move: unspecified axes are left unchanged.
 *  x,y,w,h are 0–1 fractions of the stage; rot is degrees clockwise. */
export interface ObjectMoveTarget { x?: number; y?: number; w?: number; h?: number; rot?: number }

/** How an object exits (obj_out). Single member for now; extensible. */
export type ObjectOut = "fade";

/** Fields shared by every first-class object kind. */
export interface ObjectBase {
  id: string;             // unique within its Scene (including nested children)
  name?: string;          // author-facing label shown in the layers panel
  transform: ObjectTransform;
  opacity?: number;       // 0–1, default 1
  hidden?: boolean;       // author-time editor hide (does NOT affect playback); persisted
  locked?: boolean;       // author-time editor lock; persisted
}

export type ObjectShapeKind = "rect" | "ellipse" | "line";

/** Stroke for a shape object. `width` is a fraction of stage height. */
export interface Stroke { color: string; width: number }

/** Text styling for a text object — reuses the engine's existing text vocabulary. */
export interface TextObjectStyle {
  size?: TextSize;
  align?: TextAlign;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

/** A persistent, scene-level, directly-manipulable object. Referenced by id from timeline
 *  actions in sub-project #3. Declared on `Scene.objects`, painted back-to-front in
 *  depth-first document order (index 0 = backmost). */
export type SceneObject =
  | (ObjectBase & { kind: "text"; text: string; style?: TextObjectStyle })
  | (ObjectBase & { kind: "image"; src: string; fit?: "contain" | "cover"; round?: boolean })
  | (ObjectBase & { kind: "shape"; shape: ObjectShapeKind; fill?: string; stroke?: Stroke; radius?: number })
  | (ObjectBase & { kind: "group"; children: SceneObject[] });

/** One user-gated advance. Its timeline auto-plays on entry; then arrows pulse. */
export interface Beat {
  id: string;
  /** Lighting target on entry (tweened by the engine). Omit = inherit prior. */
  nightlight?: number;
  /** Optional panel change on entry (sugar for a leading { kind:"art" } action). */
  art?: ArtTransition;
  /** Top-left of this beat's text box on the 16:9 stage (normalized 0–1).
   *  Omit = engine default (upper-left, clear of the back button). */
  pos?: StagePoint;
  timeline: Action[];
}

/** Authoring unit: a scene groups beats. Flattened to per-beat slides at load. */
export interface Scene {
  id: string;
  /** Applies one visual treatment to every beat in this scene (investor deck). Omit for /story. */
  treatment?: SlideTreatment;
  /** First-class persistent objects, painted back-to-front in depth-first order.
   *  Optional & additive: object-less decks are unchanged. (Sub-project #1.) */
  objects?: SceneObject[];
  beats: Beat[];
}

/** Slot payload a flattened cinematic slide carries. */
export interface CinematicSlideSlots {
  sceneId: string;
  beat: Beat;
}
