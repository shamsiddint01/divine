import {
  type ControlDashboardDto,
  type ControlEventDto,
  type ControlLoginInput,
  type ControlSiteHealthDto,
  type ControlPaymentInput,
  type ControlSiteCreateInput,
  type ControlSiteDetailDto,
  type ControlSiteDto,
  type ControlSiteUpdateInput,
  isApiErrorBody,
  type SiteViewRequestStatus,
} from '@divine/shared';

export class PanelError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Panel sessiyasi HttpOnly cookie'da; so'rovlar shu manzilning `/api`si orqali o'tadi. */
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/control${path}`, {
      method,
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new PanelError(0, 'Server bilan aloqa yo‘q');
  }
  const payload: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = isApiErrorBody(payload)
      ? (payload.error.details?.[0]?.message ?? payload.error.message)
      : 'Server uyg‘onmoqda, birozdan keyin qayta urinib ko‘ring';
    throw new PanelError(response.status, message);
  }
  return payload as T;
}

export const panelApi = {
  login: (input: ControlLoginInput) => request<void>('/auth/login', 'POST', input),
  logout: () => request<void>('/auth/logout', 'POST'),
  sites: () => request<ControlSiteDto[]>('/sites'),
  dashboard: () => request<ControlDashboardDto>('/sites/dashboard'),
  health: () => request<ControlSiteHealthDto[]>('/sites/health'),
  events: (siteId?: string) =>
    request<ControlEventDto[]>(`/sites/events${siteId ? `?siteId=${siteId}` : ''}`),
  site: (id: string) => request<ControlSiteDetailDto>(`/sites/${id}`),
  createSite: (input: ControlSiteCreateInput) =>
    request<ControlSiteDetailDto>('/sites', 'POST', input),
  updateSite: (id: string, input: ControlSiteUpdateInput) =>
    request<ControlSiteDetailDto>(`/sites/${id}`, 'PATCH', input),
  addPayment: (id: string, input: ControlPaymentInput) =>
    request<ControlSiteDetailDto>(`/sites/${id}/payments`, 'POST', input),
  deletePayment: (id: string, paymentId: string) =>
    request<ControlSiteDetailDto>(`/sites/${id}/payments/${paymentId}`, 'DELETE'),
  sync: (id: string) => request<ControlSiteDetailDto>(`/sites/${id}/sync`, 'POST'),
  requestView: (id: string) =>
    request<{ id: string; expiresAt: string }>(`/sites/${id}/view-requests`, 'POST'),
  viewStatus: (id: string, requestId: string) =>
    request<{ status: SiteViewRequestStatus }>(`/sites/${id}/view-requests/${requestId}`),
  verifyView: (id: string, requestId: string, code: string) =>
    request<{ viewUrl: string }>(`/sites/${id}/view-requests/${requestId}/verify`, 'POST', {
      code,
    }),
};
