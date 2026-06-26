import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    prismaCalls: [] as string[],
    contactUpdates: [] as { where: unknown; data: unknown }[],
    contactCustomUpserts: [] as unknown[],
  },
}));

vi.mock("@/lib/prisma", () => {
  const { state } = h;

  return {
    prisma: {
      contact: {
        findFirst: async () => {
          state.prismaCalls.push("contacts.findFirst");
          return state.owned;
        },
        updateMany: async (args: { where: unknown; data: unknown }) => {
          state.prismaCalls.push("contacts.updateMany");
          state.contactUpdates.push(args);
          return { count: 1 };
        },
      },
      customField: {
        findFirst: async () => {
          state.prismaCalls.push("custom_fields.findFirst");
          return state.ownedCustomField;
        },
      },
      contactCustomValue: {
        upsert: async (args: unknown) => {
          state.prismaCalls.push("contact_custom_values.upsert");
          state.contactCustomUpserts.push(args);
          return {};
        },
      },
      automation: {
        findMany: async () => {
          state.prismaCalls.push("automations.findMany");
          return state.automations;
        },
      },
      automationLog: {
        create: async () => {
          state.prismaCalls.push("automation_logs.create");
          return { id: "log1" };
        },
        findUnique: async () => ({ stepsExecuted: [], status: "success" }),
        update: async () => ({}),
      },
      automationStep: {
        findMany: async () => {
          state.prismaCalls.push("automation_steps.findMany");
          return state.steps;
        },
      },
      $executeRaw: async () => ({}),
    },
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

import { runAutomationsForTrigger } from "./engine";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.automations = [];
  h.state.steps = [];
  h.state.prismaCalls = [];
  h.state.contactUpdates = [];
  h.state.contactCustomUpserts = [];
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    h.state.owned = null;
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    expect(h.state.prismaCalls).toContain("contacts.findFirst");
    expect(h.state.prismaCalls).not.toContain("automations.findMany");
    expect(h.state.contactUpdates).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.prismaCalls).toContain("automations.findMany");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.contactUpdates).toHaveLength(1);
    expect(h.state.contactUpdates[0].where).toEqual({
      id: "c1",
      accountId: ACCOUNT,
    });
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.contactUpdates).toHaveLength(0);
    expect(h.state.contactCustomUpserts).toHaveLength(1);
    expect(h.state.contactCustomUpserts[0]).toMatchObject({
      create: { contactId: "c1", customFieldId: "cf1", value: "Premium" },
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.contactCustomUpserts).toHaveLength(1);
    expect(h.state.contactCustomUpserts[0]).toMatchObject({
      create: { value: "WhatsApp Ad" },
    });
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null;
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.contactCustomUpserts).toHaveLength(0);
    expect(h.state.contactUpdates).toHaveLength(0);
  });
});

function automationWithUpdateStep() {
  return {
    id: "a1",
    accountId: ACCOUNT,
    userId: "u1",
    name: "test",
    triggerType: "new_message_received",
    triggerConfig: {},
    isActive: true,
    executionCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function updateStep() {
  return {
    id: "s1",
    automationId: "a1",
    stepType: "update_contact_field",
    position: 0,
    parentStepId: null,
    branch: null,
    stepConfig: { field: "company", value: "pwned-by-automation" },
    createdAt: new Date(),
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automationId: "a1",
    stepType: "update_contact_field",
    position: 0,
    parentStepId: null,
    branch: null,
    stepConfig: { field, value },
    createdAt: new Date(),
  };
}
