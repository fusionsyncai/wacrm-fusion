import { fetchFormData, fetchJson } from "@/lib/api/fetch-json";

/**
 * Shared media-upload helper for account-scoped Storage buckets.
 * Uploads go through /api/storage/upload (server-side) rather than
 * the Supabase browser client.
 */

/** 16 MB — matches the `file_size_limit` on both buckets. */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
} as const;

export function buildMediaPath(
  accountId: string,
  fileName: string,
  now: number = Date.now(),
): string {
  const hasExt = /\.[^.]+$/.test(fileName);
  const ext = hasExt ? fileName.split(".").pop()!.toLowerCase() : "bin";
  const safeBase =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 40) || "file";
  return `account-${accountId}/${now}-${safeBase}.${ext}`;
}

export interface UploadAccountMediaResult {
  publicUrl: string;
  path: string;
}

export async function uploadAccountMedia(
  bucket: string,
  file: File,
): Promise<UploadAccountMediaResult> {
  const form = new FormData();
  form.set("bucket", bucket);
  form.set("file", file);
  return fetchFormData<UploadAccountMediaResult>("/api/storage/upload", form);
}

export async function deleteAccountMedia(
  bucket: string,
  path: string,
): Promise<void> {
  await fetchJson("/api/storage/delete", {
    method: "POST",
    body: JSON.stringify({ bucket, path }),
  });
}
