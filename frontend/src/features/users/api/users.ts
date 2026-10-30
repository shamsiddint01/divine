import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserStatus } from '@divine/shared';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type {
  Paginated,
  PasswordResetResponse,
  UserCreatedResponse,
  UserDto,
  UserInput,
  WarehouseOption,
} from '@/shared/types/api';

export const userKeys = {
  all: ['users'] as const,
  list: (q: Record<string, QueryValue>) => [...userKeys.all, 'list', q] as const,
  options: () => [...userKeys.all, 'options'] as const,
  warehouseOptions: () => [...userKeys.all, 'warehouse-options'] as const,
};

export function useUsers(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: userKeys.list(query),
    queryFn: ({ signal }) => apiRequest<Paginated<UserDto>>('/users', { signal, query }),
    placeholderData: keepPreviousData,
  });
}

export function useUserOptions(enabled = true) {
  return useQuery({
    enabled,
    queryKey: userKeys.options(),
    queryFn: ({ signal }) =>
      apiRequest<Paginated<UserDto>>('/users', {
        signal,
        query: { pageSize: 100, sort: 'login:asc' },
      }),
    select: (res) => res.data,
    staleTime: 60_000,
  });
}

/** User formasidagi ombor tanlovi: faqat ACTIVE omborlar (users moduli endpointi — API §4). */
export function useWarehouseOptions(enabled = true) {
  return useQuery({
    queryKey: userKeys.warehouseOptions(),
    queryFn: ({ signal }) => apiRequest<WarehouseOption[]>('/users/warehouse-options', { signal }),
    enabled,
    staleTime: 60_000,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UserInput) =>
      apiRequest<UserCreatedResponse>('/users', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<UserInput, 'login'>> }) =>
      apiRequest<UserDto>(`/users/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useSetUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      apiRequest<UserDto>(`/users/${id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<PasswordResetResponse>(`/users/${id}/reset-password`, { method: 'POST' }),
    // Lockout tozalanadi — ro'yxatdagi "vaqtincha cheklangan" belgisi yangilansin.
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}
