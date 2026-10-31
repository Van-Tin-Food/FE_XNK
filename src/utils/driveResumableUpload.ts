// Gửi file thẳng từ trình duyệt tới phiên upload resumable của Google Drive (BE mở phiên, xem
// startDocumentUpload). Không đi qua gateway Vercel nên không bị giới hạn 4,5 MB mỗi request.
// File được gửi từng phần; mất mạng hoặc Google lỗi tạm thời thì hỏi Google đã nhận tới đâu rồi gửi tiếp.

/** Mỗi phần 16 MB (Google yêu cầu bội số của 256 KB): file lớn ít lần gửi hơn, rớt mạng thì gửi lại tối đa 16 MB. */
const CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_RETRIES = 5;

export interface UploadProgress {
  loaded: number;
  total: number;
}

interface SendResult {
  status: number;
  range: string | null;
  body: string;
}

export class DriveUploadError extends Error {
  /** true = phiên upload không còn (Google trả 404 / 410): phải mở phiên mới. */
  readonly sessionExpired: boolean;

  constructor(message: string, { sessionExpired = false }: { sessionExpired?: boolean } = {}) {
    super(message);
    this.name = "DriveUploadError";
    this.sessionExpired = sessionExpired;
  }
}

function send(url: string, body: Blob | null, contentRange: string, onLoaded?: (loaded: number) => void, signal?: AbortSignal): Promise<SendResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload aborted", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Range", contentRange);
    if (onLoaded) xhr.upload.onprogress = (event) => onLoaded(event.loaded);
    xhr.onload = () => {
      signal?.removeEventListener("abort", abort);
      resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: xhr.responseText });
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(new DriveUploadError("Mất kết nối khi gửi file lên Google Drive"));
    };
    xhr.onabort = () => {
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}

/** Header Range "bytes=0-8388607" → byte kế tiếp cần gửi; không có Range = Google chưa nhận byte nào. */
function nextOffset(range: string | null): number {
  const match = range?.match(/bytes=\d+-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}

function parseUploadedFile(result: SendResult): { id: string } {
  try {
    const data = JSON.parse(result.body) as { id?: unknown };
    if (typeof data.id === "string" && data.id) return { id: data.id };
  } catch {
    // rơi xuống lỗi bên dưới
  }
  throw new DriveUploadError("Google Drive không trả về mã file sau khi upload");
}

const isRetryable = (status: number) => status === 0 || status === 429 || status >= 500;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Phần không phải phần cuối phải là bội số 256 KB. */
const CHUNK_ALIGN_BYTES = 256 * 1024;

type UploadOptions = { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal };

/**
 * Gửi file tới phiên upload; `resume` = phiên đã gửi trước một phần (preUploadToDriveSession): hỏi Google đã nhận tới đâu
 * rồi gửi tiếp phần còn lại.
 */
export async function uploadFileToDriveSession(
  uploadUrl: string,
  file: File,
  options: UploadOptions & { resume?: boolean } = {},
): Promise<{ id: string }> {
  const result = await pump(uploadUrl, file, file.size, options);
  if (!("id" in result)) throw new DriveUploadError("Google Drive chưa nhận đủ file");
  return result;
}

/**
 * Gửi trước gần hết file (bội số 256 KB, chừa phần cuối) mà Google chưa tạo file: Drive chỉ tạo file khi nhận byte cuối.
 * Dùng khi người dùng còn phải xác nhận (OCR, tạo đơn): xác nhận thì uploadFileToDriveSession(..., { resume: true }) chỉ
 * gửi phần còn lại; huỷ thì bỏ phiên, Drive không có file thừa nên không bị coi là trùng tên. Trả số byte Google đã nhận.
 */
export async function preUploadToDriveSession(uploadUrl: string, file: File, options: UploadOptions = {}): Promise<number> {
  const limit = Math.floor((file.size - 1) / CHUNK_ALIGN_BYTES) * CHUNK_ALIGN_BYTES;
  if (limit <= 0) return 0;
  const result = await pump(uploadUrl, file, limit, options);
  return "id" in result ? file.size : result.offset;
}

/** Gửi từ byte Google đang chờ tới stopAt (stopAt = file.size thì hoàn tất và trả mã file). */
async function pump(
  uploadUrl: string,
  file: File,
  stopAt: number,
  options: UploadOptions & { resume?: boolean },
): Promise<{ id: string } | { offset: number }> {
  const total = file.size;
  const report = (loaded: number) => options.onProgress?.({ loaded: Math.min(loaded, total), total });
  let offset = 0;
  let failures = 0;
  if (options.resume) {
    const status = await send(uploadUrl, null, `bytes */${total}`, undefined, options.signal).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      return { status: 0, range: null, body: "" } as SendResult;
    });
    if (status.status === 200 || status.status === 201) {
      report(total);
      return parseUploadedFile(status);
    }
    if (status.status === 404 || status.status === 410) {
      throw new DriveUploadError("Phiên upload Google Drive đã hết hạn, vui lòng upload lại", { sessionExpired: true });
    }
    if (status.status === 308) offset = nextOffset(status.range);
  }
  report(offset);

  while (true) {
    if (offset >= stopAt && stopAt < total) return { offset };
    let result: SendResult;
    try {
      const end = Math.min(offset + CHUNK_BYTES, stopAt);
      const chunkStart = offset;
      result = await send(uploadUrl, file.slice(chunkStart, end), `bytes ${chunkStart}-${end - 1}/${total}`, (loaded) => report(chunkStart + loaded), options.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      result = { status: 0, range: null, body: "" };
    }

    if (result.status === 200 || result.status === 201) {
      report(total);
      return parseUploadedFile(result);
    }
    if (result.status === 308) {
      offset = nextOffset(result.range);
      failures = 0;
      report(offset);
      continue;
    }
    if (result.status === 404 || result.status === 410) {
      throw new DriveUploadError("Phiên upload Google Drive đã hết hạn, vui lòng upload lại", { sessionExpired: true });
    }
    if (!isRetryable(result.status)) {
      throw new DriveUploadError(`Google Drive từ chối file (HTTP ${result.status})`);
    }

    // Lỗi tạm thời: chờ rồi hỏi Google đã nhận tới byte nào để gửi tiếp từ đó.
    failures += 1;
    if (failures > MAX_RETRIES) {
      throw new DriveUploadError(result.status === 0
        ? "Mất kết nối khi gửi file lên Google Drive, vui lòng kiểm tra mạng và upload lại"
        : `Google Drive đang lỗi (HTTP ${result.status}), vui lòng thử lại sau`);
    }
    await wait(Math.min(1000 * 2 ** (failures - 1), 15000));
    try {
      const status = await send(uploadUrl, null, `bytes */${total}`, undefined, options.signal);
      if (status.status === 200 || status.status === 201) {
        report(total);
        return parseUploadedFile(status);
      }
      if (status.status === 308) offset = nextOffset(status.range);
      if (status.status === 404 || status.status === 410) {
        throw new DriveUploadError("Phiên upload Google Drive đã hết hạn, vui lòng upload lại", { sessionExpired: true });
      }
    } catch (error) {
      if (error instanceof DriveUploadError || (error instanceof DOMException && error.name === "AbortError")) throw error;
      // Chưa hỏi được trạng thái (vẫn mất mạng): vòng sau gửi lại phần đang dở.
    }
  }
}
