import { describe, expect, it } from "vitest";
import {
  mean,
  stdDev,
  percentile,
  median,
  zScore,
  clampOutliers,
} from "../src/analyzer/statistics";

describe("mean", () => {
  it("promedia y descarta no-finitos", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([1, NaN, 3])).toBe(2);
  });
  it("NaN si no hay valores", () => {
    expect(Number.isNaN(mean([]))).toBe(true);
  });
});

describe("stdDev", () => {
  it("poblacional de [2,4,4,4,5,5,7,9] = 2", () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9], false)).toBeCloseTo(2, 10);
  });
  it("0 con <2 valores", () => {
    expect(stdDev([5])).toBe(0);
    expect(stdDev([])).toBe(0);
  });
});

describe("percentile / median", () => {
  it("interpola linealmente", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 25)).toBe(2);
    expect(median([1, 2, 3])).toBe(2);
  });
  it("acota p y maneja 1 elemento / vacío", () => {
    expect(percentile([7], 99)).toBe(7);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
    expect(percentile([1, 2, 3], 200)).toBe(3);
  });
});

describe("zScore", () => {
  it("calcula z y devuelve 0 si sd<=0", () => {
    expect(zScore(12, 10, 2)).toBe(1);
    expect(zScore(12, 10, 0)).toBe(0);
  });
});

describe("clampOutliers", () => {
  it("recorta por IQR", () => {
    expect(clampOutliers([1, 2, 3, 4, 100])).toEqual([1, 2, 3, 4]);
  });
  it("devuelve tal cual con <4 valores", () => {
    expect(clampOutliers([1, 100, 2])).toEqual([1, 100, 2]);
  });
});
