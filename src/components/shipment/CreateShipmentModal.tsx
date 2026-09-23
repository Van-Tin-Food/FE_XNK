"use client";

import React, { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { analyzeDocument, uploadDocument } from "@/services/shipmentApi";
import { createDatabaseRow, databaseEndpoints, listDatabaseRows } from "@/services/postgresShipmentApi";
import type { PurchaseRecord, SupplierRecord } from "@/types/postgresShipment";
import { useAuth } from "@/context/AuthContext";
import { canPerformShipmentAction } from "@/config/shipmentActionPermissions";
import { recordActivity } from "@/services/activityLogApi";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { useLanguage } from "@/context/LanguageContext";
import { findBestCatalogMatch, normalizeCatalogText } from "@/utils/masterDataMatching";
import { DOCUMENT_FILE_ACCEPT, getDocumentMimeType, isSupportedDocumentFile } from "@/utils/documentFile";

interface CreateShipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  existingOrderCodes: string[];
}

interface ReviewFields {
  orderCode: string;
  orderDate: string;
  supplier: string;
  supplierId: string;
  origin: string;
}

const REQUIRED_REVIEW_FIELDS: Array<{ key: keyof ReviewFields; labelKey: string }> = [
  { key: "orderCode", labelKey: "orderCode" },
  { key: "orderDate", labelKey: "piDate" },
  { key: "supplier", labelKey: "supplier" },
  { key: "origin", labelKey: "origin" },
];

const EMPTY_FIELDS: ReviewFields = {
  orderCode: "",
  orderDate: "",
  supplier: "",
  supplierId: "",
  origin: "",
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
  return {
    orderCode: readField(data, ["Số HĐ", "Order_code", "Order code"]),
    orderDate: readField(data, ["Ngày HĐ PI", "Ngày HĐ", "Order date"]),
    supplier: readField(data, ["Nhà cung cấp", "Nha_cung_cap"]),
    supplierId: readField(data, ["id_ncc", "ID NCC"]),
    origin: readField(data, ["XUẤT XỨ", "Xuat_xu"]),
  };
}

function fileToBase64(file: File, errorMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error(errorMessage));
      resolve(reader.result.includes(",") ? reader.result.split(",", 2)[1] : reader.result);
    };
    reader.onerror = () => reject(new Error(errorMessage));
    reader.readAsDataURL(file);
  });
}

export default function CreateShipmentModal({ isOpen, onClose, onCreated, existingOrderCodes }: CreateShipmentModalProps) {
  const { user } = useAuth();
  const { notify } = useSystemNotification();
  const { t } = useLanguage();
  const canCreateShipment = canPerformShipmentAction(user, "createShipment");
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRequestIdRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isFilePanelOpen, setIsFilePanelOpen] = useState(false);
  const [isFilePanelMaximized, setIsFilePanelMaximized] = useState(false);
  const [fileData, setFileData] = useState("");
  const [fields, setFields] = useState<ReviewFields>(EMPTY_FIELDS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);

  useEffect(() => {
    if (isOpen && !file) {
      const timer = window.setTimeout(() => inputRef.current?.click(), 150);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, file]);

  useEffect(() => {
    if (!isOpen) return;
    void listDatabaseRows<SupplierRecord>(databaseEndpoints.suppliers)
      .then(setSuppliers)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : t("supplierLoadError")));
  }, [isOpen, t]);

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
    setFileData("");
    setFields(EMPTY_FIELDS);
    setError("");
    setIsAnalyzing(false);
    setIsSaving(false);
  };

  const handleClose = () => {
    reset();
    onClose();
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

    setFile(selected);
    uploadRequestIdRef.current = crypto.randomUUID();
    setError("");
    setIsAnalyzing(true);
    try {
      const base64 = await fileToBase64(selected, t("readPiError"));
      setFileData(base64);
      const result = await analyzeDocument({ documentType: "PI", file: selected });
      const mappedRows = result.data.map(mapOcrFields);
      if (mappedRows.length === 0) throw new Error(t("noOcrProducts"));
      const mapped = mappedRows[0];
      const supplier = suppliers.find((item) => item.id_ncc === mapped.supplierId)
        || findBestCatalogMatch(mapped.supplier, suppliers, "ten_ncc");
      setFields(supplier
        ? { orderCode: mapped.orderCode, orderDate: mapped.orderDate, supplier: supplier.ten_ncc, supplierId: supplier.id_ncc, origin: String(supplier.quoc_gia || "") }
        : { orderCode: mapped.orderCode, orderDate: mapped.orderDate, supplier: mapped.supplier, supplierId: mapped.supplierId, origin: mapped.origin });
    } catch (err) {
      setFile(null);
      setFileData("");
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
    if (!canCreateShipment || !file || !fileData || isSaving) return;
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
    try {
      await createDatabaseRow<PurchaseRecord>(databaseEndpoints.purchases, {
        ma_hop_dong: normalizedOrderCode,
        ngay_hop_dong: normalizeDatabaseDate(fields.orderDate),
        ma_inv: null,
        ngay_inv: null,
        id_ncc: supplier.id_ncc,
        is_deleted: false,
      });
      await uploadDocument({
        action: "uploadDocument",
        orderCode: normalizedOrderCode,
        documentCode: "PI",
        fileName: file.name,
        fileData,
        mimeType: getDocumentMimeType(file),
        requestId: uploadRequestIdRef.current || (uploadRequestIdRef.current = crypto.randomUUID()),
      });
      recordActivity(user, {  
        action: "CREATE_SHIPMENT",
        location: "ShipmentDashboard/CreateShipmentModal",
        detail: `Tạo đơn hàng ${fields.orderCode.trim()}`,
      });
      await onCreated();
      notify(t("shipmentCreated", { orderCode: fields.orderCode.trim() }), "success");
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createShipmentError"));
    } finally {
      setIsSaving(false);
    }
  };

  const reviewFields: Array<[keyof ReviewFields, string]> = [
    ["orderCode", "orderCode"],
    ["orderDate", "piDate"],
    ["supplier", "supplier"],
    ["origin", "origin"],
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        className={`mx-2 my-2 flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-5xl flex-col overflow-hidden transition-[width,transform] duration-300 sm:mx-4 sm:my-4 sm:max-h-[94vh] sm:w-full ${isFilePanelOpen && !isFilePanelMaximized ? "md:w-[calc(50vw-1.5rem)] md:max-w-none md:-translate-x-1/2" : ""}`}
      >
      <div className="border-b border-gray-100 px-6 pb-4 pt-6 dark:border-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("createNewShipment")}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("selectPiDescription")}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-6 py-5 custom-scrollbar">
        <input ref={inputRef} type="file" accept={DOCUMENT_FILE_ACCEPT} className="hidden" onChange={handleFileChange} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={!canCreateShipment || isAnalyzing || isSaving} className="rounded-xl border border-dashed border-brand-300 bg-brand-50 px-4 py-5 text-sm font-semibold text-brand-600 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300">
          {file ? file.name : t("selectPi")}
        </button>

        {isAnalyzing && <p className="text-center text-sm text-gray-500">{t("analyzingPi")}</p>}
        {duplicateOrderCode && <p className="rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-600">{t("duplicateOrder", { orderCode: fields.orderCode.trim() })}</p>}
        {error && !duplicateOrderCode && <p className="rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-600">{error}</p>}

        {file && !isAnalyzing && !error && (
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
                        {fields.supplier && !suppliers.some((supplier) => normalizeCatalogText(supplier.ten_ncc) === normalizeCatalogText(fields.supplier)) && (
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
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
        {filePreviewUrl && <button type="button" onClick={() => setIsFilePanelOpen(true)} className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">{t("viewPiFile")}</button>}
        <button type="button" onClick={handleClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{t("cancel")}</button>
        <button type="button" onClick={handleConfirm} disabled={!canCreateShipment || !file || isAnalyzing || isSaving || duplicateOrderCode || hasMissingRequiredFields} title={hasMissingRequiredFields ? t("requiredMissing", { fields: missingRequiredFields.join(", ") }) : undefined} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{isSaving ? t("saving") : t("confirmCreate")}</button>
      </div>
    </Modal>
      {isFilePanelOpen && filePreviewUrl && (
        <aside className={`fixed right-0 top-0 z-[100000] flex h-screen min-h-0 flex-col border-l border-gray-200 bg-white shadow-2xl transition-all duration-300 dark:border-gray-700 dark:bg-gray-900 ${isFilePanelMaximized ? "w-full" : "w-[92vw] md:w-1/2"}`}>
          <div className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800 dark:text-white">{file?.name || "File PI"}</p>
            <button type="button" onClick={() => setIsFilePanelMaximized((current) => !current)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{isFilePanelMaximized ? t("minimize") : t("maximize")}</button>
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
