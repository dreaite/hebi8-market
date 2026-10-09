import { describe, expect, it } from "vitest";
import { movePrices } from "@/components/drawing-scale";

describe("moving a whole drawing", () => {
  it("shifts a linear drawing by the difference and scales a log one by the ratio", () => {
    expect(movePrices([10, 20], 15, 30, "linear", false)).toEqual([25, 35]);
    expect(movePrices([10, 20], 15, 30, "log", true)).toEqual([20, 40]);
  });

  it("keeps a point without a price as it is", () => {
    expect(movePrices([10, undefined], 10, 5, "log", true)).toEqual([5, undefined]);
  });

  it("refuses a move to zero or below where it cannot be drawn", () => {
    // a line from 10 to 100 grabbed at 100 and pulled down to 50
    expect(movePrices([10, 100], 100, 50, "linear", true)).toBeNull();
    expect(movePrices([10, 100], 100, 50, "linear", false)).toEqual([-40, 50]);
    // a log drawing dragged on a linear axis to a pointer at or below zero
    expect(movePrices([10, 100], 100, -5, "log", true)).toBeNull();
    expect(movePrices([10, 100], 100, 0, "log", true)).toBeNull();
    // ...and anywhere above it keeps its ratio
    expect(movePrices([10, 100], 100, 1, "log", true)).toEqual([0.1, 1]);
  });
});
