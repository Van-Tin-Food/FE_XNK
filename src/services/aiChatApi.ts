import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";

/** Một bảng trong kết quả: cột và dòng do backend tạo từ dữ liệu PostgreSQL (đã ẩn cột theo quyền), không do AI viết. */
export interface AiChatSection {
  title: string | null;
  columns: Array<{ key: string; label: string; align?: "right" }>;
  rows: Array<Record<string, string>>;
  truncated?: boolean;
  /** keyvalue: bảng 2 cột Thông tin / Giá trị. */
  layout?: "keyvalue";
}

export interface AiChatResult {
  tool: string;
  /** Điều kiện đã tra do backend tạo, ví dụ "Đơn hàng: ETA đúng ngày 17/10/2026 (3 ngày nữa)". */
  title: string;
  summary?: string;
  /** Ví dụ: không có quyền xem tiền hàng. */
  notice?: string | null;
  sections: AiChatSection[];
}

export interface AiChatAnswer {
  answer: string;
  results: AiChatResult[];
  mode: "tools" | "json";
}

export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}

export const AI_CHAT_MAX_QUESTION_LENGTH = 500;

/** Hỏi chatbox AI qua gateway Next → BE; trình duyệt không bao giờ gọi OpenRouter trực tiếp. */
/** language: ngôn ngữ giao diện, BE trả nhãn bảng và câu trả lời theo ngôn ngữ này. */
export async function askAiChat(question: string, history: AiChatTurn[], language: "vi" | "en", signal?: AbortSignal): Promise<AiChatAnswer> {
  const apiPath = "/api/ai-chat/ask";
  const token = getStoredUser()?.token?.trim();
  let response: Response;
  try {
    response = await fetch(backendApiUrl(apiPath), {
      method: "POST",
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question, history, language }),
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError("Chatbox AI", "POST", apiPath, error);
    throw error;
  }
  const { data, nonJsonPreview } = await parseApiResponse(response);
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("xnk:auth-expired"));
  if (!response.ok) throw createHttpApiError("Chatbox AI", "POST", apiPath, response, data, nonJsonPreview);
  const payload = (data as { data?: AiChatAnswer } | null)?.data;
  if (!payload || typeof payload.answer !== "string" || !Array.isArray(payload.results)) {
    throw createInvalidResponseError("Chatbox AI", "POST", apiPath, nonJsonPreview);
  }
  return payload;
}
