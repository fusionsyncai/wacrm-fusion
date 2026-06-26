"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@/hooks/use-auth";
import { fetchJson } from "@/lib/api/fetch-json";
import { HEARTBEAT_MS, IDLE_AFTER_MS } from "@/lib/presence";

/**
 * Heartbeats the caller's presence row via POST /api/data/presence.
 */
export function PresenceHeartbeat() {
  const { user, accountId } = useAuth();
  const idleRef = useRef(false);
  const lastActivityRef = useRef(Date.now());

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

    async function touch() {
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
    }

    void touch();
    const interval = setInterval(() => void touch(), HEARTBEAT_MS);

    return () => {
      clearInterval(interval);
      window.removeEventListener("mousemove", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("click", markActive);
      window.removeEventListener("scroll", markActive);
    };
  }, [user?.id, accountId]);

  return null;
}
