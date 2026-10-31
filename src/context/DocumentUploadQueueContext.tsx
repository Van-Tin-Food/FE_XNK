"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import UploadBatchProgressToast, { type UploadBatchFile, type UploadBatchJob } from "@/components/common/UploadBatchProgressToast";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  checkDocumentFileNames,
  createUploadBatch,
  finishDocumentUploadBatch,
  openDocumentUploadSessions,
  uploadDocument,
  type DocumentProgressResponse,
  type PreparedDocumentUpload,
  type DocumentUploadTarget,
} from "@/services/shipmentApi";
import { createConcurrencyLimit } from "@/utils/concurrency";

/**
 * Sự kiện window khi upload chạy nền có kết quả, để trang chi tiết đơn (nếu đang mở đúng đơn, kể cả mở lại sau khi đã rời
 * trang) cập nhật danh sách chứng từ: "file" = một file vừa lưu xong, "settled" = cả lượt đã xong và có file lưu được.
 */
export const DOCUMENT_UPLOAD_EVENT = "xnk:document-upload";
export interface DocumentUploadEventDetail {
  kind: "file" | "settled";
  orderCode: string;
  documentCode: string;
  /** kind "file": tiến độ chứng từ BE trả ngay sau khi lưu file. */
  documentProgress?: DocumentProgressResponse;
  /** kind "settled": file gốc đã upload được (để hiện bản xem nhanh). */
  uploadedFiles?: File[];
  /** Thư mục container vừa dùng (INSPECTION / TRA_CONT). */
  containerFolderName?: string;
}

export interface DocumentUploadJobInput {
  target: DocumentUploadTarget;
  files: File[];
  /** requestId cố định cho từng file (cùng thứ tự files); thiếu thì tự tạo. Thử lại dùng lại cùng requestId. */
  requestIds?: string[];
  /** Phiên đã mở + phần đã gửi trước của từng file (prepareDocumentUpload, cùng thứ tự files): chỉ còn gửi phần cuối. */
  preparedUploads?: Array<PreparedDocumentUpload | undefined>;
  /** Chuẩn bị file trước khi upload (ví dụ đóng dấu ảnh); lỗi thì file đó lỗi, không upload bản gốc. */
  prepareFile?: (file: File) => Promise<File>;
  /** Chạy sau mỗi lần có file lưu được (kể cả khi người dùng đã sang trang khác), ví dụ ghi nhật ký. */
  onUploaded?: (summary: { uploadedNames: string[]; containerFolderName: string }) => void;
  /** Thông báo khi cả lượt xong không lỗi; thiếu thì dùng câu chung "Đã upload N file". */
  successMessage?: string;
}

interface DocumentUploadQueueValue {
  /** Đưa một lượt upload vào hàng đợi chạy nền và trả về ngay; tiến độ hiện ở thẻ nổi. Gọi sau khi đã kiểm tra trùng tên. */
  enqueueDocumentUpload: (input: DocumentUploadJobInput) => void;
}

/** Số file gửi lên Drive cùng lúc, tính chung cho mọi lượt (nhiều hơn dễ nghẽn mạng / bị Google giới hạn tốc độ). */
const UPLOAD_CONCURRENCY = 4;
/** Lượt cần chuẩn bị file (đóng dấu ảnh): mở phiên theo nhóm nhỏ để nhóm đầu upload trong khi nhóm sau đang đóng dấu. */
const PREPARED_GROUP_SIZE = UPLOAD_CONCURRENCY;
/** Không cần chuẩn bị: mở phiên cho cả lượt trong một request (BE nhận tối đa 50 file). */
const SESSION_GROUP_SIZE = 50;
/** Lượt xong không lỗi tự ẩn sau chừng này. */
const DONE_JOB_HIDE_MS = 4000;

interface JobRecord {
  input: DocumentUploadJobInput;
  requestIds: string[];
  failedIndexes: number[];
  /** Đang chạy (lượt đầu hoặc thử lại): chặn bấm Thử lại hai lần trước khi giao diện kịp ẩn nút. */
  running: boolean;
}

const DocumentUploadQueueContext = createContext<DocumentUploadQueueValue | undefined>(undefined);

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Hàng đợi upload chứng từ chạy nền, đặt ở layout admin: chuyển trang trong app vẫn upload tiếp (chỉ đóng tab / tải lại
 * trang mới dừng, khi đó trình duyệt hỏi trước). Mỗi lượt: chuẩn bị file → mở phiên cho cả nhóm (một request) → gửi file
 * thẳng lên Drive + xác nhận, tối đa UPLOAD_CONCURRENCY file cùng lúc. Một file lỗi không dừng file khác.
 */
export function DocumentUploadQueueProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const [jobs, setJobs] = useState<UploadBatchJob[]>([]);
  const recordsRef = useRef(new Map<string, JobRecord>());
  const limitRef = useRef(createConcurrencyLimit(UPLOAD_CONCURRENCY));
  // Mở phiên theo đích (đơn + chứng từ + container): hai lượt cùng đích mở phiên lần lượt, để lượt đầu tạo thư mục container
  // xong lượt sau mới tìm (BE không khoá, mở cùng lúc có thể tạo hai thư mục trùng tên).
  const sessionLocksRef = useRef(new Map<string, Promise<unknown>>());
  const withTargetLock = useCallback(<T,>(target: DocumentUploadTarget, task: () => Promise<T>): Promise<T> => {
    const key = [target.orderCode, target.documentCode, target.transportCode, target.folderNote, target.containerFolderName]
      .map((part) => String(part || "").trim().toUpperCase())
      .join("|");
    const locks = sessionLocksRef.current;
    const run = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
    const tail = run.catch(() => undefined);
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }, []);
  // t / notify đổi theo ngôn ngữ; lượt đang chạy luôn dùng bản mới nhất.
  const textRef = useRef({ t, notify });
  useEffect(() => {
    textRef.current = { t, notify };
  }, [notify, t]);

  const patchJob = useCallback((jobId: string, patch: (job: UploadBatchJob) => UploadBatchJob) => {
    setJobs((current) => current.map((job) => (job.id === jobId ? patch(job) : job)));
  }, []);
  const patchFile = useCallback((jobId: string, index: number, patch: Partial<UploadBatchFile>) => {
    patchJob(jobId, (job) => ({ ...job, files: job.files.map((file, fileIndex) => (fileIndex === index ? { ...file, ...patch } : file)) }));
  }, [patchJob]);
  const removeJob = useCallback((jobId: string) => {
    recordsRef.current.delete(jobId);
    setJobs((current) => current.filter((job) => job.id !== jobId));
  }, []);

  const runJob = useCallback(async (jobId: string, indexes: number[]) => {
    const record = recordsRef.current.get(jobId);
    if (!record) return;
    const { input } = record;
    const { target } = input;
    const { t: translate } = textRef.current;
    // Cả lượt chỉ thành một thông báo Google Chat ("đã upload N file").
    const batch = createUploadBatch(indexes.length);
    const uploadedNames: string[] = [];
    const uploadedFiles: File[] = [];
    const failures: string[] = [];
    const failedIndexes: number[] = [];
    let containerFolderName = "";
    const fail = (index: number, error: unknown) => {
      const message = errorMessage(error, translate("uploadDocumentFailed"));
      failures.push(`${input.files[index].name} (${message})`);
      failedIndexes.push(index);
      patchFile(jobId, index, { status: "failed", error: message });
    };

    const uploads: Promise<void>[] = [];
    const groupSize = input.prepareFile ? PREPARED_GROUP_SIZE : SESSION_GROUP_SIZE;
    for (let start = 0; start < indexes.length; start += groupSize) {
      const group = indexes.slice(start, start + groupSize);
      const prepared = (await Promise.all(group.map(async (index) => {
        const original = input.files[index];
        try {
          const file = input.prepareFile ? await input.prepareFile(original) : original;
          if (file.size !== original.size) patchFile(jobId, index, { size: file.size });
          return { index, file };
        } catch (error) {
          fail(index, error);
          return null;
        }
      }))).filter((item): item is { index: number; file: File } => item !== null);
      if (prepared.length === 0) continue;

      // File đã mở phiên + gửi trước (chưa qua bước chuẩn bị làm đổi file) dùng lại phiên đó, file khác mở phiên cả nhóm.
      const preparedUploadOf = (index: number, file: File) => (file === input.files[index] ? input.preparedUploads?.[index] : undefined);
      const needSession = prepared.filter(({ index, file }) => !preparedUploadOf(index, file));
      const sessionByIndex = new Map<number, Awaited<ReturnType<typeof openDocumentUploadSessions>>[number]>();
      if (needSession.length > 0) {
        try {
          // Nhóm đầu tạo thư mục container (nếu cần) trước khi nhóm sau mở phiên, nên không tạo trùng thư mục.
          const sessions = await withTargetLock(target, () => openDocumentUploadSessions(target, needSession.map((item) => item.file)));
          needSession.forEach((item, position) => sessionByIndex.set(item.index, sessions[position]));
        } catch (error) {
          needSession.forEach((item) => fail(item.index, error));
        }
      }
      prepared.forEach(({ index, file }) => {
        const preparedUpload = preparedUploadOf(index, file);
        const result = sessionByIndex.get(index);
        if (!preparedUpload && !result) return; // mở phiên cả nhóm lỗi: đã báo lỗi ở trên
        if (result && !result.session) {
          fail(index, result.error);
          return;
        }
        const session = result?.session;
        uploads.push(limitRef.current(async () => {
          patchFile(jobId, index, { status: "uploading" });
          try {
            const response = await uploadDocument(
              { ...target, file, requestId: record.requestIds[index], batch },
              { session, prepared: preparedUpload, onProgress: ({ loaded }) => patchFile(jobId, index, { loaded }) },
            );
            uploadedNames.push(input.files[index].name);
            uploadedFiles.push(input.files[index]);
            if (response.containerFolderName) containerFolderName = response.containerFolderName;
            patchFile(jobId, index, { status: "done", loaded: file.size });
            // BE trả tiến độ chứng từ ngay sau khi lưu: file hiện trong danh sách luôn, không đợi cả lượt.
            const documentProgress = (response as { documentProgress?: DocumentProgressResponse }).documentProgress;
            window.dispatchEvent(new CustomEvent<DocumentUploadEventDetail>(DOCUMENT_UPLOAD_EVENT, {
              detail: { kind: "file", orderCode: target.orderCode, documentCode: target.documentCode, documentProgress },
            }));
          } catch (error) {
            fail(index, error);
          }
        }));
      });
    }
    await Promise.all(uploads);

    // Có file lỗi nên lượt không đủ số file: báo BE gửi thông báo cho các file đã lưu luôn.
    if (uploadedNames.length > 0 && failures.length > 0) void finishDocumentUploadBatch(batch, target.documentCode);
    if (uploadedNames.length > 0) {
      try {
        input.onUploaded?.({ uploadedNames, containerFolderName });
      } catch {
        // Ghi nhật ký lỗi không làm hỏng lượt upload đã xong.
      }
      window.dispatchEvent(new CustomEvent<DocumentUploadEventDetail>(DOCUMENT_UPLOAD_EVENT, {
        detail: { kind: "settled", orderCode: target.orderCode, documentCode: target.documentCode, uploadedFiles, containerFolderName },
      }));
    }

    const { t: latestT, notify: latestNotify } = textRef.current;
    record.failedIndexes = failedIndexes.sort((a, b) => a - b);
    record.running = false;
    if (failures.length === 0) {
      latestNotify(input.successMessage || latestT("uploadDocumentsSuccess", { count: uploadedNames.length, document: target.documentCode }), "success");
      patchJob(jobId, (job) => ({ ...job, status: "done", message: undefined }));
      window.setTimeout(() => removeJob(jobId), DONE_JOB_HIDE_MS);
    } else {
      const message = latestT("uploadDocumentsPartialFailure", { uploaded: uploadedNames.length, total: indexes.length, failures: failures.join("; ") });
      latestNotify(message, "error");
      patchJob(jobId, (job) => ({ ...job, status: "failed", retryable: true }));
    }
  }, [patchFile, patchJob, removeJob, withTargetLock]);

  // Lỗi ngoài dự kiến trong runJob (lỗi lập trình): không để lượt kẹt ở "đang chạy" (trình duyệt hỏi mãi khi đóng tab).
  const runJobSafely = useCallback(async (jobId: string, indexes: number[]) => {
    try {
      await runJob(jobId, indexes);
    } catch (error) {
      const record = recordsRef.current.get(jobId);
      if (record) {
        record.running = false;
        record.failedIndexes = indexes;
      }
      const message = errorMessage(error, textRef.current.t("uploadDocumentFailed"));
      textRef.current.notify(message, "error");
      patchJob(jobId, (job) => ({ ...job, status: "failed", retryable: true, message }));
    }
  }, [patchJob, runJob]);

  const enqueueDocumentUpload = useCallback((input: DocumentUploadJobInput) => {
    if (input.files.length === 0) return;
    const jobId = crypto.randomUUID();
    recordsRef.current.set(jobId, {
      input,
      requestIds: input.files.map((_, index) => input.requestIds?.[index] || crypto.randomUUID()),
      failedIndexes: [],
      running: true,
    });
    setJobs((current) => [...current, {
      id: jobId,
      title: `${input.target.orderCode} · ${input.target.documentCode}`,
      status: "running",
      retryable: false,
      files: input.files.map((file, index) => ({
        key: `${index}:${file.name}:${file.size}:${file.lastModified}`,
        fileName: file.name,
        size: file.size,
        loaded: 0,
        status: "queued",
      })),
    }]);
    void runJobSafely(jobId, input.files.map((_, index) => index));
  }, [runJobSafely]);

  /** Upload lại các file lỗi của lượt (kiểm tra trùng tên lại vì có file có thể đã lên Drive). */
  const retryJob = useCallback(async (jobId: string) => {
    const record = recordsRef.current.get(jobId);
    if (!record || record.running || record.failedIndexes.length === 0) return;
    record.running = true;
    const indexes = record.failedIndexes;
    const { t: translate, notify: send } = textRef.current;
    patchJob(jobId, (job) => ({ ...job, status: "running", message: undefined }));
    try {
      const nameCheck = await checkDocumentFileNames({ ...record.input.target, fileNames: indexes.map((index) => record.input.files[index].name) });
      if (nameCheck.hasDuplicates) {
        const message = translate("duplicateDocumentFileNames", {
          files: nameCheck.files
            .filter((file) => file.duplicate)
            .map((file) => `${file.targetName} (${file.reason === "exists" ? translate("duplicateReasonExists", { folder: nameCheck.folderName }) : translate("duplicateReasonSameBatch")})`)
            .join("; "),
        });
        send(message, "error");
        record.running = false;
        patchJob(jobId, (job) => ({ ...job, status: "failed", retryable: false, message }));
        return;
      }
    } catch (error) {
      const message = errorMessage(error, translate("uploadDocumentFailed"));
      send(message, "error");
      record.running = false;
      patchJob(jobId, (job) => ({ ...job, status: "failed", message }));
      return;
    }
    patchJob(jobId, (job) => ({
      ...job,
      files: job.files.map((file, index) => (indexes.includes(index) ? { ...file, status: "queued", loaded: 0, error: undefined } : file)),
    }));
    await runJobSafely(jobId, indexes);
  }, [patchJob, runJobSafely]);

  const hasRunningJob = jobs.some((job) => job.status === "running");
  // Đóng tab / tải lại trang giữa chừng thì mất phần chưa gửi: trình duyệt hỏi trước.
  useEffect(() => {
    if (!hasRunningJob) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasRunningJob]);

  const value = useMemo(() => ({ enqueueDocumentUpload }), [enqueueDocumentUpload]);
  return (
    <DocumentUploadQueueContext.Provider value={value}>
      {children}
      <UploadBatchProgressToast jobs={jobs} onRetry={(jobId) => void retryJob(jobId)} onDismiss={removeJob} />
    </DocumentUploadQueueContext.Provider>
  );
}

export function useDocumentUploadQueue(): DocumentUploadQueueValue {
  const context = useContext(DocumentUploadQueueContext);
  if (!context) throw new Error("useDocumentUploadQueue phải dùng bên trong DocumentUploadQueueProvider");
  return context;
}
