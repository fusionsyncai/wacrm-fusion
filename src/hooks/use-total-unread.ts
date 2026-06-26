"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api/fetch-json";

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * Polls /api/data/conversations/unread-total while the inbox tab is open.
 */
const POLL_MS = 30_000;

export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function poll() {
      try {
        const data = await fetchJson<{ total: number }>(
          "/api/data/conversations/unread-total",
        );
        if (!cancelledRef.current) setTotal(data.total);
      } catch (err) {
        console.error("[useTotalUnread] poll failed:", err);
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_MS);

    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, []);

  return total;
}
