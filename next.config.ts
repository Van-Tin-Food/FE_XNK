import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hệ thống nội bộ: mọi response (trang, file, API gateway) báo bot tìm kiếm không lập chỉ mục,
  // kể cả khi bot bỏ qua robots.txt hoặc vào từ link ở nơi khác.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" }],
      },
    ];
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },
    
    turbopack: {
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },
  
};

export default nextConfig;
