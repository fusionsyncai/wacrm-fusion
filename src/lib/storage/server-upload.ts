import "server-only";

import { del, put } from "@vercel/blob";

import { buildMediaPath } from "@/lib/storage/upload-media";

function requireBlobToken() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "File uploads are not configured. Set BLOB_READ_WRITE_TOKEN (Vercel Blob) on the server.",
    );
  }
}

export async function uploadToStorage(
  bucket: string,
  accountId: string,
  file: File,
  pathOverride?: string,
): Promise<{ publicUrl: string; path: string }> {
  requireBlobToken();

  const path = pathOverride ?? `${bucket}/${buildMediaPath(accountId, file.name)}`;
  const blob = await put(path, file, {
    access: "public",
    contentType: file.type || undefined,
  });

  return { publicUrl: blob.url, path: blob.pathname };
}

export async function deleteFromStorage(_bucket: string, path: string): Promise<void> {
  requireBlobToken();
  await del(path);
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  requireBlobToken();

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `avatars/${userId}/avatar-${Date.now()}.${ext}`;
  const blob = await put(path, file, {
    access: "public",
    contentType: file.type || undefined,
  });

  return blob.url;
}
