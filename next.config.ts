import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 关闭响应压缩，方便 F12 调试时直接查看 JSON 明文
  // 生产环境建议改回 true 或删除此行
  compress: false,
};

export default nextConfig;
