/** Keep the main audit line short; older, verbose records remain available in details. */
function compactChanges(subject: string, rawChanges: string): string {
  const changes = rawChanges.replace(/^thay đổi:\s*/i, "").split(/\s*\|\s*/).filter(Boolean);
  const maxLength = 220;
  const visible: string[] = [];
  for (const change of changes) {
    const candidate = `${subject} · ${[...visible, change].join("; ")}`;
    if (candidate.length > maxLength) break;
    visible.push(change);
  }
  if (visible.length === 0 && changes.length > 0) {
    visible.push(`${changes[0].slice(0, Math.max(0, maxLength - subject.length - 5))}…`);
  }
  const hidden = changes.length - visible.length;
  const suffix = hidden > 0 ? ` (+${hidden})` : "";
  return `${subject} · ${visible.join("; ")}`.slice(0, maxLength - suffix.length) + suffix;
}

export function activityLogSummary(
  action: string,
  detail: string,
  location: string,
  language: "vi" | "en" = "vi",
): string {
  // Tổng kết một lượt đồng bộ tự động liệt kê nhiều đơn: dòng chính là ngày + kết quả, không lấy đơn đầu tiên.
  if (action.toUpperCase() === "AUTO_DOCUMENT_SYNC_RUN") {
    const lines = detail.split(" | ");
    const result = lines.find((line) => line.startsWith("Kết quả:"));
    const head = result ? `${lines[0]} · ${result.replace(/^Kết quả:\s*/, "")}` : lines[0] || "";
    return head.length > 220 ? `${head.slice(0, 217)}…` : head;
  }
  // Nhắc hàng sắp về: dòng chính là ngày + số B/L ("… · 2 B/L"), danh sách B/L xem ở chi tiết.
  if (action.toUpperCase() === "ETA_ARRIVAL_REMINDER") {
    const [head = "", bills = ""] = detail.split(" | ");
    const count = bills.match(/^(\d+ B\/L)/)?.[1];
    return count ? `${head} · ${count}` : head;
  }
  // Đề nghị thanh toán: nội dung bắt đầu bằng mã đề nghị ("DNTT-001; ..." hoặc "DNTT-001 | ..."). Dòng chính = mã đề nghị
  // + các ý đầu (số tiền, lý do từ chối, thay đổi...), bỏ phần "Sau khi sửa: <toàn bộ đề nghị>" (xem ở chi tiết).
  if (/^PAYMENT_(REQUEST_|CONTAINER_REPAIR)/i.test(action)) {
    const [requestId = "", ...parts] = detail.split(/\s*;\s+|\s+\|\s+/);
    if (/^[^\s:]{2,40}$/.test(requestId.trim())) {
      const subject = `${language === "en" ? "Request" : "Đề nghị"} ${requestId.trim()}`;
      const fullCopyAt = parts.findIndex((part) => /^Sau khi sửa:/i.test(part));
      const rest = (fullCopyAt >= 0 ? parts.slice(0, fullCopyAt) : parts).filter(Boolean).join(" | ");
      return rest ? compactChanges(subject, rest) : subject;
    }
  }
  const orderCode = detail.match(/(?:^|[\s;])(?:đơn(?:\s+hàng)?|order)\s+([^\s;,]+)/i)?.[1];
  const documentCode = location.match(/\/Documents\/([A-Z0-9_]+)/i)?.[1]
    || detail.match(/chứng từ\s+([A-Z0-9_]+)/i)?.[1];
  const containerCode = detail.match(/\bcontainer\s+([^\s;,]+)/i)?.[1];

  if (orderCode) {
    const subject = `${language === "en" ? "Order" : "Đơn"} ${orderCode}`;
    if (action.toUpperCase() === "EDIT_SHIPMENT_DETAILS") {
      const changes = detail.split(";").slice(1).join(";").trim();
      return changes ? compactChanges(subject, changes) : subject;
    }
    if (documentCode && ["UPLOAD_DOCUMENT", "UPLOAD_OCR_DOCUMENT", "PASS_DOCUMENT"].includes(action.toUpperCase())) {
      return `${subject} · ${documentCode}`;
    }
    // Tiếp nhận tự động: mã chứng từ ở cuối location "System/AutoDocumentSync/<mã>".
    const syncDocument = location.match(/^System\/AutoDocumentSync\/([A-Z0-9_]+)$/i)?.[1];
    if (syncDocument && action.toUpperCase() === "AUTO_DOCUMENT_SYNC") return `${subject} · ${syncDocument}`;
    if (containerCode && action === "EDIT_RETURN_ITEM") return `${subject} · ${containerCode}`;
    return subject;
  }

  const account = detail.match(/tài khoản\s+([^\s;,]+)/i)?.[1];
  if (account) {
    const subject = `${language === "en" ? "Account" : "Tài khoản"} ${account}`;
    const changes = detail.split(";").slice(1).join(";").trim();
    return action.toUpperCase() === "UPDATE_USER_PERMISSION" && changes ? compactChanges(subject, changes) : subject;
  }

  if (["CREATE_MASTER_DATA", "UPDATE_MASTER_DATA", "DELETE_MASTER_DATA"].includes(action.toUpperCase())) {
    const subject = detail.split(";", 1)[0]?.trim() || "";
    const changes = detail.split(";").slice(1).join(";").trim();
    return changes ? compactChanges(subject, changes) : subject;
  }

  const firstClause = detail.split(/[;\n]/, 1)[0]?.trim() || "";
  return firstClause.length > 110 ? `${firstClause.slice(0, 107)}…` : firstClause;
}
