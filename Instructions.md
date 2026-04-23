# StatsFish User Instructions (Complete V1 Guide)

This document explains how to use every currently implemented feature in StatsFish.

## 1) Start the App

1. Open a terminal in the project root (the `StatsFish` folder).
2. Install dependencies:
   - `npm install`
3. Start dev server:
   - `npm run dev`
4. Open the URL printed by Vite (usually `http://localhost:5173`).

To access from other devices on your LAN:

- `npm run dev -- --host 0.0.0.0 --port 5173`

## 2) Understand the Layout

The app has three main windows and a bottom status footer:

1. **Data Window (left)**
   - Tabs: `Data`, `Transforms`, `Queries`
2. **Work Window (center)**
   - Tabs: `Query`, `Transform`, `Statistics`
3. **Results Window (right)**
   - Tabs: `Notebook`, `Describe`
4. **Footer (bottom)**
   - Status messages
   - Current data preview table + row count
   - Storage mode (`IndexedDB + OPFS` or `IndexedDB fallback`)

## 3) Top Bar Actions

### 3.1 `Load Example`

Loads `sales.csv` into the app as `sales_example`.

### 3.2 `Export Recipe`

Exports workflow metadata to JSON:

- sources metadata
- pipelines
- saved queries
- notebook blocks
- saved column edits

### 3.3 `Import Recipe`

Imports a recipe JSON and restores workflow metadata.

Important:

- Recipe import restores analysis structure/state.
- You still need to re-import original CSV files to restore underlying table data.

### 3.4 `Refresh`

Rescans DuckDB tables and refreshes table registry/preview state in the UI.

### 3.5 `Delete All Data`

Opens a confirmation modal and, if confirmed, deletes:

- all datasets
- all transforms
- all saved queries
- all notebook blocks
- persisted project metadata

## 4) Data Window: `Data` Tab

### 4.1 Import CSV

Click `Import CSV` to open the custom import modal.

### Import Modal Fields

1. **Destination**
   - `Create new table`
   - `Merge into existing table`
2. **Merge mode**
   - `Same table: union by name`
   - `Same table: exact schema`
   - `Same table: by position`
   - `Separate tables` (new-table import only)
3. **Delimiter**
   - one-character delimiter
4. **Header row**
   - checked = first row treated as header

### Merge Mode Meaning

1. `Union by name`
   - aligns columns by column name
2. `Exact schema`
   - requires same column names/types/order
3. `By position`
   - aligns columns by ordinal position
4. `Separate tables`
   - creates one table per imported file

### Import Limit Handling

Hard limits:

- max `1,000,000` rows per logical table
- max `250 MB` per logical table

If exceeded, app shows an `Import Limit Reached` modal:

- `Cancel`
- `Import 200,000-Row Sample`

### Source Metadata Captured

For each import source, the app stores:

- file name
- file size
- delimiter
- header flag
- optional SHA-256 hash (for files within hashing threshold)

### 4.2 Switch Active Table

Use `Table:` dropdown to choose which dataset is previewed.

### 4.3 Data Preview Behavior

Preview grid behavior:

1. Starts with a limited row count.
2. Auto-loads enough rows to fill visible preview area plus small buffer.
3. You can manually load more with `Load 10 more rows`.
4. Header stays sticky while scrolling.
5. Grid scrolls inside its own container.

### 4.4 Rename Dataset

Use `Rename` input + `Rename` button.

Renaming updates references in:

- query targets
- notebook block targets
- pipeline table maps
- selected transform table when relevant

### 4.5 Delete Dataset

Click `Delete Dataset` to open confirmation modal for the selected table.

On confirm, table is dropped and related per-table transform/column-edit state is removed.

### 4.6 Edit Column Name/Type/Nullability

Click any column header in the preview grid.

This opens `Edit Column` modal with:

1. `Column Name`
2. Type preset dropdown (common DuckDB types)
3. Free-text type field (for custom DuckDB types)
4. `Allow NULL values` checkbox

Click `Save Column` to apply schema changes.

Notes:

- Type changes use DuckDB `ALTER COLUMN TYPE`.
- Nullability changes use `SET NOT NULL` / `DROP NOT NULL`.
- `SET NOT NULL` is blocked if column still contains nulls.
- Column edits are stored in project state and recipe metadata.

## 5) Data Window: `Transforms` Tab

This tab is table-scoped.

### 5.1 Choose Transform Table

Use `Table:` dropdown at top.

All step list operations in this tab apply to the selected table’s pipeline only.

### 5.2 Create New Transform

Click `New Transform`.

Effects:

- opens Work Window `Transform` tab
- clears transform builder fields
- binds creation context to selected table

### 5.3 Manage Transform Steps

Each step row includes:

- step name
- step type
- enabled/disabled pill
- open/select action

Row actions:

1. `Rename`
2. `Up`
3. `Down`
4. `Enable` / `Disable`
5. `Remove`

Clicking a step also:

- selects the step
- opens corresponding transform panel in Work Window
- sets query target to that pipeline step snapshot
- loads preview in Results Notebook

## 6) Data Window: `Queries` Tab

### 6.1 Create Query

Click `New Query`.

This opens Work Window `Query` flow with cleared SQL.

### 6.2 Query List

Each query row shows:

- query name
- target summary
- active version number
- total versions

Click a query row to:

- load active query SQL
- set its saved target
- run it
- show result in Notebook

### 6.3 Rename Query

Use `Rename` action on query row.

References in query targets/notebook metadata are updated accordingly.

### 6.4 Prune Old Versions

Click `Prune Old Versions`.

Modal lists removable versions (active version excluded) with:

- version label
- timestamp
- target label
- SQL preview

Select versions and click `Prune Selected`.

Safety checks prevent pruning versions still pinned/protected by current query target or notebook references.

## 7) Work Window: `Query` Tab

### 7.1 Create Query

If editor is hidden, click `Create Query`.

### 7.2 SQL Query Card

Controls inside `SQL Query` accordion:

1. `Run against` dropdown
   - table targets
   - pipeline-step targets
   - saved-query-version targets
2. SQL editor textarea
3. Buttons:
   - `Run SQL`
   - `Save Query` (new query) or `Save New Version` (existing query)
   - `New Query`

### 7.3 SQL Rules

Query mode allows only `SELECT`/`WITH` SQL.

Statements like `DROP TABLE`, `UPDATE`, `DELETE`, etc. are blocked.

### 7.4 How `source` Works

The selected `Run against` target is always exposed as `source` in runtime SQL.

Example:

```sql
SELECT * FROM source LIMIT 100;
```

### 7.5 Referencing Pipeline Steps and Saved Queries in SQL

You can reference named CTE aliases beyond `source`.

### Pipeline step aliases

1. Same-table alias (for target/base table context):
   - sanitized step name
2. Cross-table alias:
   - `<tableName>_<stepName>` (sanitized)

Example pattern:

```sql
SELECT * FROM Orders_Filter_by_Region;
```

### Saved query aliases

- sanitized query name

Example pattern:

```sql
SELECT * FROM Revenue_By_Month;
```

Alias names are sanitized:

- spaces become `_`
- non-identifier characters are removed

If unsure, use simple names for queries/steps to make aliases predictable.

### 7.6 Saving Queries and Dependency Impact

When you save an edit to an existing query, a new immutable version is created.

If downstream saved queries depend on that query, `Dependency Impact` modal appears.

Per-dependent decisions:

1. `Keep pinned`
2. `Adopt new upstream`
3. `Fork dependent`

Apply with `Apply Decisions`, or close with keep-pinned behavior.

## 8) Work Window: `Transform` Tab

At top, this tab shows:

- `Transform table: <name>`
- `Creating transform for table: <name>`

If empty, click `Create Transform` to open transform builders.

Each transform type is an accordion panel. Fields stay collapsed until opened.

### 8.1 Available Transform Builders

1. `Filter by Column Value`
2. `Select Columns`
3. `Calculate New Column`
4. `Remove Duplicates`
5. `Fill or Drop Missing Values`
6. `Sort Rows`
7. `Type Cast and Date Parsing`
8. `Scale Numeric Column`
9. `Create Dummy Variables`
10. `Group and Aggregate`
11. `Join Tables`
12. `Pivot Table`
13. `SQL Transform`

Each panel provides `Add ... Step` or `Update ... Step` depending on selected active step type.

### 8.2 SQL Transform Panel

Contains:

1. SQL transform editor
2. `Add SQL Step`
3. `Update Step SQL` (enabled when active step is SQL transform)
4. `Run Pipeline`

Rules:

- SQL transform step must be `SELECT`/`WITH` SQL.

### 8.3 Dummy Variables Details

`Create Dummy Variables` supports:

- source column
- optional prefix
- `Drop one category`
- optional explicit drop category value

If `Drop one category` is enabled and no category is specified, first detected category is used.

### 8.4 Pipeline Run and Auto-Run

1. Manual run: `Run Pipeline`.
2. Debounced auto-run:
   - when in Data Window `Transforms` tab
   - after transform edits settle

Pipeline run result target becomes the final pipeline step (or base table if no steps).

## 9) Work Window: `Statistics` Tab

At top:

1. `Run against` dropdown
2. target summary line

This target controls column options and execution source for all statistics/visualization panels.

### 9.1 Visualization Panel

Supported chart types:

1. `Line`
2. `Scatter`
3. `Bar`
4. `Histogram`

Config options:

- X column (or value column for histogram)
- Y column (non-histogram)
- histogram bins
- optional series column
- optional facet column
- title
- x/y axis labels
- `All data visible` toggle
- manual axis bounds (x min/max, y min/max when auto-range off)
- `Show best-fit line` (line/scatter)

Click `Create Visualization` to add chart block(s) to Notebook.

Facet behavior:

- one notebook chart block per facet value
- max 12 facet groups

Important validations:

- bar charts do not support series overlay
- best-fit line requires numeric X and adequate variation
- manual X range for non-bar charts requires numeric X

### 9.2 Welch t-test Panel

Inputs:

- value column
- group column
- group A label
- group B label

Click `Run Welch t-test` to create a test notebook block.

### 9.3 Correlation Panel

Inputs:

- method (`Pearson`, `Kendall`, `Spearman`)
- X column
- Y column

Click `Run Correlation` to create a test notebook block.

### 9.4 Chi-square Test Panel

Inputs:

- row category column
- column category column

Click `Run Chi-square` to create a test notebook block.

### 9.5 OLS Regression Panel

Inputs:

- dependent column (Y)
- independent columns (X list)
- `Include intercept`
- `One-hot categorical`

Click `Run OLS Regression` to create model notebook block.

Validation checks include:

- selected columns must exist in selected target
- dependent cannot also be independent
- one-hot required for categorical predictors if non-numeric predictors are present

## 10) Results Window: `Notebook` Tab

### 10.1 Latest Query Result

Shows preview of latest query/pipeline table output.

Actions:

- click preview to expand
- `Embed Latest` copies embeddable HTML+JSON snippet

Preview row line shows:

- `Showing x of y rows` where `y` is true total result count

### 10.2 Notebook Blocks

Block types rendered:

1. `table`
2. `chart`
3. `test`
4. `model`

Each block includes metadata + action row:

- timestamp
- `Expand`
- `Embed`
- `Rerun` (when rerun metadata exists)
- `Delete`

### 10.3 Expand Table Blocks

Expanded table modal supports:

- sticky headers
- internal scrolling
- accurate row count summary
- `Load 250 more rows` when additional rows exist and query metadata is available

### 10.4 Expand Chart Blocks

Chart modal renders full interactive chart.

### 10.5 Chart Interaction Controls

In chart previews and expanded chart modal:

1. **Wheel zoom**
   - zooms both X and Y axes around pointer anchor
2. **Left-click drag**
   - pans when zoomed
3. **Right-click drag**
   - rectangle zoom on both axes
4. **Double-click**
   - reset zoom
5. **Reset Zoom button**
   - reset current chart view
6. **Crosshair guides and coordinate readout**
   - y crosshair always
   - x crosshair shown for non-bar charts

Extra chart details:

- bar/histogram y-axis defaults include zero baseline
- line continuity is preserved with clipped rendering while zooming/panning

### 10.6 OLS Model Block Contents

Model blocks include:

1. Summary line:
   - `R²`, adjusted `R²`, sample size, dropped rows
2. Expandable coefficient table
3. Expandable residual summary table
4. Diagnostic charts:
   - residuals vs fitted
   - observed vs fitted
   - residual distribution
   - normal Q-Q
   - leverage vs standardized residual
5. Expandable top influence points table (Cook’s distance)

## 11) Results Window: `Describe` Tab

Describe workflow:

1. Choose source scope button:
   - `Data`
   - `Transforms`
   - `Queries`
2. Choose target from dropdown
3. Click `Describe`

Output table columns:

- Column
- Type
- Count
- Distinct
- Null
- Top Values
- Mean
- Std
- Min
- 25%
- 50%
- 75%
- Max

## 12) Persistence Behavior

The app persists workflow state locally.

### 12.1 What Persists

- saved queries and versions
- pipelines by table
- notebook blocks
- selected targets/tabs
- source metadata
- saved column edits metadata

### 12.2 Where It Persists

- IndexedDB always
- OPFS mirror when supported
- DuckDB file prefers OPFS path when available

### 12.3 What Happens on Refresh

- UI state is rehydrated from local persisted state
- DuckDB-backed datasets are re-listed into Data Window

## 13) Recipe Export/Import Notes

Recipe export/import is for reproducible workflow metadata.

On import, if table files are missing, re-import original CSV files to restore data and replay analysis end-to-end.

## 14) Important Constraints and Limits

1. Query and SQL transform modes accept only `SELECT`/`WITH` SQL.
2. Import hard caps:
   - `1,000,000` rows per logical table
   - `250 MB` per logical table
3. Import fallback sample mode:
   - `200,000` rows per file
4. Analysis/runtime row caps:
   - stats/model/profile SQL capped internally for stability
   - chart source query capped at `50,000` rows before point sampling
5. Faceting limit for chart creation:
   - max `12` facet groups

## 15) Typical End-to-End Workflow

1. Import CSV(s) in Data tab.
2. Choose transform table in Data Window `Transforms` tab.
3. Click `New Transform` and add transform steps.
4. Run pipeline or rely on transform auto-run while editing.
5. In Work Window `Query`, run SQL against table/pipeline/query target.
6. Save query.
7. In Work Window `Statistics`, run tests/OLS/create charts.
8. Use Notebook to expand, rerun, embed, or delete outputs.
9. Use Describe tab for profile summaries of data/transform/query outputs.
10. Export recipe when you want a portable workflow metadata snapshot.

## 16) Troubleshooting Quick Reference

1. **“Only SELECT/CTE statements are allowed”**
   - remove non-select SQL statements
2. **Import limit error**
   - use sample import fallback or split data
3. **Rerun disabled for a block**
   - block lacks required `querySql`/`queryTarget` metadata
4. **Column update failed due nullability**
   - remove/fill nulls before setting `NOT NULL`
5. **Chart creation blocked for many facets**
   - choose lower-cardinality facet or remove facet

