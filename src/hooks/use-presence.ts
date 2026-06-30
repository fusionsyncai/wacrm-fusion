"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { fetchJson } from "@/lib/api/fetch-json";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import {
  derivePresence,
  type PresenceRow,
  type PresenceStatus,
  type StoredPresence,
} from "@/lib/presence";

type PresenceMap = Map<string, PresenceRow>;

interface UsePresenceResult {
  getPresence: (userId: string) => PresenceStatus;
  getRow: (userId: string) => PresenceRow | undefined;
  now: number;
}

/**
 * Live presence for every member of the caller's account.
 * Fetches on mount and when the tab regains focus (no polling).
 */
export function usePresence(enabled = true): UsePresenceResult {
  const { accountId } = useAuth();
  const [rows, setRows] = useState<PresenceMap>(() => new Map());
  const [now, setNow] = useState(() => Date.now());

  const active = enabled && !!accountId;

  const fetchPresence = useCallback(async () => {
    if (!accountId) return;

    try {
      const data = await fetchJson<{
        presence: Array<{
          user_id: string;
          status: StoredPresence;
          last_seen_at: string;
        }>;
      }>("/api/data/presence");

      setNow(Date.now());
      setRows((prev) => {
        const next = new Map(prev);
        for (const r of data.presence) {
          const incoming: PresenceRow = {
            status: r.status,
            last_seen_at: r.last_seen_at,
          };
          const existing = next.get(r.user_id);
          if (
            !existing ||
            new Date(incoming.last_seen_at) >= new Date(existing.last_seen_at)
          ) {
            next.set(r.user_id, incoming);
          }
        }
        return next;
      });
    } catch (err) {
      console.error("[usePresence] fetch error:", err);
    }
  }, [accountId]);

  useEffect(() => {
    if (!active) return;
    void fetchPresence();
  }, [active, fetchPresence]);

  useRefetchOnFocus(() => {
    if (active) void fetchPresence();
  });

  const getRow = useCallback(
    (userId: string): PresenceRow | undefined => rows.get(userId),
    [rows],
  );

  const getPresence = useCallback(
    (userId: string): PresenceStatus => {
      const row = rows.get(userId);
      return derivePresence(row?.status, row?.last_seen_at, now);
    },
    [rows, now],
  );

  return { getPresence, getRow, now };
}
