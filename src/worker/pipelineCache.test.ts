import { describe, expect, it } from "vitest";
import {
  buildPipelineCacheKey,
  PipelineResultCache
} from "./pipelineCache";
import type { PipelineStep } from "../shared/types";

describe("pipeline cache key", () => {
  it("changes when limit changes", () => {
    const steps: PipelineStep[] = [
      {
        id: "s1",
        name: "Filter",
        enabled: true,
        type: "FilterStep",
        params: {
          column: "amount",
          operator: ">" as const,
          value: "100"
        }
      }
    ];

    expect(buildPipelineCacheKey("sales", steps, 100)).not.toBe(
      buildPipelineCacheKey("sales", steps, 200)
    );
  });
});

describe("PipelineResultCache", () => {
  it("returns cloned results so callers cannot mutate cache internals", () => {
    const cache = new PipelineResultCache(2);
    cache.set("k1", {
      columns: ["a"],
      rows: [[1]],
      rowCount: 1
    });

    const first = cache.get("k1");
    if (!first) {
      throw new Error("Missing cached result");
    }
    first.columns.push("mutated");
    first.rows[0][0] = 99;

    const second = cache.get("k1");
    expect(second).toEqual({
      columns: ["a"],
      rows: [[1]],
      rowCount: 1
    });
  });

  it("evicts oldest entries when over capacity", () => {
    const cache = new PipelineResultCache(2);
    cache.set("k1", { columns: ["a"], rows: [[1]], rowCount: 1 });
    cache.set("k2", { columns: ["a"], rows: [[2]], rowCount: 1 });
    cache.set("k3", { columns: ["a"], rows: [[3]], rowCount: 1 });

    expect(cache.get("k1")).toBeNull();
    expect(cache.get("k2")).not.toBeNull();
    expect(cache.get("k3")).not.toBeNull();
    expect(cache.size()).toBe(2);
  });
});
