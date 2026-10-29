"use client";

import SearchSuggestions from "@/components/common/SearchSuggestions";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { sendContactEmail } from "@/services/emailApi";
import { databaseEndpoints, listDatabaseRows } from "@/services/postgresShipmentApi";
import type { SupplierRecord } from "@/types/postgresShipment";
import { supplierContacts } from "@/utils/supplierContacts";
import EmailSendingIndicator from "@/components/email/EmailSendingIndicator";
import PaginationControls from "@/components/common/PaginationControls";
import { paginateItems } from "@/utils/pagination";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const MAX_EMAIL_RECIPIENTS = 15;

/** Một email người nhận = một người liên hệ có email của nhà cung cấp (NCC có nhiều liên hệ thì nhiều người nhận). */
interface Recipient {
  key: string;
  supplierId: string;
  supplierName: string;
  contactName: string;
  email: string;
}

function recipientsOf(supplier: SupplierRecord): Recipient[] {
  return supplierContacts(supplier.lien_he)
    .filter((contact) => contact.email)
    .map((contact, index) => ({
      key: `${supplier.id_ncc}#${index}`,
      supplierId: supplier.id_ncc,
      supplierName: supplier.ten_ncc,
      contactName: contact.ten_nguoi_lien_he || "",
      email: contact.email || "",
    }));
}

export default function EmailPage() {
  const { can } = useAuth();
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const router = useRouter();
  const canSend = can("email", "edit");
  const canView = can("email");
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierPageSize, setSupplierPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadSuppliers = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError("");
    try {
      const rows = await listDatabaseRows<SupplierRecord>(databaseEndpoints.suppliers);
      setSuppliers(rows.filter((row) => String(row.ten_ncc || "").trim()));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("emailSupplierLoadError"));
    } finally {
      setLoading(false);
    }
  }, [canView, t]);

  useEffect(() => {
    if (!canView) {
      router.replace("/");
      return;
    }
    void loadSuppliers();
  }, [canView, loadSuppliers, router]);

  const recipientsBySupplier = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id_ncc, recipientsOf(supplier)])), [suppliers]);
  const filteredSuppliers = useMemo(() => {
    const query = supplierQuery.trim().toLocaleLowerCase("vi");
    return suppliers.filter((supplier) => {
      if (countryFilter && String(supplier.quoc_gia || "").trim() !== countryFilter) return false;
      if (!query) return true;
      const contacts = supplierContacts(supplier.lien_he).flatMap((contact) => [contact.ten_nguoi_lien_he, contact.email]);
      return [supplier.ten_ncc, ...contacts].join(" ").toLocaleLowerCase("vi").includes(query);
    });
  }, [countryFilter, supplierQuery, suppliers]);
  const countries = useMemo(() => Array.from(new Set(suppliers.map((supplier) => String(supplier.quoc_gia || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi")), [suppliers]);
  const selectedRecipients = useMemo(
    () => suppliers.flatMap((supplier) => recipientsBySupplier.get(supplier.id_ncc) || []).filter((recipient) => selectedKeys.includes(recipient.key)),
    [recipientsBySupplier, selectedKeys, suppliers],
  );
  const selectedSupplierCount = new Set(selectedRecipients.map((recipient) => recipient.supplierId)).size;
  const selectableKeys = filteredSuppliers.flatMap((supplier) => (recipientsBySupplier.get(supplier.id_ncc) || []).map((recipient) => recipient.key));
  const allVisibleSelected = selectableKeys.slice(0, MAX_EMAIL_RECIPIENTS).every((key) => selectedKeys.includes(key)) && selectableKeys.length > 0;
  const canSubmit = canSend && selectedRecipients.length > 0 && Boolean(message.trim()) && !sending;
  const supplierPagination = paginateItems(filteredSuppliers, supplierPage, supplierPageSize);

  const toggleAll = () => {
    const keys = selectableKeys.slice(0, MAX_EMAIL_RECIPIENTS);
    if (selectableKeys.length > MAX_EMAIL_RECIPIENTS) notify(t("emailSelectLimit", { count: MAX_EMAIL_RECIPIENTS }), "warning");
    setSelectedKeys((current) => allVisibleSelected ? current.filter((key) => !keys.includes(key)) : [...new Set([...current, ...keys])].slice(0, MAX_EMAIL_RECIPIENTS));
  };

  /** Chọn / bỏ mọi email của một nhà cung cấp; vượt giới hạn thì chỉ thêm phần còn chỗ và báo. */
  const toggleSupplier = (supplierId: string) => {
    const keys = (recipientsBySupplier.get(supplierId) || []).map((recipient) => recipient.key);
    if (keys.length === 0) return;
    if (keys.every((key) => selectedKeys.includes(key))) {
      setSelectedKeys((current) => current.filter((key) => !keys.includes(key)));
      return;
    }
    const missing = keys.filter((key) => !selectedKeys.includes(key));
    const room = MAX_EMAIL_RECIPIENTS - selectedKeys.length;
    if (missing.length > room) notify(t("emailSendLimit", { count: MAX_EMAIL_RECIPIENTS }), "warning");
    if (room > 0) setSelectedKeys((current) => [...current, ...missing.slice(0, room)]);
  };

  const toggleRecipient = (key: string) => {
    if (!selectedKeys.includes(key) && selectedKeys.length >= MAX_EMAIL_RECIPIENTS) {
      notify(t("emailSendLimit", { count: MAX_EMAIL_RECIPIENTS }), "warning");
      return;
    }
    setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const send = async () => {
    // name = tên nhà cung cấp: BE dùng làm tiêu đề email (formatInquirySubject) và tên người nhận.
    const recipients = selectedRecipients.map((recipient) => ({ email: recipient.email, name: recipient.supplierName }));
    if (!canSubmit || recipients.length === 0) return;

    setSending(true);
    try {
      const result = await sendContactEmail({ message: message.trim(), recipients });
      notify(
        result.failedCount
          ? t("emailPartialSuccess", { sent: result.sentCount || 0, failed: result.failedCount })
          : t("emailSentSuccessCount", { count: result.sentCount || recipients.length }),
        result.failedCount ? "warning" : "success",
      );
      setMessage("");
      setSelectedKeys([]);
    } catch (sendError) {
      notify(sendError instanceof Error ? sendError.message : t("emailSendError"), "error");
    } finally {
      setSending(false);
    }
  };

  if (!canView) return null;

  return (
    <section className="space-y-5">
      <EmailSendingIndicator sending={sending} total={selectedRecipients.length} />
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">{t("emailPageTitle")}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("emailPageDescription")}</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("emailMaxRecipients", { count: MAX_EMAIL_RECIPIENTS })}</p>
      </div>
      {error && <div className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">{error}</div>}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(360px,1.1fr)_minmax(360px,0.9fr)]">
        <div className="min-w-0">
          <SupplierList
            suppliers={supplierPagination.items}
            suggestionSuppliers={suppliers}
            recipientsBySupplier={recipientsBySupplier}
            query={supplierQuery}
            countryFilter={countryFilter}
            countries={countries}
            selectedKeys={selectedKeys}
            selectedSupplierCount={selectedSupplierCount}
            allSelected={allVisibleSelected}
            loading={loading}
            canSend={canSend}
            onQuery={(value) => { setSupplierQuery(value); setSupplierPage(1); }}
            onCountry={(value) => { setCountryFilter(value); setSupplierPage(1); }}
            onToggleAll={toggleAll}
            onToggleSupplier={toggleSupplier}
            onToggleRecipient={toggleRecipient}
          />
          <PaginationControls
            page={supplierPagination.safePage}
            totalPages={supplierPagination.totalPages}
            pageSize={supplierPageSize}
            totalItems={supplierPagination.total}
            from={supplierPagination.from}
            to={supplierPagination.to}
            summaryKey="showingRecords"
            idPrefix="email-suppliers"
            onPageChange={setSupplierPage}
            onPageSizeChange={(value) => { setSupplierPageSize(value); setSupplierPage(1); }}
          />
        </div>
        <Compose
          selectedRecipients={selectedRecipients}
          message={message}
          sending={sending}
          canSend={canSend}
          canSubmit={canSubmit}
          subject={t("emailSubjectTemplate")}
          onMessage={setMessage}
          onSend={() => void send()}
        />
      </div>
    </section>
  );
}

function SupplierList({ suppliers, suggestionSuppliers, recipientsBySupplier, query, countryFilter, countries, selectedKeys, selectedSupplierCount, allSelected, loading, canSend, onQuery, onCountry, onToggleAll, onToggleSupplier, onToggleRecipient }: {
  suppliers: SupplierRecord[];
  suggestionSuppliers: SupplierRecord[];
  recipientsBySupplier: Map<string, Recipient[]>;
  query: string;
  countryFilter: string;
  countries: string[];
  selectedKeys: string[];
  selectedSupplierCount: number;
  allSelected: boolean;
  loading: boolean;
  canSend: boolean;
  onQuery: (value: string) => void;
  onCountry: (value: string) => void;
  onToggleAll: () => void;
  onToggleSupplier: (supplierId: string) => void;
  onToggleRecipient: (key: string) => void;
}) {
  const { t } = useLanguage();
  const suggestions = suggestionSuppliers.flatMap((supplier) => [
    supplier.ten_ncc,
    ...supplierContacts(supplier.lien_he).flatMap((contact) => [contact.ten_nguoi_lien_he, contact.email]),
  ]).filter((value): value is string => Boolean(value));
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white xl:min-h-[520px] dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 p-4 dark:border-gray-800">
        <h2 className="font-semibold text-gray-800 dark:text-white/90">{t("suppliers")}</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select value={countryFilter} onChange={(event) => onCountry(event.target.value)} aria-label={t("country")} className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs outline-none focus:border-brand-400 sm:w-44 sm:shrink-0 dark:border-gray-700 dark:bg-gray-800 dark:text-white"><option value="">{t("allCountries")}</option>{countries.map((country) => <option key={country} value={country}>{country}</option>)}</select>
          <SearchSuggestions value={query} onChange={onQuery} suggestions={suggestions} placeholder={t("emailSearchSupplier")} ariaLabel={t("emailSearchSupplier")} className="h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
        </div>
      </div>
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={!canSend || loading} className="h-4 w-4 accent-brand-500" />
          {t("emailSelectAllWithEmail")}
        </label>
        <p className="mt-1 text-[11px] text-gray-400">{t("emailSelectedSuppliersCount", { count: selectedKeys.length, suppliers: selectedSupplierCount })}</p>
      </div>
      <div className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar xl:max-h-none">
        {loading ? <p className="p-3 text-xs text-gray-500">{t("emailLoading")}</p> : suppliers.length === 0 ? <p className="p-3 text-xs text-gray-500">{t("emailNoSuppliers")}</p> : suppliers.map((supplier) => {
          const recipients = recipientsBySupplier.get(supplier.id_ncc) || [];
          const selectedCount = recipients.filter((recipient) => selectedKeys.includes(recipient.key)).length;
          const allOfSupplier = recipients.length > 0 && selectedCount === recipients.length;
          return (
            <div key={supplier.id_ncc} className={`rounded-lg px-2.5 py-2 ${selectedCount > 0 ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"}`}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={allOfSupplier}
                  ref={(element) => { if (element) element.indeterminate = selectedCount > 0 && !allOfSupplier; }}
                  onChange={() => onToggleSupplier(supplier.id_ncc)}
                  disabled={!canSend || recipients.length === 0}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-gray-800 dark:text-white/90" title={supplier.ten_ncc}>{supplier.ten_ncc}</span>
                  {supplier.quoc_gia && <span className="block truncate text-[11px] text-gray-400">{supplier.quoc_gia}</span>}
                  {recipients.length === 0 && <span className="block text-[11px] text-amber-600">{t("emailSupplierNoAddress")}</span>}
                </span>
              </label>
              {recipients.length > 0 && (
                <div className="mt-1 space-y-0.5 pl-6">
                  {recipients.map((recipient) => (
                    <label key={recipient.key} className="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-white/70 dark:hover:bg-white/[0.04]">
                      <input type="checkbox" checked={selectedKeys.includes(recipient.key)} onChange={() => onToggleRecipient(recipient.key)} disabled={!canSend} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500" />
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] text-gray-600 dark:text-gray-300" title={recipient.email}>{recipient.email}</span>
                        {recipient.contactName && <span className="block truncate text-[11px] text-gray-400" title={recipient.contactName}>{recipient.contactName}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Compose({ selectedRecipients, message, sending, canSend, canSubmit, subject, onMessage, onSend }: {
  selectedRecipients: Recipient[];
  message: string;
  sending: boolean;
  canSend: boolean;
  canSubmit: boolean;
  subject: string;
  onMessage: (value: string) => void;
  onSend: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 xl:min-h-[520px] dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 pb-4 dark:border-gray-800">
        <h2 className="font-semibold text-gray-800 dark:text-white/90">{t("emailComposeTitle")}</h2>
        <p className="mt-1 text-xs text-gray-500">{t("emailPerSupplier")}</p>
      </div>
      <div className="space-y-4 pt-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("emailRecipientSupplier")}</label>
          <div className="max-h-32 min-h-10 overflow-y-auto break-words rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 custom-scrollbar dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{selectedRecipients.length ? selectedRecipients.map((recipient) => `${recipient.supplierName} <${recipient.email}>`).join(", ") : t("emailNoSelectedSuppliers")}</div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("emailSubjectLabel")}</label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{subject}</div>
        </div>
        <textarea value={message} onChange={(event) => onMessage(event.target.value)} disabled={!canSend || sending} rows={17} placeholder={t("emailMessagePlaceholder")} className="h-56 min-h-[200px] w-full sm:h-auto sm:min-h-[280px] resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <span className="text-xs text-gray-400">{t("emailSelectedRecipientsCount", { count: selectedRecipients.length })}</span>
        <button type="button" onClick={onSend} disabled={!canSubmit} className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">{sending ? t("emailSending") : t("emailSendButton")}</button>
      </div>
    </div>
  );
}
