"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Trash2 } from "lucide-react";

import { RequireRole } from "@/components/auth/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AccountLivekitConfig } from "@/types";
import { SettingsPanelHead } from "./settings-panel-head";

const DEFAULT_AGENT_NAME = "wacrm-voice";

export function LivekitConfigPanel() {
  const [config, setConfig] = useState<AccountLivekitConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [livekitUrl, setLivekitUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account/livekit-config", { cache: "no-store" });
      const body = (await res.json()) as { config: AccountLivekitConfig | null };
      setConfig(body.config);
      if (body.config) {
        setLivekitUrl(body.config.livekit_url);
        setAgentName(body.config.agent_name || DEFAULT_AGENT_NAME);
      }
    } catch (err) {
      console.error("[LivekitConfigPanel] load error:", err);
      toast.error("Could not load LiveKit settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(testConnection: boolean) {
    if (!livekitUrl.trim()) {
      toast.error("LiveKit URL is required");
      return;
    }
    if (!config?.has_api_key && !apiKey.trim()) {
      toast.error("API key is required");
      return;
    }
    if (!config?.has_api_secret && !apiSecret.trim()) {
      toast.error("API secret is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/account/livekit-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          livekit_url: livekitUrl.trim(),
          api_key: apiKey.trim() || undefined,
          api_secret: apiSecret.trim() || undefined,
          agent_name: agentName.trim() || DEFAULT_AGENT_NAME,
          test_connection: testConnection,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to save LiveKit settings");
        await load();
        return;
      }
      setConfig(body.config);
      setApiKey("");
      setApiSecret("");
      toast.success(
        testConnection ? "LiveKit connected successfully" : "LiveKit settings saved",
      );
    } catch (err) {
      console.error("[LivekitConfigPanel] save error:", err);
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  async function removeConfig() {
    setSaving(true);
    try {
      const res = await fetch("/api/account/livekit-config", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to remove LiveKit settings");
        return;
      }
      setConfig(null);
      setLivekitUrl("");
      setApiKey("");
      setApiSecret("");
      setAgentName(DEFAULT_AGENT_NAME);
      toast.success("LiveKit settings removed");
    } catch (err) {
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  const connected = config?.setup_status === "ready";
  const hasError = config?.setup_status === "error";

  return (
    <RequireRole min="admin">
      <SettingsPanelHead
        title="LiveKit voice"
        description="Connect your LiveKit Cloud project for WhatsApp voice agents. Each workspace uses its own LiveKit project and worker."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading LiveKit settings…
        </div>
      ) : (
        <Card
          className={cn(
            connected && "border-primary/30",
            hasError && "border-destructive/40",
          )}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">LiveKit Cloud</CardTitle>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {connected ? (
                    <Badge variant="secondary" className="text-[10px]">
                      <Check className="mr-1 size-3" />
                      Ready for voice calls
                    </Badge>
                  ) : hasError ? (
                    <Badge variant="destructive" className="text-[10px]">
                      Connection error
                    </Badge>
                  ) : config ? (
                    <Badge variant="outline" className="text-[10px]">
                      Saved — test connection to verify
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      Not configured
                    </Badge>
                  )}
                </div>
              </div>
              {config && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={saving}
                  onClick={() => void removeConfig()}
                  aria-label="Remove LiveKit settings"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasError && config?.setup_error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {config.setup_error}
              </p>
            )}

            <div className="grid gap-2">
              <Label htmlFor="livekit-url">LiveKit URL</Label>
              <Input
                id="livekit-url"
                value={livekitUrl}
                onChange={(e) => setLivekitUrl(e.target.value)}
                placeholder="wss://your-project.livekit.cloud"
              />
              <p className="text-xs text-muted-foreground">
                From LiveKit Cloud → Project settings → Keys &amp; URLs.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="livekit-api-key">API key</Label>
                <Input
                  id="livekit-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={config?.has_api_key ? "••••••••" : "API key"}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="livekit-api-secret">API secret</Label>
                <Input
                  id="livekit-api-secret"
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder={config?.has_api_secret ? "••••••••" : "API secret"}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="livekit-agent-name">Worker agent name</Label>
              <Input
                id="livekit-agent-name"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder={DEFAULT_AGENT_NAME}
              />
              <p className="text-xs text-muted-foreground">
                Must match the agent name deployed with{" "}
                <code className="rounded bg-muted px-1">lk agent create</code> (default{" "}
                {DEFAULT_AGENT_NAME}).
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                disabled={saving}
                onClick={() => void save(false)}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => void save(true)}
              >
                Save &amp; test connection
              </Button>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Voice uses LiveKit Inference (STT/LLM/TTS billed through LiveKit Cloud).
              Deploy the worker from{" "}
              <code className="rounded bg-muted px-1">packages/wacrm-voice-agent</code>{" "}
              (<code className="rounded bg-muted px-1">lk agent create</code>, secrets in{" "}
              <code className="rounded bg-muted px-1">.env</code>). Subscribe Meta webhook to{" "}
              <strong>calls</strong>. See{" "}
              <code className="rounded bg-muted px-1">docs/voice-agents.md</code>.
            </p>
          </CardContent>
        </Card>
      )}
    </RequireRole>
  );
}
