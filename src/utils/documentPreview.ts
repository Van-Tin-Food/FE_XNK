const GOOGLE_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

// Đường dẫn docs.google.com theo loại file và đuôi file tải về khi đó là file Google gốc (không phải file Office).
const GOOGLE_EDITOR_EXPORTS: Record<string, string> = {
  spreadsheets: "export?format=xlsx",
  document: "export?format=docx",
  presentation: "export/pptx",
};

type DriveLink = {
  fileId: string;
  /** spreadsheets / document / presentation với link docs.google.com, rỗng với link drive.google.com. */
  editor: string;
  /** File Google gốc (Sheets/Docs/Slides tạo trên Drive): phải export, không tải trực tiếp được. */
  isNativeGoogleFile: boolean;
};

/**
 * Link Drive của file PDF / ảnh có dạng drive.google.com/file/d/<id>; file Office (xlsx, docx, pptx) lại có dạng
 * docs.google.com/spreadsheets|document|presentation/d/<id>/edit?...&rtpof=true. rtpof=true nghĩa là file Office
 * thật được lưu trên Drive; không có rtpof là file Google gốc.
 */
function parseDriveLink(url: URL): DriveLink | null {
  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/i);
  if (fileMatch?.[1]) return { fileId: fileMatch[1], editor: "", isNativeGoogleFile: false };

  const editorMatch = url.pathname.match(/\/(spreadsheets|document|presentation)\/d\/([^/]+)/i);
  if (editorMatch?.[2]) {
    return {
      fileId: editorMatch[2],
      editor: editorMatch[1].toLowerCase(),
      isNativeGoogleFile: url.searchParams.get("rtpof") !== "true",
    };
  }

  const queryId = url.searchParams.get("id")?.trim();
  return queryId ? { fileId: queryId, editor: "", isNativeGoogleFile: false } : null;
}

function parseGoogleDriveUrl(value: string): DriveLink | null {
  try {
    const url = new URL(value);
    return GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase()) ? parseDriveLink(url) : null;
  } catch {
    return null;
  }
}

/** Chuyển link xem/chia sẻ Drive thành link dành cho iframe xem trước. */
export function toDocumentPreviewUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
  const link = parseGoogleDriveUrl(raw);
  if (!link) return raw;
  const fileId = encodeURIComponent(link.fileId);
  return link.isNativeGoogleFile
    ? `https://docs.google.com/${link.editor}/d/${fileId}/preview`
    : `https://drive.google.com/file/d/${fileId}/preview`;
}

/** Chuyển link Drive thành link tải file về máy (file Google gốc thì export sang định dạng Office). */
export function toDocumentDownloadUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
  const link = parseGoogleDriveUrl(raw);
  if (!link) return raw;
  const fileId = encodeURIComponent(link.fileId);
  return link.isNativeGoogleFile
    ? `https://docs.google.com/${link.editor}/d/${fileId}/${GOOGLE_EDITOR_EXPORTS[link.editor]}`
    : `https://drive.google.com/uc?export=download&id=${fileId}`;
}
