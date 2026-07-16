import { describe, expect, it } from "vitest";
import { emptyCourtBoard, sanitizeCourtBoard, serializeCourtBoard } from "./courtBoard";

describe("court board data", () => {
  it("sanitizes shapes, colors and coordinates", () => {
    const board = sanitizeCourtBoard({ version: 1, elements: [{ type: "circle", color: "#FF0000", x: -1, y: .2, x2: 2, y2: .8 }] });
    expect(board.elements[0]).toEqual({ type: "circle", color: "#ff0000", x: 0, y: .2, x2: 1, y2: .8 });
  });

  it("rejects invalid data and omits empty boards", () => {
    expect(sanitizeCourtBoard("broken")).toEqual(emptyCourtBoard());
    expect(serializeCourtBoard(emptyCourtBoard())).toBe("");
  });

  it("limits text and element count", () => {
    const elements = Array.from({ length: 140 }, () => ({ type: "text", color: "#000000", x: .1, y: .1, text: "あ".repeat(80) }));
    const board = sanitizeCourtBoard({ version: 1, elements });
    expect(board.elements).toHaveLength(120);
    expect(board.elements[0].text).toHaveLength(40);
  });
});
