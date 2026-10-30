"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { deleteMySignature, saveMySignature } from "@/services/authApi";

// Ảnh chữ ký của tài khoản (trang Thông tin cá nhân; họ và tên đầy đủ users.full_name nhập ở form thông tin phía trên): ký
// trên màn hình (chuột / ngón tay) hoặc upload ảnh. Ảnh được cắt sát nét ký,
// thu nhỏ (tối đa OUTPUT_MAX_WIDTH x OUTPUT_MAX_HEIGHT) và lưu PNG nền trong (mỗi người một chữ ký, users.chu_ky); BE in vào
// ô ký Giấy đề nghị thanh toán (người đề nghị khi đã gửi duyệt, người duyệt khi đã duyệt). Ô ký luôn nền trắng (kể cả giao
// diện tối) như giấy in.

const INK = "#1e3a8a";
const PAD_HEIGHT = 180;
const OUTPUT_MAX_WIDTH = 600;
const OUTPUT_MAX_HEIGHT = 200;
const PADDING = 8;
// Ảnh upload: điểm ảnh gần trắng (nền giấy) thành trong suốt.
const WHITE_THRESHOLD = 225;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Cắt sát vùng có nét (alpha > 0), thu nhỏ vừa khung xuất; không có nét thì null. */
function trimToPng(source: HTMLCanvasElement): string | null {
  const context = source.getContext("2d");
  if (!context) return null;
  const { width, height } = source;
  const pixels = context.getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const scale = Math.min(1, (OUTPUT_MAX_WIDTH - PADDING * 2) / cropWidth, (OUTPUT_MAX_HEIGHT - PADDING * 2) / cropHeight);
  const output = document.createElement("canvas");
  output.width = Math.ceil(cropWidth * scale) + PADDING * 2;
  output.height = Math.ceil(cropHeight * scale) + PADDING * 2;
  output.getContext("2d")?.drawImage(source, left, top, cropWidth, cropHeight, PADDING, PADDING, cropWidth * scale, cropHeight * scale);
  return output.toDataURL("image/png");
}

/** Ảnh upload -> PNG nền trong (bỏ nền trắng), cắt sát nét. */
async function imageFileToPng(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image"));
      element.src = url;
    });
    // Thu nhỏ trước để xử lý nhanh (ảnh chụp điện thoại rất lớn).
    const scale = Math.min(1, 1200 / image.naturalWidth, 600 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < data.data.length; index += 4) {
      const [r, g, b] = [data.data[index], data.data[index + 1], data.data[index + 2]];
      if (r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD) data.data[index + 3] = 0;
    }
    context.putImageData(data, 0, 0);
    return trimToPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * initialImage: ảnh chữ ký đã lưu (trang cha tải cùng họ tên bằng getMySignature, '' = chưa có); loading: đang tải;
 * signerName: họ tên in dưới chữ ký (xem trước).
 */
export default function SignatureSettings({ initialImage, loading, signerName }: { initialImage: string; loading: boolean; signerName: string }) {
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const [savedImage, setSavedImage] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "delete" | "upload">("");
  // Ảnh upload chờ lưu (thay cho nét ký trên ô).
  const [uploaded, setUploaded] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);

  // Tải xong ở trang cha: chưa có chữ ký thì mở ô ký ngay.
  useEffect(() => {
    if (loading) return;
    setSavedImage(initialImage);
    setEditing(!initialImage);
  }, [loading, initialImage]);

  // Ô ký theo bề ngang khung (điện thoại 375px -> desktop), nét sắc trên màn hình mật độ cao.
  const resetPad = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.parentElement?.clientWidth || 320;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(PAD_HEIGHT * ratio);
    canvas.style.height = `${PAD_HEIGHT}px`;
    const context = canvas.getContext("2d");
    if (context) {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.4;
      context.strokeStyle = INK;
    }
    setHasInk(false);
  }, []);

  useEffect(() => {
    if (loading || !editing || uploaded) return;
    resetPad();
    window.addEventListener("resize", resetPad);
    return () => window.removeEventListener("resize", resetPad);
  }, [loading, editing, uploaded, resetPad]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    drawing.current = start;
    const context = event.currentTarget.getContext("2d");
    // Chấm một điểm khi chỉ chạm / bấm (dấu chấm trong chữ ký).
    context?.beginPath();
    context?.arc(start.x, start.y, 1.2, 0, Math.PI * 2);
    if (context) { context.fillStyle = INK; context.fill(); }
    setHasInk(true);
  };

  const moveStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const next = point(event);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(drawing.current.x, drawing.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    drawing.current = next;
  };

  const endStroke = () => { drawing.current = null; };

  const clear = () => {
    setUploaded("");
    resetPad();
  };

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { notify(t("signatureInvalidFile"), "warning"); return; }
    if (file.size > MAX_UPLOAD_BYTES) { notify(t("signatureFileTooLarge"), "warning"); return; }
    setBusy("upload");
    try {
      const png = await imageFileToPng(file);
      if (!png) notify(t("signatureEmpty"), "warning");
      else setUploaded(png);
    } catch {
      notify(t("signatureInvalidFile"), "warning");
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    const image = uploaded || (canvasRef.current && hasInk ? trimToPng(canvasRef.current) : null);
    if (!image) { notify(t("signatureEmpty"), "warning"); return; }
    setBusy("save");
    try {
      const next = await saveMySignature({ image });
      setSavedImage(next.image);
      setEditing(!next.image);
      setUploaded("");
      notify(t("signatureSaved"), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!await confirm({ title: t("signatureDelete"), message: t("signatureDeleteConfirm"), confirmText: t("signatureDelete"), tone: "danger" })) return;
    setBusy("delete");
    try {
      await deleteMySignature();
      setSavedImage("");
      setEditing(true);
      notify(t("signatureDeleted"), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy("");
    }
  };

  const buttonSecondary = "h-10 w-full rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:w-auto dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 dark:border-gray-800 dark:bg-gray-900">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">{t("signatureTitle")}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("signatureDescription")}</p>
      </div>

      {loading ? (
        <div className="h-[180px] animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ) : !editing && savedImage ? (
        <div className="space-y-3">
          <div className="flex h-[180px] flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700">
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh data URL của chính người dùng */}
            <img src={savedImage} alt={t("signatureTitle")} className="min-h-0 max-w-full flex-1 object-contain" />
            <p className="mt-1 w-full max-w-xs truncate border-t border-gray-300 pt-1 text-center text-sm text-gray-800">{signerName}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => void remove()} disabled={busy !== ""}
              className="h-10 w-full rounded-lg border border-error-200 px-4 text-sm font-medium text-error-600 hover:bg-error-50 disabled:opacity-50 sm:w-auto dark:border-error-500/30 dark:text-error-400 dark:hover:bg-error-500/10">
              {busy === "delete" ? t("signatureDeleting") : t("signatureDelete")}
            </button>
            <button type="button" onClick={() => setEditing(true)} disabled={busy !== ""} className={buttonSecondary}>{t("signatureChange")}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-white dark:border-gray-600">
            {uploaded ? (
              <div className="flex h-[180px] items-center justify-center p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước (data URL) */}
                <img src={uploaded} alt={t("signatureTitle")} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <>
                <canvas ref={canvasRef} className="block w-full cursor-crosshair touch-none" aria-label={t("signatureDrawHint")}
                  onPointerDown={startStroke} onPointerMove={moveStroke} onPointerUp={endStroke} onPointerCancel={endStroke} onPointerLeave={endStroke} />
                {!hasInk && <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-gray-400">{t("signatureDrawHint")}</p>}
                <div className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-gray-200" />
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void pickFile(event)} />
          <p className="text-xs text-gray-500">{t("signatureUploadHint")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <button type="button" onClick={clear} disabled={busy !== ""} className={buttonSecondary}>{t("signatureClear")}</button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== ""} className={buttonSecondary}>
              {busy === "upload" ? t("signatureProcessing") : t("signatureUpload")}
            </button>
            {savedImage && (
              <button type="button" onClick={() => { setEditing(false); setUploaded(""); }} disabled={busy !== ""} className={buttonSecondary}>{t("signatureCancel")}</button>
            )}
            <button type="button" onClick={() => void save()} disabled={busy !== "" || (!uploaded && !hasInk)}
              className="h-10 w-full rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
              {busy === "save" ? t("signatureSaving") : t("signatureSave")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
