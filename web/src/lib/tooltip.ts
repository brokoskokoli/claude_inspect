import { placeTip } from '$shared/tip-position';

/**
 * Svelte action for every `.tip` element: positions the (position: fixed) tooltip next to the
 * pointer and keeps it fully inside the viewport. Usage: `<div class="tip" use:tipAt={{ x, y }}>`.
 */
export function tipAt(node: HTMLElement, pointer: { x: number; y: number }) {
  const place = (p: { x: number; y: number }) => {
    const r = node.getBoundingClientRect();
    const vp = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const { left, top } = placeTip(p, { width: r.width, height: r.height }, vp);
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  };
  place(pointer);
  return { update: place };
}
