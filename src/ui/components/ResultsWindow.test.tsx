import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultsWindow } from "./ResultsWindow";

describe("ResultsWindow", () => {
  it("copies an embed snippet for notebook table blocks", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "b1",
            title: "Block 1",
            type: "table",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            querySql: "SELECT * FROM source",
            queryTarget: {
              kind: "table",
              tableName: "sales"
            },
            payload: { columns: ["a"], rows: [[1]], rowCount: 1 }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Embed" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const copiedSnippet = writeText.mock.calls[0]?.[0] as string;
    expect(copiedSnippet).toContain(`class="statsfish-embed"`);
    expect(copiedSnippet).toContain(`"kind": "table"`);
    expect(copiedSnippet).toContain(`"title": "Block 1"`);
  });

  it("calls onRerunNotebookBlock when rerun is clicked", () => {
    const onRerunNotebookBlock = vi.fn();
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "b1",
            title: "Block 1",
            type: "table",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            querySql: "SELECT * FROM source",
            queryTarget: {
              kind: "table",
              tableName: "sales"
            },
            payload: { columns: [], rows: [], rowCount: 0 }
          }
        ]}
        onRerunNotebookBlock={onRerunNotebookBlock}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Rerun" }));
    expect(onRerunNotebookBlock).toHaveBeenCalledTimes(1);
    expect(onRerunNotebookBlock).toHaveBeenCalledWith("b1");
  });

  it("calls onDeleteNotebookBlock when delete is clicked", () => {
    const onDeleteNotebookBlock = vi.fn();
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "b1",
            title: "Block 1",
            type: "table",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            querySql: "SELECT * FROM source",
            queryTarget: {
              kind: "table",
              tableName: "sales"
            },
            payload: { columns: [], rows: [], rowCount: 0 }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={onDeleteNotebookBlock}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteNotebookBlock).toHaveBeenCalledTimes(1);
    expect(onDeleteNotebookBlock).toHaveBeenCalledWith("b1");
  });

  it("allows rerun for model blocks with analysis metadata", () => {
    const onRerunNotebookBlock = vi.fn();
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "m1",
            title: "OLS: y ~ x",
            type: "model",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            querySql: "SELECT * FROM source",
            queryTarget: {
              kind: "table",
              tableName: "sales"
            },
            analysisRequest: {
              kind: "ols_regression",
              dependentColumn: "y",
              independentColumns: ["x"],
              includeIntercept: true,
              oneHotEncodeCategorical: true
            },
            payload: {
              kind: "ols_regression",
              r2: 0.91,
              adjustedR2: 0.9,
              n: 120
            }
          }
        ]}
        onRerunNotebookBlock={onRerunNotebookBlock}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Rerun" }));
    expect(onRerunNotebookBlock).toHaveBeenCalledTimes(1);
    expect(onRerunNotebookBlock).toHaveBeenCalledWith("m1");
  });

  it("allows rerun for chart blocks with saved query metadata", () => {
    const onRerunNotebookBlock = vi.fn();
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "c1",
            title: "Chart block",
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            querySql: "SELECT amount AS _sf_x, region AS _sf_y FROM source",
            queryTarget: {
              kind: "table",
              tableName: "sales"
            },
            payload: {
              kind: "chart_v1",
              chartType: "scatter",
              xColumn: "amount",
              yColumn: "region",
              points: [{ x: 1, y: 2 }]
            }
          }
        ]}
        onRerunNotebookBlock={onRerunNotebookBlock}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Rerun" }));
    expect(onRerunNotebookBlock).toHaveBeenCalledTimes(1);
    expect(onRerunNotebookBlock).toHaveBeenCalledWith("c1");
  });

  it("renders detailed OLS model summaries in notebook blocks", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "m2",
            title: "OLS: sales ~ spend + discount",
            type: "model",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            querySql: "SELECT * FROM source",
            queryTarget: {
              kind: "table",
              tableName: "sales"
            },
            analysisRequest: {
              kind: "ols_regression",
              dependentColumn: "sales",
              independentColumns: ["spend", "discount"],
              includeIntercept: true,
              oneHotEncodeCategorical: false
            },
            payload: {
              kind: "ols_regression",
              dependentColumn: "sales",
              independentColumns: ["spend", "discount"],
              includeIntercept: true,
              oneHotEncodeCategorical: false,
              droppedCategoryByColumn: {},
              coefficients: [
                {
                  term: "Intercept",
                  estimate: 10,
                  standardError: 1,
                  tStatistic: 10,
                  pValue: 0.001
                },
                {
                  term: "spend",
                  estimate: 2.1,
                  standardError: 0.5,
                  tStatistic: 4.2,
                  pValue: 0.01
                }
              ],
              r2: 0.9,
              adjustedR2: 0.88,
              n: 100,
              residualSummary: {
                mean: 0,
                std: 1,
                min: -2,
                q25: -0.5,
                q50: 0,
                q75: 0.5,
                max: 2,
                rmse: 1.2,
                mae: 0.9
              },
              residualsVsFitted: {
                sampled: false,
                totalPoints: 100,
                points: [
                  {
                    fitted: 100,
                    residual: -1
                  }
                ]
              },
              qqPlot: {
                sampled: false,
                totalPoints: 100,
                points: [
                  {
                    theoreticalQuantile: -0.25,
                    standardizedResidual: -0.5
                  }
                ]
              },
              leverageVsResidual: {
                sampled: false,
                totalPoints: 100,
                points: [
                  {
                    leverage: 0.1,
                    standardizedResidual: -0.5,
                    cooksDistance: 0.02
                  }
                ]
              },
              topInfluencePoints: [
                {
                  rowIndex: 3,
                  leverage: 0.3,
                  standardizedResidual: -1.2,
                  cooksDistance: 0.08
                }
              ],
              completeCases: {
                totalRows: 120,
                effectiveSampleSize: 100,
                droppedRows: 20,
                droppedNullRows: 10,
                droppedInvalidRows: 10
              }
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    expect(screen.getByText("Term")).toBeTruthy();
    expect(screen.getByText("Intercept")).toBeTruthy();
    expect(screen.getByText("Residual Mean")).toBeTruthy();
    expect(screen.getByRole("img", { name: "scatter chart of residual by fitted" })).toBeTruthy();
    expect(screen.getByText("Observed vs Fitted")).toBeTruthy();
    expect(screen.getByText("Residual Distribution")).toBeTruthy();
    expect(screen.getByText("Normal Q-Q Plot")).toBeTruthy();
    expect(screen.getByText("Leverage vs Standardized Residual")).toBeTruthy();
    expect(screen.getByText("Cook's Distance")).toBeTruthy();
  });

  it("expands OLS coefficient tables and residual charts from notebook blocks", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "m3",
            title: "OLS: y ~ x",
            type: "model",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              kind: "ols_regression",
              dependentColumn: "y",
              independentColumns: ["x"],
              includeIntercept: true,
              oneHotEncodeCategorical: false,
              droppedCategoryByColumn: {},
              coefficients: [
                {
                  term: "Intercept",
                  estimate: 1,
                  standardError: 0.1,
                  tStatistic: 10,
                  pValue: 0.001
                }
              ],
              r2: 0.5,
              adjustedR2: 0.48,
              n: 20,
              residualSummary: {
                mean: 0,
                std: 1,
                min: -1,
                q25: -0.5,
                q50: 0,
                q75: 0.5,
                max: 1,
                rmse: 1,
                mae: 0.8
              },
              residualsVsFitted: {
                sampled: false,
                totalPoints: 20,
                points: [
                  {
                    fitted: 5,
                    residual: 0.2
                  }
                ]
              },
              completeCases: {
                totalRows: 20,
                effectiveSampleSize: 20,
                droppedRows: 0,
                droppedNullRows: 0,
                droppedInvalidRows: 0
              }
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand OLS: y ~ x coefficients" }));
    expect(screen.getByText("OLS: y ~ x Coefficients")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Expand chart preview" })[0]);
    expect(screen.getByText("OLS: y ~ x Residuals vs Fitted")).toBeTruthy();
  });

  it("expands latest query result table on click", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={{
          columns: ["category", "value"],
          rows: [
            ["a", 1],
            ["b", 2]
          ],
          rowCount: 2
        }}
        notebookBlocks={[]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand latest query result" }));
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("shows notebook table preview counts using total rowCount", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "huge_table",
            title: "Large query result",
            type: "table",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              columns: ["id"],
              rows: Array.from({ length: 12 }, (_, index) => [index + 1]),
              rowCount: 200000
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    expect(screen.getByText("200,000 rows.", { exact: false })).toBeTruthy();
  });

  it("loads more rows for expanded table previews when metadata is available", async () => {
    const onLoadMoreTableRows = vi.fn().mockResolvedValue({
      columns: ["id"],
      rows: [[3], [4]],
      rowCount: 4
    });

    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "paged_table",
            title: "Paged table",
            type: "table",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            querySql: "SELECT * FROM source",
            queryTarget: {
              kind: "table",
              tableName: "sales"
            },
            payload: {
              columns: ["id"],
              rows: [[1], [2]],
              rowCount: 4
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        onLoadMoreTableRows={onLoadMoreTableRows}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Load 250 more rows" }));

    await waitFor(() => {
      expect(onLoadMoreTableRows).toHaveBeenCalledWith({
        querySql: "SELECT * FROM source",
        queryTarget: {
          kind: "table",
          tableName: "sales"
        },
        offset: 2,
        limit: 250
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Showing 4 of 4 rows.")).toBeTruthy();
    });
  });

  it("renders chart axis labels, x ticks, and zoom controls", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "chart1",
            title: "Revenue by month",
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              kind: "chart_v1",
              chartType: "bar",
              xColumn: "month",
              yColumn: "revenue",
              xAxisLabel: "Month (calendar)",
              yAxisLabel: "Revenue ($M)",
              points: [
                { x: "Jan", y: 10 },
                { x: "Feb", y: 12 },
                { x: "Mar", y: 8 }
              ]
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Reset Zoom" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zoom In" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zoom Out" })).toBeNull();
    expect(screen.getByText("Month (calendar)")).toBeTruthy();
    expect(screen.getByText("Revenue ($M)")).toBeTruthy();
    expect(screen.getByText("Jan")).toBeTruthy();
  });

  it("keeps full line path when zooming so off-screen points are not dropped", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "line_chart_1",
            title: "Line path retention",
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              kind: "chart_v1",
              chartType: "line",
              xColumn: "x",
              yColumn: "y",
              points: [
                { x: 0, y: 10 },
                { x: 1, y: 12 },
                { x: 2, y: 8 },
                { x: 3, y: 11 }
              ]
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    const svg = screen.getByRole("img", { name: "line chart of y by x" });
    const beforePolyline = svg.querySelector("polyline");
    expect(beforePolyline).toBeTruthy();
    const beforePointCount =
      beforePolyline?.getAttribute("points")?.trim().split(/\s+/).filter(Boolean).length ?? 0;
    expect(beforePointCount).toBe(4);

    fireEvent.wheel(svg, { deltaY: -120, clientX: 0.5, clientY: 0.5 });

    const afterPolyline = svg.querySelector("polyline");
    expect(afterPolyline).toBeTruthy();
    const afterPointCount =
      afterPolyline?.getAttribute("points")?.trim().split(/\s+/).filter(Boolean).length ?? 0;
    expect(afterPointCount).toBe(4);
  });

  it("renders best-fit regression line when provided", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "scatter_with_fit",
            title: "Scatter + fit",
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              kind: "chart_v1",
              chartType: "scatter",
              xColumn: "x",
              yColumn: "y",
              bestFitLine: {
                slope: 2,
                intercept: 1,
                r2: 0.9
              },
              points: [
                { x: 1, y: 3 },
                { x: 2, y: 5 },
                { x: 3, y: 7 }
              ]
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    const svg = screen.getByRole("img", { name: "scatter chart of y by x" });
    expect(svg.querySelector(".chart-best-fit-line")).toBeTruthy();
  });

  it("renders multi-series line charts with separate polylines", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "multi_series_line",
            title: "Revenue by month and segment",
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              kind: "chart_v1",
              chartType: "line",
              xColumn: "month",
              yColumn: "revenue",
              seriesColumn: "segment",
              points: [
                { x: 1, y: 10, series: "SMB" },
                { x: 2, y: 12, series: "SMB" },
                { x: 1, y: 18, series: "Enterprise" },
                { x: 2, y: 19, series: "Enterprise" }
              ]
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    const svg = screen.getByRole("img", { name: "line chart of revenue by month" });
    expect(svg.querySelectorAll("polyline").length).toBe(2);
    expect(screen.getByText("Series: SMB, Enterprise")).toBeTruthy();
  });

  it("renders histogram chart payloads", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "hist_1",
            title: "Amount histogram",
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              kind: "chart_v1",
              chartType: "histogram",
              xColumn: "amount",
              yColumn: "count",
              points: [
                { x: 5, y: 10 },
                { x: 15, y: 7 },
                { x: 25, y: 4 }
              ]
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    const svg = screen.getByRole("img", { name: "histogram chart of count by amount" });
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("draws crosshair guides while hovering scatter charts", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "scatter_crosshair",
            title: "Scatter Crosshair",
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              kind: "chart_v1",
              chartType: "scatter",
              xColumn: "x",
              yColumn: "y",
              points: [
                { x: 1, y: 3 },
                { x: 2, y: 5 },
                { x: 3, y: 7 }
              ]
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    const svg = screen.getByRole("img", { name: "scatter chart of y by x" });
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () =>
        ({
          left: 0,
          top: 0,
          width: 680,
          height: 320,
          right: 680,
          bottom: 320,
          x: 0,
          y: 0,
          toJSON: () => ({})
        }) as DOMRect,
      configurable: true
    });
    fireEvent.mouseMove(svg, { clientX: 340, clientY: 160 });
    expect(svg.querySelector(".chart-crosshair-y")).toBeTruthy();
    expect(svg.querySelector(".chart-crosshair-x")).toBeTruthy();
  });

  it("prevents browser context menu on chart surfaces", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "scatter_zoom",
            title: "Scatter zoom",
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              kind: "chart_v1",
              chartType: "scatter",
              xColumn: "x",
              yColumn: "y",
              points: [
                { x: 1, y: 3 },
                { x: 2, y: 5 },
                { x: 3, y: 7 }
              ]
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    const svg = screen.getByRole("img", { name: "scatter chart of y by x" });
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () =>
        ({
          left: 0,
          top: 0,
          width: 680,
          height: 320,
          right: 680,
          bottom: 320,
          x: 0,
          y: 0,
          toJSON: () => ({})
        }) as DOMRect,
      configurable: true
    });
    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true
    });
    svg.dispatchEvent(contextMenuEvent);
    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  it("prevents wheel scrolling on chart surfaces", () => {
    render(
      <ResultsWindow
        tab="notebook"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[
          {
            id: "scatter_wheel",
            title: "Scatter wheel",
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: "sales",
            payload: {
              kind: "chart_v1",
              chartType: "scatter",
              xColumn: "x",
              yColumn: "y",
              points: [
                { x: 1, y: 3 },
                { x: 2, y: 5 },
                { x: 3, y: 7 }
              ]
            }
          }
        ]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={null}
        describeOptions={{
          data: [],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    const chartContainer = screen.getByRole("button", { name: "Expand chart preview" });
    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -120
    });
    chartContainer.dispatchEvent(wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it("shows profile top values in describe output", () => {
    render(
      <ResultsWindow
        tab="describe"
        onTabChange={vi.fn()}
        queryResult={null}
        notebookBlocks={[]}
        onRerunNotebookBlock={vi.fn()}
        onDeleteNotebookBlock={vi.fn()}
        profile={{
          tableName: "Describe: sales",
          rowCount: 5,
          columns: [
            {
              column: "segment",
              type: "VARCHAR",
              count: 5,
              distinctCount: 2,
              nullCount: 0,
              topValues: [
                { value: "SMB", count: 3 },
                { value: "Enterprise", count: 2 }
              ]
            }
          ]
        }}
        describeOptions={{
          data: [
            {
              key: "table:sales",
              label: "sales",
              target: {
                kind: "table",
                tableName: "sales"
              }
            }
          ],
          transforms: [],
          queries: []
        }}
        onDescribe={vi.fn()}
      />
    );

    expect(screen.getByText("Top Values")).toBeTruthy();
    expect(screen.getByText("SMB (3), Enterprise (2)")).toBeTruthy();
  });
});
