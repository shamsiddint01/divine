import { ERROR_MESSAGES_UZ } from '@divine/shared';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/uz';
import { ApiError, __httpRequestForTests as httpRequest, buildQueryString } from './api-client';

function mockFetch(response: Partial<Response> | Error) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (response instanceof Error) throw response;
    return response as Response;
  });
}

const json = (status: number, body: unknown): Partial<Response> => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('http API klient', () => {
  it('muvaffaqiyatli javobni qaytaradi va /api/v1 prefiksi hamda query qo‘shadi', async () => {
    const spy = mockFetch(json(200, { status: 'ok' }));
    await expect(httpRequest('/products', { query: { page: 2, search: '' } })).resolves.toEqual({
      status: 'ok',
    });
    expect(spy.mock.calls[0]?.[0]).toBe('/api/v1/products?page=2');
  });

  it('server xato strukturasini ApiError ga aylantiradi (o‘zbekcha xabar bilan)', async () => {
    mockFetch(
      json(409, {
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: 'Omborda yetarli mahsulot yo‘q',
          details: [{ field: 'items[0].quantity', message: 'Mavjud: 3 dona' }],
          requestId: 'req-1',
        },
      }),
    );
    const error = await httpRequest('/sales', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK', requestId: 'req-1' });
  });

  it('tarmoq xatosida o‘zbekcha xabar beradi', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    await expect(httpRequest('/health', {})).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: t.errors.network,
    });
  });

  it('noma’lum xato strukturasida texnik tafsilot ko‘rsatmaydi', async () => {
    mockFetch(json(500, '<html>Internal Server Error</html>'));
    await expect(httpRequest('/x', {})).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: ERROR_MESSAGES_UZ.INTERNAL_ERROR,
    });
  });

  it('acceptStatuses dagi status xato hisoblanmaydi', async () => {
    mockFetch(json(503, { status: 'degraded' }));
    await expect(httpRequest('/health', { acceptStatuses: [503] })).resolves.toEqual({
      status: 'degraded',
    });
  });

  it('query string bo‘sh qiymatlarni tashlaydi', () => {
    expect(buildQueryString({ a: 1, b: '', c: undefined, d: null, e: false })).toBe('?a=1&e=false');
    expect(buildQueryString({})).toBe('');
  });
});
