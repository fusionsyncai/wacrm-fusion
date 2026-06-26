"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { AgentDialog } from "@/components/agents/agent-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useCan } from "@/hooks/use-can";
import { fetchJson } from "@/lib/api/fetch-json";
import { cn } from "@/lib/utils";
import type { AiAgent } from "@/types";

export default function AgentsPage() {
  const canEdit = useCan("send-messages");
  const [agents, setAgents] = useState<AiAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AiAgent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { agents: data } = await fetchJson<{ agents: AiAgent[] }>(
        "/api/agents",
      );
      setAgents(data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(agent: AiAgent, next: boolean) {
    setAgents(
      (prev) =>
        prev?.map((a) =>
          a.id === agent.id ? { ...a, is_active: next } : a,
        ) ?? prev,
    );
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      setAgents(
        (prev) =>
          prev?.map((a) =>
            a.id === agent.id ? { ...a, is_active: !next } : a,
          ) ?? prev,
      );
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Failed to update agent");
      return;
    }
    toast.success(next ? "Agent activated" : "Agent paused");
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const res = await fetch(`/api/agents/${pendingDelete.id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Failed to delete agent");
      return;
    }
    toast.success("Agent deleted");
    setPendingDelete(null);
    void load();
  }

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(agent: AiAgent) {
    setEditing(agent);
    setDialogOpen(true);
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (agents === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI assistants that can reply in conversations with optional human
            approval.
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="create agents"
          onClick={openCreate}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New agent
        </GatedButton>
      </div>

      {agents.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            No agents yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create an agent and connect it from the inbox or enable
            auto-connect.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-foreground">
                      {agent.name}
                    </h2>
                    {agent.auto_connect && (
                      <Badge variant="outline" className="text-[10px]">
                        Auto-connect
                      </Badge>
                    )}
                  </div>
                  {agent.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {agent.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px]",
                        agent.reply_mode === "AUTO"
                          ? "border-primary/30 text-primary"
                          : "",
                      )}
                    >
                      {agent.reply_mode === "AUTO" ? "Auto send" : "Human review"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {(agent.tools?.length ?? 0)} tool
                      {(agent.tools?.length ?? 0) === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                  aria-label="Open menu"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted"
                >
                  <MoreVertical className="h-4 w-4" />
                </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(agent)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setPendingDelete(agent)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">Active</span>
                <Switch
                  checked={agent.is_active}
                  onCheckedChange={(next) => void toggleActive(agent, next)}
                  disabled={!canEdit}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <AgentDialog
        open={dialogOpen}
        agent={editing}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          setDialogOpen(false);
          void load();
        }}
      />

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete agent</DialogTitle>
            <DialogDescription>
              This permanently removes{" "}
              <span className="text-foreground">{pendingDelete?.name}</span>.
              Connected conversations will lose their AI agent link.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
