import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

export interface ListParamsOptions<F extends string> {
  defaultSort: string;
  defaultPageSize?: number;
  filterKeys?: readonly F[];
  /** Bir sahifada bir nechta ro'yxat bo'lsa, URL kalitlariga prefiks. */
  prefix?: string;
}

/**
 * Ro'yxat holati (sahifa, hajm, saralash, qidiruv, filtrlar) URL'da saqlanadi:
 * sahifa yangilansa yoki havola ulashilsa — holat saqlanib qoladi.
 * `query` — API'ga to'g'ridan-to'g'ri yuboriladigan obyekt (server-side pagination, REQ-091).
 */
export function useListParams<F extends string = never>(options: ListParamsOptions<F>) {
  const { defaultSort, defaultPageSize = 20, filterKeys = [], prefix = '' } = options;
  const [params, setParams] = useSearchParams();
  const k = useCallback((key: string) => `${prefix}${key}`, [prefix]);

  const page = Math.max(1, Number(params.get(k('page'))) || 1);
  const pageSize = Number(params.get(k('pageSize'))) || defaultPageSize;
  const sort = params.get(k('sort')) || defaultSort;
  const search = params.get(k('q')) ?? '';
  const filtersKey = filterKeys.map((f) => params.get(k(f)) ?? '').join('|');
  const filters = useMemo(
    () =>
      Object.fromEntries(filterKeys.map((f) => [f, params.get(k(f)) ?? ''])) as Record<F, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtersKey],
  );

  const update = useCallback(
    (changes: Record<string, string | number | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') next.delete(k(key));
            else next.set(k(key), String(value));
          }
          if (resetPage && !('page' in changes)) next.delete(k('page'));
          return next;
        },
        { replace: true },
      );
    },
    [setParams, k],
  );

  const activeFilterCount = filterKeys.filter((f) => filters[f]).length + (search ? 1 : 0);

  return {
    page,
    pageSize,
    sort,
    search,
    filters,
    activeFilterCount,
    setPage: (p: number) => update({ page: p === 1 ? null : p }, false),
    setPageSize: (size: number) => update({ pageSize: size === defaultPageSize ? null : size }),
    setSort: (value: string) => update({ sort: value === defaultSort ? null : value }),
    setSearch: (value: string) => update({ q: value }),
    setFilter: (key: F, value: string) => update({ [key]: value }),
    reset: () => update(Object.fromEntries([...filterKeys, 'q', 'sort'].map((f) => [f, null]))),
    query: { page, pageSize, sort, search, ...filters },
  };
}
