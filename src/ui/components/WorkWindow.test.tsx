import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { QueryTargetRef, SelectColumnsStep } from "../../shared/types";
import { WorkWindow } from "./WorkWindow";

function makeTarget(): QueryTargetRef {
  return {
    kind: "table",
    tableName: "sales"
  };
}

function makeProps(overrides: Partial<ComponentProps<typeof WorkWindow>> = {}) {
  const target = makeTarget();
  return {
    sql: "",
    onSqlChange: vi.fn(),
    transformTableName: "sales",
    queryTarget: target,
    targetOptions: [
      {
        key: "table:sales",
        label: "Table: sales",
        target
      }
    ],
    openNewQuerySignal: 0,
    openNewTransformSignal: 0,
    onTargetChange: vi.fn(),
    onNewQuery: vi.fn(),
    availableColumns: ["amount", "region"],
    statisticsAvailableColumns: ["amount", "region"],
    tableColumnOptions: [
      { tableName: "sales", columns: ["amount", "region"] },
      { tableName: "regions", columns: ["region_id", "region"] }
    ],
    onSaveFilterStep: vi.fn(),
    onSaveSelectColumnsStep: vi.fn(),
    onSaveMutateColumnStep: vi.fn(),
    onSaveRemoveDuplicatesStep: vi.fn(),
    onSaveMissingValuesStep: vi.fn(),
    onSaveSortRowsStep: vi.fn(),
    onSaveCastColumnStep: vi.fn(),
    onSaveScaleNumericStep: vi.fn(),
    onSaveDummyVariablesStep: vi.fn(),
    onSaveGroupAggregateStep: vi.fn(),
    onSaveJoinStep: vi.fn(),
    onSavePivotStep: vi.fn(),
    onAddSqlStep: vi.fn(),
    onUpdatePipelineSqlStep: vi.fn(),
    onRunPipeline: vi.fn(),
    onRunWelchTTest: vi.fn(),
    onRunPearsonCorrelation: vi.fn(),
    onRunChiSquareTest: vi.fn(),
    onRunOLSRegression: vi.fn(),
    onCreateChart: vi.fn(),
    activePipelineStep: null,
    savedQueries: [],
    activeQueryId: null,
    statusText: "",
    onRunSQL: vi.fn(),
    onSaveQuery: vi.fn(),
    ...overrides
  };
}

describe("WorkWindow", () => {
  it("starts query tab in create mode", () => {
    render(<WorkWindow {...makeProps()} />);

    expect(screen.getByRole("button", { name: "Create Query" })).toBeTruthy();
  });

  it("adds a filter step after creating transform and expanding the card", () => {
    const onSaveFilterStep = vi.fn();
    render(<WorkWindow {...makeProps({ onSaveFilterStep })} />);

    fireEvent.click(screen.getByRole("button", { name: "Transform" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Transform" }));
    fireEvent.click(screen.getByRole("button", { name: /Filter by Column Value/i }));
    fireEvent.change(screen.getByLabelText("Filter Operator"), {
      target: { value: ">" }
    });
    fireEvent.change(screen.getByLabelText("Filter Value"), {
      target: { value: "100" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Filter Step" }));

    expect(onSaveFilterStep).toHaveBeenCalledTimes(1);
    expect(onSaveFilterStep).toHaveBeenCalledWith({
      column: "amount",
      operator: ">",
      value: "100"
    });
  });

  it("adds a group aggregate step", () => {
    const onSaveGroupAggregateStep = vi.fn();
    render(<WorkWindow {...makeProps({ onSaveGroupAggregateStep })} />);

    fireEvent.click(screen.getByRole("button", { name: "Transform" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Transform" }));
    fireEvent.click(screen.getByRole("button", { name: /Group and Aggregate/i }));
    fireEvent.click(screen.getByLabelText("Group by amount"));
    fireEvent.change(screen.getByLabelText("Aggregate Expression 1"), {
      target: { value: "SUM(amount)" }
    });
    fireEvent.change(screen.getByLabelText("Alias 1"), {
      target: { value: "sum_amount" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Group Aggregate Step" }));

    expect(onSaveGroupAggregateStep).toHaveBeenCalledTimes(1);
    expect(onSaveGroupAggregateStep).toHaveBeenCalledWith({
      groupBy: ["amount"],
      aggregates: [
        {
          expression: "SUM(amount)",
          alias: "sum_amount"
        }
      ]
    });
  });

  it("adds a join step", () => {
    const onSaveJoinStep = vi.fn();
    render(<WorkWindow {...makeProps({ onSaveJoinStep })} />);

    fireEvent.click(screen.getByRole("button", { name: "Transform" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Transform" }));
    fireEvent.click(screen.getByRole("button", { name: /Join Tables/i }));
    fireEvent.change(screen.getByLabelText("Right Table"), {
      target: { value: "regions" }
    });
    fireEvent.change(screen.getByLabelText("Left Column"), {
      target: { value: "region" }
    });
    fireEvent.change(screen.getByLabelText("Right Column"), {
      target: { value: "region" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Join Step" }));

    expect(onSaveJoinStep).toHaveBeenCalledTimes(1);
    expect(onSaveJoinStep).toHaveBeenCalledWith({
      rightTable: "regions",
      joinType: "inner",
      conditions: [
        {
          leftColumn: "region",
          operator: "=",
          rightColumn: "region"
        }
      ]
    });
  });

  it("adds a pivot step", () => {
    const onSavePivotStep = vi.fn();
    render(<WorkWindow {...makeProps({ onSavePivotStep })} />);

    fireEvent.click(screen.getByRole("button", { name: "Transform" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Transform" }));
    fireEvent.click(screen.getByRole("button", { name: /Pivot Table/i }));
    fireEvent.change(screen.getByLabelText("Pivot Column"), {
      target: { value: "region" }
    });
    fireEvent.change(screen.getByLabelText("Value Column"), {
      target: { value: "amount" }
    });
    fireEvent.change(screen.getByLabelText("Aggregate"), {
      target: { value: "count" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Pivot Step" }));

    expect(onSavePivotStep).toHaveBeenCalledTimes(1);
    expect(onSavePivotStep).toHaveBeenCalledWith({
      indexColumns: ["amount"],
      pivotColumn: "region",
      valueColumn: "amount",
      aggregate: "count"
    });
  });

  it("adds a remove-duplicates step", () => {
    const onSaveRemoveDuplicatesStep = vi.fn();
    render(<WorkWindow {...makeProps({ onSaveRemoveDuplicatesStep })} />);

    fireEvent.click(screen.getByRole("button", { name: "Transform" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Transform" }));
    fireEvent.click(screen.getByRole("button", { name: /Remove Duplicates/i }));
    fireEvent.click(screen.getByLabelText("Key: amount"));
    fireEvent.click(screen.getByRole("button", { name: "Add Remove Duplicates Step" }));

    expect(onSaveRemoveDuplicatesStep).toHaveBeenCalledWith({
      columns: ["amount"]
    });
  });

  it("adds a missing-values fill step", () => {
    const onSaveMissingValuesStep = vi.fn();
    render(<WorkWindow {...makeProps({ onSaveMissingValuesStep })} />);

    fireEvent.click(screen.getByRole("button", { name: "Transform" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Transform" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Fill or Drop Missing Values/i })
    );
    fireEvent.change(screen.getByLabelText("Mode"), {
      target: { value: "fill" }
    });
    fireEvent.change(screen.getByLabelText("Fill Value"), {
      target: { value: "0" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Missing Values Step" }));

    expect(onSaveMissingValuesStep).toHaveBeenCalledWith({
      mode: "fill",
      columns: ["amount"],
      fillValue: "0"
    });
  });

  it("adds a sort step", () => {
    const onSaveSortRowsStep = vi.fn();
    render(<WorkWindow {...makeProps({ onSaveSortRowsStep })} />);

    fireEvent.click(screen.getByRole("button", { name: "Transform" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Transform" }));
    fireEvent.click(screen.getByRole("button", { name: /Sort Rows/i }));
    fireEvent.change(screen.getByLabelText("Direction"), {
      target: { value: "desc" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Sort Step" }));

    expect(onSaveSortRowsStep).toHaveBeenCalledWith({
      column: "amount",
      direction: "desc",
      nulls: "last"
    });
  });

  it("opens the matching transform panel when a step is selected", () => {
    const activePipelineStep: SelectColumnsStep = {
      id: "s1",
      name: "Select columns",
      enabled: true,
      type: "SelectColumnsStep",
      params: {
        columns: ["amount"]
      }
    };
    render(<WorkWindow {...makeProps({ activePipelineStep })} />);

    expect(screen.getByRole("button", { name: "Update Select Step" })).toBeTruthy();
  });

  it("runs Welch t-test only after expanding statistics panel", () => {
    const onRunWelchTTest = vi.fn();
    render(<WorkWindow {...makeProps({ onRunWelchTTest })} />);

    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    fireEvent.click(screen.getByRole("button", { name: /Welch t-test/i }));
    fireEvent.change(screen.getByLabelText("Group A"), {
      target: { value: "control" }
    });
    fireEvent.change(screen.getByLabelText("Group B"), {
      target: { value: "treatment" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Welch t-test" }));

    expect(onRunWelchTTest).toHaveBeenCalledTimes(1);
    expect(onRunWelchTTest).toHaveBeenCalledWith({
      valueColumn: "amount",
      groupColumn: "region",
      groupA: "control",
      groupB: "treatment"
    });
  });

  it("runs Pearson and Chi-square from statistics tab", () => {
    const onRunPearsonCorrelation = vi.fn();
    const onRunChiSquareTest = vi.fn();
    render(
      <WorkWindow
        {...makeProps({
          onRunPearsonCorrelation,
          onRunChiSquareTest
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    fireEvent.click(screen.getByRole("button", { name: /Correlation/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run Correlation" }));

    fireEvent.click(screen.getByRole("button", { name: /Chi-square test/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run Chi-square" }));

    expect(onRunPearsonCorrelation).toHaveBeenCalledWith({
      xColumn: "amount",
      yColumn: "region",
      method: "pearson"
    });
    expect(onRunChiSquareTest).toHaveBeenCalledWith({
      rowColumn: "amount",
      columnColumn: "region"
    });
  });

  it("passes selected correlation method", () => {
    const onRunPearsonCorrelation = vi.fn();
    render(<WorkWindow {...makeProps({ onRunPearsonCorrelation })} />);

    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    fireEvent.click(screen.getByRole("button", { name: /Correlation/i }));
    fireEvent.change(screen.getByLabelText("Method"), {
      target: { value: "kendall" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Correlation" }));

    expect(onRunPearsonCorrelation).toHaveBeenCalledWith({
      xColumn: "amount",
      yColumn: "region",
      method: "kendall"
    });
  });

  it("runs OLS regression with selected options", () => {
    const onRunOLSRegression = vi.fn();
    render(<WorkWindow {...makeProps({ onRunOLSRegression })} />);

    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    fireEvent.click(screen.getByRole("button", { name: /OLS Regression/i }));
    fireEvent.click(screen.getByLabelText("Include intercept"));
    fireEvent.click(screen.getByLabelText("One-hot categorical"));
    fireEvent.click(screen.getByRole("button", { name: "Run OLS Regression" }));

    expect(onRunOLSRegression).toHaveBeenCalledWith({
      dependentColumn: "amount",
      independentColumns: ["region"],
      includeIntercept: false,
      oneHotEncodeCategorical: false
    });
  });

  it("creates visualization from statistics tab", () => {
    const onCreateChart = vi.fn();
    render(<WorkWindow {...makeProps({ onCreateChart })} />);

    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    fireEvent.click(screen.getByRole("button", { name: /Visualization/i }));
    fireEvent.change(screen.getByLabelText("Chart Type"), {
      target: { value: "scatter" }
    });
    fireEvent.change(screen.getByLabelText("Chart Title"), {
      target: { value: "My Chart" }
    });
    fireEvent.change(screen.getByLabelText("X Axis Label"), {
      target: { value: "My X" }
    });
    fireEvent.change(screen.getByLabelText("Y Axis Label"), {
      target: { value: "My Y" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Visualization" }));

    expect(onCreateChart).toHaveBeenCalledWith(
      expect.objectContaining({
        chartType: "scatter",
        xColumn: "amount",
        yColumn: "region",
        title: "My Chart",
        xAxisLabel: "My X",
        yAxisLabel: "My Y",
        autoRange: true,
        showBestFitLine: false
      })
    );
  });

  it("passes optional series and facet selections when creating visualizations", () => {
    const onCreateChart = vi.fn();
    render(<WorkWindow {...makeProps({ onCreateChart })} />);

    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    fireEvent.click(screen.getByRole("button", { name: /Visualization/i }));
    fireEvent.change(screen.getByLabelText("Series (Optional)"), {
      target: { value: "amount" }
    });
    fireEvent.change(screen.getByLabelText("Facet (Optional)"), {
      target: { value: "region" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Visualization" }));

    expect(onCreateChart).toHaveBeenCalledWith(
      expect.objectContaining({
        seriesColumn: "amount",
        facetColumn: "region"
      })
    );
  });

  it("passes manual axis ranges and best-fit selection for visualizations", () => {
    const onCreateChart = vi.fn();
    render(<WorkWindow {...makeProps({ onCreateChart })} />);

    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    fireEvent.click(screen.getByRole("button", { name: /Visualization/i }));
    fireEvent.click(screen.getByLabelText("All data visible"));
    fireEvent.change(screen.getByLabelText("X Min"), {
      target: { value: "1.5" }
    });
    fireEvent.change(screen.getByLabelText("X Max"), {
      target: { value: "9.5" }
    });
    fireEvent.change(screen.getByLabelText("Y Min"), {
      target: { value: "0" }
    });
    fireEvent.change(screen.getByLabelText("Y Max"), {
      target: { value: "100" }
    });
    fireEvent.click(screen.getByLabelText("Show best-fit line"));
    fireEvent.click(screen.getByRole("button", { name: "Create Visualization" }));

    expect(onCreateChart).toHaveBeenCalledWith(
      expect.objectContaining({
        chartType: "line",
        autoRange: false,
        xMin: 1.5,
        xMax: 9.5,
        yMin: 0,
        yMax: 100,
        showBestFitLine: true
      })
    );
  });

  it("uses target statistics columns for OLS selectors", () => {
    const onRunOLSRegression = vi.fn();
    const { rerender } = render(
      <WorkWindow
        {...makeProps({
          onRunOLSRegression,
          availableColumns: ["dataset_a_only", "dataset_a_other"],
          statisticsAvailableColumns: ["dataset_a_only", "dataset_a_other"]
        })}
      />
    );

    rerender(
      <WorkWindow
        {...makeProps({
          onRunOLSRegression,
          availableColumns: ["dataset_a_only", "dataset_a_other"],
          statisticsAvailableColumns: ["dataset_b_y", "dataset_b_x"]
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    fireEvent.click(screen.getByRole("button", { name: /OLS Regression/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run OLS Regression" }));

    expect(onRunOLSRegression).toHaveBeenCalledWith({
      dependentColumn: "dataset_b_y",
      independentColumns: ["dataset_b_x"],
      includeIntercept: true,
      oneHotEncodeCategorical: true
    });
  });

  it("clears SQL editor state when starting a new transform flow", async () => {
    const onSqlChange = vi.fn();
    const { rerender } = render(
      <WorkWindow
        {...makeProps({
          onSqlChange,
          sql: "SELECT * FROM source",
          openNewTransformSignal: 0
        })}
      />
    );

    rerender(
      <WorkWindow
        {...makeProps({
          onSqlChange,
          sql: "SELECT * FROM source",
          openNewTransformSignal: 1
        })}
      />
    );

    await waitFor(() => {
      expect(onSqlChange).toHaveBeenCalledWith("");
    });
    expect(screen.getByRole("button", { name: /Filter by Column Value/i })).toBeTruthy();
  });
});
