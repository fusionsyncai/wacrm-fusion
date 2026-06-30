import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getWabaIdFromPhoneNumber,
  getWabaIdsFromAccessToken,
  listMessageTemplates,
  resolveWabaId,
} from './meta-api';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('getWabaIdsFromAccessToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubEnv('META_APP_SECRET', 'secret-1');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reads WABA ids from debug_token granular_scopes', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: {
          granular_scopes: [
            {
              scope: 'whatsapp_business_management',
              target_ids: ['WABA_REAL', 'WABA_OLD'],
            },
          ],
        },
      }),
    );

    await expect(getWabaIdsFromAccessToken('user-tok')).resolves.toEqual([
      'WABA_REAL',
      'WABA_OLD',
    ]);

    expect(fetchMock.mock.calls[0][0]).toContain('/debug_token');
    expect(fetchMock.mock.calls[0][1]?.headers?.Authorization).toBe(
      'Bearer app-1|secret-1',
    );
  });
});

describe('getWabaIdFromPhoneNumber', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubEnv('META_APP_SECRET', 'secret-1');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('matches WABA via debug_token + phone_numbers + message_templates', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okResponse({
          data: {
            granular_scopes: [
              {
                scope: 'whatsapp_business_management',
                target_ids: ['WABA_REAL'],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(okResponse({ data: [] }))
      .mockResolvedValueOnce(
        okResponse({
          data: [{ id: 'PHONE1' }],
        }),
      );

    await expect(
      getWabaIdFromPhoneNumber({
        phoneNumberId: 'PHONE1',
        accessToken: 'tok',
      }),
    ).resolves.toBe('WABA_REAL');

    expect(fetchMock.mock.calls[1][0]).toContain('/WABA_REAL/message_templates');
    expect(fetchMock.mock.calls[2][0]).toContain('/WABA_REAL/phone_numbers');
  });
});

describe('resolveWabaId', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubEnv('META_APP_SECRET', 'secret-1');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns a saved WABA ID without calling Meta', async () => {
    await expect(
      resolveWabaId({
        phoneNumberId: 'PHONE1',
        accessToken: 'tok',
        storedWabaId: 'WABA_SAVED',
      }),
    ).resolves.toBe('WABA_SAVED');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auto-discovers via debug_token when stored ID equals phone number ID', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okResponse({
          data: {
            granular_scopes: [
              {
                scope: 'whatsapp_business_management',
                target_ids: ['WABA_REAL'],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(okResponse({ data: [] }))
      .mockResolvedValueOnce(
        okResponse({
          data: [{ id: 'PHONE1' }],
        }),
      );

    await expect(
      resolveWabaId({
        phoneNumberId: 'PHONE1',
        accessToken: 'tok',
        storedWabaId: 'PHONE1',
      }),
    ).resolves.toBe('WABA_REAL');

    expect(fetchMock.mock.calls[0][0]).toContain('/debug_token');
  });
});

describe('listMessageTemplates', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: [{ id: '1', name: 'hello', language: 'en_US', status: 'APPROVED', category: 'UTILITY' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs /{wabaId}/message_templates with fields', async () => {
    const result = await listMessageTemplates({
      wabaId: 'WABA1',
      accessToken: 'tok',
    });

    expect(result.templates).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/WABA1/message_templates');
    expect(fetchMock.mock.calls[0][0]).toContain('fields=');
  });
});
