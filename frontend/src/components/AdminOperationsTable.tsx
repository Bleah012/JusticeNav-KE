import { useState } from "react";
import type { ReactNode } from "react";
import { AdminDataState } from "./AdminDataState";
import { Button } from "./ui/Button";
import type { AdminData } from "../types/adminData";

export type AdminColumn<T> = {
  key: string;
  label: string;
  render: (record: T) => ReactNode;
};

// Share semantic tables and actual-result pagination without invented totals.
export function AdminOperationsTable<T>({
  title,
  subject,
  records,
  status,
  retry,
  columns,
  rowKey,
  emptyTitle,
}: {
  title: string;
  subject: string;
  records: readonly T[] | null;
  status: AdminData<unknown>["status"];
  retry?: () => void;
  columns: readonly AdminColumn<T>[];
  rowKey: (record: T) => string;
  emptyTitle: string;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil((records?.length ?? 0) / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible =
    records?.slice((currentPage - 1) * pageSize, currentPage * pageSize) ?? [];

  return (
    <>
      <div
        className="admin-pages__table-wrap"
        role="region"
        aria-label={`${title} table`}
        tabIndex={0}
      >
        <table className="admin-pages__table">
          <caption className="admin-pages__sr-only">{title}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records ? (
              visible.length ? (
                visible.map((record) => (
                  <tr key={rowKey(record)}>
                    {columns.map((column, index) =>
                      index === 0 ? (
                        <th key={column.key} scope="row">
                          {column.render(record)}
                        </th>
                      ) : (
                        <td key={column.key}>{column.render(record)}</td>
                      ),
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length}>
                    <div className="seeker-page__state">
                      <h2>{emptyTitle}</h2>
                      <p>
                        No matching records were returned for the current view.
                      </p>
                    </div>
                  </td>
                </tr>
              )
            ) : (
              <tr>
                <td colSpan={columns.length}>
                  <AdminDataState
                    subject={subject}
                    status={status === "ready" ? "error" : status}
                    retry={retry}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {records && (
        <div className="admin-pages__pagination">
          <span role="status">
            {records.length
              ? `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, records.length)} of ${records.length}`
              : "0 results"}
          </span>
          {records.length > 0 && (
            <div>
              <Button
                variant="secondary"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span>
                Page {currentPage} of {pageCount}
              </span>
              <Button
                variant="secondary"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
