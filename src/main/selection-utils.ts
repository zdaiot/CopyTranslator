export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }

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
