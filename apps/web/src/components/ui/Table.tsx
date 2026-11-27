import type { ReactNode } from "react";

import { cx } from "../cx.js";

export interface Column<Row> {
  key: string;
  header: string;
  /** Cell content. Return a string or a node. */
  cell: (row: Row, index: number) => ReactNode;
  /** Right-align numeric columns. */
  align?: "start" | "end";
}

/**
 * A table that becomes a list of labelled cards below 640px (Design.md §8: "mobile tables
 * become cards"), using the same DOM so nothing is duplicated and every cell keeps its header.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowKey,
  emptyMessage,
}: {
  caption: string;
  columns: Array<Column<Row>>;
  rows: Row[];
  getRowKey: (row: Row, index: number) => string;
  emptyMessage: ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-line bg-surface p-6 text-sm text-muted">
        {emptyMessage}
      </p>
    );
  }

  return (
    <>
      <table className="hidden w-full border-collapse text-sm sm:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx("py-2 pr-4 font-medium text-muted", column.align === "end" && "text-right")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={getRowKey(row, index)} className="border-b border-line last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx("py-3 pr-4 align-top text-ink", column.align === "end" && "text-right")}
                >
                  {column.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="space-y-3 sm:hidden" aria-label={caption}>
        {rows.map((row, index) => (
          <li
            key={getRowKey(row, index)}
            className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {columns.map((column) => (
                <div key={column.key} className="contents">
                  <dt className="text-muted">{column.header}</dt>
                  <dd className="text-ink">{column.cell(row, index)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
