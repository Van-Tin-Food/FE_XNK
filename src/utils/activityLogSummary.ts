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
    if (containerCode && action === "EDIT_RETURN_ITEM") return `${subject} · ${containerCode}`;
    return subject;
  }

  const account = detail.match(/tài khoản\s+([^\s;,]+)/i)?.[1];
  if (account) {
    const subject = `${language === "en" ? "Account" : "Tài khoản"} ${account}`;
    const changes = detail.split(";").slice(1).join(";").trim();
    return action.toUpperCase() === "UPDATE_USER_PERMISSION" && changes ? compactChanges(subject, changes) : subject;
  }

  if (["CREATE_MASTER_DATA", "UPDATE_MASTER_DATA"].includes(action.toUpperCase())) {
    const subject = detail.split(";", 1)[0]?.trim() || "";
    const changes = detail.split(";").slice(1).join(";").trim();
    return changes ? compactChanges(subject, changes) : subject;
  }

  const firstClause = detail.split(/[;\n]/, 1)[0]?.trim() || "";
  return firstClause.length > 110 ? `${firstClause.slice(0, 107)}…` : firstClause;
}
