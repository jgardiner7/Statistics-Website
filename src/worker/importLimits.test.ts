import { describe, expect, it } from "vitest";
import {
  assertImportByteLimits,
  assertImportRowLimit,
  MAX_LOGICAL_TABLE_BYTES,
  MAX_LOGICAL_TABLE_ROWS
} from "./importLimits";

describe("worker import limits", () => {
  it("allows byte sizes within cap for single-table merge modes", () => {
    expect(() =>
      assertImportByteLimits("same_table_union_by_name", "sales", [
        { sizeBytes: 120 * 1024 * 1024 },
        { sizeBytes: 80 * 1024 * 1024 }
      ])
    ).not.toThrow();
  });

  it("rejects byte sizes above cap for single-table merge modes", () => {
    expect(() =>
      assertImportByteLimits("same_table_union_by_name", "sales", [
        { sizeBytes: MAX_LOGICAL_TABLE_BYTES + 1 }
      ])
    ).toThrow('table "sales"');
  });

  it("rejects oversized files in separate table mode with per-table names", () => {
    expect(() =>
      assertImportByteLimits("separate_tables", "sales", [
        { sizeBytes: 10 },
        { sizeBytes: MAX_LOGICAL_TABLE_BYTES + 1 }
      ])
    ).toThrow('table "sales_2"');
  });

  it("allows row counts within cap", () => {
    expect(() => assertImportRowLimit("sales", MAX_LOGICAL_TABLE_ROWS)).not.toThrow();
  });

  it("rejects row counts above cap", () => {
    expect(() => assertImportRowLimit("sales", MAX_LOGICAL_TABLE_ROWS + 1)).toThrow(
      "row limit"
    );
  });
});
