// ============================================
// 故事板图片优化提示词 — 程序化构建器
// 直接从 StoryboardDocument JSON 提取全部文案，
// 构建英文优化提示词。不调用 AI，零延迟、确定性、文案完整性有保证。
// ============================================

import type { StoryboardDocument } from "./document-types";

/**
 * 从 StoryboardDocument 程序化构建图片优化提示词
 * 不调用 AI — 直接提取 JSON 全部文案，确保 100% 文字保留
 *
 * @param doc StoryboardDocument JSON
 * @param context 渲染上下文（项目名、集标题、场景号等）
 * @returns 英文优化提示词字符串
 */
export function buildOptimizationPrompt(
  doc: StoryboardDocument,
  context: {
    projectName: string;
    episodeTitle: string;
    sceneNumber: number;
    locationName: string;
    totalShots: number;
    stylePresetPrompt?: string | null;
  }
): string {
  const parts: string[] = [];

  // 布局结构描述
  parts.push("Professional storyboard layout, image-to-image optimization.");
  parts.push("Layout: header banner at top, 3-column main body (character refs | frame grid | scene ref), bottom 3-column (emotion curve | audio | cinematography notes).");
  parts.push("Style: clean professional film storyboard, grid layout with frame numbers and annotations.");

  // 风格预设
  if (context.stylePresetPrompt) {
    parts.push(`Visual style: ${context.stylePresetPrompt}`);
  }

  // CRITICAL 文案保留约束
  parts.push("\nCRITICAL: ALL text content below MUST appear exactly as written in the output image. Do not paraphrase, summarize, or omit any text.");

  // Header
  parts.push(`\n[HEADER]`);
  parts.push(`Project: ${context.projectName} | ${context.episodeTitle}`);
  parts.push(`Scene ${context.sceneNumber} | ${context.locationName} | ${context.totalShots} shots`);
  parts.push(`Color: ${doc.header.color_scheme}`);
  parts.push(`Mood: ${doc.header.mood_tone}`);
  parts.push(`Rhythm: ${doc.header.editing_rhythm}`);

  // Frames — 逐帧提取全部文案
  parts.push(`\n[FRAMES]`);
  for (const f of doc.frames) {
    parts.push(`S${f.shot_number} [${f.shot_type}] ${f.description}`);
    parts.push(`  Camera: ${f.camera_movement} | Light: ${f.lighting} | Emotion: ${f.emotion} | Transition: ${f.transition}`);
  }

  // Emotion curve
  parts.push(`\n[EMOTION CURVE]`);
  for (const e of doc.emotion_curve) {
    parts.push(`S${e.shot_number}: ${e.emotion} (intensity ${e.intensity}/10)`);
  }

  // Audio
  parts.push(`\n[AUDIO]`);
  parts.push(`Environment: ${doc.audio.environment_sound}`);
  parts.push(`Music: ${doc.audio.music}`);
  parts.push(`SFX: ${doc.audio.key_sound_effects.join(", ")}`);

  // Cinematography notes
  parts.push(`\n[CINEMATOGRAPHY]`);
  parts.push(`Lens: ${doc.cinematography_notes.lens_spec}`);
  parts.push(`Movement: ${doc.cinematography_notes.movement_style}`);
  parts.push(`Transitions: ${doc.cinematography_notes.transition_pref}`);

  // 结尾约束
  parts.push("\nAll frame numbers (S1, S2...), shot types, emotions, and text labels must remain clearly readable.");

  return parts.join("\n");
}
