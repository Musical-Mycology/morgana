import type { PanelSpec } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Pure HTML string for a data panel; injected into a positioned media tile by CinematicSlide. */
export function renderPanelHTML(spec: PanelSpec): string {
  const title = spec.title ? `<div class="cin__panel-title">${esc(spec.title)}</div>` : "";
  const rows = (spec.rows ?? [])
    .map(
      (r) =>
        `<div class="cin__panel-row"><span>${esc(r.label)}</span>` +
        `<span class="cin__panel-val${r.tone ? ` is-${r.tone}` : ""}">${esc(r.value)}</span></div>`,
    )
    .join("");
  const total = spec.total
    ? `<div class="cin__panel-row cin__panel-total"><span>${esc(spec.total.label)}</span>` +
      `<span class="cin__panel-big">${esc(spec.total.value)}</span></div>`
    : "";
  const note = spec.note ? `<div class="cin__panel-note">${esc(spec.note)}</div>` : "";
  return `${title}${rows}${total}${note}`;
}
