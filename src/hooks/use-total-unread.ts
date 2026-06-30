"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api/fetch-json";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * Fetches on mount and when the tab regains focus (no polling).
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  const cancelledRef = useRef(false);

  const fetchTotal = useCallback(async () => {
    try {
      const data = await fetchJson<{ total: number }>(
        "/api/data/conversations/unread-total",
      );
      if (!cancelledRef.current) setTotal(data.total);
    } catch (err) {
      console.error("[useTotalUnread] fetch failed:", err);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void fetchTotal();
    return () => {
      cancelledRef.current = true;
    };
  }, [fetchTotal]);

  useRefetchOnFocus(() => void fetchTotal());

  return total;
}
