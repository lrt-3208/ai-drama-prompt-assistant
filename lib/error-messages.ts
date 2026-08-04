// ============================================
// 错误消息映射 - 将 Supabase/AI 错误转为中文用户友好提示
// ============================================

/** Supabase Auth 错误码 → 中文提示 */
const AUTH_ERROR_MAP: Record<string, string> = {
  invalid_credentials: "邮箱或密码不正确",
  email_not_confirmed: "邮箱未验证，请先查收验证邮件",
  user_already_exists: "该邮箱已注册，请直接登录",
  weak_password: "密码强度不足，至少 6 位字符",
  rate_limit_exceeded: "操作过于频繁，请稍后再试",
  email_address_invalid: "邮箱地址格式不正确",
  user_banned: "账号已被禁用",
  over_request_rate_limit: "请求过于频繁，请稍后再试",
  request_timeout: "请求超时，请重试",
  unexpected_failure: "服务暂时不可用，请稍后再试",
  reauthentication_needed: "需要重新验证身份",
  reauthentication_not_valid: "验证信息已过期，请重新操作",
  same_password: "新密码不能与旧密码相同",
  user_not_found: "用户不存在",
  session_expired: "登录已过期，请重新登录",
  session_not_found: "登录状态无效，请重新登录",
  anonymous_provider_insufficient_permissions: "无权限执行此操作",
};

/**
 * 将 Supabase Auth 错误转为中文提示
 */
export function mapAuthError(error: {
  code?: string;
  message?: string;
}): string {
  // 优先用 code 匹配
  if (error.code && AUTH_ERROR_MAP[error.code]) {
    return AUTH_ERROR_MAP[error.code];
  }

  // 退而求其次，用 message 关键词匹配
  const msg = error.message || "";

  if (msg.includes("Invalid login credentials")) {
    return "邮箱或密码不正确";
  }
  if (msg.includes("Email not confirmed")) {
    return "邮箱未验证，请先查收验证邮件";
  }
  if (msg.includes("already registered") || msg.includes("User already registered")) {
    return "该邮箱已注册，请直接登录";
  }
  if (msg.includes("Password should be at least")) {
    return "密码强度不足，至少 6 位字符";
  }
  if (msg.includes("rate limit") || msg.includes("Rate limit")) {
    return "操作过于频繁，请稍后再试";
  }
  if (msg.includes("timeout")) {
    return "请求超时，请重试";
  }

  // 返回原始消息作为兜底
  return msg || "操作失败，请重试";
}

/** AI 服务错误码 → 中文提示 */
const AI_ERROR_MAP: Record<string, string> = {
  rate_limit: "AI 服务请求过于频繁，请稍后再试",
  timeout: "AI 服务响应超时，请重试",
  auth: "AI 服务认证失败，请检查配置",
  invalid_response: "AI 返回内容格式异常，请重试",
  network: "网络连接异常，请检查网络后重试",
  unknown: "AI 服务暂时不可用，请稍后再试",
};

/**
 * 将 AI 错误转为中文提示
 */
export function mapAIError(error: {
  type?: string;
  message?: string;
}): string {
  if (error.type && AI_ERROR_MAP[error.type]) {
    return AI_ERROR_MAP[error.type];
  }
  return error.message || "AI 服务暂时不可用，请稍后再试";
}
