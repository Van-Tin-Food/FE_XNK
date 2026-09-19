export const DOCUMENT_FILE_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf",
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif",
] as const;

export const DOCUMENT_FILE_ACCEPT = DOCUMENT_FILE_EXTENSIONS
  .map((extension) => `.${extension}`)
  .join(",");

const DOCUMENT_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
};

function getFileExtension(fileName: string): string {
  return fileName.trim().toLowerCase().split(".").pop() || "";
}

export function isSupportedDocumentFile(file: Pick<File, "name">): boolean {
  return DOCUMENT_FILE_EXTENSIONS.includes(getFileExtension(file.name) as typeof DOCUMENT_FILE_EXTENSIONS[number]);
}

export function getDocumentMimeType(file: Pick<File, "name" | "type">): string {
  return file.type || DOCUMENT_MIME_TYPES[getFileExtension(file.name)] || "application/octet-stream";
}

