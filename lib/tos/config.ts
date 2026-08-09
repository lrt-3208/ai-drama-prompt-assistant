// ============================================
// TOS 配置读取与校验
// 启动时 fail-fast：缺失环境变量直接抛错
// ============================================

export interface TOSConfig {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  endpoint: string;
  bucket: string;
}

let cachedConfig: TOSConfig | null = null;

/**
 * 读取并校验 TOS 配置（单例缓存）
 * 缺失任意环境变量时抛错，避免运行时才发现
 */
export function getTOSConfig(): TOSConfig {
  if (cachedConfig) return cachedConfig;

  const accessKeyId = process.env.TOS_ACCESS_KEY;
  const accessKeySecret = process.env.TOS_SECRET_KEY;
  const region = process.env.TOS_REGION;
  const endpoint = process.env.TOS_ENDPOINT;
  const bucket = process.env.TOS_BUCKET;

  const missing: string[] = [];
  if (!accessKeyId) missing.push("TOS_ACCESS_KEY");
  if (!accessKeySecret) missing.push("TOS_SECRET_KEY");
  if (!region) missing.push("TOS_REGION");
  if (!endpoint) missing.push("TOS_ENDPOINT");
  if (!bucket) missing.push("TOS_BUCKET");

  if (missing.length > 0) {
    throw new Error(
      `TOS 配置缺失: ${missing.join(", ")}。请在 .env.local 中设置这些环境变量。`
    );
  }

  cachedConfig = {
    accessKeyId: accessKeyId!,
    accessKeySecret: accessKeySecret!,
    region: region!,
    endpoint: endpoint!,
    bucket: bucket!,
  };

  return cachedConfig!;
}
