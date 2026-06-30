"use client";

import { useCallback, useEffect, useRef } from "react";

import { useAuth } from "@/hooks/use-auth";
import { fetchJson } from "@/lib/api/fetch-json";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import { IDLE_AFTER_MS } from "@/lib/presence";

/**
 * Updates the caller's presence row via POST /api/data/presence on mount
 * and when the tab regains focus (no heartbeat interval).
 */
export function PresenceHeartbeat() {
  const { user, accountId } = useAuth();
  const idleRef = useRef(false);
  const lastActivityRef = useRef(Date.now());

  const touch = useCallback(async () => {
    if (!user?.id || !accountId) return;

    const away = Date.now() - lastActivityRef.current > IDLE_AFTER_MS;
    const status = away ? "away" : "online";
    try {
      await fetchJson("/api/data/presence", {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      console.error("[PresenceHeartbeat] touch failed:", err);
    }
  }, [user?.id, accountId]);

  useEffect(() => {
    if (!user?.id || !accountId) return;

    function markActive() {
      lastActivityRef.current = Date.now();
      idleRef.current = false;
    }

    window.addEventListener("mousemove", markActive);
    window.addEventListener("keydown", markActive);
    window.addEventListener("click", markActive);
    window.addEventListener("scroll", markActive, { passive: true });

    void touch();

    return () => {
      window.removeEventListener("mousemove", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("click", markActive);
      window.removeEventListener("scroll", markActive);
    };
  }, [user?.id, accountId, touch]);

  useRefetchOnFocus(() => void touch());

  return null;
}
