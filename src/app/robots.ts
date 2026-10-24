import type { MetadataRoute } from "next";

// Hệ thống nội bộ: không cho Googlebot hay bot tìm kiếm nào thu thập trang (/robots.txt).
// proxy.ts bỏ qua đường dẫn có dấu chấm nên bot đọc được file này mà không bị chuyển sang /signin.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "Googlebot", disallow: "/" },
      { userAgent: "*", disallow: "/" },
    ],
  };
}
