# Specifications Version 1

## 1. Summary
StatsFish is a local-first, browser-only data analysis application. The app runs fully on the client, loads user CSV files, supports SQL and GUI-based transformations, provides core statistical analysis, and stores reproducible notebook outputs. All expensive computation runs in a Web Worker with DuckDB-Wasm to keep the UI responsive.

## 2. Product Goals

### 2.1 Primary Goals
1. Enable quick spreadsheet-style and SQL-style analysis without a backend.
2. Represent data work as reproducible steps that can be exported and re-imported.
3. Support exploratory and inferential analysis in one interface.
4. Keep the UI responsive for medium-large local datasets.

### 2.2 Non-Goals for V1
1. No server persistence, sharing links, or collaborative features.
2. No guaranteed support for datasets larger than browser memory limits.
3. No full Pandas feature parity.

## 3. Technical Boundaries
1. Frontend stack: React + TypeScript + Vite.
2. Compute engine: DuckDB-Wasm in a dedicated Web Worker.
3. Data interchange: Arrow IPC where practical to minimize copies.
4. No network upload of user data, no analytics beacons, no external API calls.
5. App works offline after initial load.
6. Keep dependencies minimal and practical for shipping.
7. Local persistence uses `IndexedDB` for project metadata/state and `OPFS` for larger local artifacts and caches.
8. Prefer DuckDB-native features whenever they reduce complexity or improve performance (for example: views, temp tables, and internal metadata tables for lineage/cache bookkeeping). Keep recipe export/import and durable app metadata independent from DuckDB internals.

## 4. MVP Scope

### 4.1 Core UI Layout
1. Single-page app with three panes.
2. Left pane (Data Window) has tabs: `Data`, `Transforms`, `Queries`.
3. Center pane (Work Window) hosts transform builders and SQL editor.
4. Right pane (Results Window) shows notebook outputs and `Profile`.

### 4.2 Data Loading and Table Management
1. CSV import is required.
2. Multi-file import modes:
   - `separate_tables`
   - `same_table_union_by_name` (default; fill missing columns with `NULL`)
   - `same_table_exact_schema`
   - `same_table_by_position`
3. Headerless files use generated names (`c1`, `c2`, ...).
4. User can rename tables.
5. V1 hard cap: `1,000,000 rows` or `250 MB` per logical imported table.
6. Above cap: show explicit warning/modal and offer safe fallback behavior (cancel or sampled preview where applicable).

### 4.3 Pipeline System
1. Pipeline is linear for canonical data preparation: `t0 -> t1 -> t2 -> ...`.
2. Every enabled step has deterministic SQL output.
3. Step model includes:
   - `id` (stable UUID)
   - `name`
   - `type`
   - `enabled`
   - `params`
   - version metadata
4. Supported step types in V1:
   - `LoadCSVStep`
   - `SQLTransformStep`
   - `FilterStep`
   - `SelectColumnsStep`
   - `MutateColumnStep`
   - `GroupAggregateStep`
   - `JoinStep`
   - `PivotStep` (stub allowed if not fully implemented)
5. Curated GUI cleaning transforms in V1:
   - remove duplicates
   - fill/drop missing values
   - sort rows
   - type cast and date parsing
   - one-hot encoding (basic)
   - numeric scaling
6. SQL is always available as a fallback for any operation.

### 4.4 Saved Queries and Dependency Versioning
1. Saved queries are exploratory artifacts, separate from the canonical pipeline order.
2. Saved query references are ID/version-based, not name-based.
3. Query names are aliases only; renaming does not rewrite SQL text.
4. Saved queries store definition and parameters, then execute lazily.
5. Saved queries can target:
   - any pipeline step version
   - any saved query version
6. Editing a step or query creates a new immutable version.
7. If upstream change impacts dependents, show a per-dependent prompt with actions across the full transitive dependency chain:
   - `Adopt new upstream`
   - `Keep pinned to old upstream`
   - `Fork new dependent version`
8. Version retention policy: keep all versions until user manually prunes.
9. Saved query dependencies must remain acyclic; save/edit that would create a cycle is rejected with a clear error.

### 4.5 EDA Profile
1. Profile appears in the Results pane.
2. Profile metrics:
   - row count
   - inferred type per column
   - null count
   - distinct count (approximate allowed)
   - min/max for numeric/date
   - top values for categorical/text
   - quantiles `p25`, `p50`, `p75` for numeric when feasible

### 4.6 Statistical Tests
1. Welch two-sample t-test.
2. Pearson correlation test.
3. Chi-square test of independence with contingency table.
4. Result block includes test metadata, assumptions/caveats, effect size, p-value, and CI when feasible.
5. CI/effect-size minimum guarantee: complete support for t-test.

### 4.7 Regression
1. OLS linear regression with:
   - dependent variable selection
   - one or more independent variables
   - optional intercept
   - basic one-hot encoding with reference category
2. Output includes:
   - coefficients table (`estimate`, `std_error`, `t_stat`, `p_value`)
   - `R^2`, adjusted `R^2`, sample size
   - residual summary
3. Diagnostic output includes residuals vs fitted plot data (sampling allowed for large inputs).

### 4.8 Notebook Blocks
1. EDA, tests, model results, and charts are stored as reproducible blocks.
2. Block fields:
   - `id`
   - `createdAt`
   - `title`
   - `type`
   - `upstream pipeline/state hash`
   - `query or params`
   - `render payload handle`
3. Block actions: rerun and delete.

### 4.9 Export and Import
1. Export `analysis recipe` JSON containing:
   - source file metadata and parse options
   - table definitions and merge modes
   - pipeline steps and versions
   - saved queries and versions
   - notebook block metadata (no heavy data blobs)
2. Import rebuilds structure and prompts file rebind as needed.

### 4.10 Local Persistence and Storage
1. Project state autosaves locally after user actions and on a periodic debounce.
2. `IndexedDB` stores project metadata, graph/index records, and recipe-compatible state.
3. `OPFS` stores large local artifacts (for example imported file copies, Arrow/cache payloads, and optional snapshot blobs).
4. If `OPFS` is unavailable, fallback to `IndexedDB`-only storage mode with user-visible warning.
5. DuckDB may store runtime metadata in internal tables/views where appropriate, but durable recovery must not depend on DuckDB process memory alone.

### 4.11 Sampling, Missing Data, and Type Policy
1. Sampling must be deterministic using a persisted per-project random seed.
2. Default sample caps:
   - grid preview queries: `LIMIT 1,000` per page view
   - charts/diagnostic plots: up to `50,000` rows
   - profile/statistics on large tables: up to `200,000` rows unless full-scan is requested
3. Statistical tests and regression use row-wise complete-case filtering over required columns:
   - apply type coercion to required numeric columns
   - drop rows with null/non-coercible values in required fields
   - report dropped-row counts and effective sample size in result metadata
4. If effective sample size is below validity thresholds, execution returns a validation error instead of partial output.

## 5. Data Model and Interfaces

### 5.1 Core Types (Conceptual)
```ts
type NodeKind = "pipeline_step" | "saved_query";

interface SourceFileRef {
  id: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  hasHeader: boolean;
  delimiter: string;
  uploadedAt: string;
}

interface TableDef {
  tableId: string;
  displayName: string;
  sourceFileIds: string[];
  mergeMode:
    | "separate_tables"
    | "same_table_union_by_name"
    | "same_table_exact_schema"
    | "same_table_by_position";
  columnSchema: ColumnSchemaDef[];
}

interface PipelineStep {
  stepId: string;
  displayName: string;
  type: string;
  enabled: boolean;
  orderIndex: number;
  activeVersionId: string;
}

interface SavedQuery {
  queryId: string;
  displayName: string;
  activeVersionId: string;
  targetRefVersionId: string;
  mode: "definition_lazy";
}

interface ProjectStorageState {
  projectId: string;
  storageMode: "idb_plus_opfs" | "idb_only_fallback";
  autosaveEnabled: boolean;
  lastAutosaveAt: string;
}

interface NodeVersion {
  versionId: string;
  nodeKind: NodeKind;
  nodeId: string;
  sqlText: string;
  params: Record<string, unknown>;
  dependsOnVersionIds: string[];
  createdAt: string;
  createdByAction: "create" | "edit" | "fork" | "adopt_upstream";
  pipelineStateHash: string;
}

interface NotebookBlock {
  blockId: string;
  createdAt: string;
  title: string;
  type: "table" | "chart" | "test" | "model" | "text";
  upstreamVersionId: string;
  pipelineStateHash: string;
  queryOrParams: Record<string, unknown>;
  payloadRef: string;
}
```

### 5.2 Worker Messaging
```ts
interface WorkerRequest<T = unknown> {
  requestId: string;
  type: string;
  payload: T;
  cancelToken?: string;
}

interface WorkerResponse<T = unknown> {
  requestId: string;
  status: "ok" | "error" | "cancelled";
  payload?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
```

## 6. Execution and Caching Rules
1. Pipeline and heavy analytics run only in worker.
2. Worker request scheduling contract is `last-write-wins` with cooperative cancellation.
3. Superseded requests are cancelled when possible; if a task cannot be cancelled in-flight, late results are discarded by request version/token checks.
4. Runtime metadata can use DuckDB internal tables/views (for example version lookup caches and dependency lookup materializations) when beneficial.
5. Cache intermediate results by:
   - node/step version ID
   - SQL hash
   - upstream dependency hashes
   - source hash
6. Do not transfer large JS arrays across threads when Arrow buffers are available.

## 7. Error Handling
1. Compile-time validation for GUI-step parameters.
2. SQL runtime errors are mapped back to step/query UI with actionable messages.
3. Dependency-impact modal appears before finalizing upstream edits that affect dependents.
4. Constraint violations are warnings in V1 and visible in profile/data views.

## 8. Performance Requirements
1. Maintain responsive UI for at least ~200k rows on a typical laptop.
2. Enforce import cap at 1M rows or 250 MB.
3. Use sampling for previews, charts, and diagnostics on large data.
4. Keep main thread free of heavy compute.
5. Performance targets on a typical 4-core laptop:
   - first visual feedback after action: under `100 ms`
   - simple transform re-run on 200k rows: under `3 s` p95
   - profile computation on 200k rows: under `3 s` p95
6. No compute-related main-thread long task should exceed `50 ms` in normal operation.

## 9. Security and Privacy
1. All user data remains local for V1.
2. No server-side data upload.
3. No telemetry or third-party analytics scripts.
4. Future sharing capabilities must remain explicitly separate from local-only workflows.

## 10. Deliverables
1. Working repo with runnable dev/build commands.
2. Functional V1 UI implementing all MVP features listed in this file.
3. Clear module boundaries:
   - UI
   - worker/engine
   - pipeline compiler/executor
   - stats/regression
   - serialization
4. Example CSVs under `public/examples` plus `Load example` action.
5. Unit tests for:
   - GUI step SQL compilation
   - recipe export/import schema
   - OLS numeric correctness on known dataset
6. Code comments for worker messaging protocol and cache strategy.

## 11. Acceptance Criteria
1. User can import CSVs, create tables, and run pipeline transforms without freezing UI.
2. User can create saved queries from pipeline outputs or other saved queries.
3. Upstream edit with dependents always triggers per-dependent decision flow with transitive dependency handling.
4. Notebook blocks are reproducible against pinned version/state.
5. Exported recipe re-imports and restores pipeline/query/notebook structures.
6. Statistical tests and OLS produce expected values on known test fixtures.
7. Reloading the browser restores prior project state via local autosave.
8. Cycle-forming saved-query dependencies are blocked.
9. Performance targets in Section 8 are met on the reference test dataset.

## 12. Browser Support Floor
1. Supported desktop browsers: latest two stable versions of Chrome, Edge, and Firefox.
2. Safari support is best-effort for V1; if required storage APIs are unavailable, run in reduced local-storage mode with warning.
3. Mobile browsers are out of scope for guaranteed V1 behavior.
