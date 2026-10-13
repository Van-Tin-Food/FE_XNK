const GOOGLE_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

function getGoogleDriveFileId(url: URL): string | null {
  const pathMatch = url.pathname.match(/\/file\/d\/([^/]+)/i);
  if (pathMatch?.[1]) return pathMatch[1];

  const queryId = url.searchParams.get("id");
  return queryId?.trim() || null;
}

/** Chuyển link xem/chia sẻ Drive thành link dành cho iframe PDF. */
export function toDocumentPreviewUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.startsWith("blob:") || raw.startsWith("data:")) return raw;

  try {
    const url = new URL(raw);
    if (!GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase())) return raw;
    const fileId = getGoogleDriveFileId(url);
    return fileId
      ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
      : raw;
  } catch {
    return raw;
  }
}

/** Chuyển link Drive thành endpoint tải file trực tiếp. */
export function toDocumentDownloadUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.startsWith("blob:") || raw.startsWith("data:")) return raw;

  try {
    const url = new URL(raw);
    if (!GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase())) return raw;
    const fileId = getGoogleDriveFileId(url);
    return fileId
      ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
      : raw;
  } catch {
    return raw;
  }
}
