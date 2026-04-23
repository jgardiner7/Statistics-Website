Build a complete, working prototype repo for a “local-first” browser-only data analysis web app. It must run entirely in the browser with no backend services.  It should have as few dependencies as possible. The app loads a user-uploaded CSV, allows SQL-/Pandas-like and GUI-based transformations, supports basic statistical tests and regressions, and produces a reproducible “analysis notebook” of outputs. Performance and responsiveness matter: all heavy compute must run off the main thread.  Eventually there will be an option to have the analysis saved to the server so users can share the analysis with a link.  

High-level product intent
- This tool targets users who would otherwise do quick analyses in Excel or ad-hoc scripts, then want to share an analysis narrative (tables/charts/test results) in a reproducible form.
- Treat the analysis as a pipeline of steps. Every transformation and analysis output should be reproducible from (a) the input file and (b) a JSON “analysis recipe.”

MVP scope (must implement)
1) In-browser engine
- Use DuckDB-Wasm (for now, I'd like to eventually write something on my own) as the core query/compute engine, running inside a Web Worker.
- Data interchange between worker and UI should use Apache Arrow where possible.
- CSV is required for MVP. (Design so Parquet (and eventually Sqlite) can be added later, but do not implement Parquet (or Sqlite) unless it is trivial.)
- No server calls. The app must work offline after initial load (aside from npm install/build time).
- It might be faster if a lot of the computation is programmed in a language other than JavaScript/TypeScript and then compiled to WebAssembly.  Consider this.  

2) Core UX
- Single-page app with 3-pane layout:

  A) Data Window (left): 
  - Has three tabs on the top, "Data," "Transforms," and "Queries"
    - The "Data" tab has a grid that displays the data (like a spreadsheet).  The header is displayed.  There is a "Schema" buttons that lets the user view the schema (It gives the type and name of each column and lets them edit it.  It also lets them specify other constraints (range, allowed values, etc.)).  
    - The "Transforms" tab shows the list of transform steps that have been applied to the data.  When you click on one, it opens in the middle window (the Work Window)
    - The "Queries" tab is where saved queries (and saved their saved outputs) will show up.  In the Work Window, the user will be able to query the table.  If they want, they can save the output.  Doing so will save the query in the Data Window under the Queries tab.  They can then name the query, or let a name be automatically assigned.  They can then reference the name of a saved query when writing another query in the Work Window (which can also be saved).  If a query name is ever changed, the queries referencing that query will need to be updated automatically.  
      - When displaying a saved query and its output, there will be an edit button that opens the query in the Work Window, and the output in the right window (the Results Window)
    - scrollable dataset preview grid, dataset info, list of steps, add-step button, reorder steps, enable/disable steps.

  B) Work Window (center): a transform builder, or a SQL editor depending on current step.  There should be a button to add a transform step (one of the transforms described below) or to add a Sql step.  

  C) Results Window (right): a chronological list of output blocks (tables, charts, test results, model summaries) that were produced during the workflow and saved.
- The user can:
  - Upload a (or multiple) CSV file(s) (the CSV file should be allowed to be too large for memory).  If multiple files are uploaded, then the user can decided if they are all part of one table or multiple tables.  The user should be able to name/rename any tables.  
  - See a preview grid (first N rows, selectable columns).
  - Create transformations either via (i) SQL/Pandas step or (ii) GUI step templates.
  - Allow the user to save the output of a query for later use (There will be a "Save Query" button somewhere.)  A variable name is automatically assigned to the query, but the user can change the name if they want.  
    - The saved query output should be saved to the data pane/preview on the left.  The left data pane should let the user look at the original dataset, or at any of the saved queries.  The user will be able to change the name of the query in the left pane.  
  - Materialize the current “active table” and run analyses against it.
  - Export the analysis recipe JSON and re-import it to replay.

3) Transformation steps (pipeline)
Implement a pipeline system with these step types:
- LoadCSVStep: parses and registers the CSV as a DuckDB table with a stable name.
- SQLTransformStep: user writes SQL that produces the next table (CTE recommended; final SELECT result becomes the next table).
- FilterStep (GUI): pick column, operator, value(s) -> generates SQL behind the scenes.
- SelectColumnsStep (GUI): pick subset of columns -> generates SQL.
- MutateColumnStep (GUI): create/replace column using expression builder (basic arithmetic, string ops, CASE WHEN). Generate SQL.
- GroupAggregateStep (GUI): group-by columns + aggregations (count, count distinct, sum, avg, min, max, stddev, median/quantiles if available). Generate SQL.
- JoinStep (GUI): join with another registered table with a saved intermediate snapshot. Provide join type and keys. Generate SQL.
- PivotStep (GUI): simple pivot (one column becomes headers, one value column aggregated). If too hard, stub with “not implemented” but include the step structure.
- All the common data cleaning functions that Pandas has.  Some that come to mind (this is not a comprehensive list):
  - Dealing with duplicates
  - Dropping rows meeting certain conditions (with nans or nulls)
  - Scaling columns
  - Computing columns from other columns
  - Creating dummy variables for categorical data
  - Sorting columns
  - Common string functions (lower, upper strip, replace, pad)
  - Filling missing data (with mean, median, mode, the results of a regression, etc.)
  - Dealing with dates

Each step must have:
- id (uuid), name, type, enabled boolean
- params (type-specific)
- A deterministic SQL representation (even GUI steps must compile to SQL)
- The user should always have the option of using Sql instead of the GUI
- Clear error handling that maps DuckDB errors back to the step UI

Pipeline execution rules:
- The pipeline produces a sequence of derived tables/views: t0 (base), t1, t2, … for enabled steps in order.
- Cache intermediate results keyed by (step id + SQL hash + upstream hash) to avoid recomputation.
- Provide a “Run pipeline” button plus automatic debounced runs for small edits (but never freeze the UI).

4) EDA (exploratory summaries)
Implement fast column profiling for the current active table:
- row count
- per column: inferred type, null count, distinct count (approx ok), min/max for numeric/date, top 10 values for categorical/text, and basic quantiles (basically all the information given in the Pandas .describe() function).
Show this in a “Profile” tab.

5) Statistical tests (MVP set)
Implement at least these, producing a result block that includes test name, inputs, assumptions/caveats, effect size, confidence interval when feasible, and p-value:
- Two-sample t-test (Welch) for numeric outcome grouped by a binary/categorical column (user selects outcome column + group column + two group values).
- Pearson correlation test between two numeric columns.
- Chi-square test of independence for two categorical columns (with contingency table output).

If implementing effect sizes and CIs is too time-consuming, implement them for the t-test only, but design the result schema to include them.

6) Regression (MVP)
Implement OLS linear regression:
- UI: select dependent y column and one or more independent x columns; allow optional intercept toggle; allow automatic one-hot encoding for categorical predictors (basic, with reference category).
- Output: coefficients table (estimate, standard error, t-stat, p-value), R², adjusted R², N, and a simple residual summary.
- Provide a diagnostic plot option: residuals vs fitted (use a sample if huge).

Implementation note: you may compute OLS either by (a) DuckDB SQL + linear algebra in JS (matrix solve), or (b) a DuckDB extension if feasible in wasm, but do not block the MVP on complex extension packaging. Prefer a reliable, self-contained implementation with clear numeric stability notes.

7) Results notebook
- Any EDA profile, test, regression, or chart output is stored as a notebook “block” with:
  - id, createdAt, title, type (table/chart/test/model/text)
  - the upstream pipeline state hash it depends on
  - the query/parameters used to generate it
  - a render payload (Arrow table or JSON summary)
- Blocks must be reproducible by re-running against the same pipeline state.
- Allow re-run and delete block actions.

8) Export / import
- Export “analysis recipe” JSON that includes:
  - file metadata (name, size, hash), parse options (delimiter, header row), and schema overrides (optional)
  - pipeline steps array
  - notebook blocks metadata (not the heavy data; store queries/params)
- Import should recreate the pipeline and notebook structure; the user re-selects the CSV file if needed (because browser cannot access their filesystem automatically).

Tech stack and repo expectations
- Use React + TypeScript + Vite.
- Use a Web Worker for DuckDB-Wasm. The UI thread must remain responsive.
- Use a data grid component for table previews (keep it lightweight).
- Use Monaco editor (or a simpler editor if needed) for SQL step editing with basic SQL highlighting.
- Use a charting approach that is practical in React (Vega-Lite, ECharts, Plotly, or similar). Keep charts minimal: scatterplot, histogram, bar.
- Add basic styling; focus on clarity over polish.

Performance and correctness requirements
- Must handle at least ~200k rows CSV on a typical laptop without locking the UI. Use sampling for previews and charts when needed.
- All potentially expensive operations (pipeline runs, profiles, tests, regressions) must execute in a worker and support cancellation (or at least last-write-wins).
- Avoid copying large arrays between worker and UI. Prefer Arrow IPC buffers or chunked transfers.
- There should be extensive testing with maximum practical code coverage.

Security/privacy requirements
- No network upload of user data. No analytics beacons. No external API calls.
- Clearly separate “data stays local” from future sharing features (not yet implemented).

Deliverables
- A working repo with:
  - README explaining how to run (npm install, npm run dev, npm run build) and key architecture decisions.
  - A minimal but real UI implementing all MVP items above.
  - Clear module boundaries: engine/worker layer, pipeline compiler/executor, UI components, stats/regression code, serialization.
  - A small set of example CSVs in /public/examples and a “Load example” button to speed testing.
  - Unit tests for: pipeline SQL compilation for GUI steps, recipe export/import schema, and OLS math (at least a small known dataset).
- Include comments in code explaining the worker messaging protocol and the pipeline caching strategy.

Nice-to-have (implement only if MVP is solid)
- Parquet and Sqlite read support (Duckdb can already read these files into tables, so I think it shouldn't be too hard).
- Window functions helpers in the GUI.
- Robust missing-data handling steps (fill/drop/indicator).
- A “copy as link” placeholder UI (no backend), and “copy results as Markdown” for notebook blocks.

Start by scaffolding the repo, then implement the worker-based DuckDB engine and a minimal pipeline, then add the UI panes, then EDA, tests, and regression.
