// ============================================
// TOS 工具函数 — key 生成 + 图片元数据提取
// ============================================

import { createHash, randomUUID } from "crypto";

/**
 * 生成 TOS 对象 key
 * 格式: projects/{projectId}/assets/{assetType}/{entityType}/{entityId}/{uuid}.{ext}
 */
export function generateTosKey(
  projectId: string,
  assetType: string,
  entityType: string,
  entityId: string,
  mimeType: string
): string {
  const ext = mimeToExt(mimeType);
  const uuid = randomUUID().replace(/-/g, "").slice(0, 12);
  return `projects/${projectId}/assets/${assetType}/${entityType}/${entityId}/${uuid}.${ext}`;
}

/**
 * MIME type → 文件扩展名
 */
function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "bin";
  }
}

/**
 * 允许的图片 MIME 类型
 */
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/**
 * 最大文件大小：10MB
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * 校验文件类型
 */
export function isValidImageType(mimeType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * 校验文件大小
 */
export function isValidFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

/**
 * 从图片 Buffer 提取宽高
 * 解析 PNG/JPEG/WebP 文件头
 */
export function extractImageDimensions(
  buffer: Buffer
): { width: number; height: number } {
  // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian)
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // JPEG: scan SOF0/SOF2 marker
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF0 (0xC0) ~ SOF15 (0xCF), excluding SOF4-7 (0xC4-0xC7) and SOF12-15 (0xCC-0xCF) are DHT/JPG
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }
      // Skip to next marker
      const segmentLength = buffer.readUInt16BE(offset + 2);
      offset += 2 + segmentLength;
    }
  }

  // WebP: check RIFF header
  if (
    buffer.length >= 30 &&
    buffer.slice(0, 4).toString("ascii") === "RIFF" &&
    buffer.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    const vp8 = buffer.slice(12, 16).toString("ascii");
    if (vp8 === "VP8 ") {
      // Lossy WebP
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (vp8 === "VP8L") {
      // Lossless WebP
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (vp8 === "VP8X") {
      // Extended WebP
      return {
        width: (buffer.readUInt32LE(24) & 0xffffff) + 1,
        height: (buffer.readUInt32LE(27) & 0xffffff) + 1,
      };
    }
  }

  // 无法解析时返回 0
  return { width: 0, height: 0 };
}

/**
 * 计算 SHA-256 哈希
 */
export function calculateHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
