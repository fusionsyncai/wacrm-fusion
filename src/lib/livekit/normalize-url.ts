/** LiveKit server SDKs expect https:// host, not wss:// */
export function normalizeLiveKitHttpUrl(url: string): string {
  let trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("wss://")) trimmed = `https://${trimmed.slice(6)}`;
  else if (trimmed.startsWith("ws://")) trimmed = `http://${trimmed.slice(5)}`;
  else if (!/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;
  return trimmed;
}

export function normalizeLiveKitWsUrl(url: string): string {
  const http = normalizeLiveKitHttpUrl(url);
  if (http.startsWith("https://")) return `wss://${http.slice(8)}`;
  if (http.startsWith("http://")) return `ws://${http.slice(7)}`;
  return http;
}
