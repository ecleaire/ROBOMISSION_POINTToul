export type BoardTool = "select" | "pen" | "circle" | "cross" | "square" | "triangle" | "text" | "eraser";

export interface BoardElement {
  type: Exclude<BoardTool, "select" | "eraser">;
  color: string;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  text?: string;
  points?: number[];
  rotation?: number;
  size?: number;
}

export interface CourtBoard {
  version: 1;
  elements: BoardElement[];
}

const COLORS = /^#[0-9a-f]{6}$/i;
const TYPES = new Set(["pen", "circle", "cross", "square", "triangle", "text"]);
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const clampSize = (value: number) => Math.max(.025, Math.min(.22, value));
const normalizeRotation = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;

export interface BoardElementBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

export function emptyCourtBoard(): CourtBoard {
  return { version: 1, elements: [] };
}

export function sanitizeCourtBoard(value: unknown): CourtBoard {
  let candidate = value;
  if (typeof candidate === "string") {
    try { candidate = JSON.parse(candidate); } catch { return emptyCourtBoard(); }
  }
  if (!candidate || typeof candidate !== "object") return emptyCourtBoard();
  const source = candidate as Partial<CourtBoard>;
  if (!Array.isArray(source.elements)) return emptyCourtBoard();
  const elements = source.elements.slice(0, 120).flatMap((raw): BoardElement[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Partial<BoardElement>;
    if (!item.type || !TYPES.has(item.type) || typeof item.x !== "number" || typeof item.y !== "number") return [];
    const color = typeof item.color === "string" && COLORS.test(item.color) ? item.color.toLowerCase() : "#e53935";
    const base: BoardElement = { type: item.type, color, x: clamp(item.x), y: clamp(item.y) };
    if (Number.isFinite(item.rotation)) base.rotation = normalizeRotation(Number(item.rotation));
    if (item.type === "text") {
      const text = String(item.text || "").trim().slice(0, 40);
      return text ? [{ ...base, text, size: clampSize(Number.isFinite(item.size) ? Number(item.size) : .055) }] : [];
    }
    if (item.type === "pen") {
      if (!Array.isArray(item.points)) return [];
      const points = item.points.slice(0, 800).map(Number).filter(Number.isFinite).map(clamp);
      return points.length >= 4 && points.length % 2 === 0 ? [{ ...base, points }] : [];
    }
    return [{ ...base, x2: clamp(Number(item.x2 ?? item.x)), y2: clamp(Number(item.y2 ?? item.y)) }];
  });
  return { version: 1, elements };
}

export function cloneCourtBoard(board: CourtBoard): CourtBoard {
  return sanitizeCourtBoard(JSON.parse(JSON.stringify(board)));
}

export function serializeCourtBoard(board: CourtBoard): string {
  const clean = sanitizeCourtBoard(board);
  return clean.elements.length ? JSON.stringify(clean) : "";
}

export function boardElementBounds(item: BoardElement, aspect = 2600 / 1258): BoardElementBounds {
  if (item.type === "pen" && item.points?.length) {
    const xs = item.points.filter((_, index) => index % 2 === 0);
    const ys = item.points.filter((_, index) => index % 2 === 1);
    const left = Math.min(...xs); const right = Math.max(...xs);
    const top = Math.min(...ys); const bottom = Math.max(...ys);
    return { left, top, right, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
  }
  if (item.type === "text") {
    const height = item.size ?? .055;
    const width = Math.max(.035, (item.text?.length || 1) * height * .62 / aspect);
    return { left: item.x, top: item.y, right: item.x + width, bottom: item.y + height, cx: item.x + width / 2, cy: item.y + height / 2 };
  }
  const x2 = item.x2 ?? item.x + .08;
  const y2 = item.y2 ?? item.y + .13;
  const left = Math.min(item.x, x2); const right = Math.max(item.x, x2);
  const top = Math.min(item.y, y2); const bottom = Math.max(item.y, y2);
  return { left, top, right, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

export function moveBoardElement(item: BoardElement, dx: number, dy: number, aspect = 2600 / 1258): BoardElement {
  const moved = { ...item, points: item.points ? [...item.points] : undefined };
  const bounds = boardElementBounds(item, aspect);
  const safeDx = Math.max(-bounds.left, Math.min(1 - bounds.right, dx));
  const safeDy = Math.max(-bounds.top, Math.min(1 - bounds.bottom, dy));
  moved.x = clamp(item.x + safeDx); moved.y = clamp(item.y + safeDy);
  if (typeof item.x2 === "number") moved.x2 = clamp(item.x2 + safeDx);
  if (typeof item.y2 === "number") moved.y2 = clamp(item.y2 + safeDy);
  if (moved.points) moved.points = moved.points.map((value, index) => clamp(value + (index % 2 ? safeDy : safeDx)));
  return moved;
}

export function scaleBoardElement(item: BoardElement, factor: number, aspect = 2600 / 1258): BoardElement {
  const bounds = boardElementBounds(item, aspect);
  const maxFactorX = Math.min(bounds.cx / Math.max(.001, bounds.cx - bounds.left), (1 - bounds.cx) / Math.max(.001, bounds.right - bounds.cx));
  const maxFactorY = Math.min(bounds.cy / Math.max(.001, bounds.cy - bounds.top), (1 - bounds.cy) / Math.max(.001, bounds.bottom - bounds.cy));
  const safeFactor = Math.max(.25, Math.min(4, maxFactorX, maxFactorY, factor));
  const scaleX = (value: number) => clamp(bounds.cx + (value - bounds.cx) * safeFactor);
  const scaleY = (value: number) => clamp(bounds.cy + (value - bounds.cy) * safeFactor);
  const scaled = { ...item, x: scaleX(item.x), y: scaleY(item.y), points: item.points ? [...item.points] : undefined };
  if (typeof item.x2 === "number") scaled.x2 = scaleX(item.x2);
  if (typeof item.y2 === "number") scaled.y2 = scaleY(item.y2);
  if (scaled.points) scaled.points = scaled.points.map((value, index) => index % 2 ? scaleY(value) : scaleX(value));
  if (item.type === "text") {
    scaled.size = clampSize((item.size ?? .055) * safeFactor);
    const nextBounds = boardElementBounds(scaled, aspect);
    scaled.x = clamp(bounds.cx - (nextBounds.right - nextBounds.left) / 2);
    scaled.y = clamp(bounds.cy - (nextBounds.bottom - nextBounds.top) / 2);
  }
  return scaled;
}

export function rotateBoardElement(item: BoardElement, deltaDegrees: number): BoardElement {
  return { ...item, points: item.points ? [...item.points] : undefined, rotation: normalizeRotation((item.rotation ?? 0) + deltaDegrees) };
}

function rotatePoint(x: number, y: number, cx: number, cy: number, radians: number) {
  const cosine = Math.cos(radians); const sine = Math.sin(radians);
  return { x: cx + (x - cx) * cosine - (y - cy) * sine, y: cy + (x - cx) * sine + (y - cy) * cosine };
}

export function drawCourtBoard(canvas: HTMLCanvasElement, board: CourtBoard, selectedIndex = -1) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.textBaseline = "top";
  const clean = sanitizeCourtBoard(board);
  for (const item of clean.elements) {
    const x = item.x * width;
    const y = item.y * height;
    const x2 = (item.x2 ?? item.x) * width;
    const y2 = (item.y2 ?? item.y) * height;
    const bounds = boardElementBounds(item, width / height);
    const centerX = bounds.cx * width; const centerY = bounds.cy * height;
    const rotation = (item.rotation ?? 0) * Math.PI / 180;
    context.save();
    context.translate(centerX, centerY);
    context.rotate(rotation);
    context.translate(-centerX, -centerY);
    context.strokeStyle = item.color;
    context.fillStyle = item.color;
    context.lineWidth = Math.max(3 * dpr, Math.min(width, height) * .008);
    context.shadowColor = "rgba(255,255,255,.8)";
    context.shadowBlur = context.lineWidth * .45;
    context.beginPath();
    if (item.type === "pen" && item.points) {
      item.points.forEach((point, index) => {
        if (index % 2) return;
        const px = point * width;
        const py = item.points![index + 1] * height;
        if (index === 0) context.moveTo(px, py); else context.lineTo(px, py);
      });
      context.stroke();
    } else if (item.type === "circle") {
      context.ellipse((x + x2) / 2, (y + y2) / 2, Math.max(Math.abs(x2 - x) / 2, 8 * dpr), Math.max(Math.abs(y2 - y) / 2, 8 * dpr), 0, 0, Math.PI * 2);
      context.stroke();
    } else if (item.type === "square") {
      context.strokeRect(Math.min(x, x2), Math.min(y, y2), Math.max(Math.abs(x2 - x), 12 * dpr), Math.max(Math.abs(y2 - y), 12 * dpr));
    } else if (item.type === "cross") {
      context.moveTo(x, y); context.lineTo(x2, y2); context.moveTo(x2, y); context.lineTo(x, y2); context.stroke();
    } else if (item.type === "triangle") {
      context.moveTo((x + x2) / 2, y); context.lineTo(x2, y2); context.lineTo(x, y2); context.closePath(); context.stroke();
    } else if (item.type === "text" && item.text) {
      context.shadowBlur = Math.max(2 * dpr, context.lineWidth * .25);
      context.font = `900 ${Math.max(14 * dpr, height * (item.size ?? .055))}px system-ui, sans-serif`;
      context.fillText(item.text, x, y, width - x);
    }
    context.restore();
  }
  const selected = clean.elements[selectedIndex];
  if (selected) {
    const bounds = boardElementBounds(selected, width / height);
    const centerX = bounds.cx * width; const centerY = bounds.cy * height;
    context.save();
    context.translate(centerX, centerY);
    context.rotate((selected.rotation ?? 0) * Math.PI / 180);
    context.translate(-centerX, -centerY);
    context.shadowBlur = 0;
    context.strokeStyle = "#0878c9";
    context.fillStyle = "#ffffff";
    context.lineWidth = 2 * dpr;
    context.setLineDash([7 * dpr, 5 * dpr]);
    context.strokeRect(bounds.left * width, bounds.top * height, Math.max(12 * dpr, (bounds.right - bounds.left) * width), Math.max(12 * dpr, (bounds.bottom - bounds.top) * height));
    context.setLineDash([]);
    const handleSize = 9 * dpr;
    context.fillRect(bounds.right * width - handleSize, bounds.bottom * height - handleSize, handleSize * 2, handleSize * 2);
    context.strokeRect(bounds.right * width - handleSize, bounds.bottom * height - handleSize, handleSize * 2, handleSize * 2);
    const rotateY = bounds.top * height - 28 * dpr;
    context.beginPath(); context.moveTo(centerX, bounds.top * height); context.lineTo(centerX, rotateY); context.stroke();
    context.beginPath(); context.arc(centerX, rotateY, handleSize, 0, Math.PI * 2); context.fill(); context.stroke();
    context.restore();
  }
}

export function boardPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

export function findBoardElement(board: CourtBoard, x: number, y: number, aspect = 2600 / 1258) {
  for (let index = board.elements.length - 1; index >= 0; index -= 1) {
    const item = board.elements[index];
    const bounds = boardElementBounds(item, aspect);
    const radians = -(item.rotation ?? 0) * Math.PI / 180;
    const unrotated = rotatePoint(x * aspect, y, bounds.cx * aspect, bounds.cy, radians);
    const localX = unrotated.x / aspect; const localY = unrotated.y;
    if (item.type === "pen" && item.points) {
      for (let point = 0; point < item.points.length; point += 2) {
        if (Math.hypot((item.points[point] - localX) * aspect, item.points[point + 1] - localY) < .045) return index;
      }
      continue;
    }
    if (localX >= bounds.left - .025 && localX <= bounds.right + .025 && localY >= bounds.top - .04 && localY <= bounds.bottom + .04) return index;
  }
  return -1;
}
