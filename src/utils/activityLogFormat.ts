// Hiển thị nhật ký thao tác dễ đọc: "thực hiện ở đâu" (màn hình) và danh sách thay đổi trước → sau.
// Thiết bị (trình duyệt · hệ điều hành) do BE tóm tắt sẵn khi ghi log.

type Translate = (key: string) => string;

const CATALOG_KEYS: Record<string, string> = {
  "nha-cung-cap": "supplierLower",
  "hang-tau": "carrierLower",
  kho: "warehouseLower",
};

function capitalize(value: string): string {
  return value ? value.charAt(0).toLocaleUpperCase("vi") + value.slice(1) : value;
}

/**
 * Đổi mã vị trí lưu trong log (vd "ShipmentDetailModal/Documents/CO") thành đường dẫn màn hình
 * theo ngôn ngữ giao diện: ["Trang chủ", "Chi tiết đơn", "Chứng từ", "CO"]. Mã lạ giữ nguyên.
 */
export function activityLocationParts(location: string, t: Translate): string[] {
  const raw = String(location || "").trim();
  if (!raw) return [];
  const [head, ...rest] = raw.replace(/^\/+/, "").split("/").filter(Boolean);
  const tail = rest.slice(1);

  switch (head) {
    case "ShipmentDashboard":
      return [t("locHome"), t("locCreateShipment")];
    case "ShipmentDetailModal": {
      const tab = rest[0];
      const tabLabel = tab === "Documents" ? t("locDocuments")
        : tab === "Details" ? t("locOrderInfo")
          : tab === "ReturnItem" ? t("locTransport")
          : tab === "Costs" ? t("locCosts")
            : tab;
      return [t("locHome"), t("locOrderDetail"), ...(tabLabel ? [tabLabel] : []), ...tail];
    }
    case "Dashboard":
      return [t("locHome"), rest[0] === "ExportExcel" ? t("exportExcel") : rest[0]].filter(Boolean);
    case "master-data": {
      const catalogKey = CATALOG_KEYS[rest[0]];
      return [t("masterDataManagement"), ...(rest[0] ? [catalogKey ? capitalize(t(catalogKey)) : rest[0]] : [])];
    }
    case "account-management":
      return [t("accountManagement")];
    case "Auth":
      if (rest[0] === "SignUp") return [t("accountManagement"), t("registerAccount")];
      if (rest[0] === "ResetPassword") return [t("accountManagement"), t("resetPassword")];
      if (rest[0] === "Google") return [t("locLoginScreen"), t("locGoogleButton")];
      if (rest[0] === "Login") return [t("locLoginScreen"), ...(rest[1] === "Google" ? [t("locGoogleVerify")] : [])];
      return [raw];
    case "Support":
      return rest[0] === "DocumentSync" ? [t("documentSync"), ...tail] : [raw];
    case "AiChat":
      return [t("locAiChat")];
    case "Sidebar":
      return [t("locSidebar"), rest[0] === "Logout" ? t("logout") : rest[0]].filter(Boolean);
    case "Email":
      return [t("email")];
    case "PaymentRequests":
      return [t("locPaymentRequests")];
    case "GoogleChat":
      return [t("locGoogleChat"), t("locPaymentRequests")];
    default:
      return [raw];
  }
}

export interface ActivityDetailLine {
  /** Dòng thay đổi "trường: cũ → mới". */
  field?: string;
  before?: string;
  after?: string;
  /** Dòng nội dung thường. */
  text?: string;
}

/**
 * Tách nội dung log thành từng dòng để xem chi tiết: các vế ngăn bằng "; " hoặc " | ",
 * vế dạng "trường: cũ → mới" thành dòng thay đổi.
 */
export function activityDetailLines(detail: string): ActivityDetailLine[] {
  return String(detail || "")
    .split(/;\s+|\s+\|\s+|\n/)
    .map((part) => part.replace(/^thay đổi:\s*/i, "").trim())
    .filter(Boolean)
    .map((part) => {
      const change = part.match(/^([^:→]{1,80}):\s*([\s\S]*?)\s*→\s*([\s\S]*)$/);
      if (change) return { field: change[1].trim(), before: change[2].trim(), after: change[3].trim() };
      return { text: part };
    });
}
