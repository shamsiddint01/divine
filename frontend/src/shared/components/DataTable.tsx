import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { t } from '@/i18n/uz';
import { PHONE_QUERY, useMediaQuery } from '@/shared/hooks/use-media-query';
import { cn } from '@/shared/lib/utils';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { ErrorState } from './ErrorState';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Server saralash maydoni (`?sort=<sortKey>:asc|desc`). */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Kichik ekranlarda yashirish (responsive). */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  empty?: ReactNode;
  sort?: string;
  onSortChange?: (sort: string) => void;
  onRowClick?: (row: T) => void;
  /** Tanlangan qator (masalan, detal paneli ochiq bo'lgan yozuv). */
  selectedKey?: string | null;
  skeletonRows?: number;
  footer?: ReactNode;
  /**
   * Telefonda jadval o'rniga kartalar: birinchi ustun — sarlavha, qolgan BARCHA ustunlar (keng ekranda
   * yashiriladiganlari ham) — "nom: qiymat". Ko'p raqamli ustunli jadvallar (hisobotlar) uchun: aks holda
   * asosiy summalar ekrandan tashqarida qoladi.
   */
  mobileCards?: boolean;
}

const HIDE: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
  '2xl': 'hidden 2xl:table-cell',
};

/**
 * Umumiy jadval: saralanadigan sarlavhalar, loading skeleton, bo'sh va xato holatlari.
 * Ma'lumotni server qaytaradi (filtr, saralash, pagination — server-side).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  empty,
  sort,
  onSortChange,
  onRowClick,
  selectedKey,
  skeletonRows = 8,
  footer,
  mobileCards = false,
}: DataTableProps<T>) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  if (error && !rows) {
    return <ErrorState message={error.message || t.errors.unexpected} onRetry={onRetry} />;
  }
  const [sortField, sortDir] = (sort ?? '').split(':');

  const toggleSort = (key: string) => {
    if (!onSortChange) return;
    onSortChange(sortField === key && sortDir === 'asc' ? `${key}:desc` : `${key}:asc`);
  };

  const alignClass = (align?: Column<T>['align']) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : undefined;
  // Telefonda matn ustunlari (chapga tekislangan) qatorga o'tadi — aks holda uzun nom jadvalni ekrandan
  // kengaytirib, raqam ustunlarini ko'rinmas qiladi. Raqam ustunlari (o'ngga/markazga) bir qatorda qoladi.
  const wrapClass = (align?: Column<T>['align']) =>
    !align || align === 'left'
      ? 'max-sm:min-w-20 max-sm:whitespace-normal max-sm:break-words'
      : undefined;

  if (mobileCards && isPhone) {
    const [title, ...rest] = columns;
    const fields = rest.filter((c) => c.header);
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <ul className={cn('divide-y', isLoading && rows && 'opacity-60 transition-opacity')}>
          {isLoading && !rows
            ? Array.from({ length: Math.min(skeletonRows, 4) }, (_, i) => (
                <li key={i} className="space-y-2 px-4 py-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </li>
              ))
            : rows?.map((row) => (
                <li
                  key={rowKey(row)}
                  className={cn(
                    'space-y-2 px-4 py-3',
                    onRowClick && 'cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-2',
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e: KeyboardEvent) => {
                          if (e.key === 'Enter') onRowClick(row);
                        }
                      : undefined
                  }
                >
                  {title ? <div className="text-sm font-medium break-words">{title.cell(row)}</div> : null}
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    {fields.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-muted-foreground">{c.header}</dt>
                        <dd className="font-medium break-words">{c.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
        </ul>
        {rows && rows.length === 0 && !isLoading ? <div className="p-6">{empty}</div> : null}
        {footer ? <div className="border-t px-3 py-3">{footer}</div> : null}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead
                key={c.key}
                className={cn(
                  alignClass(c.align),
                  wrapClass(c.align),
                  c.hideBelow && HIDE[c.hideBelow],
                  c.className,
                )}
                aria-sort={
                  c.sortKey && sortField === c.sortKey
                    ? sortDir === 'desc'
                      ? 'descending'
                      : 'ascending'
                    : undefined
                }
              >
                {c.sortKey && onSortChange ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(c.sortKey as string)}
                    className={cn(
                      '-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground',
                      sortField === c.sortKey && 'text-foreground',
                    )}
                    aria-label={t.table.sortBy(c.header)}
                  >
                    {c.header}
                    {sortField === c.sortKey ? (
                      sortDir === 'desc' ? (
                        <ArrowDown className="size-3.5" />
                      ) : (
                        <ArrowUp className="size-3.5" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3.5 opacity-40" />
                    )}
                  </button>
                ) : (
                  c.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(isLoading && rows && 'opacity-60 transition-opacity')}>
          {isLoading && !rows
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn(c.hideBelow && HIDE[c.hideBelow])}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows?.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  data-state={selectedKey && selectedKey === rowKey(row) ? 'selected' : undefined}
                  className={cn(
                    onRowClick &&
                      'cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e: KeyboardEvent) => {
                          if (e.key === 'Enter') onRowClick(row);
                        }
                      : undefined
                  }
                >
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        alignClass(c.align),
                        wrapClass(c.align),
                        c.hideBelow && HIDE[c.hideBelow],
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
      {rows && rows.length === 0 && !isLoading ? <div className="border-t p-6">{empty}</div> : null}
      {footer ? <div className="border-t px-3 py-3">{footer}</div> : null}
    </div>
  );
}
