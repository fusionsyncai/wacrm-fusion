"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Star, Trash2 } from "lucide-react";

import { RequireRole } from "@/components/auth/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  modelsForProvider,
} from "@/lib/llm/models";
import type { AccountLlmConfig, LlmProvider } from "@/types";
import { SettingsPanelHead } from "./settings-panel-head";

type DraftState = Record<LlmProvider, { modelId: string; apiKey: string }>;

function emptyDrafts(): DraftState {
  return Object.fromEntries(
    LLM_PROVIDERS.map((p) => [
      p,
      { modelId: modelsForProvider(p)[0] ?? "", apiKey: "" },
    ]),
  ) as DraftState;
}

function ProviderCard({
  provider,
  config,
  draft,
  canEdit,
  busy,
  onDraftChange,
  onSave,
  onTest,
  onRemove,
  onSetDefault,
}: {
  provider: LlmProvider;
  config: AccountLlmConfig | undefined;
  draft: { modelId: string; apiKey: string };
  canEdit: boolean;
  busy: boolean;
  onDraftChange: (patch: Partial<{ modelId: string; apiKey: string }>) => void;
  onSave: (testAfter: boolean) => void;
  onTest: () => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  const models = modelsForProvider(provider);
  const connected = !!config?.has_api_key;
  const needsKey = !connected && !draft.apiKey.trim();

  return (
    <Card
      className={cn(
        connected && "border-primary/30",
        config?.is_default && "ring-1 ring-primary/40",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {LLM_PROVIDER_LABELS[provider]}
            </CardTitle>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {connected ? (
                <Badge variant="secondary" className="text-[10px]">
                  <Check className="mr-1 size-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  Not connected
                </Badge>
              )}
              {config?.is_default && (
                <Badge className="text-[10px]">
                  <Star className="mr-1 size-3" />
                  Default for agents
                </Badge>
              )}
            </div>
          </div>
          {connected && canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={onRemove}
              aria-label={`Remove ${LLM_PROVIDER_LABELS[provider]} key`}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Model</Label>
          <Select
            value={draft.modelId}
            onValueChange={(v) => v && onDraftChange({ modelId: v })}
            disabled={!canEdit || busy}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <RequireRole min="admin">
          <div className="grid gap-2">
            <Label htmlFor={`llm-key-${provider}`}>API key</Label>
            <Input
              id={`llm-key-${provider}`}
              type="password"
              autoComplete="off"
              placeholder={
                connected ? "Enter new key to replace saved key" : "Paste API key"
              }
              value={draft.apiKey}
              disabled={busy}
              onChange={(e) => onDraftChange({ apiKey: e.target.value })}
            />
          </div>
        </RequireRole>

        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only admins can manage API keys.
          </p>
        )}

        <RequireRole min="admin">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !draft.modelId || needsKey}
              onClick={() => onSave(false)}
            >
              {connected ? "Save changes" : "Connect"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !draft.modelId || needsKey}
              onClick={() => onSave(true)}
            >
              {connected ? "Save & test" : "Connect & test"}
            </Button>
            {connected && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onTest}
              >
                Test
              </Button>
            )}
            {connected && !config?.is_default && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onSetDefault}
              >
                Use for agents
              </Button>
            )}
          </div>
        </RequireRole>
      </CardContent>
    </Card>
  );
}

export function LlmConfigPanel() {
  const { canEditSettings } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<LlmProvider | null>(null);
  const [configs, setConfigs] = useState<AccountLlmConfig[]>([]);
  const [drafts, setDrafts] = useState<DraftState>(emptyDrafts);

  const configByProvider = useMemo(() => {
    const map = new Map<LlmProvider, AccountLlmConfig>();
    for (const c of configs) map.set(c.provider, c);
    return map;
  }, [configs]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/llm-config", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || "Failed to load LLM settings");
        return;
      }
      const data = (await res.json()) as { configs: AccountLlmConfig[] };
      const list = data.configs ?? [];
      setConfigs(list);

      setDrafts((prev) => {
        const next = { ...prev };
        for (const p of LLM_PROVIDERS) {
          const saved = list.find((c) => c.provider === p);
          next[p] = {
            modelId: saved?.model_id ?? modelsForProvider(p)[0] ?? "",
            apiKey: "",
          };
        }
        return next;
      });
    } catch (err) {
      console.error("[LlmConfigPanel] load error:", err);
      toast.error("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProvider(provider: LlmProvider, testAfter: boolean) {
    if (!canEditSettings) return;
    const draft = drafts[provider];
    setBusyProvider(provider);
    try {
      const res = await fetch("/api/account/llm-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model_id: draft.modelId,
          ...(draft.apiKey.trim() ? { api_key: draft.apiKey.trim() } : {}),
          test_connection: testAfter,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to save");
        return;
      }
      setDrafts((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], apiKey: "" },
      }));
      await load();
      toast.success(
        testAfter ? `${LLM_PROVIDER_LABELS[provider]} connected and verified` : "Saved",
      );
    } catch (err) {
      console.error("[LlmConfigPanel] save error:", err);
      toast.error("Could not reach the server");
    } finally {
      setBusyProvider(null);
    }
  }

  async function testProvider(provider: LlmProvider) {
    setBusyProvider(provider);
    try {
      const res = await fetch("/api/account/llm-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", provider }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Connection test failed");
        return;
      }
      toast.success(`${LLM_PROVIDER_LABELS[provider]} connection OK`);
    } catch (err) {
      console.error("[LlmConfigPanel] test error:", err);
      toast.error("Could not reach the server");
    } finally {
      setBusyProvider(null);
    }
  }

  async function removeProvider(provider: LlmProvider) {
    if (!canEditSettings) return;
    setBusyProvider(provider);
    try {
      const res = await fetch("/api/account/llm-config", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to remove");
        return;
      }
      await load();
      toast.success(`${LLM_PROVIDER_LABELS[provider]} disconnected`);
    } catch (err) {
      console.error("[LlmConfigPanel] remove error:", err);
      toast.error("Could not reach the server");
    } finally {
      setBusyProvider(null);
    }
  }

  async function setDefaultProvider(provider: LlmProvider) {
    if (!canEditSettings) return;
    setBusyProvider(provider);
    try {
      const res = await fetch("/api/account/llm-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_default", provider }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || "Failed to set default");
        return;
      }
      await load();
      toast.success(`${LLM_PROVIDER_LABELS[provider]} is now the default for agents`);
    } catch (err) {
      console.error("[LlmConfigPanel] set default error:", err);
      toast.error("Could not reach the server");
    } finally {
      setBusyProvider(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading AI settings…
      </div>
    );
  }

  const connectedCount = configs.filter((c) => c.has_api_key).length;

  return (
    <div>
      <SettingsPanelHead
        title="AI & LLM"
        description="Connect one or more providers. Agents use the provider marked as default."
      />

      {connectedCount === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          No providers connected yet. Add an API key on any card below to enable AI agents.
        </p>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {LLM_PROVIDERS.map((provider) => (
          <ProviderCard
            key={provider}
            provider={provider}
            config={configByProvider.get(provider)}
            draft={drafts[provider]}
            canEdit={canEditSettings}
            busy={busyProvider === provider}
            onDraftChange={(patch) =>
              setDrafts((prev) => ({
                ...prev,
                [provider]: { ...prev[provider], ...patch },
              }))
            }
            onSave={(testAfter) => void saveProvider(provider, testAfter)}
            onTest={() => void testProvider(provider)}
            onRemove={() => void removeProvider(provider)}
            onSetDefault={() => void setDefaultProvider(provider)}
          />
        ))}
      </div>
    </div>
  );
}
