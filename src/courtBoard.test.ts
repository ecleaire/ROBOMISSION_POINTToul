import { describe, expect, it } from "vitest";
import { emptyCourtBoard, moveBoardElement, rotateBoardElement, sanitizeCourtBoard, scaleBoardElement, serializeCourtBoard } from "./courtBoard";

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

  it("preserves editable text size and normalizes rotation", () => {
    const board = sanitizeCourtBoard({ version: 1, elements: [{ type: "text", color: "#000000", x: .2, y: .3, text: "確認", size: .09, rotation: 450 }] });
    expect(board.elements[0]).toMatchObject({ text: "確認", size: .09, rotation: 90 });
  });

  it("moves, resizes and rotates an existing shape", () => {
    const shape = sanitizeCourtBoard({ version: 1, elements: [{ type: "square", color: "#1565c0", x: .2, y: .2, x2: .4, y2: .4 }] }).elements[0];
    const moved = moveBoardElement(shape, .1, .15);
    expect(moved.x).toBeCloseTo(.3); expect(moved.y).toBeCloseTo(.35); expect(moved.x2).toBeCloseTo(.5); expect(moved.y2).toBeCloseTo(.55);
    const scaled = scaleBoardElement(shape, 2);
    expect(scaled.x).toBeCloseTo(.1); expect(scaled.y).toBeCloseTo(.1); expect(scaled.x2).toBeCloseTo(.5); expect(scaled.y2).toBeCloseTo(.5);
    expect(rotateBoardElement(shape, 225).rotation).toBe(-135);
  });
});
