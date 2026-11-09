import React, { useState, useMemo } from 'react';
import { Search, ChevronLeft, ChevronRight, Inbox, ArrowUpDown } from 'lucide-react';

export interface Column<T> {
  header: string;
  accessor?: keyof T | ((row: T) => React.ReactNode);
  sortable?: boolean;
  className?: string;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (row: T) => string;
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  filterComponent?: React.ReactNode;
  actions?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  isLoading?: boolean;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  searchPlaceholder = 'Search records...',
  searchFilter,
  filterComponent,
  actions,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no items to display matching the criteria.',
  onRowClick,
  pageSize = 10,
  isLoading = false,
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumnIndex, setSortColumnIndex] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Filtered dataset
  const filteredData = useMemo(() => {
    if (!searchQuery.trim() || !searchFilter) return data;
    return data.filter((item) => searchFilter(item, searchQuery.trim()));
  }, [data, searchQuery, searchFilter]);

  // Sorted dataset
  const sortedData = useMemo(() => {
    if (sortColumnIndex === null) return filteredData;
    const col = columns[sortColumnIndex];
    if (!col || !col.accessor) return filteredData;

    return [...filteredData].sort((a, b) => {
      let valA: any = typeof col.accessor === 'function' ? col.accessor(a) : a[col.accessor as keyof T];
      let valB: any = typeof col.accessor === 'function' ? col.accessor(b) : b[col.accessor as keyof T];

      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDirection === 'asc' ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
    });
  }, [filteredData, sortColumnIndex, sortDirection, columns]);

  // Paginated data
  const totalPages = Math.ceil(sortedData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const handleSort = (index: number) => {
    if (sortColumnIndex === index) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumnIndex(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumnIndex(index);
      setSortDirection('asc');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Top Search & Filter Bar */}
      {(searchFilter || filterComponent || actions) && (
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex flex-1 items-center gap-3">
            {searchFilter && (
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-800 placeholder:text-slate-400"
                />
              </div>
            )}
            {filterComponent}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  onClick={() => col.sortable && handleSort(idx)}
                  className={`py-3 px-4 ${col.className || ''} ${
                    col.sortable ? 'cursor-pointer hover:bg-slate-100 transition-colors select-none' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{col.header}</span>
                    {col.sortable && (
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs">Loading records...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center">
                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-slate-400">
                    <Inbox className="w-10 h-10 stroke-1 mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-700 text-sm">{emptyTitle}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{emptyDescription}</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedData.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  onClick={() => onRowClick && onRowClick(row)}
                  className={`transition-colors ${
                    onRowClick ? 'cursor-pointer hover:bg-indigo-50/40' : 'hover:bg-slate-50/60'
                  }`}
                >
                  {columns.map((col, cIdx) => (
                    <td key={cIdx} className={`py-3.5 px-4 text-slate-700 ${col.className || ''}`}>
                      {col.render
                        ? col.render(row)
                        : col.accessor
                        ? typeof col.accessor === 'function'
                          ? col.accessor(row)
                          : (row[col.accessor as keyof T] as unknown as React.ReactNode)
                        : null}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {!isLoading && sortedData.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 bg-slate-50/40">
          <div>
            Showing <span className="font-semibold text-slate-700">{(currentPage - 1) * pageSize + 1}</span> to{' '}
            <span className="font-semibold text-slate-700">
              {Math.min(currentPage * pageSize, sortedData.length)}
            </span>{' '}
            of <span className="font-semibold text-slate-700">{sortedData.length}</span> records
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-medium text-slate-700">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
