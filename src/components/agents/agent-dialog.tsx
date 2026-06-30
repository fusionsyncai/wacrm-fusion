"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  AgentReplyMode,
  AiAgent,
  AiAgentTool,
  AiAgentToolParameter,
} from "@/types";

interface AgentDialogProps {
  open: boolean;
  agent: AiAgent | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const emptyTool = (): AiAgentToolParameter => ({
  field: "",
  type: "string",
  description: "",
});

const newToolDraft = () => ({
  name: "",
  description: "",
  parameters: [emptyTool()],
});

export function AgentDialog({
  open,
  agent,
  onOpenChange,
  onSaved,
}: AgentDialogProps) {
  const isEdit = !!agent;
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("prompt");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [replyMode, setReplyMode] = useState<AgentReplyMode>("HUMAN");
  const [autoConnect, setAutoConnect] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceId, setVoiceId] = useState("");
  const [callSummaryPrompt, setCallSummaryPrompt] = useState("");
  const [tools, setTools] = useState<
    Array<{
      id?: string;
      name: string;
      description: string;
      parameters: AiAgentToolParameter[];
    }>
  >([]);

  useEffect(() => {
    if (!open) return;
    setTab("prompt");
    if (agent) {
      setName(agent.name);
      setDescription(agent.description ?? "");
      setSystemPrompt(agent.system_prompt);
      setReplyMode(agent.reply_mode);
      setAutoConnect(agent.auto_connect);
      setIsActive(agent.is_active);
      setVoiceEnabled(agent.voice_enabled);
      setVoiceId(agent.voice_id ?? "");
      setCallSummaryPrompt(agent.call_summary_prompt ?? "");
      setTools(
        agent.tools?.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          parameters:
            t.parameters.length > 0 ? t.parameters : [emptyTool()],
        })) ?? [],
      );
    } else {
      setName("");
      setDescription("");
      setSystemPrompt("You are a helpful WhatsApp support assistant.");
      setReplyMode("HUMAN");
      setAutoConnect(false);
      setIsActive(false);
      setVoiceEnabled(false);
      setVoiceId("");
      setCallSummaryPrompt("");
      setTools([]);
    }
  }, [open, agent]);

  function updateTool(
    index: number,
    patch: Partial<(typeof tools)[number]>,
  ) {
    setTools((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    );
  }

  function updateToolParam(
    toolIndex: number,
    paramIndex: number,
    patch: Partial<AiAgentToolParameter>,
  ) {
    setTools((prev) =>
      prev.map((t, i) => {
        if (i !== toolIndex) return t;
        const parameters = t.parameters.map((p, pi) =>
          pi === paramIndex ? { ...p, ...patch } : p,
        );
        return { ...t, parameters };
      }),
    );
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Agent name is required");
      setTab("prompt");
      return;
    }
    if (!systemPrompt.trim()) {
      toast.error("System prompt is required");
      setTab("prompt");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        system_prompt: systemPrompt.trim(),
        reply_mode: replyMode,
        auto_connect: autoConnect,
        is_active: isActive,
        voice_enabled: voiceEnabled,
        voice_id: voiceId.trim() || null,
        call_summary_prompt: callSummaryPrompt.trim() || null,
      };

      let agentId = agent?.id;
      if (isEdit && agentId) {
        const res = await fetch(`/api/agents/${agentId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(body.error ?? "Failed to update agent");
          return;
        }
      } else {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(body.error ?? "Failed to create agent");
          return;
        }
        const body = (await res.json()) as { agent: AiAgent };
        agentId = body.agent.id;
      }

      if (agentId) {
        const toolsRes = await fetch(`/api/agents/${agentId}/tools`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tools: tools.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              parameters: t.parameters.filter((p) => p.field.trim()),
            })),
          }),
        });
        if (!toolsRes.ok) {
          const body = await toolsRes.json().catch(() => ({}));
          toast.error(body.error ?? "Failed to save tools");
          return;
        }
      }

      toast.success(isEdit ? "Agent updated" : "Agent created");
      onSaved();
    } catch (err) {
      console.error("[AgentDialog] save error:", err);
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5">
          <DialogTitle className="text-lg">
            {isEdit ? "Edit agent" : "New agent"}
          </DialogTitle>
          <DialogDescription>
            Configure prompt, tools, and reply behavior for this AI assistant.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-5">
            <TabsList className="h-10 w-full justify-start">
              <TabsTrigger value="prompt" className="flex-1 sm:flex-none sm:px-6">
                Prompt
              </TabsTrigger>
              <TabsTrigger value="tools" className="flex-1 sm:flex-none sm:px-6">
                Tools
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1 sm:flex-none sm:px-6">
                Settings
              </TabsTrigger>
              <TabsTrigger value="voice" className="flex-1 sm:flex-none sm:px-6">
                Voice
              </TabsTrigger>
            </TabsList>

          <TabsContent value="prompt" className="mt-0 space-y-5">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Support bot"
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="agent-description">Description (optional)</Label>
                <Input
                  id="agent-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Handles tier-1 support questions"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agent-prompt">System prompt</Label>
              <Textarea
                id="agent-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={10}
                className="min-h-[240px] resize-y font-mono text-sm leading-relaxed"
                placeholder="You are a helpful assistant…"
              />
              <p className="text-xs text-muted-foreground">
                Instructions the model follows for every conversation with this agent.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="tools" className="mt-0 space-y-4">
            {tools.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No tools yet. Add tools the model can call during conversations.
                </p>
              </div>
            ) : (
              tools.map((tool, toolIndex) => (
                <div
                  key={tool.id ?? toolIndex}
                  className="space-y-4 rounded-lg border border-border bg-muted/10 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Tool {toolIndex + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setTools((prev) =>
                          prev.filter((_, i) => i !== toolIndex),
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <Label>Name</Label>
                      <Input
                        value={tool.name}
                        onChange={(e) =>
                          updateTool(toolIndex, { name: e.target.value })
                        }
                        placeholder="getWeather"
                      />
                    </div>
                    <div className="grid gap-1 sm:col-span-2">
                      <Label>Description</Label>
                      <Textarea
                        value={tool.description}
                        onChange={(e) =>
                          updateTool(toolIndex, {
                            description: e.target.value,
                          })
                        }
                        rows={2}
                        className="min-h-18 resize-y"
                        placeholder="Get weather for a city"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Parameters</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateTool(toolIndex, {
                            parameters: [...tool.parameters, emptyTool()],
                          })
                        }
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add field
                      </Button>
                    </div>
                    {tool.parameters.map((param, paramIndex) => (
                      <div
                        key={paramIndex}
                        className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-3"
                      >
                        <Input
                          value={param.field}
                          onChange={(e) =>
                            updateToolParam(toolIndex, paramIndex, {
                              field: e.target.value,
                            })
                          }
                          placeholder="city"
                        />
                        <Select
                          value={param.type}
                          onValueChange={(v) =>
                            updateToolParam(toolIndex, paramIndex, {
                              type: v as AiAgentToolParameter["type"],
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="string">string</SelectItem>
                            <SelectItem value="number">number</SelectItem>
                            <SelectItem value="boolean">boolean</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex gap-1">
                          <Input
                            className="flex-1"
                            value={param.description}
                            onChange={(e) =>
                              updateToolParam(toolIndex, paramIndex, {
                                description: e.target.value,
                              })
                            }
                            placeholder="City name"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              updateTool(toolIndex, {
                                parameters: tool.parameters.filter(
                                  (_, pi) => pi !== paramIndex,
                                ),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setTools((prev) => [...prev, newToolDraft()])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add tool
            </Button>
          </TabsContent>

          <TabsContent value="settings" className="mt-0 space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/10 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Inactive agents never reply, even when connected.
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/10 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Auto-connect</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Attach this agent to new conversations on first inbound
                  message. Only one agent per account can auto-connect.
                </p>
              </div>
              <Switch checked={autoConnect} onCheckedChange={setAutoConnect} />
            </div>
            <div className="grid gap-2 rounded-lg border border-border bg-muted/10 p-4">
              <Label>Reply mode</Label>
              <Select
                value={replyMode}
                onValueChange={(v) => setReplyMode(v as AgentReplyMode)}
              >
                <SelectTrigger className="w-full sm:max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">
                    Auto — send replies immediately
                  </SelectItem>
                  <SelectItem value="HUMAN">
                    Human — create drafts for review
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="voice" className="mt-0 space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/10 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Voice calls</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Answer inbound WhatsApp voice calls with this agent via LiveKit.
                  Requires LiveKit settings and a deployed worker.
                </p>
              </div>
              <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
            </div>
            <div className="grid gap-2 rounded-lg border border-border bg-muted/10 p-4">
              <Label htmlFor="agent-voice-id">TTS voice ID</Label>
              <Input
                id="agent-voice-id"
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
                disabled={!voiceEnabled}
              />
              <p className="text-xs text-muted-foreground">
                Cartesia voice ID for LiveKit Inference TTS (sonic-3). Leave blank
                for the worker default.
              </p>
            </div>
            <div className="grid gap-2 rounded-lg border border-border bg-muted/10 p-4">
              <Label htmlFor="agent-call-summary">Call summary prompt</Label>
              <Textarea
                id="agent-call-summary"
                value={callSummaryPrompt}
                onChange={(e) => setCallSummaryPrompt(e.target.value)}
                rows={4}
                disabled={!voiceEnabled}
                placeholder="Summarize this WhatsApp voice call in 2-4 sentences…"
              />
              <p className="text-xs text-muted-foreground">
                Used after the call ends to generate an inbox summary via your
                account LLM.
              </p>
            </div>
          </TabsContent>
        </Tabs>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save agent"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
