// ============================================
// TOS 公共 URL 构造
// 存储桶为公共读权限，无需签名，直接拼 URL
// ============================================

/**
 * 从 tos_key 构造公共访问 URL
 *
 * 格式: https://{bucket}.{endpoint}/{tos_key}
 * 示例: https://ai-drama-prompt-assistant.tos-cn-shanghai.volces.com/characters/xxx.png
 *
 * 注意：此函数只读取 TOS_BUCKET 和 TOS_ENDPOINT 两个环境变量，
 * 不调用 getTOSConfig()（后者缺失任意 TOS 变量时 fail-fast 抛异常）。
 * Server Component 中调用此函数时，即使 TOS 完整配置缺失也不会导致页面渲染崩溃，
 * 仅返回空字符串使图片显示占位符。
 */
export function getPublicUrl(tosKey: string): string {
  const bucket = process.env.TOS_BUCKET;
  const endpoint = process.env.TOS_ENDPOINT;
  if (!bucket || !endpoint) return "";
  return `https://${bucket}.${endpoint}/${tosKey}`;
}
