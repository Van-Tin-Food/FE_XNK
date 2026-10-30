"use client";

import SearchSuggestions from "@/components/common/SearchSuggestions";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  type EmailJob,
  type EmailJobError,
  getCurrentEmailJob,
  getEmailJob,
  getEmailLastSent,
  startEmailJob,
} from "@/services/emailApi";
import { databaseEndpoints, listDatabaseRows } from "@/services/postgresShipmentApi";
import type { SupplierRecord } from "@/types/postgresShipment";
import { supplierContacts } from "@/utils/supplierContacts";
import {
  DEFAULT_EMAIL_FILTERS,
  type EmailRecipientOption,
  type EmailSupplierFilters,
  type EmailSupplierRow,
  type GroupSelectionState,
  MAX_EMAIL_RECIPIENTS,
  countryOptions,
  filterEmailSuppliers,
  groupSelectionState,
  hasActiveEmailFilters,
  toggleRecipientGroup,
} from "@/utils/emailRecipients";
import EmailSendProgress from "@/components/email/EmailSendProgress";
import PaginationControls from "@/components/common/PaginationControls";
import { paginateItems } from "@/utils/pagination";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Id lượt gửi đang theo dõi: tải lại trang vẫn xem tiếp được tiến độ / kết quả. */
const JOB_STORAGE_KEY = "xnk:email-job-id";
const POLL_INTERVAL_MS = 1500;
const POLL_RETRY_MS = 4000;

const SELECT_CLASS = "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs outline-none focus:border-brand-400 sm:h-9 dark:border-gray-700 dark:bg-gray-800 dark:text-white";

function recipientsOf(supplier: SupplierRecord): EmailRecipientOption[] {
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

function readStoredJobId(): string {
  try {
    return window.sessionStorage.getItem(JOB_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeJobId(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(JOB_STORAGE_KEY, id);
    else window.sessionStorage.removeItem(JOB_STORAGE_KEY);
  } catch {
    // Trình duyệt chặn sessionStorage: chỉ mất khả năng xem lại tiến độ sau khi tải lại trang.
  }
}

/** Checkbox nhóm: tích khi chọn hết, gạch ngang khi chọn một phần. */
function groupCheckboxRef(state: GroupSelectionState) {
  return (element: HTMLInputElement | null) => {
    if (element) element.indeterminate = state === "some";
  };
}

export default function EmailPage() {
  const { can } = useAuth();
  const { t, language } = useLanguage();
  const { notify } = useSystemNotification();
  const router = useRouter();
  const canSend = can("email", "edit");
  const canView = can("email");
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState<EmailSupplierFilters>(DEFAULT_EMAIL_FILTERS);
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierPageSize, setSupplierPageSize] = useState(15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSent, setLastSent] = useState<{ byEmail: Map<string, string>; loadedAt: number }>(() => ({ byEmail: new Map(), loadedAt: 0 }));
  const [lastSentError, setLastSentError] = useState(false);
  const [job, setJob] = useState<EmailJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [connectionLost, setConnectionLost] = useState(false);
  // Đang gửi: khoá chọn người nhận / nội dung / nút gửi cho tới khi lượt gửi xong.
  const sending = starting || job?.status === "running";

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

  const loadLastSent = useCallback(async () => {
    if (!canView) return;
    try {
      const rows = await getEmailLastSent();
      setLastSent({ byEmail: new Map(rows.map((row) => [row.email, row.lastSentAt])), loadedAt: Date.now() });
      setLastSentError(false);
    } catch {
      setLastSentError(true);
    }
  }, [canView]);

  useEffect(() => {
    if (!canView) {
      router.replace("/");
      return;
    }
    void loadSuppliers();
    void loadLastSent();
  }, [canView, loadLastSent, loadSuppliers, router]);

  const trackJob = useCallback((next: EmailJob) => {
    setJob(next);
    storeJobId(next.id);
    setConnectionLost(false);
  }, []);

  const closeJob = useCallback(() => {
    setJob(null);
    storeJobId(null);
  }, []);

  // Mở lại trang: theo dõi tiếp lượt đang chạy, hoặc xem lại kết quả lượt vừa gửi trong tab này.
  useEffect(() => {
    if (!canSend) return undefined;
    let cancelled = false;
    void (async () => {
      let resumed: EmailJob | null = null;
      try {
        resumed = await getCurrentEmailJob();
        const storedId = readStoredJobId();
        if (!resumed && storedId) resumed = await getEmailJob(storedId);
      } catch (resumeError) {
        if ((resumeError as EmailJobError).status === 404) storeJobId(null);
        return;
      }
      if (cancelled) return;
      if (resumed) {
        setJob((current) => current ?? resumed);
        storeJobId(resumed.id);
      } else {
        storeJobId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [canSend]);

  const handleFinished = useCallback((finished: EmailJob) => {
    if (finished.sentCount === 0) {
      notify(t("emailJobAllFailed", { failed: finished.failedCount }), "error");
    } else if (finished.failedCount > 0) {
      notify(t("emailPartialSuccess", { sent: finished.sentCount, failed: finished.failedCount }), "warning");
    } else {
      notify(t("emailSentSuccessCount", { count: finished.sentCount }), "success");
    }
    void loadLastSent();
  }, [loadLastSent, notify, t]);

  const jobId = job?.id;
  const jobRunning = job?.status === "running";
  useEffect(() => {
    if (!jobId || !jobRunning) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await getEmailJob(jobId);
        if (cancelled) return;
        setConnectionLost(false);
        setJob(next);
        if (next.status === "done") handleFinished(next);
        else setPollAttempt((value) => value + 1);
      } catch (pollError) {
        if (cancelled) return;
        if ((pollError as EmailJobError).status === 404) {
          closeJob();
          notify(t("emailJobLost"), "warning");
          return;
        }
        setConnectionLost(true);
        setPollAttempt((value) => value + 1);
      }
    }, connectionLost ? POLL_RETRY_MS : POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [closeJob, connectionLost, handleFinished, jobId, jobRunning, notify, pollAttempt, t]);

  const recipientsBySupplier = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id_ncc, recipientsOf(supplier)])), [suppliers]);
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const filteredRows = useMemo(
    () => filterEmailSuppliers(suppliers, recipientsBySupplier, filters, { lastSent: lastSent.byEmail, selectedKeys: selectedSet, now: lastSent.loadedAt }),
    [filters, lastSent, recipientsBySupplier, selectedSet, suppliers],
  );
  const countries = useMemo(() => countryOptions(suppliers), [suppliers]);
  const suggestions = useMemo(() => [...new Set(suppliers.flatMap((supplier) => [
    supplier.ten_ncc,
    ...supplierContacts(supplier.lien_he).flatMap((contact) => [contact.ten_nguoi_lien_he, contact.email]),
  ]).filter((value): value is string => Boolean(value)))], [suppliers]);
  const selectedRecipients = useMemo(
    () => suppliers.flatMap((supplier) => recipientsBySupplier.get(supplier.id_ncc) || []).filter((recipient) => selectedSet.has(recipient.key)),
    [recipientsBySupplier, selectedSet, suppliers],
  );
  const selectedSupplierCount = new Set(selectedRecipients.map((recipient) => recipient.supplierId)).size;
  const supplierPagination = paginateItems(filteredRows, supplierPage, supplierPageSize);
  // "Chọn tất cả" chỉ áp dụng cho các email đang hiện ở trang hiện tại (đúng trang đang xem, không phải trang 1).
  const pageKeys = supplierPagination.items.flatMap((row) => row.recipients.map((recipient) => recipient.key));
  const pageState = groupSelectionState(selectedSet, pageKeys);
  const canSubmit = canSend && selectedRecipients.length > 0 && Boolean(message.trim()) && !sending;

  const updateFilters = (patch: Partial<EmailSupplierFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setSupplierPage(1);
  };

  const applyToggle = (keys: string[]) => {
    if (sending) return;
    const { next, skipped } = toggleRecipientGroup(selectedKeys, keys, MAX_EMAIL_RECIPIENTS);
    if (skipped > 0) notify(t("emailSelectLimitSkipped", { count: MAX_EMAIL_RECIPIENTS, skipped }), "warning");
    setSelectedKeys(next);
  };

  const reselectFailed = () => {
    if (!job) return;
    const failedEmails = new Set(job.recipients.filter((recipient) => recipient.status === "not sent").map((recipient) => recipient.email.toLowerCase()));
    const keys: string[] = [];
    for (const recipient of suppliers.flatMap((supplier) => recipientsBySupplier.get(supplier.id_ncc) || [])) {
      const email = recipient.email.toLowerCase();
      if (!failedEmails.has(email)) continue;
      failedEmails.delete(email);
      keys.push(recipient.key);
    }
    setSelectedKeys(keys.slice(0, MAX_EMAIL_RECIPIENTS));
    closeJob();
  };

  const send = async () => {
    // name = tên nhà cung cấp: BE dùng làm tiêu đề email (formatInquirySubject) và tên người nhận.
    const recipients = selectedRecipients.map((recipient) => ({ email: recipient.email, name: recipient.supplierName }));
    if (!canSubmit || recipients.length === 0) return;

    setStarting(true);
    try {
      const started = await startEmailJob({ message: message.trim(), recipients });
      trackJob(started);
      // Người nhận đã chuyển sang khung tiến độ; nội dung giữ lại để gửi tiếp nhóm nhà cung cấp khác.
      setSelectedKeys([]);
      notify(t("emailJobStarted", { count: started.total }), "info");
    } catch (sendError) {
      const startError = sendError as EmailJobError;
      // Đã có lượt đang chạy (tab khác, hoặc request trước bị ngắt giữa chừng nhưng BE vẫn nhận): theo dõi lượt đó.
      const running = startError.job ?? await getCurrentEmailJob().catch(() => null);
      if (running) {
        trackJob(running);
        const runningEmails = new Set(running.recipients.map((recipient) => recipient.email.toLowerCase()));
        if (recipients.every((recipient) => runningEmails.has(recipient.email.toLowerCase()))) setSelectedKeys([]);
      }
      notify(startError.message || t("emailSendError"), "error");
    } finally {
      setStarting(false);
    }
  };

  if (!canView) return null;

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">{t("emailPageTitle")}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("emailPageDescription")}</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("emailMaxRecipients", { count: MAX_EMAIL_RECIPIENTS })}</p>
      </div>
      {job && <EmailSendProgress job={job} connectionLost={connectionLost} onClose={closeJob} onReselectFailed={reselectFailed} />}
      {error && <div className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">{error}</div>}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(360px,1.1fr)_minmax(360px,0.9fr)]">
        <div className="min-w-0">
          <SupplierList
            rows={supplierPagination.items}
            filteredCount={filteredRows.length}
            filters={filters}
            countries={countries}
            suggestions={suggestions}
            selectedSet={selectedSet}
            selectedCount={selectedKeys.length}
            selectedSupplierCount={selectedSupplierCount}
            pageKeyCount={pageKeys.length}
            pageState={pageState}
            lastSent={lastSent.byEmail}
            lastSentError={lastSentError}
            dateLocale={language === "vi" ? "vi-VN" : "en-GB"}
            loading={loading}
            disabled={!canSend || sending}
            onFilters={updateFilters}
            onClearFilters={() => { setFilters(DEFAULT_EMAIL_FILTERS); setSupplierPage(1); }}
            onTogglePage={() => applyToggle(pageKeys)}
            onClearSelection={() => { if (!sending) setSelectedKeys([]); }}
            onToggleSupplier={(row) => applyToggle(row.recipients.map((recipient) => recipient.key))}
            onToggleRecipient={(key) => applyToggle([key])}
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
          onRemoveRecipient={(key) => applyToggle([key])}
          onSend={() => void send()}
        />
      </div>
    </section>
  );
}

function SupplierList({
  rows, filteredCount, filters, countries, suggestions, selectedSet, selectedCount, selectedSupplierCount, pageKeyCount, pageState,
  lastSent, lastSentError, dateLocale, loading, disabled,
  onFilters, onClearFilters, onTogglePage, onClearSelection, onToggleSupplier, onToggleRecipient,
}: {
  rows: EmailSupplierRow[];
  filteredCount: number;
  filters: EmailSupplierFilters;
  countries: string[];
  suggestions: string[];
  selectedSet: ReadonlySet<string>;
  selectedCount: number;
  selectedSupplierCount: number;
  pageKeyCount: number;
  pageState: GroupSelectionState;
  lastSent: Map<string, string>;
  lastSentError: boolean;
  dateLocale: string;
  loading: boolean;
  disabled: boolean;
  onFilters: (patch: Partial<EmailSupplierFilters>) => void;
  onClearFilters: () => void;
  onTogglePage: () => void;
  onClearSelection: () => void;
  onToggleSupplier: (row: EmailSupplierRow) => void;
  onToggleRecipient: (key: string) => void;
}) {
  const { t } = useLanguage();
  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(dateLocale);
  };
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white xl:min-h-[520px] dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 p-4 dark:border-gray-800">
        <h2 className="font-semibold text-gray-800 dark:text-white/90">{t("suppliers")}</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2">
            <SearchSuggestions value={filters.query} onChange={(query) => onFilters({ query })} suggestions={suggestions} placeholder={t("emailSearchSupplier")} ariaLabel={t("emailSearchSupplier")} className={SELECT_CLASS} />
          </div>
          <select value={filters.country} onChange={(event) => onFilters({ country: event.target.value })} aria-label={t("country")} className={SELECT_CLASS}>
            <option value="">{t("allCountries")}</option>
            {countries.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
          <select value={filters.contact} onChange={(event) => onFilters({ contact: event.target.value as EmailSupplierFilters["contact"] })} aria-label={t("emailFilterContact")} className={SELECT_CLASS}>
            <option value="all">{t("emailFilterContactAll")}</option>
            <option value="withEmail">{t("emailFilterWithEmail")}</option>
            <option value="withoutEmail">{t("emailFilterWithoutEmail")}</option>
          </select>
          <select value={filters.history} onChange={(event) => onFilters({ history: event.target.value as EmailSupplierFilters["history"] })} aria-label={t("emailFilterHistory")} className={SELECT_CLASS}>
            <option value="all">{t("emailHistoryAll")}</option>
            <option value="never">{t("emailHistoryNever")}</option>
            <option value="notWithin7">{t("emailHistoryNotWithin7")}</option>
            <option value="notWithin30">{t("emailHistoryNotWithin30")}</option>
            <option value="within7">{t("emailHistoryWithin7")}</option>
          </select>
          <select value={filters.selection} onChange={(event) => onFilters({ selection: event.target.value as EmailSupplierFilters["selection"] })} aria-label={t("emailFilterSelection")} className={SELECT_CLASS}>
            <option value="all">{t("emailSelectionAll")}</option>
            <option value="selected">{t("emailSelectionSelected")}</option>
            <option value="unselected">{t("emailSelectionUnselected")}</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">{t("emailFilteredCount", { count: filteredCount })}</span>
          {hasActiveEmailFilters(filters) && (
            <button type="button" onClick={onClearFilters} className="h-8 rounded-lg px-2 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10">{t("clearFilters")}</button>
          )}
        </div>
        {lastSentError && filters.history !== "all" && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{t("emailLastSentLoadError")}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
        <label className="flex min-h-9 items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={pageState === "all"}
            ref={groupCheckboxRef(pageState)}
            onChange={onTogglePage}
            disabled={disabled || loading || pageKeyCount === 0}
            className="h-4 w-4 accent-brand-500"
          />
          {t("emailSelectPage", { count: pageKeyCount })}
        </label>
        {selectedCount > 0 && (
          <button type="button" onClick={onClearSelection} disabled={disabled} className="h-8 rounded-lg px-2 text-xs font-semibold text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/[0.05]">{t("emailClearSelection")}</button>
        )}
        <p className="w-full text-[11px] text-gray-400">{t("emailSelectedSuppliersCount", { count: selectedCount, suppliers: selectedSupplierCount })}</p>
      </div>
      <div className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar xl:max-h-none">
        {loading ? <p className="p-3 text-xs text-gray-500">{t("emailLoading")}</p> : rows.length === 0 ? <p className="p-3 text-xs text-gray-500">{t("emailNoSuppliers")}</p> : rows.map((row) => {
          const { supplier, recipients } = row;
          const state = groupSelectionState(selectedSet, recipients.map((recipient) => recipient.key));
          return (
            <div key={supplier.id_ncc} className={`rounded-lg px-2.5 py-2 ${state !== "none" ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"}`}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={state === "all"}
                  ref={groupCheckboxRef(state)}
                  onChange={() => onToggleSupplier(row)}
                  disabled={disabled || recipients.length === 0}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-gray-800 dark:text-white/90" title={supplier.ten_ncc}>{supplier.ten_ncc}</span>
                  {supplier.quoc_gia && <span className="block truncate text-[11px] text-gray-400">{supplier.quoc_gia}</span>}
                  {row.totalRecipients === 0 && <span className="block text-[11px] text-amber-600">{t("emailSupplierNoAddress")}</span>}
                </span>
              </label>
              {recipients.length > 0 && (
                <div className="mt-1 space-y-0.5 pl-6">
                  {recipients.map((recipient) => {
                    const sentAt = lastSent.get(recipient.email.toLowerCase());
                    return (
                      <label key={recipient.key} className="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-white/70 dark:hover:bg-white/[0.04]">
                        <input type="checkbox" checked={selectedSet.has(recipient.key)} onChange={() => onToggleRecipient(recipient.key)} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500" />
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] text-gray-600 dark:text-gray-300" title={recipient.email}>{recipient.email}</span>
                          {recipient.contactName && <span className="block truncate text-[11px] text-gray-400" title={recipient.contactName}>{recipient.contactName}</span>}
                          {sentAt && <span className="block text-[11px] text-success-700 dark:text-success-300">{t("emailLastSent", { date: formatDate(sentAt) })}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Compose({ selectedRecipients, message, sending, canSend, canSubmit, subject, onMessage, onRemoveRecipient, onSend }: {
  selectedRecipients: EmailRecipientOption[];
  message: string;
  sending: boolean;
  canSend: boolean;
  canSubmit: boolean;
  subject: string;
  onMessage: (value: string) => void;
  onRemoveRecipient: (key: string) => void;
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
          <p className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("emailRecipientSupplier")}</p>
          <div className="flex max-h-40 min-h-10 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 custom-scrollbar dark:border-gray-700 dark:bg-gray-900">
            {selectedRecipients.length ? selectedRecipients.map((recipient) => (
              <span key={recipient.key} className="inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-full border border-gray-200 bg-white py-0.5 pl-2.5 pr-0.5 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                <span className="min-w-0 truncate" title={`${recipient.supplierName} <${recipient.email}>`}>{recipient.supplierName} &lt;{recipient.email}&gt;</span>
                <button
                  type="button"
                  onClick={() => onRemoveRecipient(recipient.key)}
                  disabled={sending || !canSend}
                  aria-label={t("emailRemoveRecipient", { email: recipient.email })}
                  title={t("emailRemoveRecipient", { email: recipient.email })}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08] dark:hover:text-white"
                >
                  ×
                </button>
              </span>
            )) : <span className="px-1 py-0.5 text-xs text-gray-500 dark:text-gray-400">{t("emailNoSelectedSuppliers")}</span>}
          </div>
        </div>
        <div>
          <p className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("emailSubjectLabel")}</p>
          <div className="break-words rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{subject}</div>
        </div>
        <textarea value={message} onChange={(event) => onMessage(event.target.value)} disabled={!canSend || sending} rows={17} aria-label={t("emailMessageLabel")} placeholder={t("emailMessagePlaceholder")} className="h-56 min-h-[200px] w-full sm:h-auto sm:min-h-[280px] resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-800" />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <span className="text-xs text-gray-400">{t("emailSelectedRecipientsCount", { count: selectedRecipients.length })} / {MAX_EMAIL_RECIPIENTS}</span>
        <button type="button" onClick={onSend} disabled={!canSubmit} className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">{sending ? t("emailSending") : t("emailSendButton")}</button>
      </div>
    </div>
  );
}
