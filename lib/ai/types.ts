// ============================================
// AI 服务层 - 类型定义
// ============================================

/** 聊天消息角色 */
export type ChatRole = "system" | "user" | "assistant";

/** 聊天消息 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** AI 请求配置 */
export interface AIRequestConfig {
  /** Provider 标识（如 qwen / openai / claude），用于工厂选择适配器 */
  provider?: string;
  /** 模型名称 */
  model?: string;
  /** 温度 (0-2)，越高越随机 */
  temperature?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 是否使用 JSON 响应格式 */
  jsonMode?: boolean;
  /** API Key（DB 配置优先，fallback 到环境变量） */
  apiKey?: string;
  /** API Base URL（DB 配置优先，fallback 到环境变量） */
  apiBase?: string;
}

/** AI 生成类型 */
export enum GenerationType {
  SCRIPT = "script", // 剧本生成
  STORYBOARD = "storyboard", // 分镜生成
  STORY = "story", // 故事分析（元数据生成）
  CHARACTER = "character", // 角色生成
  LOCATION = "location", // 场景生成
  STYLE = "style", // 风格生成
  IMAGE_PROMPT = "image_prompt", // 图片 Prompt 生成
  SCENE_VIDEO_PROMPT = "scene_video_prompt", // 场景视频 Prompt 生成
  STORYBOARD_IMAGE = "storyboard_image", // 故事板图片优化
  CHAT = "chat", // 普通对话
}

/** Provider 能力描述 */
export interface ProviderCapabilities {
  jsonMode: boolean;
  streaming: boolean;
  maxTokens: number;
}

/** AI 调用结果 */
export interface AIResult {
  /** 生成的文本内容 */
  content: string;
  /** 如果 jsonMode 为 true，解析后的 JSON 对象 */
  json: unknown | null;
  /** 使用的模型名称 */
  model: string;
  /** 总耗时 (ms) */
  elapsed: number;
  /** prompt token 数 (如果 provider 返回) */
  promptTokens?: number;
  /** completion token 数 (如果 provider 返回) */
  completionTokens?: number;
}

/** AI 调用上下文（用于日志记录） */
export interface AICallContext {
  userId: string;
  projectId: string;
  type: GenerationType;
  retryCount?: number;
}

/** AI 错误类型 */
export enum AIErrorType {
  RATE_LIMIT = "rate_limit",
  TIMEOUT = "timeout",
  AUTH = "auth",
  INVALID_RESPONSE = "invalid_response",
  NETWORK = "network",
  UNKNOWN = "unknown",
}

/** AI 服务错误 */
export class AIError extends Error {
  type: AIErrorType;
  statusCode?: number;
  retryable: boolean;

  constructor(
    message: string,
    type: AIErrorType = AIErrorType.UNKNOWN,
    retryable = false,
    statusCode?: number
  ) {
    super(message);
    this.name = "AIError";
    this.type = type;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

/** 图片生成请求 */
export interface ImageGenerationRequest {
  /** 优化提示词 */
  prompt: string;
  /** 参考图片 base64（DOM 截图） */
  referenceImage?: string;
  /** 输出宽度 */
  width?: number;
  /** 输出高度 */
  height?: number;
  /** 负面提示词 */
  negativePrompt?: string;
}

/** 图片生成结果 */
export interface ImageGenerationResult {
  /** 生成图片的 URL（base64 或远程 URL） */
  imageUrl: string;
  /** 使用的模型 */
  model: string;
  /** 耗时 ms */
  elapsed: number;
}
