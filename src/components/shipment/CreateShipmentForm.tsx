"use client";

import React, { useEffect, useRef, useState } from "react";
import { analyzeDocument, checkDocumentFileNames, createUploadBatch, MAX_OCR_FILE_BYTES, uploadDocument } from "@/services/shipmentApi";
import { createDatabaseRow, databaseEndpoints, listCatalogRows } from "@/services/postgresShipmentApi";
import type { PurchaseRecord, SupplierRecord } from "@/types/postgresShipment";
import { useAuth } from "@/context/AuthContext";
import { recordActivity } from "@/services/activityLogApi";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { useLanguage } from "@/context/LanguageContext";
import { findBestCatalogMatch } from "@/utils/masterDataMatching";
import { DOCUMENT_FILE_ACCEPT, formatFileSize, isSupportedDocumentFile } from "@/utils/documentFile";
import UploadProgressToast from "@/components/common/UploadProgressToast";
import { useLeaveGuard } from "@/hooks/useLeaveGuard";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import OcrLoadingCard from "./OcrLoadingCard";

// Trang /shipments/new (trước là modal: bấm ra ngoài / nút Back của trình duyệt làm mất form đang nhập).
interface CreateShipmentFormProps {
  /** Về danh sách đơn. */
  onCancel: () => void;
  /** Đã tạo đơn (kể cả khi PI chưa lên Drive): mở chi tiết đơn vừa tạo. */
  onCreated: (orderCode: string) => void;
  existingOrderCodes: string[];
}

interface ReviewFields {
  orderCode: string;
  orderDate: string;
  supplier: string;
  supplierId: string;
  origin: string;
  productName: string;
}

const REQUIRED_REVIEW_FIELDS: Array<{ key: keyof ReviewFields; labelKey: string }> = [
  { key: "orderCode", labelKey: "orderCode" },
  { key: "orderDate", labelKey: "piDate" },
  { key: "supplier", labelKey: "supplier" },
  { key: "origin", labelKey: "origin" },
  { key: "productName", labelKey: "productName" },
];

const EMPTY_FIELDS: ReviewFields = {
  orderCode: "",
  orderDate: "",
  supplier: "",
  supplierId: "",
  origin: "",
  productName: "",
};

function normalizeKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");
}

function normalizeDatabaseDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!local) return raw;
  return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
}

function readField(data: Record<string, string>, names: string[]): string {
  const wanted = names.map(normalizeKey);
  const entry = Object.entries(data).find(([key]) => wanted.includes(normalizeKey(key)));
  return entry?.[1] || "";
}

function mapOcrFields(data: Record<string, string>): ReviewFields {
  const productName = readField(data, ["Product", "Product Name", "Description", "Tên hàng"]);
  return {
    orderCode: readField(data, ["Số HĐ", "Order_code", "Order code"]),
    orderDate: readField(data, ["Ngày HĐ PI", "Ngày HĐ", "Order date"]),
    supplier: readField(data, ["Nhà cung cấp", "Nha_cung_cap"]),
    supplierId: readField(data, ["id_ncc", "ID NCC"]),
    origin: readField(data, ["XUẤT XỨ", "Xuat_xu"]),
    productName,
  };
}

export default function CreateShipmentForm({ onCancel, onCreated, existingOrderCodes }: CreateShipmentFormProps) {
  const { user, can } = useAuth();
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const { t } = useLanguage();
  // Tạo đơn = quyền sửa Đơn hàng (gồm cả upload PI của đơn mới).
  const canCreateShipment = can("shipments", "edit");
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRequestIdRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isFilePanelOpen, setIsFilePanelOpen] = useState(false);
  const [isFilePanelMaximized, setIsFilePanelMaximized] = useState(false);
  // Tiến độ upload PI lên Google Drive khi bấm tạo đơn; null = không upload.
  const [uploadedBytes, setUploadedBytes] = useState<number | null>(null);
  const [fields, setFields] = useState<ReviewFields>(EMPTY_FIELDS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);

  // Mở trang là hỏi chọn file PI luôn (trình duyệt có thể chặn nếu không vừa bấm; khi đó bấm nút chọn PI).
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.click(), 150);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    void listCatalogRows<SupplierRecord>(databaseEndpoints.suppliers)
      .then(setSuppliers)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : t("supplierLoadError")));
  }, [t]);

  // Đã chọn PI (kể cả lúc đang tạo): rời trang (Back, link, đóng tab) sẽ mất form nên hỏi trước.
  const confirmLeavePage = React.useCallback(() => confirm({
    title: t("unsavedChangesTitle"),
    message: t("unsavedChangesMessage"),
    confirmText: t("leavePage"),
    cancelText: t("stayOnPage"),
    tone: "danger",
  }), [confirm, t]);
  const { allowLeave } = useLeaveGuard(Boolean(file), confirmLeavePage);
  // Đang xem PI ở nửa phải (từ md): form nổi ở nửa trái như modal cũ, khoá cuộn trang phía sau.
  const isSplitPreview = Boolean(isFilePanelOpen && filePreviewUrl && !isFilePanelMaximized);
  useEffect(() => {
    if (!isFilePanelOpen || !filePreviewUrl) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [filePreviewUrl, isFilePanelOpen]);

  useEffect(() => {
    if (suppliers.length === 0) return;
    setFields((current) => {
      if (!current.supplier) return current;
      const supplier = suppliers.find((item) => item.id_ncc === current.supplierId)
        || findBestCatalogMatch(current.supplier, suppliers, "ten_ncc");
      if (!supplier) return current;
      return {
        ...current,
        supplier: supplier.ten_ncc,
        supplierId: supplier.id_ncc,
        origin: String(supplier.quoc_gia || ""),
      };
    });
  }, [suppliers]);

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => {
    uploadRequestIdRef.current = null;
    setFile(null);
    setIsFilePanelOpen(false);
    setIsFilePanelMaximized(false);
    setUploadedBytes(null);
    setFields(EMPTY_FIELDS);
    setError("");
    setIsAnalyzing(false);
    setIsSaving(false);
  };

  const handleClose = async () => {
    if (isSaving) return;
    if (file && !(await confirmLeavePage())) return;
    allowLeave();
    reset();
    onCancel();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canCreateShipment) return;
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (!isSupportedDocumentFile(selected)) {
      setError(t("piPdfOnly"));
      return;
    }
    // PI được phân tích OCR qua gateway (giới hạn 4,5 MB mỗi request).
    if (selected.size > MAX_OCR_FILE_BYTES) {
      setError(t("ocrFileTooLarge", { file: selected.name, size: formatFileSize(selected.size), max: "4 MB" }));
      return;
    }

    setFile(selected);
    uploadRequestIdRef.current = crypto.randomUUID();
    setError("");
    setIsAnalyzing(true);
    try {
      const result = await analyzeDocument({ documentType: "PI", file: selected });
      const mappedRows = result.data.map(mapOcrFields);
      if (mappedRows.length === 0) throw new Error(t("noOcrProducts"));
      if (result.aiAvailable === false) notify(t("ocrAiUnavailable"), "warning");
      const mapped = mappedRows[0];
      const supplier = suppliers.find((item) => item.id_ncc === mapped.supplierId)
        || findBestCatalogMatch(mapped.supplier, suppliers, "ten_ncc");
      setFields(supplier
        ? { orderCode: mapped.orderCode, orderDate: mapped.orderDate, supplier: supplier.ten_ncc, supplierId: supplier.id_ncc, origin: String(supplier.quoc_gia || ""), productName: mapped.productName }
        : { orderCode: mapped.orderCode, orderDate: mapped.orderDate, supplier: mapped.supplier, supplierId: mapped.supplierId, origin: mapped.origin, productName: mapped.productName });
    } catch (err) {
      setFile(null);
      setError(err instanceof Error ? err.message : t("analyzePiError"));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateField = (key: keyof ReviewFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
  };

  const handleSupplierChange = (supplierName: string) => {
    const supplier = suppliers.find((item) => item.ten_ncc === supplierName);
    setFields((current) => ({
      ...current,
      supplier: supplierName,
      supplierId: supplier?.id_ncc || "",
      origin: String(supplier?.quoc_gia || ""),
    }));
  };

  const normalizedOrderCode = fields.orderCode.trim().toUpperCase().replace(/\s+/g, "");
  const duplicateOrderCode = Boolean(normalizedOrderCode && existingOrderCodes.some(
    (code) => code.trim().toUpperCase().replace(/\s+/g, "") === normalizedOrderCode,
  ));
  const missingRequiredFields = REQUIRED_REVIEW_FIELDS
    .filter(({ key }) => {
      if (!fields[key].trim()) return true;
      if (key === "supplier") return !suppliers.some((supplier) => supplier.ten_ncc === fields.supplier);
      return false;
    })
    .map(({ labelKey }) => t(labelKey));
  const hasMissingRequiredFields = missingRequiredFields.length > 0;

  const handleConfirm = async () => {
    if (!canCreateShipment || !file || isSaving) return;
    if (duplicateOrderCode) {
      setError(t("duplicatePi", { orderCode: fields.orderCode.trim() }));
      return;
    }
    if (hasMissingRequiredFields) {
      setError(t("completeRequired", { fields: missingRequiredFields.join(", ") }));
      return;
    }
    if (normalizedOrderCode.length > 100) {
      setError(t("orderCodeTooLong"));
      return;
    }
    const supplier = suppliers.find((item) => item.id_ncc === fields.supplierId)
      || suppliers.find((item) => normalizeKey(item.ten_ncc) === normalizeKey(fields.supplier));
    if (!supplier) {
      setError(t("supplierNotFound", { supplier: fields.supplier.trim() }));
      return;
    }
    setIsSaving(true);
    setError("");
    let shipmentCreated = false;
    try {
      // Kiểm tra trùng tên file PI trước khi ghi DB để không tạo đơn rỗng khi upload bị từ chối.
      const nameCheck = await checkDocumentFileNames({ orderCode: normalizedOrderCode, documentCode: "PI", fileNames: [file.name] });
      if (nameCheck.hasDuplicates) {
        setError(t("duplicateDocumentFileNames", {
          files: `${nameCheck.files[0]?.targetName || file.name} (${t("duplicateReasonExists", { folder: nameCheck.folderName })})`,
        }));
        return;
      }
      await createDatabaseRow<PurchaseRecord>(databaseEndpoints.purchases, {
        ma_hop_dong: normalizedOrderCode,
        ngay_hop_dong: normalizeDatabaseDate(fields.orderDate),
        ma_inv: null,
        ngay_inv: null,
        id_ncc: supplier.id_ncc,
        is_deleted: false,
      });
      await createDatabaseRow(databaseEndpoints.purchaseDetails, {
        ma_hop_dong: normalizedOrderCode,
        ten_hang: fields.productName.trim(),
      });
      shipmentCreated = true;
      setUploadedBytes(0);
      await uploadDocument({
        orderCode: normalizedOrderCode,
        documentCode: "PI",
        file,
        requestId: uploadRequestIdRef.current || (uploadRequestIdRef.current = crypto.randomUUID()),
        batch: createUploadBatch(1),
      }, { onProgress: ({ loaded }) => setUploadedBytes(loaded) });
      recordActivity(user, {
        action: "CREATE_SHIPMENT",
        location: "ShipmentDashboard/CreateShipmentModal",
        detail: `Tạo đơn hàng ${fields.orderCode.trim()}`,
      });
      notify(t("shipmentCreated", { orderCode: fields.orderCode.trim() }), "success");
      allowLeave();
      reset();
      onCreated(normalizedOrderCode);
    } catch (err) {
      const reason = err instanceof Error ? err.message : t("createShipmentError");
      if (shipmentCreated) {
        // Đơn đã ghi DB nhưng PI chưa lên Drive: báo rõ để upload lại PI ở chi tiết đơn, không tạo đơn lần nữa.
        const message = t("shipmentCreatedPiUploadFailed", { orderCode: normalizedOrderCode, reason });
        notify(message, "error");
        allowLeave();
        reset();
        onCreated(normalizedOrderCode);
        return;
      }
      setError(reason);
      notify(reason, "error");
    } finally {
      setUploadedBytes(null);
      setIsSaving(false);
    }
  };

  const reviewFields: Array<[keyof ReviewFields, string]> = [
    ["orderCode", "orderCode"],
    ["orderDate", "piDate"],
    ["supplier", "supplier"],
    ["origin", "origin"],
    ["productName", "productName"],
  ];

  return (
    <>
      {/* Đang xem PI (từ md): như modal cũ — nền mờ phủ cả trang, form nổi ở nửa trái, file ở nửa phải. */}
      {isSplitPreview && <div className="fixed inset-0 z-[100000] hidden bg-gray-400/50 backdrop-blur-[32px] md:block" aria-hidden="true" />}
      <div className={isSplitPreview
        ? "mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-3 custom-scrollbar md:fixed md:bottom-4 md:left-4 md:top-4 md:z-[100000] md:mx-0 md:w-[calc(50vw-1.5rem)] md:max-w-none md:overflow-y-auto md:overscroll-contain md:rounded-3xl md:bg-white md:p-4 md:shadow-2xl dark:md:bg-gray-900"
        : "mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-3"}>
      <button
        type="button"
        onClick={() => void handleClose()}
        disabled={isSaving}
        className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-gray-500 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:text-brand-300"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        {t("backToShipmentList")}
      </button>
      <section className="flex min-w-0 flex-col rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-4 pb-4 pt-5 dark:border-gray-800 sm:px-6 sm:pt-6">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{t("createNewShipment")}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("selectPiDescription")}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-6">
        <input ref={inputRef} type="file" accept={DOCUMENT_FILE_ACCEPT} className="hidden" onChange={handleFileChange} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={!canCreateShipment || isAnalyzing || isSaving} className="rounded-xl border border-dashed border-brand-300 bg-brand-50 px-4 py-5 text-sm font-semibold text-brand-600 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300">
          {file ? file.name : t("selectPi")}
        </button>

        {isAnalyzing && <OcrLoadingCard title={t("analyzingPi")} fileName={file?.name} />}
        {duplicateOrderCode && <p className="rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-600">{t("duplicateOrder", { orderCode: fields.orderCode.trim() })}</p>}
        {error && !duplicateOrderCode && <p className="rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-600">{error}</p>}

        {file && !isAnalyzing && (
          <>
            <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
              {t("reviewOcrBeforeCreate")}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="hidden">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t("selectedPiFile")}</p>
                {filePreviewUrl && <button type="button" onClick={() => setIsFilePanelOpen(true)} className="mt-3 inline-flex w-fit items-center rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600">{t("viewPiFile")}</button>}
              </div>
              <div className="col-span-full grid content-start gap-3 sm:grid-cols-2">
                {reviewFields.map(([key, labelKey]) => (
                  <label key={key} className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                    <span>{t(labelKey)} <span className="text-error-500">*</span></span>
                    {key === "supplier" ? (
                      <select value={fields.supplier} onChange={(event) => handleSupplierChange(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                          <option value="">{t("selectSupplier")}</option>
                          {fields.supplier && !suppliers.some((supplier) => supplier.ten_ncc === fields.supplier) && (
                            <option value={fields.supplier} disabled>{t("ocrNotMatched", { value: fields.supplier })}</option>
                          )}
                          {suppliers.map((supplier) => <option key={supplier.id_ncc} value={supplier.ten_ncc}>{supplier.ten_ncc}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={fields[key]} readOnly={key === "origin"} onChange={(event) => updateField(key, event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 read-only:cursor-not-allowed read-only:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:read-only:bg-gray-800" />
                    )}
                  </label>
                ))}
              </div>
            </div>
            {hasMissingRequiredFields && (
              <p className="text-xs text-error-600 dark:text-error-400">
                {t("requiredMissing", { fields: missingRequiredFields.join(", ") })}
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-4 py-4 dark:border-gray-800 sm:px-6">
        {filePreviewUrl && <button type="button" onClick={() => setIsFilePanelOpen(true)} className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">{t("viewPiFile")}</button>}
        <button type="button" onClick={() => void handleClose()} disabled={isSaving} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{t("cancel")}</button>
        <button type="button" onClick={handleConfirm} disabled={!canCreateShipment || !file || isAnalyzing || isSaving || duplicateOrderCode || hasMissingRequiredFields} title={hasMissingRequiredFields ? t("requiredMissing", { fields: missingRequiredFields.join(", ") }) : undefined} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{isSaving ? t("saving") : t("confirmCreate")}</button>
      </div>
      </section>
      </div>
      {uploadedBytes !== null && file && <UploadProgressToast fileName={file.name} loaded={uploadedBytes} size={file.size} />}
      {isFilePanelOpen && filePreviewUrl && (
        <aside className={`fixed right-0 top-0 z-[100000] flex h-screen min-h-0 flex-col border-l border-gray-200 bg-white shadow-2xl transition-all duration-300 dark:border-gray-700 dark:bg-gray-900 ${isFilePanelMaximized ? "w-full" : "w-[92vw] md:w-1/2"}`}>
          <div className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800 dark:text-white">{file?.name || "File PI"}</p>
            <button type="button" onClick={() => setIsFilePanelMaximized((current) => !current)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{isFilePanelMaximized ? t("minimize") : t("maximize")}</button>
            <button type="button" onClick={() => { setIsFilePanelOpen(false); setIsFilePanelMaximized(false); }} aria-label={t("closePiFile")} title={t("closePiFile")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-error-50 hover:text-error-600 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-error-500/10 dark:hover:text-error-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-gray-100 p-2 custom-scrollbar dark:bg-gray-950">
            <iframe title={t("viewFileTitle", { file: file?.name || "PI" })} src={filePreviewUrl} className="block h-[calc(100vh-4.5rem)] min-h-[720px] w-full rounded-lg bg-white" />
          </div>
        </aside>
      )}
      {filePreviewUrl && isFilePanelOpen && (
        <button type="button" onClick={() => { setIsFilePanelOpen(false); setIsFilePanelMaximized(false); }} className="fixed right-0 top-1/2 z-[100001] -translate-y-1/2 rounded-l-xl border border-r-0 border-brand-200 bg-brand-500 px-3 py-4 text-sm font-semibold text-white shadow-lg hover:bg-brand-600" aria-label={t("closePiFile")}>
          → File
        </button>
      )}
      {filePreviewUrl && !isFilePanelOpen && file && !isAnalyzing && (
        <button type="button" onClick={() => setIsFilePanelOpen(true)} className="fixed right-0 top-1/2 z-[100000] -translate-y-1/2 rounded-l-xl border border-r-0 border-brand-200 bg-brand-500 px-3 py-4 text-sm font-semibold text-white shadow-lg hover:bg-brand-600" aria-label={t("openPiFile")}>
          ← File
        </button>
      )}
    </>
  );
}
