# StatsFish (V1 Prototype)

StatsFish is a local-first statistical analysis app that runs fully in the browser.

- UI: React + TypeScript + Vite
- Compute: DuckDB-Wasm in a Web Worker
- Persistence: IndexedDB, with OPFS-assisted mode when available

## Quick Start

```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

## Documentation Index

- Build/run/test guide: [`RUN_AND_BUILD.md`](RUN_AND_BUILD.md)
- Full end-user instructions: [`Instructions.md`](Instructions.md)
- Architecture and file map: [`Codebase_Structure.md`](Codebase_Structure.md)
- Implementation plan and progress log: [`Implementation_Version_1.md`](Implementation_Version_1.md)
- V1 spec baseline: [`Specifications_Version_1.md`](Specifications_Version_1.md)
- Broad product requirements: [`General Specifications.md`](General Specifications.md)

## Implemented V1 Surface

1. CSV import with merge modes:
   - `Same table: union by name`
   - `Same table: exact schema`
   - `Same table: by position`
   - `Separate tables`
2. Data preview with incremental row loading, sticky headers, and in-place column editing (rename/type/nullability).
3. Table-scoped transform pipelines with GUI step builders and SQL transform fallback.
4. Saved SQL queries with immutable versions, dependency-impact decisions, and manual per-version pruning.
5. Query targets for:
   - base tables
   - pipeline steps (snapshot-pinned)
   - saved query versions
6. Statistics and modeling:
   - Welch t-test
   - Pearson/Kendall/Spearman correlation
   - chi-square test
   - OLS regression (with one-hot encoding option + diagnostics)
7. Interactive visualization blocks (line/scatter/bar/histogram), including pan/zoom, box-zoom, axis labels/ranges, optional best-fit line, series overlays, and faceting.
8. Notebook blocks with rerun/delete/expand/embed actions for table/chart/test/model outputs.
9. Describe tab for profiling data/transforms/queries.
10. Recipe export/import for workflows and metadata.
11. Persistent local project state and durable DuckDB storage with fallback behavior.

## V1 Guardrails

- Query execution is limited to `SELECT`/`WITH` statements.
- SQL transform steps are limited to `SELECT`/`WITH` statements.
- Import caps:
  - `1,000,000` rows per logical table
  - `250 MB` size cap per logical table
- When import caps are exceeded, sampled import fallback is available (`200,000` rows/file max).

## Development Commands

```bash
npm run dev
npm run build
npm run preview
npm run test
npm run test:watch
```
