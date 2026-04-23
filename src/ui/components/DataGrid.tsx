import type { Ref } from "react";
import type { PrimitiveValue } from "../../shared/types";

interface DataGridProps {
  columns: string[];
  rows: PrimitiveValue[][];
  emptyText?: string;
  className?: string;
  containerRef?: Ref<HTMLDivElement>;
  onColumnHeaderClick?: (columnName: string, columnIndex: number) => void;
  columnHeaderTitle?: string;
}

export function DataGrid({
  columns,
  rows,
  emptyText,
  className,
  containerRef,
  onColumnHeaderClick,
  columnHeaderTitle
}: DataGridProps) {
  if (columns.length === 0) {
    return <div className="empty-box">{emptyText ?? "No data loaded yet."}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={className ? `grid-wrap ${className}` : "grid-wrap"}
    >
      <table className="data-grid">
        <thead>
          <tr>
            {columns.map((column, columnIndex) => (
              <th key={`${column}-${columnIndex}`}>
                {onColumnHeaderClick ? (
                  <button
                    type="button"
                    className="column-header-button"
                    title={columnHeaderTitle ?? "Edit column"}
                    onClick={() => onColumnHeaderClick(column, columnIndex)}
                  >
                    {column}
                  </button>
                ) : (
                  column
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`row-${index}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${index}-${cellIndex}`}>
                  {cell === null ? <span className="null-cell">NULL</span> : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
