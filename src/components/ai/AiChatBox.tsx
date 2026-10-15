"use client";

import { canPerformShipmentAction } from "@/config/shipmentActionPermissions";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import type { ApiError } from "@/utils/apiError";
import { AI_CHAT_MAX_QUESTION_LENGTH, askAiChat, prepareAiChat, type AiChatResult, type AiChatSection, type AiChatTurn } from "@/services/aiChatApi";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  results?: AiChatResult[];
  error?: boolean;
  /** Câu hỏi gây lỗi, để bấm "Thử lại". */
  retryQuestion?: string;
}

// Mã lỗi BE -> câu thông báo theo ngôn ngữ giao diện (getFriendlyMessage chỉ có tiếng Việt).
const ERROR_KEYS: Record<string, string> = {
  AI_CHAT_NOT_CONFIGURED: "aiChatErrorNotConfigured",
  AI_CHAT_TIMEOUT: "aiChatErrorTimeout",
  AI_CHAT_RATE_LIMITED: "aiChatErrorRateLimited",
  AI_CHAT_QUESTION_REQUIRED: "aiChatErrorQuestion",
  AI_CHAT_QUESTION_TOO_LONG: "aiChatErrorQuestion",
};

function chatErrorMessage(error: unknown, t: (key: string) => string): string {
  const apiError = error as ApiError | undefined;
  const key = apiError?.code ? ERROR_KEYS[apiError.code] : undefined;
  if (key) return t(key);
  if (apiError?.status === 401) return t("aiChatErrorSession");
  if (apiError?.status === 403) return t("aiChatErrorForbidden");
  return t("aiChatError");
}

const SUGGESTION_KEYS = ["aiChatSuggestUpcoming", "aiChatSuggestInDays", "aiChatSuggestOrder", "aiChatSuggestStats", "aiChatSuggestMissing"];
const HISTORY_TURNS = 6;

/** Icon chatbox AI: đầu robot kèm tia sáng ✦. */
function AiBotIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3.5V6" />
      <circle cx="10" cy="2.6" r="0.9" fill="currentColor" stroke="none" />
      <rect x="3" y="6" width="14" height="11" rx="3.5" />
      <path d="M1.5 10.5v3M18.5 10.5v3" />
      <circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <path d="M8 14.2c.6.5 1.2.7 2 .7s1.4-.2 2-.7" />
      <path d="M19.5 15.5l.6 1.5 1.4.6-1.4.6-.6 1.5-.6-1.5-1.4-.6 1.4-.6z" fill="currentColor" strokeWidth="1" />
      <path d="M21 2.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" fill="currentColor" strokeWidth="0.8" />
    </svg>
  );
}

/** Một bảng kết quả do backend mô tả. Màn hẹp: mỗi dòng thành thẻ "nhãn: giá trị"; rộng hơn là bảng. */
function SectionTable({ section }: { section: AiChatSection }) {
  const { t } = useLanguage();
  const isKeyValue = section.layout === "keyvalue";
  // Danh sách chỉ có một cột (vd chỉ số HĐ): hiển thị gọn thành các thẻ mã, không cần bảng.
  if (!isKeyValue && section.columns.length === 1 && section.rows.length > 0) {
    const key = section.columns[0].key;
    return (
      <div className="min-w-0 border-t border-gray-100 px-3 py-2.5 first:border-t-0 dark:border-gray-800">
        <ul className="flex flex-wrap gap-1.5" aria-label={section.columns[0].label}>
          {section.rows.map((row, index) => (
            <li key={`${row[key]}-${index}`} className="break-all rounded-lg bg-brand-50 px-2 py-1 font-mono text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{row[key]}</li>
          ))}
        </ul>
        {section.truncated && <p className="mt-1.5 text-[11px] text-gray-400">{t("aiChatTruncated")}</p>}
      </div>
    );
  }
  return (
    <div className="min-w-0 border-t border-gray-100 first:border-t-0 dark:border-gray-800">
      {section.title && <p className="px-3 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{section.title}</p>}
      {section.rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">{t("aiChatNoRows")}</p>
      ) : isKeyValue ? (
        <dl className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-2.5 text-xs">
          {section.rows.map((row, index) => (
            <React.Fragment key={`${row.field}-${index}`}>
              <dt className="text-gray-500 dark:text-gray-400">{row.field}</dt>
              <dd className="min-w-0 break-words font-medium text-gray-800 dark:text-white/90">{row.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 sm:hidden dark:divide-gray-800">
            {section.rows.map((row, index) => (
              <li key={index} className="px-3 py-2.5">
                <dl className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                  {section.columns.filter((column) => row[column.key]).map((column) => (
                    <React.Fragment key={column.key}>
                      <dt className="text-gray-400">{column.label}</dt>
                      <dd className="min-w-0 break-words font-medium text-gray-800 dark:text-white/90">{row[column.key]}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto custom-scrollbar sm:block">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                <tr>
                  {section.columns.map((column) => (
                    <th key={column.key} className={`whitespace-nowrap px-3 py-2 ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {section.rows.map((row, index) => (
                  <tr key={index} className="align-top">
                    {section.columns.map((column, columnIndex) => (
                      <td
                        key={column.key}
                        className={`min-w-[5rem] max-w-[16rem] break-words px-3 py-2 ${column.align === "right" ? "text-right tabular-nums" : ""} ${columnIndex === 0 ? "font-semibold text-brand-600 dark:text-brand-400" : "text-gray-700 dark:text-gray-300"}`}
                      >
                        {row[column.key] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {section.truncated && <p className="px-3 pb-2 text-[11px] text-gray-400">{t("aiChatTruncated")}</p>}
    </div>
  );
}

/** Kết quả một lần tra cứu: tiêu đề điều kiện + tóm tắt + các bảng; toàn bộ là dữ liệu thật do backend trả về. */
function ResultBlock({ result }: { result: AiChatResult }) {
  return (
    <div className="mt-2 min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <p className="min-w-0 break-words text-xs font-semibold text-gray-700 dark:text-gray-200">{result.title}</p>
        {result.summary && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{result.summary}</p>}
        {result.notice && <p className="mt-1 text-[11px] font-medium text-warning-600 dark:text-warning-400">{result.notice}</p>}
      </div>
      {result.sections.map((section, index) => <SectionTable key={index} section={section} />)}
    </div>
  );
}

/** Chatbox AI tra cứu đơn hàng (thử nghiệm, chỉ đọc). Gọi BE; BE gọi OpenRouter và truy vấn PostgreSQL. */
export default function AiChatBox() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const canUse = canPerformShipmentAction(user, "useAiChat");

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setIsPreparing(true);
    setIsReady(false);
    prepareAiChat(controller.signal)
      .then(() => setIsReady(true))
      .catch(() => setIsReady(false))
      .finally(() => setIsPreparing(false));
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") setIsOpen(false); };
    window.addEventListener("keydown", handleKey);
    return () => { controller.abort(); window.removeEventListener("keydown", handleKey); };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && isReady) inputRef.current?.focus();
  }, [isOpen, isReady]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question || isSending || !isReady) return;
    if (question.length > AI_CHAT_MAX_QUESTION_LENGTH) return;
    // Ngữ cảnh: chỉ vài lượt hỏi/đáp dạng chữ gần nhất, không gửi lại bảng dữ liệu.
    const history: AiChatTurn[] = messages
      .filter((message) => !message.error)
      .slice(-HISTORY_TURNS)
      .map((message) => ({ role: message.role, content: message.content }));
    setMessages((current) => [...current, { id: nextId.current++, role: "user", content: question }]);
    setInput("");
    setIsSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await askAiChat(question, history, language, controller.signal);
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: response.answer, results: response.results }]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessages((current) => [...current, {
        id: nextId.current++,
        role: "assistant",
        content: chatErrorMessage(error, t),
        error: true,
        retryQuestion: question,
      }]);
    } finally {
      setIsSending(false);
      abortRef.current = null;
    }
  }, [isReady, isSending, language, messages, t]);

  if (!canUse) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  };

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={t("aiChatOpen")}
          title={t("aiChatOpen")}
          className="fixed bottom-4 right-4 z-[9990] inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-theme-lg ring-4 ring-white/70 transition hover:scale-105 hover:from-brand-600 hover:to-violet-700 focus:outline-none focus:ring-brand-500/30 sm:bottom-6 sm:right-6 dark:ring-gray-900/70"
        >
          <AiBotIcon size={28} />
        </button>
      )}

      {isOpen && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={t("aiChatTitle")}
          className="fixed inset-0 z-[100000] flex flex-col bg-white dark:bg-gray-900 sm:inset-auto sm:z-[9990] sm:bottom-6 sm:right-6 sm:h-[min(680px,calc(100dvh-6rem))] sm:w-[480px] sm:rounded-2xl sm:border sm:border-gray-200 sm:shadow-theme-lg xl:w-[600px] dark:sm:border-gray-800"
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white">
              <AiBotIcon size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">{t("aiChatTitle")}</p>
              <p className="truncate text-[11px] text-gray-400">{t("aiChatSubtitle")}</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={() => { abortRef.current?.abort(); setMessages([]); setIsSending(false); }} className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
                {t("aiChatClear")}
              </button>
            )}
            <button type="button" onClick={() => setIsOpen(false)} aria-label={t("close")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div ref={listRef} aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 custom-scrollbar sm:px-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600 dark:text-gray-300">{t("aiChatWelcome")}</p>
                <div className="flex flex-wrap gap-2">
                  {isReady && SUGGESTION_KEYS.map((key) => (
                    <button key={key} type="button" onClick={() => void send(t(key))} className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-left text-xs font-medium text-brand-700 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
                      {t(key)}
                    </button>
                  ))}
                  {isPreparing && <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiChatPreparing")}</p>}
                  {!isPreparing && !isReady && <p className="text-xs text-error-600 dark:text-error-400">{t("aiChatPrepareError")}</p>}
                </div>
              </div>
            )}
            {messages.map((message) => (
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-500 px-3.5 py-2 text-sm text-white">{message.content}</p>
                </div>
              ) : (
                <div key={message.id} className="min-w-0">
                  <div className={`max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-bl-md px-3.5 py-2 text-sm sm:max-w-[92%] ${message.error ? "border border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300" : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-white/90"}`}>
                    {message.content}
                    {message.error && message.retryQuestion && (
                      <button type="button" disabled={isSending} onClick={() => void send(message.retryQuestion || "")} className="mt-2 block text-xs font-semibold underline disabled:opacity-50">{t("aiChatRetry")}</button>
                    )}
                  </div>
                  {message.results?.map((result, index) => <ResultBlock key={`${message.id}-${index}`} result={result} />)}
                </div>
              )
            ))}
            {isSending && (
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                {t("aiChatThinking")}
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => { event.preventDefault(); void send(input); }}
            className="shrink-0 border-t border-gray-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-gray-800"
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                maxLength={AI_CHAT_MAX_QUESTION_LENGTH}
                placeholder={t("aiChatPlaceholder")}
                aria-label={t("aiChatPlaceholder")}
                className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-brand-500/20"
              />
              <button
                type="submit"
                disabled={isPreparing || !isReady || isSending || !input.trim()}
                aria-label={t("aiChatSend")}
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPreparing ? t("aiChatPreparingShort") : t("aiChatSend")}
              </button>
            </div>
            <p className="mt-1.5 flex justify-between gap-2 text-[11px] text-gray-400">
              <span>{t("aiChatHint")}</span>
              <span className="tabular-nums">{input.length}/{AI_CHAT_MAX_QUESTION_LENGTH}</span>
            </p>
          </form>
        </div>
      )}
    </>
  );
}
