import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataGrid } from "./DataGrid";

describe("DataGrid", () => {
  it("calls header click callback with column name and index", () => {
    const onColumnHeaderClick = vi.fn();
    render(
      <DataGrid
        columns={["alpha", "beta"]}
        rows={[[1, 2]]}
        onColumnHeaderClick={onColumnHeaderClick}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "beta" }));
    expect(onColumnHeaderClick).toHaveBeenCalledTimes(1);
    expect(onColumnHeaderClick).toHaveBeenCalledWith("beta", 1);
  });

  it("renders empty state when no columns exist", () => {
    render(<DataGrid columns={[]} rows={[]} emptyText="No preview" />);
    expect(screen.getByText("No preview")).toBeTruthy();
  });
});
