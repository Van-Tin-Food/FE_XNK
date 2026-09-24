export interface PaginatedResult<T> {
  items: T[];
  totalPages: number;
  safePage: number;
  from: number;
  to: number;
  total: number;
}

export function paginateItems<T>(items: T[], page: number, pageSize: number): PaginatedResult<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize) || 1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * safePageSize;

  return {
    items: items.slice(start, start + safePageSize),
    totalPages,
    safePage,
    from: total > 0 ? start + 1 : 0,
    to: Math.min(start + safePageSize, total),
    total,
  };
}