// Gửi file thẳng từ trình duyệt tới phiên upload resumable của Google Drive (BE mở phiên, xem
// startDocumentUpload). Không đi qua gateway Vercel nên không bị giới hạn 4,5 MB mỗi request.
// File được gửi từng phần; mất mạng hoặc Google lỗi tạm thời thì hỏi Google đã nhận tới đâu rồi gửi tiếp.

/** Mỗi phần 8 MB (Google yêu cầu bội số của 256 KB). */
const CHUNK_BYTES = 8 * 1024 * 1024;
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
  constructor(message: string) {
    super(message);
    this.name = "DriveUploadError";
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

export async function uploadFileToDriveSession(
  uploadUrl: string,
  file: File,
  options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<{ id: string }> {
  const total = file.size;
  const report = (loaded: number) => options.onProgress?.({ loaded: Math.min(loaded, total), total });
  let offset = 0;
  let failures = 0;
  report(0);

  while (true) {
    let result: SendResult;
    try {
      const end = Math.min(offset + CHUNK_BYTES, total);
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
      throw new DriveUploadError("Phiên upload Google Drive đã hết hạn, vui lòng upload lại");
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
        throw new DriveUploadError("Phiên upload Google Drive đã hết hạn, vui lòng upload lại");
      }
    } catch (error) {
      if (error instanceof DriveUploadError || (error instanceof DOMException && error.name === "AbortError")) throw error;
      // Chưa hỏi được trạng thái (vẫn mất mạng): vòng sau gửi lại phần đang dở.
    }
  }
}
