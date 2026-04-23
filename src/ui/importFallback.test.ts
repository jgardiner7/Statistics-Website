import { describe, expect, it } from "vitest";
import {
  IMPORT_SAMPLE_ROW_FALLBACK,
  isImportLimitErrorMessage,
  toErrorMessage
} from "./importFallback";

describe("importFallback", () => {
  it("detects row and size limit import errors", () => {
    expect(
      isImportLimitErrorMessage(
        'Import exceeds V1 size limit for table "sales". Limit: 250.0 MB.'
      )
    ).toBe(true);
    expect(
      isImportLimitErrorMessage(
        'Import exceeds V1 row limit for table "sales". Limit: 1,000,000 rows.'
      )
    ).toBe(true);
    expect(isImportLimitErrorMessage("Unexpected parsing error")).toBe(false);
  });

  it("normalizes unknown errors into strings", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
    expect(toErrorMessage("plain")).toBe("plain");
    expect(toErrorMessage(42)).toBe("42");
  });

  it("exposes default fallback sample size", () => {
    expect(IMPORT_SAMPLE_ROW_FALLBACK).toBe(200_000);
  });
});
