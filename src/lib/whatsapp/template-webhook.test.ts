import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from './template-webhook';

const updateMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageTemplate: {
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));

describe('isTemplateWebhookField', () => {
  it('recognises the three template fields', () => {
    expect(isTemplateWebhookField('message_template_status_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_quality_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_components_update')).toBe(
      true,
    );
  });
  it('rejects messaging fields', () => {
    expect(isTemplateWebhookField('messages')).toBe(false);
    expect(isTemplateWebhookField('message_status')).toBe(false);
  });
});

describe('handleTemplateWebhookChange — status update', () => {
  beforeEach(() => {
    updateMany.mockReset();
    updateMany.mockResolvedValue({ count: 1 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('flips status to APPROVED and clears any rejection_reason', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: {
        event: 'APPROVED',
        message_template_id: 12345,
        message_template_name: 'order_confirmation',
        message_template_language: 'en_US',
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { metaTemplateId: '12345' },
      data: {
        status: 'APPROVED',
        rejectionReason: null,
        submissionError: null,
      },
    });
  });

  it('persists the reason field on REJECTED', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: {
        event: 'REJECTED',
        message_template_id: 'TMPL_99',
        reason: 'Template uses non-compliant language.',
      },
    });
    expect(updateMany.mock.calls[0][0].data.status).toBe('REJECTED');
    expect(updateMany.mock.calls[0][0].data.rejectionReason).toBe(
      'Template uses non-compliant language.',
    );
  });

  it('falls back to a generic reason when REJECTED has no `reason`', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: { event: 'REJECTED', message_template_id: '7' },
    });
    expect(updateMany.mock.calls[0][0].data.rejectionReason).toBe('Rejected by Meta');
  });

  it('normalises PENDING_REVIEW → PENDING (via shared normalizeStatus)', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: { event: 'PENDING_REVIEW', message_template_id: '1' },
    });
    expect(updateMany.mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('logs and exits when meta_template_id is missing (no UPDATE issued)', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: { event: 'APPROVED' },
    });
    expect(updateMany).toHaveLength(0);
  });

  it('logs a warning when the row is unknown locally (zero matches)', async () => {
    const warn = vi.spyOn(console, 'warn');
    updateMany.mockResolvedValue({ count: 0 });
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: {
        event: 'APPROVED',
        message_template_id: 'NEVER_SEEN',
        message_template_name: 'mystery',
      },
    });
    expect(warn).toHaveBeenCalled();
  });
});

describe('handleTemplateWebhookChange — quality update', () => {
  beforeEach(() => {
    updateMany.mockReset();
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('sets quality_score from new_quality_score', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_quality_update',
      value: {
        message_template_id: '99',
        previous_quality_score: 'GREEN',
        new_quality_score: 'YELLOW',
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { metaTemplateId: '99' },
      data: { qualityScore: 'YELLOW' },
    });
  });

  it('stores null for unrecognised quality scores', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_quality_update',
      value: {
        message_template_id: '99',
        new_quality_score: 'PURPLE',
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { metaTemplateId: '99' },
      data: { qualityScore: null },
    });
  });
});

describe('handleTemplateWebhookChange — components update', () => {
  it('is an info-log no-op (does not write to DB)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    updateMany.mockReset();
    await handleTemplateWebhookChange({
      field: 'message_template_components_update',
      value: {
        message_template_id: '5',
        message_template_name: 'x',
      },
    });
    expect(updateMany).toHaveLength(0);
    expect(info).toHaveBeenCalled();
  });
});

describe('handleTemplateWebhookChange — unknown field', () => {
  it('is a defensive no-op', async () => {
    updateMany.mockReset();
    await handleTemplateWebhookChange(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { field: 'message_template_future_field' as any, value: {} },
    );
    expect(updateMany).toHaveLength(0);
  });
});
