/**
 * Where to put a tooltip next to the pointer so that it lies completely inside the viewport.
 * Prefers below-right of the pointer, flips to the left / above when there is no room,
 * and finally clamps to the viewport edges (minus a margin). Pure – used by the web UI.
 */
export interface TipBox {
  left: number;
  top: number;
}

export function placeTip(
  pointer: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { offset?: number; margin?: number } = {},
): TipBox {
  const offset = opts.offset ?? 12;
  const margin = opts.margin ?? 8;
  const axis = (p: number, len: number, vp: number): number => {
    let pos = p + offset;
    // no room after the pointer: flip to the other side
    if (pos + len > vp - margin) pos = p - offset - len;
    // still outside: clamp (if the tip is larger than the viewport, keep its start visible)
    return Math.max(margin, Math.min(pos, vp - margin - len));
  };
  return { left: axis(pointer.x, size.width, viewport.width), top: axis(pointer.y, size.height, viewport.height) };
}
