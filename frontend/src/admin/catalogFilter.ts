export type CatalogRow = {
  id: string;
  title: string;
  category: string;
  location: string | null;
  checkedOn: string;
  sources: readonly {
    name: string;
    url: string;
  }[];
  publicPath: string;
  serviceId: string | null;
};
export function filterCatalog(
  rows: readonly CatalogRow[],
  search: string,
  category: string,
  sort: string,
  page: number,
  pageSize = 10,
) {
  const needle = search.trim().toLocaleLowerCase();
  const filtered = rows.filter(
    (row) =>
      (category === "all" || row.category === category) &&
      (!needle ||
        `${row.title} ${row.category} ${row.location ?? ""}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
  const ordered = [...filtered].sort((a, b) =>
    sort === "newest"
      ? b.checkedOn.localeCompare(a.checkedOn) || a.title.localeCompare(b.title)
      : sort === "oldest"
        ? a.checkedOn.localeCompare(b.checkedOn) ||
          a.title.localeCompare(b.title)
        : a.title.localeCompare(b.title),
  );
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize)),
    currentPage = Math.max(1, Math.min(page, pageCount));
  return {
    total: ordered.length,
    pageCount,
    currentPage,
    visible: ordered.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize,
    ),
  };
}
