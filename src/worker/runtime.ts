import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbEhWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdbMvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdbEhWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdbMvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import type {
  ChiSquareTestResult,
  ColumnInfo,
  ColumnProfile,
  CorrelationMethod,
  OLSRegressionResult,
  PearsonCorrelationResult,
  PrimitiveValue,
  TableProfile,
  WelchTTestResult
} from "../shared/types";
import { buildPipelineSql } from "../pipeline/compiler";
import { quoteIdentifier, quoteLiteral, sanitizeIdentifier } from "../shared/sql";
import type { WorkerRequest } from "../shared/workerProtocol";
import {
  ANALYSIS_MAX_ROWS,
  PROFILE_SQL_MAX_ROWS
} from "../shared/limits";
import {
  chiSquareTest,
  kendallCorrelationTest,
  pearsonCorrelationTest,
  spearmanCorrelationTest,
  welchTTest
} from "../stats/hypothesis";
import { inverseNormalCdf } from "../stats/distributions";
import { fitOLS } from "../stats/ols";
import {
  assertImportByteLimits,
  assertImportRowLimit
} from "./importLimits";
import {
  buildPipelineCacheKey,
  PipelineResultCache
} from "./pipelineCache";
import { diffTableRegistry } from "./tableRegistry";

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdbMvpWasm,
    mainWorker: duckdbMvpWorker
  },
  eh: {
    mainModule: duckdbEhWasm,
    mainWorker: duckdbEhWorker
  }
};
const MATERIALIZED_PIPELINE_CACHE_MAX_ENTRIES = 25;

function normalizeCell(value: unknown): PrimitiveValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    const safe = Number(value);
    return Number.isSafeInteger(safe) ? safe : value.toString();
  }
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

function isMissingCell(value: PrimitiveValue): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function parseFiniteNumber(value: PrimitiveValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

const DUCKDB_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_ ]*(\([0-9,\s]+\))?$/;

function normalizeTypeDefinition(typeName: string): string {
  const normalized = typeName.trim().replace(/\s+/g, " ").toUpperCase();
  if (!normalized) {
    throw new Error("Column type cannot be empty.");
  }
  if (!DUCKDB_TYPE_PATTERN.test(normalized)) {
    throw new Error(
      `Unsupported type format "${typeName}". Use DuckDB SQL types like VARCHAR, DOUBLE, INTEGER, DATE, TIMESTAMP, DECIMAL(18,4).`
    );
  }
  return normalized;
}

function comparableTypeName(typeName: string): string {
  return typeName.trim().replace(/\s+/g, " ").toUpperCase();
}

function quantileSorted(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) {
    return Number.NaN;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function summarizeNumeric(values: number[]): {
  mean: number;
  std: number;
  min: number;
  q25: number;
  q50: number;
  q75: number;
  max: number;
  rmse: number;
  mae: number;
} {
  if (values.length === 0) {
    throw new Error("Cannot summarize an empty numeric array.");
  }
  const n = values.length;
  const mean = values.reduce((acc, value) => acc + value, 0) / n;
  const variance =
    n > 1
      ? values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (n - 1)
      : 0;
  const std = Math.sqrt(Math.max(0, variance));
  const sorted = [...values].sort((a, b) => a - b);
  const rmse = Math.sqrt(values.reduce((acc, value) => acc + value ** 2, 0) / n);
  const mae = values.reduce((acc, value) => acc + Math.abs(value), 0) / n;
  return {
    mean,
    std,
    min: sorted[0],
    q25: quantileSorted(sorted, 0.25),
    q50: quantileSorted(sorted, 0.5),
    q75: quantileSorted(sorted, 0.75),
    max: sorted[sorted.length - 1],
    rmse,
    mae
  };
}

function sampleResidualPoints(
  fitted: number[],
  residuals: number[],
  maxPoints: number
): {
  sampled: boolean;
  totalPoints: number;
  points: Array<{ fitted: number; residual: number }>;
} {
  const totalPoints = Math.min(fitted.length, residuals.length);
  const safeLimit = Math.max(1, Math.floor(maxPoints));
  if (totalPoints <= safeLimit) {
    return {
      sampled: false,
      totalPoints,
      points: fitted.slice(0, totalPoints).map((value, index) => ({
        fitted: value,
        residual: residuals[index]
      }))
    };
  }

  const points: Array<{ fitted: number; residual: number }> = [];
  const step = safeLimit <= 1 ? 0 : (totalPoints - 1) / (safeLimit - 1);
  for (let i = 0; i < safeLimit; i += 1) {
    const index =
      safeLimit <= 1
        ? 0
        : Math.min(totalPoints - 1, Math.round(i * step));
    points.push({
      fitted: fitted[index],
      residual: residuals[index]
    });
  }
  return {
    sampled: true,
    totalPoints,
    points
  };
}

function samplePointsEvenly<T>(values: T[], maxPoints: number): {
  sampled: boolean;
  totalPoints: number;
  points: T[];
} {
  const totalPoints = values.length;
  const safeLimit = Math.max(1, Math.floor(maxPoints));
  if (totalPoints <= safeLimit) {
    return {
      sampled: false,
      totalPoints,
      points: values
    };
  }
  const points: T[] = [];
  const step = safeLimit <= 1 ? 0 : (totalPoints - 1) / (safeLimit - 1);
  for (let i = 0; i < safeLimit; i += 1) {
    const index =
      safeLimit <= 1
        ? 0
        : Math.min(totalPoints - 1, Math.round(i * step));
    points.push(values[index]);
  }
  return {
    sampled: true,
    totalPoints,
    points
  };
}

type ArrowQueryResult = {
  schema: {
    fields: Array<{ name: string }>;
  };
  toArray(): Array<Record<string, unknown>>;
};

function tableToRows(result: ArrowQueryResult): {
  columns: string[];
  rows: PrimitiveValue[][];
} {
  const columns = result.schema.fields.map((field) => field.name);
  const rows = result.toArray().map((record) =>
    columns.map((column) => normalizeCell(record[column]))
  );
  return { columns, rows };
}

export class DuckDBRuntime {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private readonly userTableNames = new Set<string>();
  private readonly pipelineResultCache = new PipelineResultCache(25);
  private readonly tableRowCountCache = new Map<string, number>();

  async init(): Promise<void> {
    if (this.conn) {
      return;
    }

    const bundle = await duckdb.selectBundle(BUNDLES);
    if (!bundle.mainWorker) {
      throw new Error("DuckDB worker bundle was not available");
    }

    const worker = new Worker(bundle.mainWorker);
    this.db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    let openedOnOpfs = false;
    try {
      await this.db.open({
        path: "opfs://statsfish.duckdb",
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
        opfs: {
          fileHandling: "auto"
        }
      });
      openedOnOpfs = true;
    } catch {
      try {
        await this.db.open({
          path: "statsfish_fallback.duckdb",
          accessMode: duckdb.DuckDBAccessMode.READ_WRITE
        });
      } catch {
        await this.db.open({});
      }
    }
    this.conn = await this.db.connect();
    try {
      await this.conn.query(`SET memory_limit = '512MB'`);
    } catch {
      // Ignore if this runtime version does not expose memory_limit.
    }
    try {
      await this.conn.query(`SET threads = 1`);
    } catch {
      // Ignore if this runtime version does not expose threads config.
    }
    if (openedOnOpfs) {
      try {
        await this.conn.query(`SET temp_directory = 'opfs://statsfish_tmp'`);
      } catch {
        // Ignore when OPFS temp directories are unavailable.
      }
    }
    await this.conn.query(`CREATE SCHEMA IF NOT EXISTS _sf_runtime`);
    await this.conn.query(`
      CREATE TABLE IF NOT EXISTS _sf_runtime.table_registry (
        table_name VARCHAR PRIMARY KEY,
        created_at TIMESTAMP DEFAULT now(),
        row_count BIGINT
      )
    `);
    await this.conn.query(`
      CREATE TABLE IF NOT EXISTS _sf_runtime.pipeline_cache (
        cache_key VARCHAR PRIMARY KEY,
        table_name VARCHAR NOT NULL,
        base_table_name VARCHAR NOT NULL,
        row_count BIGINT,
        updated_at TIMESTAMP DEFAULT now()
      )
    `);
    try {
      await this.conn.query(`
        ALTER TABLE _sf_runtime.table_registry
        ADD COLUMN row_count BIGINT
      `);
    } catch {
      // Column already exists on existing installs.
    }
    try {
      await this.conn.query(`
        ALTER TABLE _sf_runtime.pipeline_cache
        ADD COLUMN base_table_name VARCHAR
      `);
    } catch {
      // Column already exists on existing installs.
    }
    try {
      await this.conn.query(`
        ALTER TABLE _sf_runtime.pipeline_cache
        ADD COLUMN row_count BIGINT
      `);
    } catch {
      // Column already exists on existing installs.
    }
    try {
      await this.conn.query(`
        ALTER TABLE _sf_runtime.pipeline_cache
        ADD COLUMN updated_at TIMESTAMP DEFAULT now()
      `);
    } catch {
      // Column already exists on existing installs.
    }
  }

  private async getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
    await this.init();
    if (!this.conn) {
      throw new Error("DuckDB connection not initialized");
    }
    return this.conn;
  }

  async cancelPendingQuery(): Promise<boolean> {
    await this.init();
    if (!this.conn) {
      return false;
    }
    try {
      return await this.conn.useUnsafe((bindings, connectionId) =>
        bindings.cancelPendingQuery(connectionId)
      );
    } catch {
      try {
        return await this.conn.cancelSent();
      } catch {
        return false;
      }
    }
  }

  private async getTableColumns(tableName: string): Promise<ColumnInfo[]> {
    const conn = await this.getConnection();
    const schemaResult = (await conn.query(`
      SELECT
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ${quoteLiteral(tableName)}
      ORDER BY ordinal_position
    `)) as unknown as ArrowQueryResult;
    const schemaRows = tableToRows(schemaResult).rows;
    if (schemaRows.length > 0) {
      return schemaRows.map((row) => ({
        name: String(row[0]),
        type: String(row[1]),
        nullable: String(row[2] ?? "YES").toUpperCase() === "YES"
      }));
    }

    const fallbackResult = (await conn.query(
      `DESCRIBE SELECT * FROM ${quoteIdentifier(tableName)}`
    )) as unknown as ArrowQueryResult;
    const fallbackRows = tableToRows(fallbackResult).rows;
    return fallbackRows.map((row) => ({
      name: String(row[0]),
      type: String(row[1]),
      nullable: undefined
    }));
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const conn = await this.getConnection();
    const result = (await conn.query(`
      SELECT 1 AS exists_flag
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ${quoteLiteral(tableName)}
      LIMIT 1
    `)) as unknown as ArrowQueryResult;
    return tableToRows(result).rows.length > 0;
  }

  private newPipelineCacheTableName(): string {
    return `_sf_pipeline_cache_${sanitizeIdentifier(crypto.randomUUID())}`;
  }

  private async invalidatePipelineCaches(): Promise<void> {
    this.pipelineResultCache.clear();
    const conn = await this.getConnection();
    const cacheRows = (await conn.query(`
      SELECT table_name
      FROM _sf_runtime.pipeline_cache
    `)) as unknown as ArrowQueryResult;
    const tableNames = tableToRows(cacheRows).rows
      .map((row) => String(row[0] ?? ""))
      .filter((tableName) => tableName.length > 0);
    for (const tableName of tableNames) {
      await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
      this.tableRowCountCache.delete(tableName);
    }
    await conn.query(`DELETE FROM _sf_runtime.pipeline_cache`);
  }

  private async pruneMaterializedPipelineCache(): Promise<void> {
    const conn = await this.getConnection();
    const staleRows = (await conn.query(`
      SELECT cache_key, table_name
      FROM (
        SELECT
          cache_key,
          table_name,
          ROW_NUMBER() OVER (ORDER BY updated_at DESC) AS _sf_row_num
        FROM _sf_runtime.pipeline_cache
      )
      WHERE _sf_row_num > ${MATERIALIZED_PIPELINE_CACHE_MAX_ENTRIES}
    `)) as unknown as ArrowQueryResult;
    const staleEntries = tableToRows(staleRows).rows.map((row) => ({
      cacheKey: String(row[0] ?? ""),
      tableName: String(row[1] ?? "")
    }));
    for (const entry of staleEntries) {
      if (!entry.tableName) {
        continue;
      }
      await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(entry.tableName)}`);
      await conn.query(`
        DELETE FROM _sf_runtime.pipeline_cache
        WHERE cache_key = ${quoteLiteral(entry.cacheKey)}
      `);
      this.tableRowCountCache.delete(entry.tableName);
    }
  }

  private async materializePipelineCache(
    cacheKey: string,
    baseTableName: string,
    sql: string
  ): Promise<void> {
    const conn = await this.getConnection();
    const existingResult = (await conn.query(`
      SELECT table_name
      FROM _sf_runtime.pipeline_cache
      WHERE cache_key = ${quoteLiteral(cacheKey)}
      LIMIT 1
    `)) as unknown as ArrowQueryResult;
    const existingRow = tableToRows(existingResult).rows[0];
    const existingTableName =
      existingRow && existingRow[0] ? String(existingRow[0]) : null;
    const tableName = existingTableName || this.newPipelineCacheTableName();
    await conn.query(`
      CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS
      ${sql}
    `);
    const rowCount = await this.getTableRowCount(tableName, {
      bypassCache: true
    });
    await conn.query(`
      INSERT OR REPLACE INTO _sf_runtime.pipeline_cache (
        cache_key,
        table_name,
        base_table_name,
        row_count,
        updated_at
      )
      VALUES (
        ${quoteLiteral(cacheKey)},
        ${quoteLiteral(tableName)},
        ${quoteLiteral(baseTableName)},
        ${Math.max(0, Math.floor(rowCount))},
        now()
      )
    `);
    await this.pruneMaterializedPipelineCache();
  }

  private async readMaterializedPipelineCache(
    cacheKey: string,
    limit: number
  ): Promise<{
    columns: string[];
    rows: PrimitiveValue[][];
    rowCount: number;
  } | null> {
    const conn = await this.getConnection();
    const metadataResult = (await conn.query(`
      SELECT table_name, row_count
      FROM _sf_runtime.pipeline_cache
      WHERE cache_key = ${quoteLiteral(cacheKey)}
      LIMIT 1
    `)) as unknown as ArrowQueryResult;
    const metadataRow = tableToRows(metadataResult).rows[0];
    if (!metadataRow) {
      return null;
    }
    const tableName = String(metadataRow[0] ?? "");
    if (!tableName) {
      return null;
    }
    const tableExists = await this.tableExists(tableName);
    if (!tableExists) {
      await conn.query(`
        DELETE FROM _sf_runtime.pipeline_cache
        WHERE cache_key = ${quoteLiteral(cacheKey)}
      `);
      return null;
    }
    const previewResult = (await conn.query(`
      SELECT *
      FROM ${quoteIdentifier(tableName)}
      LIMIT ${Math.max(1, limit)}
    `)) as unknown as ArrowQueryResult;
    const { columns, rows } = tableToRows(previewResult);
    const metadataRowCount = Number(metadataRow[1] ?? Number.NaN);
    const rowCount = Number.isFinite(metadataRowCount)
      ? Math.max(0, Math.floor(metadataRowCount))
      : await this.getTableRowCount(tableName);
    await conn.query(`
      UPDATE _sf_runtime.pipeline_cache
      SET updated_at = now()
      WHERE cache_key = ${quoteLiteral(cacheKey)}
    `);
    return {
      columns,
      rows,
      rowCount
    };
  }

  private async getTableRowCount(
    tableName: string,
    options?: { bypassCache?: boolean }
  ): Promise<number> {
    if (!options?.bypassCache && this.tableRowCountCache.has(tableName)) {
      return this.tableRowCountCache.get(tableName) ?? 0;
    }
    if (!options?.bypassCache) {
      const registeredRowCount = await this.getRegisteredRowCount(tableName);
      if (registeredRowCount !== null) {
        this.tableRowCountCache.set(tableName, registeredRowCount);
        return registeredRowCount;
      }
    }
    const conn = await this.getConnection();
    const result = (await conn.query(`
      SELECT COUNT(*)::BIGINT AS row_count
      FROM ${quoteIdentifier(tableName)}
    `)) as unknown as ArrowQueryResult;
    const countRow = tableToRows(result).rows[0];
    const rowCount = Number(countRow?.[0] ?? 0);
    this.tableRowCountCache.set(tableName, rowCount);
    await this.updateRegisteredRowCount(tableName, rowCount);
    return rowCount;
  }

  private async getRegisteredRowCount(tableName: string): Promise<number | null> {
    const conn = await this.getConnection();
    const result = (await conn.query(`
      SELECT row_count
      FROM _sf_runtime.table_registry
      WHERE table_name = ${quoteLiteral(tableName)}
      LIMIT 1
    `)) as unknown as ArrowQueryResult;
    const row = tableToRows(result).rows[0];
    if (!row) {
      return null;
    }
    const value = row[0];
    const count = typeof value === "number" ? value : Number(value ?? Number.NaN);
    return Number.isFinite(count) ? count : null;
  }

  private async updateRegisteredRowCount(tableName: string, rowCount: number): Promise<void> {
    const conn = await this.getConnection();
    const normalizedCount = Math.max(0, Math.floor(rowCount));
    await conn.query(`
      UPDATE _sf_runtime.table_registry
      SET row_count = ${normalizedCount}
      WHERE table_name = ${quoteLiteral(tableName)}
    `);
  }

  private async assertRowLimitForTable(
    tableName: string,
    options?: { dropOnFailure?: boolean }
  ): Promise<number> {
    const rowCount = await this.getTableRowCount(tableName);
    try {
      assertImportRowLimit(tableName, rowCount);
    } catch (error) {
      if (options?.dropOnFailure ?? true) {
        const conn = await this.getConnection();
        await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
      }
      this.tableRowCountCache.delete(tableName);
      throw error;
    }
    return rowCount;
  }

  private async ensureHeaderlessColumns(rawTable: string): Promise<void> {
    const columns = await this.getTableColumns(rawTable);
    const conn = await this.getConnection();
    for (let i = 0; i < columns.length; i += 1) {
      const from = columns[i].name;
      const to = `c${i + 1}`;
      if (from !== to) {
        await conn.query(
          `ALTER TABLE ${quoteIdentifier(rawTable)} RENAME COLUMN ${quoteIdentifier(
            from
          )} TO ${quoteIdentifier(to)}`
        );
      }
    }
  }

  private async registerUserTable(
    tableName: string,
    rowCount?: number
  ): Promise<void> {
    this.userTableNames.add(tableName);
    if (typeof rowCount === "number" && Number.isFinite(rowCount)) {
      this.tableRowCountCache.set(tableName, Math.max(0, Math.floor(rowCount)));
    }
    const conn = await this.getConnection();
    const rowCountSql =
      typeof rowCount === "number" && Number.isFinite(rowCount)
        ? `${Math.max(0, Math.floor(rowCount))}`
        : "NULL";
    await conn.query(`
      INSERT OR REPLACE INTO _sf_runtime.table_registry(table_name, created_at, row_count)
      VALUES (${quoteLiteral(tableName)}, now(), ${rowCountSql})
    `);
  }

  private async listPhysicalUserTables(): Promise<string[]> {
    const conn = await this.getConnection();
    const discoveredResult = (await conn.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE '_sf_%'
      ORDER BY table_name
    `)) as unknown as ArrowQueryResult;
    return tableToRows(discoveredResult).rows.map((row) => String(row[0]));
  }

  async listTables(): Promise<string[]> {
    const conn = await this.getConnection();
    const discoveredTables = await this.listPhysicalUserTables();

    const registryResult = (await conn.query(`
      SELECT table_name
      FROM _sf_runtime.table_registry
      ORDER BY created_at DESC
    `)) as unknown as ArrowQueryResult;
    const registryRows = tableToRows(registryResult).rows;
    const registryTables = registryRows.map((row) => String(row[0]));
    const diff = diffTableRegistry(registryTables, discoveredTables);

    const registryMutated =
      diff.missingInRegistry.length > 0 || diff.staleInRegistry.length > 0;
    for (const tableName of discoveredTables) {
      this.userTableNames.add(tableName);
    }
    for (const tableName of diff.missingInRegistry) {
      await conn.query(`
        INSERT OR IGNORE INTO _sf_runtime.table_registry(table_name, created_at, row_count)
        VALUES (${quoteLiteral(tableName)}, now(), NULL)
      `);
    }
    for (const tableName of diff.staleInRegistry) {
      this.userTableNames.delete(tableName);
      this.tableRowCountCache.delete(tableName);
      await conn.query(`
        DELETE FROM _sf_runtime.table_registry
        WHERE table_name = ${quoteLiteral(tableName)}
      `);
    }

    if (registryMutated) {
      const normalizedRegistryResult = (await conn.query(`
        SELECT table_name
        FROM _sf_runtime.table_registry
        ORDER BY created_at DESC
      `)) as unknown as ArrowQueryResult;
      const normalizedRegistryTables = tableToRows(normalizedRegistryResult).rows.map((row) =>
        String(row[0])
      );
      if (normalizedRegistryTables.length > 0) {
        return normalizedRegistryTables;
      }
      if (discoveredTables.length > 0) {
        return discoveredTables;
      }
      return [];
    }

    if (registryTables.length > 0) {
      return registryTables;
    }
    if (discoveredTables.length > 0) {
      return discoveredTables;
    }

    return Array.from(this.userTableNames.values());
  }

  async renameTable(fromTableName: string, toTableName: string): Promise<{
    tableNames: string[];
    renamedTo: string;
  }> {
    const fromName = sanitizeIdentifier(fromTableName);
    const toName = sanitizeIdentifier(toTableName);
    if (!toName) {
      throw new Error("New table name cannot be empty.");
    }
    if (fromName === toName) {
      return {
        tableNames: await this.listTables(),
        renamedTo: toName
      };
    }

    const conn = await this.getConnection();
    const cachedRowCount = this.tableRowCountCache.get(fromName);
    await conn.query(`
      ALTER TABLE ${quoteIdentifier(fromName)}
      RENAME TO ${quoteIdentifier(toName)}
    `);
    await this.invalidatePipelineCaches();
    this.tableRowCountCache.delete(fromName);
    if (cachedRowCount !== undefined) {
      this.tableRowCountCache.set(toName, cachedRowCount);
    }
    this.userTableNames.delete(fromName);
    this.userTableNames.add(toName);
    await conn.query(`
      DELETE FROM _sf_runtime.table_registry
      WHERE table_name = ${quoteLiteral(fromName)}
    `);
    await this.registerUserTable(toName, cachedRowCount);
    return {
      tableNames: await this.listTables(),
      renamedTo: toName
    };
  }

  async alterTableColumn(
    payload: Extract<WorkerRequest, { type: "ALTER_TABLE_COLUMN" }>["payload"]
  ): Promise<{
    tableName: string;
    columns: ColumnInfo[];
  }> {
    const tableName = sanitizeIdentifier(payload.tableName);
    const fromColumnName = payload.columnName.trim();
    const toColumnName = payload.nextName.trim();
    const nextTypeDefinition = normalizeTypeDefinition(payload.nextType);

    if (!fromColumnName) {
      throw new Error("Current column name cannot be empty.");
    }
    if (!toColumnName) {
      throw new Error("New column name cannot be empty.");
    }

    const tableExists = await this.tableExists(tableName);
    if (!tableExists) {
      throw new Error(`Table "${tableName}" does not exist.`);
    }

    const currentColumns = await this.getTableColumns(tableName);
    const currentColumn = currentColumns.find((column) => column.name === fromColumnName);
    if (!currentColumn) {
      throw new Error(`Column "${fromColumnName}" does not exist in table "${tableName}".`);
    }
    if (
      toColumnName !== fromColumnName &&
      currentColumns.some((column) => column.name === toColumnName)
    ) {
      throw new Error(
        `Column rename failed: "${toColumnName}" already exists in table "${tableName}".`
      );
    }

    const requiresRename = fromColumnName !== toColumnName;
    const requiresTypeChange =
      comparableTypeName(currentColumn.type) !== comparableTypeName(nextTypeDefinition);
    const currentNullable = currentColumn.nullable ?? true;
    const nextNullable =
      typeof payload.nextNullable === "boolean" ? payload.nextNullable : currentNullable;
    const requiresNullableChange = currentNullable !== nextNullable;
    if (!requiresRename && !requiresTypeChange && !requiresNullableChange) {
      return {
        tableName,
        columns: currentColumns
      };
    }

    const conn = await this.getConnection();
    try {
      await conn.query(`SELECT CAST(NULL AS ${nextTypeDefinition})`);
    } catch {
      throw new Error(`DuckDB does not recognize column type "${payload.nextType}".`);
    }

    // Apply type mutation before rename to reduce catalog-version conflicts and keep
    // the operation deterministic for downstream replay.
    if (requiresTypeChange) {
      await conn.query(`
        ALTER TABLE ${quoteIdentifier(tableName)}
        ALTER COLUMN ${quoteIdentifier(fromColumnName)}
        TYPE ${nextTypeDefinition}
      `);
    }
    if (requiresRename) {
      await conn.query(`
        ALTER TABLE ${quoteIdentifier(tableName)}
        RENAME COLUMN ${quoteIdentifier(fromColumnName)} TO ${quoteIdentifier(toColumnName)}
      `);
    }
    const resolvedColumnName = requiresRename ? toColumnName : fromColumnName;
    if (requiresNullableChange) {
      if (nextNullable) {
        await conn.query(`
          ALTER TABLE ${quoteIdentifier(tableName)}
          ALTER COLUMN ${quoteIdentifier(resolvedColumnName)}
          DROP NOT NULL
        `);
      } else {
        const nullCountResult = (await conn.query(`
          SELECT COUNT(*)::BIGINT AS null_count
          FROM ${quoteIdentifier(tableName)}
          WHERE ${quoteIdentifier(resolvedColumnName)} IS NULL
        `)) as unknown as ArrowQueryResult;
        const nullCount = Number(tableToRows(nullCountResult).rows[0]?.[0] ?? 0);
        if (Number.isFinite(nullCount) && nullCount > 0) {
          throw new Error(
            `Cannot set NOT NULL on "${resolvedColumnName}" because ${nullCount.toLocaleString()} row(s) are NULL.`
          );
        }
        await conn.query(`
          ALTER TABLE ${quoteIdentifier(tableName)}
          ALTER COLUMN ${quoteIdentifier(resolvedColumnName)}
          SET NOT NULL
        `);
      }
    }

    await this.invalidatePipelineCaches();
    const columns = await this.getTableColumns(tableName);
    return {
      tableName,
      columns
    };
  }

  async deleteTable(tableName: string): Promise<{
    tableNames: string[];
    deletedTableName: string;
  }> {
    const normalizedTableName = sanitizeIdentifier(tableName);
    if (!normalizedTableName) {
      throw new Error("Table name cannot be empty.");
    }
    const conn = await this.getConnection();
    await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(normalizedTableName)}`);
    await conn.query(`
      DELETE FROM _sf_runtime.table_registry
      WHERE table_name = ${quoteLiteral(normalizedTableName)}
    `);
    this.userTableNames.delete(normalizedTableName);
    this.tableRowCountCache.delete(normalizedTableName);
    await this.invalidatePipelineCaches();
    return {
      tableNames: await this.listTables(),
      deletedTableName: normalizedTableName
    };
  }

  async resetProject(): Promise<{
    tableNames: string[];
    cleared: true;
  }> {
    const conn = await this.getConnection();
    const tables = await this.listTables();
    for (const tableName of tables) {
      await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
    }
    await conn.query(`DELETE FROM _sf_runtime.table_registry`);
    this.userTableNames.clear();
    this.tableRowCountCache.clear();
    await this.invalidatePipelineCaches();
    return {
      tableNames: [],
      cleared: true
    };
  }

  async importCSVs(payload: Extract<WorkerRequest, { type: "IMPORT_CSVS" }>["payload"]): Promise<{
    tableNames: string[];
    importedInto: string[];
  }> {
    const conn = await this.getConnection();
    if (!this.db) {
      throw new Error("DuckDB database is not initialized");
    }
    await this.invalidatePipelineCaches();
    const normalizedBaseName = sanitizeIdentifier(payload.tableName || "dataset");
    const sampleRows =
      typeof payload.sampleRows === "number" && Number.isFinite(payload.sampleRows)
        ? Math.max(1, Math.floor(payload.sampleRows))
        : undefined;
    if (!sampleRows) {
      assertImportByteLimits(
        payload.mergeMode,
        normalizedBaseName,
        payload.files.map((file) => ({
          sizeBytes:
            file.sizeBytes ??
            ("buffer" in file && file.buffer ? file.buffer.byteLength : 0)
        }))
      );
    }
    const virtualFileNames: string[] = [];
    const rawTableNames: string[] = [];
    const importedInto: string[] = [];

    try {
      for (let i = 0; i < payload.files.length; i += 1) {
        const file = payload.files[i];
        const virtualFile = `_sf_file_${normalizedBaseName}_${i}.csv`;
        const rawTable = `_sf_raw_${normalizedBaseName}_${i}`;

        if ("file" in file && file.file) {
          await this.db.registerFileHandle(
            virtualFile,
            file.file,
            duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
            true
          );
        } else if ("buffer" in file && file.buffer) {
          await this.db.registerFileBuffer(virtualFile, new Uint8Array(file.buffer));
        } else {
          throw new Error(`File entry ${i + 1} is missing file contents.`);
        }

        virtualFileNames.push(virtualFile);
        const sampleLimitClause = sampleRows ? `\n          LIMIT ${sampleRows}` : "";

        await conn.query(`
          CREATE OR REPLACE TEMP TABLE ${quoteIdentifier(rawTable)} AS
          SELECT * FROM read_csv_auto(
            ${quoteLiteral(virtualFile)},
            HEADER=${payload.hasHeader ? "TRUE" : "FALSE"},
            delim=${quoteLiteral(payload.delimiter)}
          )${sampleLimitClause}
        `);

        if (!payload.hasHeader) {
          await this.ensureHeaderlessColumns(rawTable);
        }
        rawTableNames.push(rawTable);
      }

      const includeExistingTable =
        !!payload.appendToExisting && (await this.tableExists(normalizedBaseName));
      if (payload.appendToExisting && !includeExistingTable) {
        throw new Error(`Cannot merge: existing table "${normalizedBaseName}" was not found.`);
      }
      const mergeSourceTables = includeExistingTable
        ? [normalizedBaseName, ...rawTableNames]
        : rawTableNames;
      if (payload.appendToExisting) {
        let projectedRowCount = 0;
        for (const tableName of mergeSourceTables) {
          projectedRowCount += await this.getTableRowCount(tableName);
        }
        assertImportRowLimit(normalizedBaseName, projectedRowCount);
      }

      if (payload.mergeMode === "separate_tables") {
        if (payload.appendToExisting) {
          throw new Error(
            "Separate-tables mode cannot be used when merging into an existing table."
          );
        }
        for (let i = 0; i < rawTableNames.length; i += 1) {
          const finalName =
            rawTableNames.length === 1
              ? normalizedBaseName
              : `${normalizedBaseName}_${i + 1}`;
          await conn.query(`
            CREATE OR REPLACE TABLE ${quoteIdentifier(finalName)} AS
            SELECT * FROM ${quoteIdentifier(rawTableNames[i])}
          `);
          const finalRowCount = await this.assertRowLimitForTable(finalName);
          await this.registerUserTable(finalName, finalRowCount);
          importedInto.push(finalName);
        }
      } else if (payload.mergeMode === "same_table_union_by_name") {
        const unionSql = mergeSourceTables
          .map((table) => `SELECT * FROM ${quoteIdentifier(table)}`)
          .join("\nUNION ALL BY NAME\n");
        await conn.query(`
          CREATE OR REPLACE TABLE ${quoteIdentifier(normalizedBaseName)} AS
          ${unionSql}
        `);
        const finalRowCount = await this.assertRowLimitForTable(normalizedBaseName, {
          dropOnFailure: !payload.appendToExisting
        });
        await this.registerUserTable(normalizedBaseName, finalRowCount);
        importedInto.push(normalizedBaseName);
      } else if (payload.mergeMode === "same_table_exact_schema") {
        const baseCols = await this.getTableColumns(mergeSourceTables[0]);
        for (let i = 1; i < mergeSourceTables.length; i += 1) {
          const nextCols = await this.getTableColumns(mergeSourceTables[i]);
          const sameLength = baseCols.length === nextCols.length;
          const sameSchema =
            sameLength &&
            baseCols.every(
              (col, index) =>
                col.name === nextCols[index].name &&
                col.type.toLowerCase() === nextCols[index].type.toLowerCase()
            );
          if (!sameSchema) {
            throw new Error(
              `Schema mismatch in file ${i + 1}. Use union-by-name or by-position mode.`
            );
          }
        }
        const unionSql = mergeSourceTables
          .map((table) => `SELECT * FROM ${quoteIdentifier(table)}`)
          .join("\nUNION ALL\n");
        await conn.query(`
          CREATE OR REPLACE TABLE ${quoteIdentifier(normalizedBaseName)} AS
          ${unionSql}
        `);
        const finalRowCount = await this.assertRowLimitForTable(normalizedBaseName, {
          dropOnFailure: !payload.appendToExisting
        });
        await this.registerUserTable(normalizedBaseName, finalRowCount);
        importedInto.push(normalizedBaseName);
      } else if (payload.mergeMode === "same_table_by_position") {
        const columnSets = await Promise.all(
          mergeSourceTables.map((table) => this.getTableColumns(table))
        );
        const maxColumns = Math.max(...columnSets.map((columns) => columns.length));
        const tableSelects = mergeSourceTables.map((tableName, tableIndex) => {
          const columns = columnSets[tableIndex];
          const selectColumns = Array.from({ length: maxColumns }, (_, i) => {
            if (i < columns.length) {
              return `CAST(${quoteIdentifier(columns[i].name)} AS VARCHAR) AS ${quoteIdentifier(
                `c${i + 1}`
              )}`;
            }
            return `NULL::VARCHAR AS ${quoteIdentifier(`c${i + 1}`)}`;
          });
          return `SELECT ${selectColumns.join(", ")} FROM ${quoteIdentifier(tableName)}`;
        });

        await conn.query(`
          CREATE OR REPLACE TABLE ${quoteIdentifier(normalizedBaseName)} AS
          ${tableSelects.join("\nUNION ALL\n")}
        `);
        const finalRowCount = await this.assertRowLimitForTable(normalizedBaseName, {
          dropOnFailure: !payload.appendToExisting
        });
        await this.registerUserTable(normalizedBaseName, finalRowCount);
        importedInto.push(normalizedBaseName);
      }

      return {
        tableNames: await this.listTables(),
        importedInto
      };
    } finally {
      for (const rawTableName of rawTableNames) {
        await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(rawTableName)}`);
        this.tableRowCountCache.delete(rawTableName);
      }
      if (this.db && virtualFileNames.length > 0) {
        await this.db.dropFiles(virtualFileNames);
      }
    }
  }

  async previewTable(tableName: string, limit = 200): Promise<{
    tableName: string;
    rowCount: number;
    columns: ColumnInfo[];
    rows: PrimitiveValue[][];
  }> {
    const conn = await this.getConnection();
    const countResult = (await conn.query(`
      SELECT COUNT(*)::BIGINT AS row_count
      FROM ${quoteIdentifier(tableName)}
    `)) as unknown as ArrowQueryResult;
    const countRow = tableToRows(countResult).rows[0];
    const rowCount = Number(countRow?.[0] ?? 0);

    const preview = (await conn.query(`
      SELECT * FROM ${quoteIdentifier(tableName)}
      LIMIT ${Math.max(1, limit)}
    `)) as unknown as ArrowQueryResult;
    const { columns, rows } = tableToRows(preview);

    const schema = await this.getTableColumns(tableName);

    return {
      tableName,
      rowCount,
      columns: schema.length ? schema : columns.map((name) => ({ name, type: "UNKNOWN" })),
      rows
    };
  }

  async runSQL(
    sql: string,
    limit = 200,
    includeTotalRowCount = true,
    offset = 0
  ): Promise<{
    columns: string[];
    rows: PrimitiveValue[][];
    rowCount: number;
  }> {
    const conn = await this.getConnection();
    const cleanSql = sql.trim().replace(/;$/, "");
    if (!cleanSql) {
      return { columns: [], rows: [], rowCount: 0 };
    }

    const selectable = /^\s*(with|select)\b/i.test(cleanSql);
    if (!selectable) {
      throw new Error("Only SELECT/CTE statements are allowed in query execution.");
    }

    const wrappedSql = includeTotalRowCount
      ? `
          SELECT
            *,
            COUNT(*) OVER ()::BIGINT AS ${quoteIdentifier("_sf_total_row_count")}
          FROM (
            ${cleanSql}
          ) AS _sf_query_result
          LIMIT ${Math.max(1, limit)}
          OFFSET ${Math.max(0, Math.floor(offset))}
        `
      : `
          SELECT * FROM (
            ${cleanSql}
          ) AS _sf_query_result
          LIMIT ${Math.max(1, limit)}
          OFFSET ${Math.max(0, Math.floor(offset))}
        `;
    const result = (await conn.query(wrappedSql)) as unknown as ArrowQueryResult;
    const { columns, rows } = tableToRows(result);
    if (!includeTotalRowCount) {
      return {
        columns,
        rows,
        rowCount: rows.length
      };
    }

    const countColumnIndex = columns.length - 1;
    const rawCount =
      rows.length > 0 && countColumnIndex >= 0 ? rows[0][countColumnIndex] : 0;
    const parsedRowCount = typeof rawCount === "number" ? rawCount : Number(rawCount ?? 0);
    const rowCount = Number.isFinite(parsedRowCount) ? Math.max(0, Math.floor(parsedRowCount)) : rows.length;
    const displayColumns = columns.slice(0, Math.max(0, columns.length - 1));
    const displayRows = rows.map((row) => row.slice(0, Math.max(0, row.length - 1)));
    return {
      columns: displayColumns,
      rows: displayRows,
      rowCount
    };
  }

  async runPipeline(
    baseTableName: string,
    steps: Extract<WorkerRequest, { type: "RUN_PIPELINE" }>["payload"]["steps"],
    limit = 200
  ): Promise<{
    columns: string[];
    rows: PrimitiveValue[][];
    rowCount: number;
  }> {
    const normalizedLimit = Math.max(1, limit);
    const cacheKey = buildPipelineCacheKey(baseTableName, steps, normalizedLimit);
    const cached = this.pipelineResultCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const materialized = await this.readMaterializedPipelineCache(
      cacheKey,
      normalizedLimit
    );
    if (materialized) {
      this.pipelineResultCache.set(cacheKey, materialized);
      return materialized;
    }
    const sql = buildPipelineSql(steps, baseTableName);
    await this.materializePipelineCache(cacheKey, baseTableName, sql);
    const result =
      (await this.readMaterializedPipelineCache(cacheKey, normalizedLimit)) ??
      (await this.runSQL(sql, normalizedLimit));
    this.pipelineResultCache.set(cacheKey, result);
    return result;
  }

  private async runSelect(
    sql: string,
    options?: {
      rowLimit?: number;
    }
  ): Promise<{
    columns: string[];
    rows: PrimitiveValue[][];
  }> {
    const cleanSql = sql.trim().replace(/;$/, "");
    if (!/^\s*(with|select)\b/i.test(cleanSql)) {
      throw new Error("Statistical tests require a SELECT/CTE query.");
    }
    const rowLimit =
      typeof options?.rowLimit === "number" && Number.isFinite(options.rowLimit)
        ? Math.max(1, Math.floor(options.rowLimit))
        : ANALYSIS_MAX_ROWS;
    const conn = await this.getConnection();
    const result = (await conn.query(`
      SELECT *
      FROM (
        ${cleanSql}
      ) AS _sf_select_source
      LIMIT ${rowLimit}
    `)) as unknown as ArrowQueryResult;
    return tableToRows(result);
  }

  async runWelchTTest(
    payload: Extract<WorkerRequest, { type: "RUN_WELCH_T_TEST" }>["payload"]
  ): Promise<WelchTTestResult> {
    const valueColumn = payload.valueColumn.trim();
    const groupColumn = payload.groupColumn.trim();
    const groupA = payload.groupA.trim();
    const groupB = payload.groupB.trim();
    const confidenceLevel = payload.confidenceLevel ?? 0.95;

    if (!valueColumn || !groupColumn) {
      throw new Error("Welch t-test requires value and group columns.");
    }
    if (!groupA || !groupB) {
      throw new Error("Welch t-test requires both group labels.");
    }
    if (groupA === groupB) {
      throw new Error("Welch t-test group labels must be different.");
    }

    const { rows } = await this.runSelect(`
      WITH _sf_test_source AS (
        ${payload.sql}
      )
      SELECT
        ${quoteIdentifier(valueColumn)} AS _sf_value,
        ${quoteIdentifier(groupColumn)} AS _sf_group
      FROM _sf_test_source
    `);

    const sampleA: number[] = [];
    const sampleB: number[] = [];
    let droppedNullRows = 0;
    let droppedInvalidRows = 0;
    let droppedOutOfGroupRows = 0;

    for (const row of rows) {
      const value = row[0] ?? null;
      const groupValue = row[1] ?? null;

      if (isMissingCell(groupValue)) {
        droppedNullRows += 1;
        continue;
      }
      const normalizedGroup = String(groupValue);
      if (normalizedGroup !== groupA && normalizedGroup !== groupB) {
        droppedOutOfGroupRows += 1;
        continue;
      }

      const numericValue = parseFiniteNumber(value);
      if (numericValue === null) {
        if (isMissingCell(value)) {
          droppedNullRows += 1;
        } else {
          droppedInvalidRows += 1;
        }
        continue;
      }

      if (normalizedGroup === groupA) {
        sampleA.push(numericValue);
      } else {
        sampleB.push(numericValue);
      }
    }

    const stats = welchTTest(sampleA, sampleB, confidenceLevel);
    const effectiveSampleSize = sampleA.length + sampleB.length;
    const totalRows = rows.length;
    const droppedRows = totalRows - effectiveSampleSize;

    return {
      ...stats,
      valueColumn,
      groupColumn,
      groupA,
      groupB,
      completeCases: {
        totalRows,
        effectiveSampleSize,
        droppedRows,
        droppedNullRows,
        droppedInvalidRows,
        droppedOutOfGroupRows
      }
    };
  }

  async runPearsonCorrelation(
    payload: Extract<WorkerRequest, { type: "RUN_PEARSON_CORRELATION" }>["payload"]
  ): Promise<PearsonCorrelationResult> {
    const xColumn = payload.xColumn.trim();
    const yColumn = payload.yColumn.trim();
    const method: CorrelationMethod = payload.method ?? "pearson";
    const confidenceLevel = payload.confidenceLevel ?? 0.95;
    if (!xColumn || !yColumn) {
      throw new Error("Correlation requires two numeric columns.");
    }

    const { rows } = await this.runSelect(`
      WITH _sf_test_source AS (
        ${payload.sql}
      )
      SELECT
        ${quoteIdentifier(xColumn)} AS _sf_x,
        ${quoteIdentifier(yColumn)} AS _sf_y
      FROM _sf_test_source
    `);

    const xValues: number[] = [];
    const yValues: number[] = [];
    let droppedNullRows = 0;
    let droppedInvalidRows = 0;

    for (const row of rows) {
      const x = row[0] ?? null;
      const y = row[1] ?? null;
      const numericX = parseFiniteNumber(x);
      const numericY = parseFiniteNumber(y);

      if (numericX === null || numericY === null) {
        if (isMissingCell(x) || isMissingCell(y)) {
          droppedNullRows += 1;
        } else {
          droppedInvalidRows += 1;
        }
        continue;
      }

      xValues.push(numericX);
      yValues.push(numericY);
    }

    type CorrelationCoreResult = Omit<
      PearsonCorrelationResult,
      "xColumn" | "yColumn" | "completeCases"
    >;
    let stats: CorrelationCoreResult;
    if (method === "spearman") {
      stats = spearmanCorrelationTest(xValues, yValues, confidenceLevel);
    } else if (method === "kendall") {
      stats = kendallCorrelationTest(xValues, yValues, confidenceLevel);
    } else {
      stats = pearsonCorrelationTest(xValues, yValues, confidenceLevel);
    }
    const effectiveSampleSize = xValues.length;
    const totalRows = rows.length;
    const droppedRows = totalRows - effectiveSampleSize;

    return {
      ...stats,
      xColumn,
      yColumn,
      completeCases: {
        totalRows,
        effectiveSampleSize,
        droppedRows,
        droppedNullRows,
        droppedInvalidRows
      }
    };
  }

  async runChiSquareTest(
    payload: Extract<WorkerRequest, { type: "RUN_CHI_SQUARE_TEST" }>["payload"]
  ): Promise<ChiSquareTestResult> {
    const rowColumn = payload.rowColumn.trim();
    const columnColumn = payload.columnColumn.trim();
    if (!rowColumn || !columnColumn) {
      throw new Error("Chi-square test requires row and column category fields.");
    }

    const { rows } = await this.runSelect(`
      WITH _sf_test_source AS (
        ${payload.sql}
      )
      SELECT
        ${quoteIdentifier(rowColumn)} AS _sf_row,
        ${quoteIdentifier(columnColumn)} AS _sf_column
      FROM _sf_test_source
    `);

    const observations: Array<{ rowCategory: string; columnCategory: string }> = [];
    let droppedNullRows = 0;

    for (const row of rows) {
      const rowValue = row[0] ?? null;
      const columnValue = row[1] ?? null;
      if (isMissingCell(rowValue) || isMissingCell(columnValue)) {
        droppedNullRows += 1;
        continue;
      }

      observations.push({
        rowCategory: String(rowValue),
        columnCategory: String(columnValue)
      });
    }

    const stats = chiSquareTest(observations);
    const effectiveSampleSize = observations.length;
    const totalRows = rows.length;
    const droppedRows = totalRows - effectiveSampleSize;

    return {
      ...stats,
      rowColumn,
      columnColumn,
      completeCases: {
        totalRows,
        effectiveSampleSize,
        droppedRows,
        droppedNullRows,
        droppedInvalidRows: 0
      }
    };
  }

  async runOLSRegression(
    payload: Extract<WorkerRequest, { type: "RUN_OLS_REGRESSION" }>["payload"]
  ): Promise<OLSRegressionResult> {
    const dependentColumn = payload.dependentColumn.trim();
    const independentColumns = Array.from(
      new Set(
        payload.independentColumns
          .map((column) => column.trim())
          .filter((column) => column.length > 0)
      )
    );
    const includeIntercept = payload.includeIntercept !== false;
    const oneHotEncodeCategorical = payload.oneHotEncodeCategorical !== false;
    const maxDiagnosticPoints = payload.maxDiagnosticPoints ?? 5000;

    if (!dependentColumn) {
      throw new Error("OLS regression requires a dependent column.");
    }
    if (independentColumns.length === 0) {
      throw new Error("OLS regression requires at least one independent column.");
    }
    if (independentColumns.includes(dependentColumn)) {
      throw new Error(
        "Dependent column cannot also be listed as an independent column."
      );
    }

    const projectionSql = [
      `${quoteIdentifier(dependentColumn)} AS _sf_y`,
      ...independentColumns.map(
        (column, index) => `${quoteIdentifier(column)} AS ${quoteIdentifier(`_sf_x_${index}`)}`
      )
    ].join(",\n        ");
    const { rows } = await this.runSelect(`
      WITH _sf_model_source AS (
        ${payload.sql}
      )
      SELECT
        ${projectionSql}
      FROM _sf_model_source
    `);

    type CandidateRow = {
      y: number;
      predictors: PrimitiveValue[];
    };
    const candidateRows: CandidateRow[] = [];
    let droppedNullRows = 0;
    let droppedInvalidRows = 0;

    for (const row of rows) {
      const yRaw = row[0] ?? null;
      const yValue = parseFiniteNumber(yRaw);
      if (yValue === null) {
        if (isMissingCell(yRaw)) {
          droppedNullRows += 1;
        } else {
          droppedInvalidRows += 1;
        }
        continue;
      }

      const predictors = row.slice(1).map((value) => value ?? null);
      if (predictors.some((value) => isMissingCell(value))) {
        droppedNullRows += 1;
        continue;
      }

      candidateRows.push({
        y: yValue,
        predictors
      });
    }

    if (candidateRows.length === 0) {
      throw new Error(
        "OLS regression has no complete rows after null/type filtering."
      );
    }

    const numericPredictors = independentColumns.map((_, index) =>
      candidateRows.every((row) => parseFiniteNumber(row.predictors[index]) !== null)
    );
    if (!oneHotEncodeCategorical && numericPredictors.some((isNumeric) => !isNumeric)) {
      const categoricalColumn = independentColumns.find(
        (_, index) => !numericPredictors[index]
      );
      throw new Error(
        `Independent column "${categoricalColumn}" is categorical. Enable one-hot encoding.`
      );
    }

    const droppedCategoryByColumn: Record<string, string> = {};
    const categoricalKeptCategories = new Map<string, string[]>();
    if (oneHotEncodeCategorical) {
      independentColumns.forEach((column, index) => {
        if (numericPredictors[index]) {
          return;
        }
        const categories = Array.from(
          new Set(candidateRows.map((row) => String(row.predictors[index])))
        ).sort((a, b) => a.localeCompare(b));
        const referenceCategory = categories[0];
        droppedCategoryByColumn[column] = referenceCategory;
        categoricalKeptCategories.set(column, categories.slice(1));
      });
    }

    const termNames: string[] = [];
    independentColumns.forEach((column, index) => {
      if (numericPredictors[index]) {
        termNames.push(column);
        return;
      }
      const keptCategories = categoricalKeptCategories.get(column) ?? [];
      keptCategories.forEach((category) => {
        termNames.push(`${column}[${category}]`);
      });
    });

    const yValues: number[] = [];
    const xMatrix: number[][] = [];
    for (const candidate of candidateRows) {
      const featureRow: number[] = [];
      let invalidRow = false;

      for (let index = 0; index < independentColumns.length; index += 1) {
        if (numericPredictors[index]) {
          const numericValue = parseFiniteNumber(candidate.predictors[index]);
          if (numericValue === null) {
            invalidRow = true;
            break;
          }
          featureRow.push(numericValue);
          continue;
        }

        const column = independentColumns[index];
        const value = String(candidate.predictors[index]);
        const keptCategories = categoricalKeptCategories.get(column) ?? [];
        keptCategories.forEach((category) => {
          featureRow.push(value === category ? 1 : 0);
        });
      }

      if (invalidRow) {
        droppedInvalidRows += 1;
        continue;
      }
      yValues.push(candidate.y);
      xMatrix.push(featureRow);
    }

    const effectiveSampleSize = yValues.length;
    const totalRows = rows.length;
    const droppedRows = totalRows - effectiveSampleSize;
    if (effectiveSampleSize === 0) {
      throw new Error("OLS regression has no valid rows after preprocessing.");
    }
    if (!includeIntercept && xMatrix[0]?.length === 0) {
      throw new Error(
        "OLS regression requires at least one predictor when intercept is disabled."
      );
    }

    const fitted = fitOLS(yValues, xMatrix, {
      intercept: includeIntercept
    });
    const coefficientTerms = includeIntercept
      ? ["Intercept", ...termNames]
      : [...termNames];
    if (coefficientTerms.length !== fitted.coefficients.length) {
      throw new Error("OLS term mapping failed due to mismatched coefficient lengths.");
    }

    const coefficients = fitted.coefficients.map((estimate, index) => ({
      term: coefficientTerms[index],
      estimate,
      standardError: fitted.standardErrors[index],
      tStatistic: fitted.tStatistics[index],
      pValue: fitted.pValues[index]
    }));
    const sortedStandardizedResiduals = [...fitted.standardizedResiduals]
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    const qqPoints = sortedStandardizedResiduals.map((standardizedResidual, index) => {
      const probability = (index + 0.5) / sortedStandardizedResiduals.length;
      return {
        theoreticalQuantile: inverseNormalCdf(probability),
        standardizedResidual
      };
    });
    const leveragePoints = fitted.leverage
      .map((leverage, index) => ({
        rowIndex: index,
        leverage,
        standardizedResidual: fitted.standardizedResiduals[index],
        cooksDistance: fitted.cooksDistance[index]
      }))
      .filter(
        (point) =>
          Number.isFinite(point.leverage) &&
          Number.isFinite(point.standardizedResidual) &&
          Number.isFinite(point.cooksDistance)
      );
    const topInfluencePoints = [...leveragePoints]
      .sort((left, right) => right.cooksDistance - left.cooksDistance)
      .slice(0, 10)
      .map((point) => ({
        rowIndex: point.rowIndex,
        leverage: point.leverage,
        standardizedResidual: point.standardizedResidual,
        cooksDistance: point.cooksDistance
      }));

    return {
      kind: "ols_regression",
      dependentColumn,
      independentColumns,
      includeIntercept,
      oneHotEncodeCategorical,
      droppedCategoryByColumn,
      coefficients,
      r2: fitted.r2,
      adjustedR2: fitted.adjustedR2,
      n: fitted.n,
      residualSummary: summarizeNumeric(fitted.residuals),
      residualsVsFitted: sampleResidualPoints(
        fitted.fitted,
        fitted.residuals,
        maxDiagnosticPoints
      ),
      qqPlot: samplePointsEvenly(qqPoints, maxDiagnosticPoints),
      leverageVsResidual: samplePointsEvenly(
        leveragePoints.map((point) => ({
          leverage: point.leverage,
          standardizedResidual: point.standardizedResidual,
          cooksDistance: point.cooksDistance
        })),
        maxDiagnosticPoints
      ),
      topInfluencePoints,
      completeCases: {
        totalRows,
        effectiveSampleSize,
        droppedRows,
        droppedNullRows,
        droppedInvalidRows
      }
    };
  }

  private async buildColumnProfiles(
    tableName: string,
    columns: ColumnInfo[]
  ): Promise<ColumnProfile[]> {
    const conn = await this.getConnection();
    const profileColumns: ColumnProfile[] = [];

    for (const column of columns) {
      const columnRef = quoteIdentifier(column.name);
      const numericValue = `TRY_CAST(${columnRef} AS DOUBLE)`;
      const result = (await conn.query(`
        SELECT
          COUNT(${columnRef}) AS value_count,
          COUNT(*) FILTER (WHERE ${columnRef} IS NULL) AS null_count,
          COUNT(DISTINCT ${columnRef}) AS distinct_count,
          MIN(${columnRef}) AS min_value,
          MAX(${columnRef}) AS max_value,
          AVG(${numericValue}) AS mean_value,
          STDDEV_SAMP(${numericValue}) AS std_value,
          quantile_cont(${numericValue}, 0.25) AS q25_value,
          quantile_cont(${numericValue}, 0.50) AS q50_value,
          quantile_cont(${numericValue}, 0.75) AS q75_value
        FROM ${quoteIdentifier(tableName)}
      `)) as unknown as ArrowQueryResult;
      const row = tableToRows(result).rows[0] ?? [];
      const mean = parseFiniteNumber(row[5] ?? null);
      const std = parseFiniteNumber(row[6] ?? null);
      const q25 = parseFiniteNumber(row[7] ?? null);
      const q50 = parseFiniteNumber(row[8] ?? null);
      const q75 = parseFiniteNumber(row[9] ?? null);
      const topValuesResult = (await conn.query(`
        SELECT
          ${columnRef} AS value,
          COUNT(*) AS value_count
        FROM ${quoteIdentifier(tableName)}
        WHERE ${columnRef} IS NOT NULL
        GROUP BY 1
        ORDER BY value_count DESC
        LIMIT 10
      `)) as unknown as ArrowQueryResult;
      const topValues = tableToRows(topValuesResult).rows.map((topRow) => ({
        value: normalizeCell(topRow[0] ?? null),
        count: Number(topRow[1] ?? 0)
      }));

      profileColumns.push({
        column: column.name,
        type: column.type,
        count: Number(row[0] ?? 0),
        nullCount: Number(row[1] ?? 0),
        distinctCount: Number(row[2] ?? 0),
        topValues,
        min: row[3] ?? null,
        max: row[4] ?? null,
        mean: mean === null ? undefined : mean,
        std: std === null ? undefined : std,
        q25: q25 === null ? undefined : q25,
        q50: q50 === null ? undefined : q50,
        q75: q75 === null ? undefined : q75
      });
    }

    return profileColumns;
  }

  private async buildTableProfile(
    tableName: string,
    limitColumns = 30,
    label?: string
  ): Promise<TableProfile> {
    const safeLimit = Math.max(1, limitColumns);
    const rowCount = await this.getTableRowCount(tableName);
    const columns = (await this.getTableColumns(tableName)).slice(0, safeLimit);
    const profileColumns = await this.buildColumnProfiles(tableName, columns);
    return {
      tableName: label && label.trim() ? label.trim() : tableName,
      rowCount,
      columns: profileColumns
    };
  }

  async profileTable(tableName: string, limitColumns = 30): Promise<TableProfile> {
    return this.buildTableProfile(tableName, limitColumns);
  }

  async profileSql(
    payload: Extract<WorkerRequest, { type: "PROFILE_SQL" }>["payload"]
  ): Promise<TableProfile> {
    const conn = await this.getConnection();
    const cleanSql = payload.sql.trim().replace(/;$/, "");
    if (!/^\s*(with|select)\b/i.test(cleanSql)) {
      throw new Error("Profile requires a SELECT/CTE query.");
    }
    const tempTableName = `_sf_profile_${Math.random().toString(36).slice(2, 10)}`;
    await conn.query(`
      CREATE OR REPLACE TEMP TABLE ${quoteIdentifier(tempTableName)} AS
      SELECT *
      FROM (
        ${cleanSql}
      ) AS _sf_profile_source
      LIMIT ${PROFILE_SQL_MAX_ROWS}
    `);
    try {
      return await this.buildTableProfile(
        tempTableName,
        payload.limitColumns ?? 40,
        payload.label
      );
    } finally {
      await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tempTableName)}`);
    }
  }
}
