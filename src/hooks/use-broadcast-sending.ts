'use client';

import { useState } from 'react';
import { fetchJson } from '@/lib/api/fetch-json';
import { useAuth } from '@/hooks/use-auth';
import { Contact, MessageTemplate } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}

export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  headerMediaUrl?: string;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;
const INSERT_BATCH_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

type CustomValueIndex = Map<string, Map<string, string>>;

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    return customValues?.get(v.value) ?? '';
  });
}

async function fetchCustomValueIndex(contactIds: string[]): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { values } = await fetchJson<{
      values: Array<{ contact_id: string; custom_field_id: string; value: string | null }>;
    }>(`/api/data/contact-custom-values?contact_ids=${slice.join(',')}`);

    for (const row of values ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { user, accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      const { contacts: data } = await fetchJson<{ contacts: Contact[] }>(
        '/api/data/contacts?page=0&page_size=100',
      );
      contacts = data ?? [];
    } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
      const { rows } = await fetchJson<{
        rows: Array<{ contact: Contact; total_count: number }>;
      }>('/api/data/contacts/filter-by-tags', {
        method: 'POST',
        body: JSON.stringify({ tag_ids: audience.tagIds, limit: 10000, offset: 0 }),
      });
      contacts = (rows ?? []).map((r) => r.contact);
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(audience.csvContacts);
    }

    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const { contact_tags: excludeRows } = await fetchJson<{
        contact_tags: Array<{ contact_id: string }>;
      }>(`/api/data/contact-tags?tag_ids=${audience.excludeTagIds.join(',')}`);
      const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts;
  }

  async function upsertCsvContacts(
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];
    if (!user) throw new Error('You are not signed in.');
    if (!accountId) throw new Error('Your profile is not linked to an account.');

    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    const { contacts: existing } = await fetchJson<{ contacts: Contact[] }>(
      `/api/data/contacts?phones=${encodeURIComponent(phones.join(','))}`,
    );

    const byPhone = new Map<string, Contact>();
    for (const c of existing ?? []) {
      if (c.phone) byPhone.set(c.phone, c);
    }

    const missing = phones.filter((p) => !byPhone.has(p));

    for (const phone of missing) {
      try {
        const { contact } = await fetchJson<{ contact: Contact }>('/api/data/contacts', {
          method: 'POST',
          body: JSON.stringify({
            phone,
            name: uniqueByPhone.get(phone)?.name ?? null,
          }),
        });
        if (contact.phone) byPhone.set(contact.phone, contact);
      } catch {
        // Skip failed inserts — may be duplicate race.
      }
    }

    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(filter: CustomFieldFilter): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;
    const params = new URLSearchParams({
      custom_field_id: fieldId,
      operator,
      value,
    });
    const { values: matches } = await fetchJson<{
      values: Array<{ contact_id: string }>;
    }>(`/api/data/contact-custom-values?${params}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    const { contacts: data } = await fetchJson<{ contacts: Contact[] }>(
      `/api/data/contacts?contact_ids=${contactIds.join(',')}`,
    );
    return data ?? [];
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    try {
      if (!user) throw new Error('You are not signed in.');
      if (!accountId) throw new Error('Your profile is not linked to an account.');

      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      setProgress(10);
      const { broadcast } = await fetchJson<{ broadcast: { id: string } }>(
        '/api/data/broadcasts',
        {
          method: 'POST',
          body: JSON.stringify({
            name: payload.name,
            template_name: payload.template.name,
            template_language: payload.template.language ?? 'en_US',
            template_variables: payload.variables,
            audience_filter: {
              type: payload.audience.type,
              tagIds: payload.audience.tagIds,
              customField: payload.audience.customField,
              excludeTagIds: payload.audience.excludeTagIds,
            },
            status: 'sending',
            total_recipients: contacts.length,
          }),
        },
      );

      setProgress(20);
      const recipientRows = contacts.map((contact) => ({
        contact_id: contact.id,
        status: 'pending' as const,
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        try {
          await fetchJson('/api/data/broadcast-recipients', {
            method: 'POST',
            body: JSON.stringify({
              broadcast_id: broadcast.id,
              recipients: batch,
            }),
          });
        } catch (err) {
          await fetchJson(`/api/data/broadcasts/${broadcast.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'failed', failed_count: contacts.length }),
          });
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        }
      }

      setProgress(30);
      const { recipients } = await fetchJson<{
        recipients: Array<{
          id: string;
          contact?: Contact | null;
        }>;
      }>(`/api/data/broadcast-recipients?broadcast_id=${broadcast.id}`);

      const contactIds = (recipients ?? [])
        .map((r) => r.contact?.id)
        .filter((id): id is string => Boolean(id));
      const customValueIndex = await fetchCustomValueIndex(contactIds);

      let failedCount = 0;
      const totalRecipients = recipients?.length ?? 0;

      const headerType = payload.template.header_type;
      const isMediaHeader =
        headerType === 'image' ||
        headerType === 'video' ||
        headerType === 'document';
      const headerMediaUrl = payload.headerMediaUrl?.trim();
      const messageParams =
        isMediaHeader && headerMediaUrl ? { headerMediaUrl } : undefined;

      for (let i = 0; i < (recipients ?? []).length; i += SEND_BATCH_SIZE) {
        const batch = (recipients ?? []).slice(i, i + SEND_BATCH_SIZE);

        const apiRecipients = batch
          .filter((r) => r.contact?.phone)
          .map((r) => ({
            phone: r.contact!.phone as string,
            params: r.contact
              ? resolveVariables(
                  payload.variables,
                  r.contact,
                  customValueIndex.get(r.contact.id),
                )
              : [],
            ...(messageParams ? { messageParams } : {}),
          }));

        if (apiRecipients.length === 0) continue;

        try {
          const res = await fetch('/api/whatsapp/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipients: apiRecipients,
              template_name: payload.template.name,
              template_language: payload.template.language ?? 'en_US',
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Broadcast API request failed');
          }

          const resultsByPhone = new Map<string, BroadcastApiResult>();
          for (const r of (data.results ?? []) as BroadcastApiResult[]) {
            resultsByPhone.set(r.phone, r);
          }

          for (const recipient of batch) {
            const phone = recipient.contact?.phone;
            const result = phone ? resultsByPhone.get(phone) : undefined;

            if (!result) {
              failedCount++;
              await fetchJson('/api/data/broadcast-recipients', {
                method: 'PATCH',
                body: JSON.stringify({
                  id: recipient.id,
                  status: 'failed',
                  error_message: 'No phone number on contact',
                }),
              });
              continue;
            }

            if (result.status === 'sent') {
              await fetchJson('/api/data/broadcast-recipients', {
                method: 'PATCH',
                body: JSON.stringify({
                  id: recipient.id,
                  status: 'sent',
                  sent_at: new Date().toISOString(),
                  whatsapp_message_id: result.whatsapp_message_id ?? null,
                  error_message: null,
                }),
              });
            } else {
              failedCount++;
              await fetchJson('/api/data/broadcast-recipients', {
                method: 'PATCH',
                body: JSON.stringify({
                  id: recipient.id,
                  status: 'failed',
                  error_message: result.error ?? 'Unknown error',
                }),
              });
            }
          }
        } catch (err) {
          for (const recipient of batch) {
            failedCount++;
            await fetchJson('/api/data/broadcast-recipients', {
              method: 'PATCH',
              body: JSON.stringify({
                id: recipient.id,
                status: 'failed',
                error_message: err instanceof Error ? err.message : 'Unknown error',
              }),
            });
          }
        }

        const progressPct =
          30 + Math.round(((i + batch.length) / totalRecipients) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < totalRecipients) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      await fetchJson(`/api/data/broadcasts/${broadcast.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: finalStatus }),
      });

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
