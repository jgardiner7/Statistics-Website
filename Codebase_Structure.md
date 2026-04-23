# Codebase Structure Report

Last updated: 2026-02-28

## 1) Repository Purpose

StatsFish is a browser-only, local-first analytics prototype.

- Main thread: React UI + orchestration.
- Worker thread: DuckDB-Wasm runtime and heavy compute.
- Persistent state: IndexedDB snapshots, with OPFS mirrored state and OPFS-backed DuckDB when available.

Current implementation supports:

1. CSV import (single/multi-file) with merge modes, delimiter/header options, and hard import caps.
2. Table preview with incremental loading and schema editing (rename/type/nullability).
3. Table-scoped transform pipelines with GUI and SQL transform steps.
4. Saved SQL queries with immutable versions and dependency impact handling.
5. Statistical tests + OLS regression with diagnostic outputs.
6. Interactive chart creation and notebook-style result blocks with rerun/delete/embed.
7. Recipe export/import for reproducible workflow metadata.

## 2) High-Level Architecture

- `src/ui`: app state, UI orchestration, persistence wiring, and components.
- `src/worker`: request router + DuckDB runtime implementation.
- `src/shared`: cross-layer types, SQL helpers, and hard limits.
- `src/pipeline`: transform-step validation and deterministic SQL compiler.
- `src/queries`: saved-query lineage/version logic + runtime SQL target resolution.
- `src/stats`: distributions, hypothesis tests, and OLS core math.
- `src/serialization`: recipe schema encode/decode.

## 3) Main Runtime Flow

1. `src/main.tsx` mounts `App`.
2. `App` creates worker client (`useWorkerClient`) and sends `INIT_ENGINE`.
3. UI actions dispatch typed worker RPC requests (import, preview, SQL, pipeline, stats, profile, OLS, table/schema changes).
4. `src/worker/index.ts` routes requests into `DuckDBRuntime` methods.
5. Runtime returns typed payloads; UI updates reducer state (`src/ui/state.ts`).
6. Persisted state is debounced to IndexedDB (and OPFS mirror when available).
7. Notebook blocks store query target + SQL + analysis metadata for reruns.

## 4) Core Correctness Invariants

1. Query execution and SQL transform execution are restricted to `SELECT`/`WITH` SQL.
2. Saved-query version graph remains acyclic.
3. Query targets are explicit and typed: table, pipeline step snapshot, or query version.
4. Pipeline state is table-scoped (`pipelinesByTable`) and does not leak between tables.
5. Import caps are enforced:
   - `1,000,000` rows max per logical table
   - `250 MB` max per logical table
6. Statistical/model operations apply complete-case filtering and report dropped rows.
7. Pipeline caching is invalidated on dataset/schema mutations.
8. Notebook reruns are pinned to stored query SQL + target metadata.

## 5) Storage and Performance Model

1. DuckDB database:
   - OPFS path preferred (`opfs://statsfish.duckdb`) with fallback open modes.
   - runtime settings attempt bounded memory (`SET memory_limit = '512MB'`) and single-threaded execution.
2. App metadata persistence:
   - IndexedDB is primary persisted project-state store.
   - OPFS `project_state.json` mirror is also written when available.
3. Query/model shaping limits:
   - `ANALYSIS_MAX_ROWS = 200_000`
   - `PROFILE_SQL_MAX_ROWS = 200_000`
   - `CHART_QUERY_MAX_ROWS = 50_000`
   - `OLS_DIAGNOSTIC_MAX_POINTS = 5_000`
4. CSV import fallback:
   - if hard caps are exceeded, UI offers sampled import (`200,000` rows/file max).

## 6) Root-Level File Map

- `README.md`: top-level overview and docs index.
- `RUN_AND_BUILD.md`: setup/build/test/run instructions.
- `Instructions.md`: complete end-user feature guide.
- `Codebase_Structure.md`: this architecture and file map report.
- `Implementation_Version_1.md`: implementation plan + progress log.
- `Specifications_Version_1.md`: structured V1 requirements baseline.
- `General Specifications.md`: broader product specification.
- `package.json`: scripts + dependency declarations.
- `vite.config.ts`: Vite/Vitest configuration.
- `tsconfig*.json`: TS compiler setup.

## 7) `src/` File-by-File Summary

### Entry

- `src/main.tsx`: React mount point.
- `src/vite-env.d.ts`: Vite ambient typings.

### Shared Contracts and Utilities

- `src/shared/types.ts`: domain types (tables, pipeline, queries, notebook, stats, recipes).
- `src/shared/workerProtocol.ts`: typed worker request/response protocol.
- `src/shared/sql.ts`: identifier sanitization + SQL literal/identifier quoting.
- `src/shared/limits.ts`: shared row/point caps.

### Pipeline

- `src/pipeline/compiler.ts`: deterministic SQL compiler for all supported step types.
- `src/pipeline/types.ts`: shared type re-exports for pipeline module use.
- `src/pipeline/validation.ts`: runtime guards/normalization for persisted/imported steps.
- `src/pipeline/compiler.test.ts`: compiler behavior/edge-case tests.
- `src/pipeline/validation.test.ts`: validation acceptance/rejection tests.

### Query Lineage and Runtime SQL

- `src/queries/lineage.ts`: saved-query versioning, dependency validation, pruning, cycle checks, impact decisions.
- `src/queries/runtimeSql.ts`: builds executable SQL for selected target (`source` CTE + named refs).
- `src/queries/lineage.test.ts`: lineage logic tests.
- `src/queries/runtimeSql.test.ts`: target-resolution/runtime SQL tests.

### Serialization

- `src/serialization/recipe.ts`: build/parse `AnalysisRecipeV1`.
- `src/serialization/recipe.test.ts`: recipe schema and roundtrip tests.

### Statistics and Modeling

- `src/stats/distributions.ts`: numerical distribution helper functions.
- `src/stats/hypothesis.ts`: Welch/Kendall/Pearson/Spearman/chi-square implementations.
- `src/stats/ols.ts`: OLS fit routine and diagnostics support.
- `src/stats/distributions.test.ts`: numerical fixtures.
- `src/stats/hypothesis.test.ts`: statistical fixture tests.
- `src/stats/ols.test.ts`: OLS sanity/consistency tests.

### Worker Layer

- `src/worker/index.ts`: request router, success/error response mapping, cancellation entry point.
- `src/worker/runtime.ts`: DuckDB runtime (init/import/schema/edit/query/profile/pipeline/stats/model).
- `src/worker/pipelineCache.ts`: in-memory pipeline cache key/value with eviction.
- `src/worker/importLimits.ts`: hard cap checks for import row/byte limits.
- `src/worker/tableRegistry.ts`: physical-vs-registry table reconciliation.
- `src/worker/pipelineCache.test.ts`: cache behavior tests.
- `src/worker/importLimits.test.ts`: cap enforcement tests.
- `src/worker/tableRegistry.test.ts`: registry reconciliation tests.

### UI State, Persistence, and Worker Client

- `src/ui/state.ts`: reducer, UI state shape, action handlers, per-table pipeline normalization.
- `src/ui/localProjectStore.ts`: IndexedDB/OPFS persistence adapter.
- `src/ui/hooks/useWorkerClient.ts`: typed RPC client + `sendLatest` cancellation semantics.
- `src/ui/importFallback.ts`: import-limit fallback helpers.
- `src/ui/state.test.ts`: reducer tests.
- `src/ui/localProjectStore.test.ts`: storage mode/fallback tests.
- `src/ui/hooks/useWorkerClient.test.tsx`: worker client cancellation/path tests.
- `src/ui/importFallback.test.ts`: fallback-message helper tests.

### UI Components

- `src/ui/App.tsx`: top-level orchestration and all workflow handlers.
- `src/ui/components/TabBar.tsx`: generic tab switcher.
- `src/ui/components/DataGrid.tsx`: reusable table grid (clickable headers optional).
- `src/ui/components/DataWindow.tsx`: Data/Transforms/Queries panel.
- `src/ui/components/WorkWindow.tsx`: Query/Transform/Statistics authoring panel.
- `src/ui/components/ResultsWindow.tsx`: Notebook + Describe panel and chart renderer.
- `src/ui/components/ImportCsvModal.tsx`: custom CSV import modal.
- `src/ui/components/ConfirmActionModal.tsx`: reusable confirm modal.
- `src/ui/components/DependencyImpactModal.tsx`: dependent-query decision modal.
- `src/ui/styles.css`: layout, scroll behavior, modal, and chart/table styling.
- `src/ui/components/DataGrid.test.tsx`: DataGrid tests.
- `src/ui/components/DataWindow.test.tsx`: DataWindow behavior tests.
- `src/ui/components/WorkWindow.test.tsx`: WorkWindow action wiring tests.
- `src/ui/components/ResultsWindow.test.tsx`: ResultsWindow action wiring tests.

## 8) Current Test Surface

Coverage includes:

1. Pipeline compiler + validation.
2. Query lineage/versioning and runtime SQL generation.
3. Worker helper modules (import limits/cache/table registry).
4. Stats/distribution/OLS numerical logic.
5. UI reducer + local persistence adapter + worker client behavior.
6. Key UI component interaction wiring.

Run with:

```bash
npm run test -- --run
```

## 9) Known Post-V1 Enhancements (Not Fully Closed)

1. Advanced schema constraint authoring UI (PK/UNIQUE/CHECK/FK) beyond current column rename/type/nullability edits.
2. Richer OPFS artifact lifecycle management beyond current DuckDB + project-state persistence.
3. Additional integration/performance harness depth for large-data stress profiles.

## 10) Recommended Reading Order for Engineering Work

1. `src/shared/types.ts`
2. `src/shared/workerProtocol.ts`
3. `src/worker/index.ts`
4. `src/worker/runtime.ts`
5. `src/pipeline/compiler.ts`
6. `src/queries/runtimeSql.ts`
7. `src/queries/lineage.ts`
8. `src/ui/state.ts`
9. `src/ui/App.tsx`
10. `src/ui/components/*`

