import type { PipelineStep, PrimitiveValue } from "../shared/types";

export interface CachedQueryResult {
  columns: string[];
  rows: PrimitiveValue[][];
  rowCount: number;
}

function cloneResult(result: CachedQueryResult): CachedQueryResult {
  return {
    columns: [...result.columns],
    rows: result.rows.map((row) => [...row]),
    rowCount: result.rowCount
  };
}

export function buildPipelineCacheKey(
  baseTableName: string,
  steps: PipelineStep[],
  limit: number
): string {
  return JSON.stringify({
    baseTableName,
    limit,
    steps
  });
}

export class PipelineResultCache {
  private readonly map = new Map<string, CachedQueryResult>();
  private readonly maxEntries: number;

  constructor(maxEntries = 25) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  clear(): void {
    this.map.clear();
  }

  get(key: string): CachedQueryResult | null {
    const value = this.map.get(key);
    return value ? cloneResult(value) : null;
  }

  set(key: string, result: CachedQueryResult): void {
    this.map.set(key, cloneResult(result));
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (typeof oldest === "string") {
        this.map.delete(oldest);
      }
    }
  }

  size(): number {
    return this.map.size;
  }
}
