import { redirect } from "next/navigation";

// Trang cũ "Quản lý chi phí / Tổng quan chi phí": đã chuyển sang Báo cáo > Chi phí & công nợ phải trả (chỉ admin).
export default function CostManagementRedirect() {
  redirect("/reports/costs");
}
