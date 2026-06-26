"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { fetchJson } from "@/lib/api/fetch-json";
import {
  derivePresence,
  type PresenceRow,
  type PresenceStatus,
  type StoredPresence,
} from "@/lib/presence";

const RE_DERIVE_MS = 15_000;
const POLL_MS = 30_000;

type PresenceMap = Map<string, PresenceRow>;

interface UsePresenceResult {
  getPresence: (userId: string) => PresenceStatus;
  getRow: (userId: string) => PresenceRow | undefined;
  now: number;
}

/**
 * Live presence for every member of the caller's account.
 * Polls /api/data/presence on an interval (no websocket layer).
 */
export function usePresence(enabled = true): UsePresenceResult {
  const { accountId } = useAuth();
  const [rows, setRows] = useState<PresenceMap>(() => new Map());
  const [now, setNow] = useState(() => Date.now());

  const active = enabled && !!accountId;

  useEffect(() => {
    if (!active || !accountId) return;

    let cancelled = false;

    async function fetchPresence() {
      try {
        const data = await fetchJson<{
          presence: Array<{
            user_id: string;
            status: StoredPresence;
            last_seen_at: string;
          }>;
        }>("/api/data/presence");

        if (cancelled) return;

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
    }

    void fetchPresence();
    const poll = setInterval(() => void fetchPresence(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), RE_DERIVE_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [active, accountId]);

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
