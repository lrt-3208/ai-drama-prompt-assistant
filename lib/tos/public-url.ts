// ============================================
// TOS 公共 URL 构造
// 存储桶为公共读权限，无需签名，直接拼 URL
// ============================================

import { getTOSConfig } from "./config";

/**
 * 从 tos_key 构造公共访问 URL
 *
 * 格式: https://{bucket}.{endpoint}/{tos_key}
 * 示例: https://ai-drama-prompt-assistant.tos-cn-shanghai.volces.com/characters/xxx.png
 */
export function getPublicUrl(tosKey: string): string {
  const { bucket, endpoint } = getTOSConfig();
  return `https://${bucket}.${endpoint}/${tosKey}`;
}
