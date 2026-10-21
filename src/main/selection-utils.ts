export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }
export const popupResizeEdges = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type PopupResizeEdge = typeof popupResizeEdges[number];
export const popupSizes = {
  small: { width: 450, height: 360, chatHeight: 500 },
  medium: { width: 600, height: 480, chatHeight: 600 },
  large: { width: 780, height: 640, chatHeight: 740 },
};
export type PopupSizePreset = keyof typeof popupSizes;

// Keep the opposite edge stationary; side handles change only one dimension.
// Limits are measured from that fixed edge, including on negative-coordinate
// displays and when the available screen is smaller than the usual minimum.
export function resizeSelectionPopup(bounds: Bounds, edge: PopupResizeEdge, delta: Point, workArea: Bounds, minimum: { width: number; height: number }): Bounds {
  const resizeAxis = (start: number, length: number, change: number, areaStart: number, areaLength: number, min: number, leading: boolean) => {
    const fixed = leading ? start + length : start;
    const max = Math.max(1, Math.min(900, leading ? fixed - areaStart : areaStart + areaLength - fixed));
    const size = Math.round(Math.max(Math.min(min, max), Math.min(max, length + (leading ? -change : change))));
    return { start: leading ? fixed - size : start, size };
  };
  const result = { ...bounds };
  if (edge.includes("w") || edge.includes("e")) {
    const axis = resizeAxis(bounds.x, bounds.width, delta.x, workArea.x, workArea.width, minimum.width, edge.includes("w"));
    result.x = axis.start; result.width = axis.size;
  }
  if (edge.includes("n") || edge.includes("s")) {
    const axis = resizeAxis(bounds.y, bounds.height, delta.y, workArea.y, workArea.height, minimum.height, edge.includes("n"));
    result.y = axis.start; result.height = axis.size;
  }
  return result;
}

export function constrainPopupMove(bounds: Bounds, workArea: Bounds): Bounds {
  return { ...bounds,
    x: Math.round(Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width))),
    y: Math.round(Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - bounds.height))),
  };
}

export function placeSelectionPopup(point: Point, size: { width: number; height: number }, workArea: Bounds): Bounds {
  const margin = 12;
  const width = Math.min(size.width, Math.max(1, workArea.width - margin * 2));
  const height = Math.min(size.height, Math.max(1, workArea.height - margin * 2));
  const left = workArea.x + margin;
  const top = workArea.y + margin;
  const right = workArea.x + workArea.width - margin - width;
  const bottom = workArea.y + workArea.height - margin - height;
  const preferredY = point.y + 18 + height <= workArea.y + workArea.height - margin
    ? point.y + 18 : point.y - height - 18;
  return { x: Math.round(Math.max(left, Math.min(point.x + 12, right))),
    y: Math.round(Math.max(top, Math.min(preferredY, bottom))), width, height };
}

export function isPointInside(point: Point, bounds: Bounds) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

// Closing the popup or making a new selection invalidates older network replies.
export class SelectionRevision {
  private revision = 0;
  next() { return ++this.revision; }
  current(revision: number) { return this.revision === revision; }
}
