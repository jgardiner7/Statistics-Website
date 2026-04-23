# Implementation Plan Version 1

## 1. Objective
Deliver a complete V1 prototype of StatsFish as a browser-only, local-first analysis app with reproducible pipeline/query workflows, worker-based compute, and core statistics/regression features.

## 2. Delivery Strategy
1. Build foundations first: worker engine, shared types, version model.
2. Ship thin vertical slices early: import -> transform -> preview -> save query.
3. Add analytics and notebook features after core reproducibility flows are stable.
4. Keep SQL as universal fallback so GUI scope can remain practical.
5. Use DuckDB-native capabilities when they clearly help (views/temp tables/internal metadata tables), while keeping durable state in local browser storage.

## 2.1 Locked V1 Operational Decisions
1. Local persistence: `IndexedDB` for project metadata and `OPFS` for larger artifacts/caches, with `IndexedDB`-only fallback.
2. Compute cancellation: `last-write-wins` request scheduling with cooperative cancellation.
3. Dependency impacts: apply per-dependent decisions across full transitive downstream chain.
4. Version retention: keep all versions by default; manual prune only.
5. Graph constraints: saved-query dependency graph must remain acyclic.
6. Statistics NA/type semantics: complete-case filtering with dropped-row reporting.
7. Sampling: deterministic using persisted project seed.

## 3. Work Breakdown by Phase

### Phase 0: Project Skeleton and Standards
1. Initialize React + TypeScript + Vite app structure.
2. Add strict TypeScript settings and lint/test scaffolding.
3. Create folders for:
   - `src/ui`
   - `src/worker`
   - `src/pipeline`
   - `src/stats`
   - `src/serialization`
   - `src/shared`
4. Add base README with run/build commands.
5. Add storage adapter interfaces (`IndexedDB`, `OPFS`, fallback mode) and browser capability checks.
6. Define browser support matrix and failure-mode UX for unsupported APIs.

Exit criteria:
1. App starts with `npm run dev`.
2. CI/test command executes.
3. Shared type module compiles.
4. Storage abstraction compiles with feature-detection tests.

### Phase 1: Worker Engine and DuckDB-Wasm Integration
1. Integrate DuckDB-Wasm into dedicated Web Worker.
2. Implement worker RPC protocol (`WorkerRequest`/`WorkerResponse`).
3. Add query execution API with cancellation token support and `last-write-wins` broker behavior.
4. Add Arrow IPC result transport for table-like outputs.
5. Implement first-pass error mapping from worker to UI.
6. Add DuckDB internal runtime metadata objects (for example `_sf_runtime` tables/views) for cached dependency and version lookups.

Exit criteria:
1. UI can send SQL and render sample results.
2. Cancellation or last-write-wins behavior works for rapid edits.
3. Main thread remains responsive during long-running worker operations.
4. Runtime metadata lookup tables/views are queryable and rebuildable.

### Phase 2: Data Ingestion and Table Registry
1. Implement CSV upload parser options (delimiter, header/no-header).
2. Implement multi-file modes:
   - separate tables
   - same-table union by name
   - same-table exact schema
   - same-table by position
3. Generate headerless names as `c1..cN`.
4. Implement import cap checks (1M rows or 250 MB) with clear UX.
5. Build table registry and table rename functionality.
6. Implement local autosave pipeline:
   - metadata to IndexedDB
   - large artifacts to OPFS
   - fallback to IndexedDB-only when OPFS unavailable

Exit criteria:
1. User can import single and multiple CSV files in all supported modes.
2. Cap behavior is deterministic and user-visible.
3. Table metadata persists in app state and recipe model.
4. Refresh restores autosaved state from local storage.

### Phase 3: Pipeline Core and SQL Compilation
1. Implement linear pipeline state (`t0 -> t1 -> t2 ...`) with enabled/disabled ordering.
2. Implement step types:
   - LoadCSV
   - SQL transform
   - Filter
   - Select columns
   - Mutate column
   - Group aggregate
   - Join
   - Pivot
3. Implement curated cleaning steps:
   - duplicates
   - missing value fill/drop
   - sort
   - type cast/date parse
   - one-hot
   - scale
4. Compile all GUI steps to deterministic SQL.
5. Add cache keying by version/hash/upstream/source hash.
6. Add deterministic sampling utility with persisted project seed.

Exit criteria:
1. Pipeline run produces expected derived table sequence.
2. GUI and SQL steps generate stable reproducible SQL.
3. Cache prevents unnecessary recomputation.
4. Sampling behavior is reproducible across reruns and reloads.

### Phase 4: Version Graph and Saved Query System
1. Create immutable version model for steps and queries.
2. Implement saved queries as definition-only lazy artifacts.
3. Support saved query targets to any pipeline step version or query version.
4. Implement dependency index for reverse impact detection.
5. Implement upstream-change modal with per-dependent actions:
   - Adopt new upstream
   - Keep pinned
   - Fork dependent
6. Implement transitive downstream impact traversal and action propagation.
7. Enforce DAG constraints for saved-query dependencies (reject cycle-forming edits).
8. Implement manual version pruning with dependency guards.

Exit criteria:
1. Editing upstream nodes always creates new versions.
2. Dependents are handled through explicit decisions.
3. Old versions remain available until user prunes.
4. Transitive dependents are handled consistently for all three actions.
5. Cycle-forming references are rejected with user-visible errors.

### Phase 5: Main UI and Interaction Flows
1. Build three-pane layout and route internal state to panes.
2. Left pane:
   - Data tab with grid and schema view
   - Transforms tab
   - Queries tab
3. Center pane:
   - SQL editor
   - GUI transform builders
   - run/save actions
4. Right pane:
   - notebook block list
   - profile tab
5. Ensure accessible feedback for loading, cancellation, and errors.

Exit criteria:
1. End-to-end flow works: import -> transform -> query -> notebook block.
2. Dependency prompt appears at correct times.
3. UI remains responsive during worker computation.

### Phase 6: EDA, Statistical Tests, and OLS
1. Implement profile computations in worker.
2. Implement Welch t-test with effect size and CI.
3. Implement Pearson correlation.
4. Implement chi-square with contingency output.
5. Implement OLS:
   - intercept toggle
   - one-hot encoding with reference category
   - coefficient table and fit metrics
   - residual summary
   - residual-vs-fitted plot data
6. Add result block renderers for test/model outputs.
7. Implement shared missing-data/type-coercion policy for tests/regression and surface dropped-row counts.

Exit criteria:
1. All required analytics features are callable from UI.
2. Outputs are represented as reproducible notebook blocks.
3. Known test datasets produce expected statistics.
4. Results include effective sample size and excluded-row metadata.

### Phase 7: Notebook Reproducibility and Serialization
1. Implement notebook block CRUD (`create`, `rerun`, `delete`).
2. Pin blocks to upstream version IDs and pipeline state hash.
3. Implement `AnalysisRecipeV1` export with metadata only for heavy outputs.
4. Implement import and file rebind flow using file hash/name checks.

Exit criteria:
1. Export/import roundtrip restores project structure accurately.
2. Notebook rerun regenerates outputs from pinned lineage.
3. Missing files on import are handled with clear rebind prompts.

### Phase 8: Validation, Hardening, and Documentation
1. Add unit tests for GUI SQL compilation snapshots.
2. Add unit tests for versioning and dependency-impact outcomes.
3. Add integration tests for worker execution and cancellation.
4. Add statistical correctness tests for tests and OLS.
5. Add serialization schema tests for recipe roundtrip.
6. Add performance checks with representative datasets.
7. Finalize README architecture sections and protocol/cache comments.
8. Add cross-browser smoke tests for storage capability and fallback behavior.

Exit criteria:
1. Required tests pass.
2. Performance expectations are met for target dataset sizes.
3. Documentation is sufficient for local setup and architecture onboarding.
4. Supported browsers pass smoke tests and unsupported cases degrade cleanly.

## 4. Task Dependencies
1. Phase 1 must complete before Phases 3 and 6.
2. Phase 2 must complete before pipeline and query UX can be validated.
3. Phase 4 must complete before full notebook reproducibility behavior is final.
4. Phase 7 depends on stabilized state models from Phases 3-6.

## 5. Testing Plan

### 5.1 Unit Test Targets
1. SQL compilation per step type.
2. Version graph transitions and dependency choices.
3. Recipe schema encode/decode.
4. OLS and statistical formula correctness.

### 5.2 Integration Test Targets
1. Worker RPC and cancellation behavior.
2. Import workflows for all merge modes.
3. Pipeline + saved query chained execution.
4. Dependency prompt actions and resulting lineage.
5. Notebook rerun against pinned version IDs.
6. Local autosave and recovery from IndexedDB/OPFS.
7. Storage fallback when OPFS is unavailable.

### 5.3 Manual Validation Scenarios
1. Multi-CSV upload with mixed headers and schema mismatch warnings.
2. Upstream query edit with multiple dependents and mixed decisions.
3. Large file near cap to verify responsiveness and sampling behavior.
4. Export on one session and import/rebind in a fresh session.
5. Refresh/reopen recovery after unsaved edits.
6. Attempted cycle creation in saved-query dependencies.

### 5.4 Quality Gates
1. Blocking tests must pass for:
   - SQL compilation snapshots
   - version graph and transitive dependency handling
   - recipe serialization roundtrip
   - OLS/statistical fixture validation
2. Performance gate on reference dataset:
   - simple transform p95 under `3 s` on 200k rows
   - profile p95 under `3 s` on 200k rows
3. Browser gate:
   - latest two stable Chrome/Edge/Firefox pass core smoke tests
   - unsupported storage APIs trigger documented fallback path

## 6. Risks and Mitigations
1. Risk: browser memory pressure on large files.
   - Mitigation: hard cap, sampling, worker-only heavy compute, Arrow transfer.
2. Risk: lineage complexity creates inconsistent state.
   - Mitigation: immutable versions, strict dependency index, exhaustive versioning tests.
3. Risk: numeric instability in regression.
   - Mitigation: use stable linear algebra approach and verify against known fixtures.
4. Risk: SQL compilation drift across GUI steps.
   - Mitigation: deterministic compiler plus snapshot-based unit tests.

## 7. Definition of Done for V1
1. All MVP features in `Specifications_Version_1.md` are implemented.
2. Critical tests for compiler, versioning, serialization, and OLS pass.
3. App runs fully local with no backend dependency.
4. Worker protocol and caching strategy are documented in code and README.
5. Local autosave/recovery works with IndexedDB+OPFS and fallback mode.
6. Dependency-update flows handle transitive chains and prevent cycles.

## 8. Audit Snapshot (2026-02-28)
This section records the current implementation state after a full repo/spec audit.

### 8.1 Implemented and Working
1. React + TypeScript + Vite scaffold, worker-based DuckDB runtime, and 3-pane UI shell.
2. CSV import with all four merge modes and table preview/profile basics.
3. Saved query versioning with immutable versions, transitive dependency impact flow, and cycle detection.
4. Recipe export/import baseline wiring (including pipeline steps in export and validation on import).
5. Pipeline SQL compiler foundations with deterministic SQL for:
   - `FilterStep`
   - `SelectColumnsStep`
   - `MutateColumnStep`
   - `RemoveDuplicatesStep`
   - `MissingValuesStep`
   - `SortRowsStep`
   - `CastColumnStep`
   - `ScaleNumericStep`
   - `SQLTransformStep`
   - `GroupAggregateStep`
   - `JoinStep`
   - `PivotStep`
6. Worker pipeline execution path (`RUN_PIPELINE`) wired from UI to worker/runtime.
7. Transform-step state management supports add, update, reorder, enable/disable, and remove.
8. Work Window now includes GUI builders for:
   - `FilterStep`
   - `SelectColumnsStep`
   - `MutateColumnStep`
   - `RemoveDuplicatesStep`
   - `MissingValuesStep`
   - `SortRowsStep`
   - `CastColumnStep`
   - `ScaleNumericStep`
   - `DummyVariablesStep`
   - `GroupAggregateStep`
   - `JoinStep`
   - `PivotStep`
   plus SQL-transform editing, with add/update behavior for the selected transform.
9. Import limits in worker now enforce V1 caps (`1,000,000` rows and `250 MB`) with clear error messages.
10. Query runtime now supports targets to current pipeline steps (by step ID + base table), in addition to base tables and saved-query versions.
11. Notebook blocks now support rerun/delete actions in the Results pane for rerunnable table-query blocks.
12. Rerunnable notebook blocks persist query metadata (`querySql`, `queryTarget`) to support local rerun.
13. Source metadata now records SHA-256 file hashes during CSV/example import.
14. Data tab supports table rename flow backed by worker/runtime table renaming.
15. Worker + UI statistical tests are now implemented for:
   - Welch two-sample t-test
   - Pearson correlation test
   - Chi-square test of independence
   including complete-case filtering metadata (`total`, `effective`, dropped-row counts).
16. Notebook rerun now supports both table-query blocks and statistical test blocks via persisted `analysisRequest` metadata.
17. New statistical math/distribution test coverage added (t/chi-square/normal helper checks + hypothesis fixture tests).
18. Worker runtime now includes an in-memory pipeline result cache (keyed by base table + ordered step definitions + limit) with bounded eviction and invalidation on import/rename/non-select SQL mutations.
19. Local project persistence now detects `OPFS` support and:
   - mirrors project snapshots to OPFS when available
   - loads from OPFS as a fallback when IndexedDB has no state
   - surfaces an explicit UI banner/status when running in IndexedDB-only fallback mode
20. Data tab preview now uses bounded incremental loading (start at `20`, grow by `10`), with explicit `Load 10 more rows` control, sticky headers, and an independently scrolling preview grid.
21. Non-selected preview tables no longer keep row previews hydrated in UI state; only the selected Data-tab table keeps preview rows loaded.
22. Work Window now has explicit `Query`, `Transform`, and `Statistics` tabs, with create-entry flows and collapsed accordion editors by default.
23. Transform labels now match requested wording (`Filter by Column Value`, `Select Columns`, `Calculate New Column`, `SQL Transform`) and query editor label is `SQL Query`.
24. Selecting a pipeline step or saved query from the left pane now opens the corresponding Work Window editor state and loads results into the Results window.
25. CSV import action is available in the Data tab, and import now prompts for destination table (`existing` merge vs `new` table) when tables already exist.
26. Worker runtime now opens DuckDB on an OPFS-backed path when available (with safe default fallback), and applies memory/thread limits to reduce browser memory pressure.
27. OLS regression is now implemented end-to-end (UI + worker + notebook rerun), including:
   - intercept toggle
   - automatic one-hot encoding with dropped reference categories
   - coefficient-level inferential stats (`estimate`, `std_error`, `t_stat`, `p_value`)
   - `R^2`, adjusted `R^2`, residual summary, and residual-vs-fitted payload
   - complete-case filtering metadata for dropped rows/effective sample size
28. Transform pipelines are now table-scoped (`pipelinesByTable`) with explicit transform-table selection in the Transforms tab, removing query/transform execution coupling to a global “active table.”
29. Runtime SQL target resolution now uses per-table pipeline maps, preventing cross-table transform leakage when querying/stat-running against non-preview tables.
30. Notebook now supports first-party interactive chart blocks (line, scatter, bar, histogram) created from the Statistics tab, with custom SVG rendering and hover tooltips (no added charting dependency).
31. Chart rendering now includes x-axis tick scales (numeric and categorical), explicit axis label support, two-axis wheel zoom, left-drag panning while zoomed, right-drag rectangle zoom, and clipped full-series rendering so line continuity is preserved when points move off-screen.
32. Chart creation now supports optional manual axis ranges (`x/y min/max`) with an `All data visible` auto-range toggle, default bar-chart y-axis anchoring at zero, optional regression best-fit overlay for scatter/line charts, and inline coordinate readout + crosshair guides without layout shift.
33. Worker table listing now reconciles registry state with physical schema tables on every refresh, so multi-table projects reliably rehydrate after reload.
34. SQL execution row counts are now true total result counts even when preview rows are capped, so notebook/query previews display accurate `Showing x of y rows` summaries.
35. Notebook table previews and expanded-table modals now keep content contained with internal horizontal/vertical scroll and sticky headers, preventing wide-table overflow outside notebook blocks.
36. Data-tab preview now supports in-place column schema editing by clicking column headers (rename + type change) via custom modal; worker applies DuckDB `ALTER` operations in a stable sequence and refreshes preview schema.
37. Column schema edits are now persisted (`IndexedDB`/`OPFS`), included in recipe export/import metadata (`columnEditsByTable`), and replayed after matching new-table CSV imports to support reproducibility from original data files.
38. Notebook expand-table view now supports chunked `Load more rows` pagination (offset/limit worker queries) when query metadata is available, so large result sets can be explored without preloading all rows.
39. Notebook block action row (`time`, `Expand`, `Rerun`, `Delete`) now renders below previews and wraps cleanly to avoid horizontal overflow.
40. Column-type editor now includes a dropdown of common DuckDB types plus manual free-text entry for custom type definitions.
41. Notebook/test/model/chart blocks now persist a deterministic `pipelineStateHash` derived from compiled runtime SQL, and reruns refresh that hash.
42. Recipe export/import now preserves table-scoped pipeline state (`pipelinesByTable`, `activePipelineStepIdByTable`, and `selectedTransformTableName`) rather than flattening to one table.
43. Describe/profile now includes top-value frequency output per column (`topValues`) alongside count/distinct/null/mean/std/min/max/quantiles.
44. CSV import now records source `sha256` for regular uploads when files are within a safe in-memory hash size threshold.
45. Import-cap handling now uses a custom warning modal with explicit actions (`Cancel` or sampled import), and sampled import executes with a capped row count per file.
46. Transform editing now supports debounced auto-run execution in the Transforms tab to keep previews synchronized without manual rerun clicks.
47. Notebook model blocks now render richer OLS summaries (coefficient table, residual summary metrics, and diagnostic sample counts) instead of summary text only.
48. Saved query version pruning is now implemented with explicit dependency guards and query/notebook pin protection (`Prune Old Versions` in Queries tab).
49. Saved-query pruning now supports per-version selection in a custom modal (instead of all-old-versions-at-once) with dependency/pin protection retained.
50. Work Window transform creation now reliably binds to the table selected in Data Window Transforms tab, and explicitly displays the target table while editing.
51. OLS notebook outputs now use expandable previews for coefficient tables, residual summary tables, and residual-vs-fitted charts (consistent with other notebook tables/charts), with corrected container sizing so previews stay within notebook/result blocks.
52. Chart interaction handling now suppresses browser context menus during right-drag zoom (including pointer-release fallback outside the chart surface) and blocks wheel-scroll chaining from chart surfaces to the notebook container.
53. OLS notebook diagnostics now include additional plots beyond residual-vs-fitted: observed-vs-fitted and residual-distribution histogram previews (with expand support).
54. Statistics selector state update logic was hardened to avoid redundant state writes that could cause maximum update depth loops.
55. Pipeline-step query targets now preserve immutable per-step pipeline snapshots (`pipelineSnapshot`) so saved queries/notebook reruns remain reproducible even after later pipeline edits.
56. Worker pipeline execution now supports durable DuckDB materialized cache entries (`_sf_runtime.pipeline_cache` + `_sf_pipeline_cache_*` tables), with in-memory + materialized cache lookup and invalidation on dataset/DDL mutations.
57. Column editor now supports nullability constraint edits (`SET/DROP NOT NULL`) with validation and replay support in saved column schema edits.
58. Notebook blocks now expose `Embed` actions that copy an embeddable HTML+JSON snippet for table/chart/model payloads.
59. Worker protocol/client now implement explicit cancellation requests (`CANCEL_REQUEST`) so superseded `sendLatest` calls attempt cooperative in-flight DuckDB query cancellation.
60. Runtime analysis/query shaping now uses shared row-cap constants (`200,000` max rows for stats/model/profile-sql inputs and `50,000` max rows for chart-source queries) to reduce memory spikes and align sampling defaults.
61. Browser-storage fallback smoke tests now cover `OPFS` capability detection (`idb_plus_opfs` vs `idb_only_fallback`) in `localProjectStore`.
62. OLS outputs now include richer diagnostics beyond residual-vs-fitted: normal Q-Q sampled points, leverage-vs-standardized-residual sampled points, and top Cook’s-distance influence rows in notebook model summaries.
63. Visualization builder now supports optional `Series` overlays and optional `Facet` splitting; facet mode creates one reproducible notebook chart block per facet value (bounded to avoid runaway block creation).
64. Notebook rerun flow now supports chart blocks (in addition to table/test/model blocks) when query SQL + target metadata are present.
65. Test suite currently passing (`161` tests).
66. Documentation set refreshed (`README.md`, `RUN_AND_BUILD.md`, `Codebase_Structure.md`) and complete end-user usage guide added in `Instructions.md`.

### 8.2 Partially Implemented
1. Pipeline execution/editing is wired with in-memory + materialized cache reuse, but advanced cache lifecycle policies and performance tuning remain.
2. Notebook blocks can be added/rerun/deleted for table-query, statistical-test, OLS model outputs, and chart outputs, but full multi-type reproducibility workflows remain incomplete (for example text blocks and richer model renderers).
3. Local persistence now supports IndexedDB + OPFS snapshot mirroring, explicit fallback mode signaling, and OPFS-backed DuckDB runtime path selection when available; dedicated OPFS artifact lifecycle/caching beyond this is still not implemented.

### 8.3 Post-V1 Enhancements
1. Transform builder ergonomics for advanced multi-column editing and richer presets remain to be implemented.
2. Advanced schema editor/constraints UI (for example PK/UNIQUE/CHECK/FK authoring, beyond current rename/type/nullability edits) remains.
3. Full OPFS artifact persistence for large data/cache payloads beyond project snapshot state.
4. Broader cross-browser compatibility validation remains (beyond current storage-mode smoke coverage).

## 9. Issues That Should Be Corrected
These are concrete mismatches/defects discovered in the audit and should be treated as planned work.

1. Worker response path currently converts query results to JS arrays; Arrow IPC transfer optimization from the spec is not yet implemented.
2. Cancellation plumbing is now implemented in worker protocol/client/runtime, but broader integration validation is still needed to quantify cancellation effectiveness across all long-running operation types.
3. Limits are now standardized for stats/model/profile-sql/chart paths via shared constants; preview-grid limits intentionally remain UI-driven/incremental for viewport-fit behavior.

## 10. Added Missing Work Items (Plan Delta)
These items were missing or under-specified in earlier phases and are now added explicitly.

### 10.1 Data and Storage Delta
1. Complete import cap experience:
   - worker cap enforcement (`rows` and `bytes`) is implemented
   - UI warning/modal + sampled-import fallback path is implemented
2. Add per-source hashing and recipe file metadata parity (`name`, `size`, `hash`, parse options).
   - source hashing is implemented (`sha256`)
   - remaining metadata parity/rebind workflow still required
3. OPFS adapter is partially implemented:
   - project snapshot mirroring and fallback load path are implemented
   - runtime now prefers an OPFS-backed DuckDB database path when available
   - dedicated large artifact/cache payload persistence and lifecycle management is still required
4. IndexedDB-only fallback mode with explicit status banner is implemented.

### 10.2 Pipeline and Query Delta
1. Pipeline compiler is wired to worker execution (`t0 -> t1 -> ...`) with bounded in-memory cache plus durable DuckDB materialized cache entries and invalidation on data mutations.
2. Extend transform UX coverage:
   - base CRUD/ordering/enable/disable is implemented
   - curated V1 cleaning builders are implemented (dedupe, missing fill/drop, sort, cast/date parse, scaling, dummy variables, pivot)
   - remaining work is advanced ergonomics/presets
3. Add query targets to pipeline step versions in lineage and runtime SQL builder.
   - baseline support for pipeline step refs is implemented
   - immutable pipeline step snapshot targeting is implemented via persisted `pipelineSnapshot` on `pipeline_step` targets
4. Saved-query version pruning UX with dependency guards is implemented.

### 10.3 Analytics Delta
1. Test engine APIs and result schemas for t-test, Pearson, and chi-square are implemented end-to-end in worker + UI.
2. OLS output now includes standard errors, t-stats, p-values, adjusted metrics, and residual diagnostics payload.
3. Complete-case filtering and dropped-row reporting are implemented for both statistical tests and OLS regression.
4. Profile outputs now include top values and quantiles.

### 10.4 Notebook and UX Delta
1. Complete notebook block actions:
   - rerun/delete is implemented for rerunnable table-query, chart, statistical-test, and OLS model blocks
   - text/non-query block rerun behavior remains out of scope
2. Notebook blocks now pin to explicit upstream version + `pipelineStateHash`.
3. Chart block rendering now covers scatter/histogram/bar/line with custom SVG views, includes optional multi-series overlays and facet-split generation workflows, and notebook blocks expose embed-snippet export actions.
4. Add schema/constraints view in Data tab and table rename flow.
   - table rename is implemented
   - schema editing now supports rename/type/nullability in the Data-tab column editor
   - advanced constraint authoring remains

### 10.5 Testing and Validation Delta
1. Add deeper integration tests for worker protocol/pipeline execution; baseline hook-level cancellation behavior test coverage is now in place.
2. Expand persistence tests for IndexedDB + OPFS fallback behavior beyond current storage-mode smoke coverage.
3. Add statistical correctness fixtures for t-test, Pearson, chi-square, and richer OLS outputs.
4. Add export/import roundtrip tests that include non-empty pipeline and version lineage.
5. Add performance harness checks for reference datasets.

## 11. Revised Execution Order (Next)
1. Continue transform UX polish (advanced ergonomics/presets) where needed.
2. Continue dependency/versioning UX polish around immutable pipeline-step snapshots and query-pruning flows.
3. Finish OPFS artifact persistence beyond the implemented IndexedDB + OPFS snapshot/fallback mode.
4. Expand notebook/model renderers beyond summary-level outputs.
5. Close with integration/performance/browser fallback validation and README architecture refresh.
