import type {
  AnnouncementDto,
  SupportErrorInput,
  SupportTicketCreateInput,
  SupportTicketDto,
} from '@divine/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/lib/api-client';
import { apiMode } from '@/shared/lib/api-mode';

const TICKETS_KEY = ['support', 'tickets'] as const;
const live = apiMode === 'http';

export function useMyTickets() {
  return useQuery({
    queryKey: TICKETS_KEY,
    queryFn: ({ signal }) => apiRequest<SupportTicketDto[]>('/support/tickets', { signal }),
    enabled: live,
    refetchInterval: 60_000,
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SupportTicketCreateInput) =>
      apiRequest<SupportTicketDto>('/support/tickets', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TICKETS_KEY }),
  });
}

export function useReplyTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiRequest<SupportTicketDto>(`/support/tickets/${id}/replies`, {
        method: 'POST',
        body: { body },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TICKETS_KEY }),
  });
}

export function useAnnouncement() {
  return useQuery({
    queryKey: ['support', 'announcement'],
    queryFn: ({ signal }) => apiRequest<AnnouncementDto | null>('/support/announcement', { signal }),
    enabled: live,
    staleTime: 5 * 60_000,
  });
}

export function sendFeedback(topic: string, helpful: boolean): void {
  if (!live) return;
  void apiRequest<void>('/support/feedback', { method: 'POST', body: { topic, helpful } }).catch(
    () => undefined,
  );
}

const reported = new Map<string, number>();
const REPORT_EVERY_MS = 60_000;

/** Sahifa yoki server xatosi: foydalanuvchi hech narsa bosmasa ham egasiga boradi (daqiqada bir marta). */
export function reportError(input: SupportErrorInput): void {
  if (!live) return;
  const key = `${input.errorCode ?? ''}|${input.page ?? ''}|${input.message}`;
  const last = reported.get(key) ?? 0;
  if (Date.now() - last < REPORT_EVERY_MS) return;
  reported.set(key, Date.now());
  void apiRequest<void>('/support/errors', {
    method: 'POST',
    body: { ...input, message: input.message.slice(0, 2000) },
  }).catch(() => undefined);
}
