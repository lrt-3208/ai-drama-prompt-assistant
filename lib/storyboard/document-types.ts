// ============================================
// Storyboard Document — 类型定义
// 场景视觉规划文档的结构化数据模型
// ============================================

/** 故事板文档结构化内容（存储在 storyboards.document JSONB 字段） */
export interface StoryboardDocument {
  header: {
    color_scheme: string;        // 色调方案，如 "冷灰+暖橙撞色"
    mood_tone: string;           // 氛围基调，如 "都市生活化轻喜剧感"
    editing_rhythm: string;      // 剪辑节奏风格，如 "前6镜快切(每镜0.8-1.5秒),后2镜慢放"
  };
  frames: StoryboardFrame[];     // 镜头帧列表
  emotion_curve: EmotionPoint[]; // 情绪曲线
  audio: AudioAtmosphere;        // 音频氛围
  cinematography_notes: CinematographyNotes; // 摄影笔记
}

/** 单个镜头帧 */
export interface StoryboardFrame {
  shot_number: number;
  shot_type: string;          // 景别：特写/中景/远景/全景
  description: string;         // 镜头描述（含构图和连续性信息）
  camera_movement: string;     // 运镜：固定/俯拍/手持/慢移等
  lighting: string;            // 光影描述
  emotion: string;             // 情绪关键词
  transition: string;          // 衔接/转场方式
}

/** 情绪曲线数据点 */
export interface EmotionPoint {
  shot_number: number;
  emotion: string;    // 情绪关键词
  intensity: number;  // 强度值 1-10
}

/** 音频氛围 */
export interface AudioAtmosphere {
  environment_sound: string;    // 环境声
  music: string;               // 音乐
  key_sound_effects: string[]; // 关键音效列表
}

/** 摄影笔记 */
export interface CinematographyNotes {
  lens_spec: string;        // 镜头特性
  movement_style: string;   // 运镜风格
  transition_pref: string;  // 转场偏好
}

// ============================================
// 渲染数据（组装后传给 React 排版组件）
// ============================================

/** 完整的故事板渲染数据 */
export interface StoryboardRenderData {
  projectName: string;
  episodeTitle: string;
  sceneNumber: number;
  locationName: string;
  totalShots: number;
  document: StoryboardDocument;
  characters: CharacterRef[];
  locationImageUrl: string | null;
  frameImages: Record<number, string>; // shot_number → image URL
}

/** 角色参考信息 */
export interface CharacterRef {
  name: string;
  role: string | null;
  portraitUrl: string | null;
  description: string;
}
