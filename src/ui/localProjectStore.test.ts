import { afterEach, describe, expect, it } from "vitest";
import { getStorageMode } from "./localProjectStore";

describe("localProjectStore storage mode", () => {
  const originalStorage = navigator.storage;

  afterEach(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: originalStorage
    });
  });

  it("uses IndexedDB-only fallback when OPFS is unavailable", () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {}
    });
    expect(getStorageMode()).toBe("idb_only_fallback");
  });

  it("uses IndexedDB + OPFS mode when OPFS APIs are available", () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        getDirectory: async () => ({})
      }
    });
    expect(getStorageMode()).toBe("idb_plus_opfs");
  });
});
