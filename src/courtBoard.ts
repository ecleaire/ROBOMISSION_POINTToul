export type BoardTool = "pen" | "circle" | "cross" | "square" | "triangle" | "text" | "eraser";

export interface BoardElement {
  type: Exclude<BoardTool, "eraser">;
  color: string;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  text?: string;
  points?: number[];
}

export interface CourtBoard {
  version: 1;
  elements: BoardElement[];
}

const COLORS = /^#[0-9a-f]{6}$/i;
const TYPES = new Set(["pen", "circle", "cross", "square", "triangle", "text"]);
const clamp = (value: number) => Math.max(0, Math.min(1, value));

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
    if (item.type === "text") {
      const text = String(item.text || "").trim().slice(0, 40);
      return text ? [{ ...base, text }] : [];
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

export function drawCourtBoard(canvas: HTMLCanvasElement, board: CourtBoard) {
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
  for (const item of sanitizeCourtBoard(board).elements) {
    const x = item.x * width;
    const y = item.y * height;
    const x2 = (item.x2 ?? item.x) * width;
    const y2 = (item.y2 ?? item.y) * height;
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
      context.font = `900 ${Math.max(18 * dpr, height * .055)}px system-ui, sans-serif`;
      context.fillText(item.text, x, y, width - x);
    }
  }
}

export function boardPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

export function findBoardElement(board: CourtBoard, x: number, y: number) {
  for (let index = board.elements.length - 1; index >= 0; index -= 1) {
    const item = board.elements[index];
    if (item.type === "pen" && item.points) {
      for (let point = 0; point < item.points.length; point += 2) {
        if (Math.hypot(item.points[point] - x, item.points[point + 1] - y) < .035) return index;
      }
      continue;
    }
    const x2 = item.x2 ?? item.x + Math.max(.06, (item.text?.length || 1) * .025);
    const y2 = item.y2 ?? item.y + .08;
    const left = Math.min(item.x, x2) - .035;
    const right = Math.max(item.x, x2) + .035;
    const top = Math.min(item.y, y2) - .05;
    const bottom = Math.max(item.y, y2) + .05;
    if (x >= left && x <= right && y >= top && y <= bottom) return index;
  }
  return -1;
}
