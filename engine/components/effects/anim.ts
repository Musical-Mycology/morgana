import gsap from "gsap";

/** Stagger-reveal a set of elements (already ordered) on slide entry. */
export function staggerReveal(targets: HTMLElement[]): gsap.core.Timeline {
  const tl = gsap.timeline();
  tl.from(targets, { y: 18, opacity: 0, duration: 0.5, ease: "power2.out", stagger: 0.12 });
  return tl;
}
