// ============================================
// TOS Singleton Client
// 长生命周期客户端，复用 HTTP 连接池
// 仅 server-side 使用（API Routes / task-runner）
// ============================================

import { TosClient } from "@volcengine/tos-sdk";
import { getTOSConfig } from "./config";

let tosInstance: TosClient | null = null;

/**
 * 获取 TOS 单例客户端
 * 首次调用时创建，后续复用
 */
export function createTosClient(): TosClient {
  if (!tosInstance) {
    const config = getTOSConfig();
    tosInstance = new TosClient({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      region: config.region,
      endpoint: config.endpoint,
    });
  }
  return tosInstance;
}

/**
 * 获取配置的 bucket 名称
 */
export function getTOSBucket(): string {
  return getTOSConfig().bucket;
}
