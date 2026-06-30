"use client";

import { useEffect, useRef } from "react";

/** Refetch when the tab/window regains focus (no polling). */
export function useRefetchOnFocus(refetch: () => void) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        refetchRef.current();
      }
    }

    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
