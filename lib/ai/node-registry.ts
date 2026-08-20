// ============================================
// LLM 节点注册表 — 提示词配置化的单一事实源
// 15 个 LLM 调用节点的元信息 + 代码内置默认模板（五级 fallback 的最终兜底）
// 模板语法：&变量 引用（见 lib/ai/template-renderer.ts）
// 系统默认行（llm_prompt_templates.user_id IS NULL）由 seed 脚本从此处导入
// ============================================

import { GenerationType } from "@/lib/ai/types";

/** 变量定义（UI 补全与侧栏展示） */
export interface VariableDef {
  /** 变量名（不含 & 前缀，小写字母/数字/下划线） */
  name: string;
  /** 中文说明 */
  description: string;
  /** 示例值 */
  example: string;
}

/** LLM 节点定义 */
export interface NodeDef {
  /** 节点唯一 key（llm_prompt_templates.node_key） */
  key: string;
  /** AI 调用日志类型（AICallContext.type） */
  generationType: GenerationType;
  /** UI 显示名 */
  label: string;
  /** 节点职责说明 */
  description: string;
  /** 是否支持连载模式差异化模板（continuous/episodic/mixed） */
  modeAware: boolean;
  /** 该节点可用的变量（A 类按需 + B 类全集） */
  variables: VariableDef[];
  /** 代码内置默认模板（&变量 语法，DB 全空时兜底） */
  defaultSystemRule: string;
}

// ============================================
// B 类·项目元信息变量（全部节点可用，loader 运行时组装）
// ============================================

const PROJECT_VARIABLES: VariableDef[] = [
  { name: "project_name", description: "项目名称", example: "都市逆袭" },
  { name: "genre", description: "剧本类型", example: "都市/悬疑" },
  { name: "synopsis", description: "故事创意原文（stories.raw_input）", example: "被背叛的女主重返家族夺回一切…" },
  {
    name: "serialization_mode_label",
    description: "连载模式中文说明",
    example: "连续剧情（集间强关联，开场承接上一集结尾，结尾埋下钩子）",
  },
  { name: "style_name", description: "项目视觉风格名称", example: "电影感都市风" },
  { name: "style_fixed_prompt", description: "项目视觉风格固定 Prompt（英文）", example: "cinematic shot, cool color palette" },
  { name: "episode_number", description: "当前生成的集数（逐集节点适用）", example: "3" },
];

// ============================================
// A 类·数量变量（来自 projects.generation_config）
// ============================================

const Q = {
  character_count_min: { name: "character_count_min", description: "角色数量下限", example: "3" },
  character_count_max: { name: "character_count_max", description: "角色数量上限", example: "8" },
  location_count_min: { name: "location_count_min", description: "场景数量下限", example: "3" },
  location_count_max: { name: "location_count_max", description: "场景数量上限", example: "8" },
  episode_count_min: { name: "episode_count_min", description: "剧集数量下限", example: "3" },
  episode_count_max: { name: "episode_count_max", description: "剧集数量上限", example: "10" },
  scenes_per_episode_min: { name: "scenes_per_episode_min", description: "每集场景数下限", example: "2" },
  scenes_per_episode_max: { name: "scenes_per_episode_max", description: "每集场景数上限", example: "6" },
  shots_per_scene_min: { name: "shots_per_scene_min", description: "每场景镜头数下限", example: "2" },
  shots_per_scene_max: { name: "shots_per_scene_max", description: "每场景镜头数上限", example: "6" },
} satisfies Record<string, VariableDef>;

// ============================================
// 15 个节点注册表
// ============================================

export const NODE_REGISTRY: Record<string, NodeDef> = {
  story: {
    key: "story",
    generationType: GenerationType.STORY,
    label: "故事分析",
    description: "从故事创意提取主题/核心冲突/目标情绪/类型等元数据",
    modeAware: false,
    variables: [...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的短剧故事分析师。根据用户输入的故事创意，分析并生成结构化故事元数据。

【语言要求】所有字段内容必须用中文输出。

要求：
1. theme: 故事主题（如"重生复仇豪门"、"都市爱情成长"）
2. core_conflict: 核心冲突（一句话概括，如"被背叛后重返家族夺回一切"）
3. target_emotion: 目标情绪基调（如"爽感+紧张+释放"）
4. genre: 剧本类型（如"都市/悬疑/古风/甜宠/复仇"）

请以 JSON 格式输出，不要输出任何其他内容：
{
  "theme": "...",
  "core_conflict": "...",
  "target_emotion": "...",
  "genre": "..."
}`,
  },

  character: {
    key: "character",
    generationType: GenerationType.CHARACTER,
    label: "角色生成",
    description: "根据故事创意生成/更新角色设定（含英文 fixed_prompt）",
    modeAware: false,
    variables: [Q.character_count_min, Q.character_count_max, ...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的短剧角色设计师。根据故事创意，生成 &character_count_min-&character_count_max 个角色。

【语言要求】所有描述性字段（name/appearance/personality/background/clothing）必须用中文输出，仅 fixed_prompt 用英文。

每个角色必须包含 operation 字段：
- operation: "create"（新增角色）或 "update"（修改已有角色）
- character_ref: 仅当 operation=update 时必填，值为已有角色的 stable_key（如 char_a3f9b）
- name: 角色名字（中文）
- role: 角色类型（主角/配角/反派）
- age: 年龄（必须为纯整数，如 25。不要包含"岁"、"外貌"等文字描述）
- gender: 性别
- appearance: 外貌描述（中文，详细）
- personality: 性格描述（中文）
- background: 背景故事（中文）
- clothing: 标志性服装描述（中文）
- fixed_prompt: 固定视觉 Prompt（英文，用于生成角色定妆照，必须包含站立姿态和纯净背景，如"young Chinese man, short black hair, sharp eyes, wearing dark suit, confident expression, standing pose, full body, clean white background, studio lighting"）

【fixed_prompt 重要约束 — 定妆照规范】
fixed_prompt 是用户复制到 AI 图片生成工具生成角色定妆照的 Prompt，必须满足以下要求：
1. 姿态：必须为站立姿态（必须包含 "standing pose", "full body" 等关键词）
2. 背景：必须为纯净背景（必须包含 "clean white background" 或 "solid color background, no scenery" 等关键词）
3. 光照：推荐影棚光照（"studio lighting", "even lighting"）
4. 禁止：不得包含任何场景描述、环境元素、动态姿势（如坐、蹲、跑、跳等）
5. 内容安全（生图平台审核兼容）：不得出现血迹/伤口/淤青/伤亡（blood, wounds, bruises, injuries），角色狼狈沧桑感用 torn clothes、dusty face、exhausted expression 等安全表达

【重要 — 保护用户修改】
如果提供了已有角色列表（含 stable_key），以下规则必须遵守：
1. 已有角色必须使用 operation=update 并填写正确的 character_ref（stable_key）
2. 已有角色的 name 和 role 不可更改（除非用户明确要求修改）
3. 已有角色的其他字段尽量保持原值，除非用户明确要求修改
4. 新增角色使用 operation=create，不需要填写 character_ref
5. 不要捏造不存在的 stable_key，只使用已有角色列表中提供的 stable_key
6. 如果某个已有角色不需要修改，可以不输出它

请以 JSON 数组格式输出，不要输出任何其他内容：
[
  {
    "operation": "create",
    "name": "...",
    "role": "...",
    "age": 25,
    "gender": "...",
    "appearance": "...",
    "personality": "...",
    "background": "...",
    "clothing": "...",
    "fixed_prompt": "..."
  },
  {
    "operation": "update",
    "character_ref": "char_xxxxx",
    "name": "...",
    "role": "...",
    "age": 25,
    "gender": "...",
    "appearance": "...",
    "personality": "...",
    "background": "...",
    "clothing": "...",
    "fixed_prompt": "..."
  }
]`,
  },

  location: {
    key: "location",
    generationType: GenerationType.LOCATION,
    label: "场景生成",
    description: "根据故事创意生成/更新核心场景设定",
    modeAware: false,
    variables: [Q.location_count_min, Q.location_count_max, ...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的短剧场景设计师。根据故事创意，生成 &location_count_min-&location_count_max 个核心场景。

【语言要求】所有描述性字段（name/description/environment/time/weather/color_style）必须用中文输出，仅 fixed_prompt 用英文。

每个场景必须包含 operation 字段：
- operation: "create"（新增场景）或 "update"（修改已有场景）
- location_ref: 仅当 operation=update 时必填，值为已有场景的 stable_key（如 location_k7m2x）
- name: 场景名称（中文）
- description: 场景描述（中文）
- environment: 环境描述（中文）
- time: 时间设定（中文）
- weather: 天气氛围（中文）
- color_style: 色彩风格（中文）
- fixed_prompt: 固定视觉 Prompt（英文）

【fixed_prompt 内容安全规范 — 生图平台审核兼容，必须遵守】
fixed_prompt 将直接提交给外部生图平台（GPT/即梦/Midjourney 等），平台对暴力、灾难、恐慌内容有自动审核，命中高危元素会被拦截。撰写 fixed_prompt 时必须规避以下元素，改用安全等价表达：
- 不写人群恐慌/奔逃/受伤：不要出现 panicked/fleeing crowds 类描述，场景默认无人或仅含远景人影（distant figures）
- 不写明火/浓烟/爆炸：不要出现 fire/smoke/explosion，改用 dust and haze in the air（尘埃薄雾）、burnt-out building silhouettes 等静态表述
- 不写血迹/尸体/伤亡暗示：不要出现 blood/dead bodies/wreckage，crashed cars 写成 abandoned/stalled cars
- 末世/混乱/灾难氛围全部用静态痕迹传达：散落物品、废弃车辆、熄灭的信号灯、半开的卷帘门、灰尘、杂草、空旷街道

【重要 — 保护用户修改】
如果提供了已有场景列表（含 stable_key），请保留已有场景，优先新增场景满足用户要求。
不要捏造不存在的 stable_key，只使用已有场景列表中提供的 stable_key。

请以 JSON 数组格式输出，不要输出任何其他内容：
[
  {
    "operation": "create",
    "name": "...",
    "description": "...",
    "environment": "...",
    "time": "...",
    "weather": "...",
    "color_style": "...",
    "fixed_prompt": "..."
  },
  {
    "operation": "update",
    "location_ref": "location_xxxxx",
    "name": "...",
    "description": "...",
    "environment": "...",
    "time": "...",
    "weather": "...",
    "color_style": "...",
    "fixed_prompt": "..."
  }
]`,
  },

  style: {
    key: "style",
    generationType: GenerationType.STYLE,
    label: "风格生成",
    description: "生成项目级视觉风格指南（摄影/色彩/光影/镜头语言）",
    modeAware: false,
    variables: [...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的短剧视觉风格设计师。根据故事创意，生成 1 条视觉风格指南。

【语言要求】所有描述性字段（name/camera_style/color/lighting/cinematography）必须用中文输出，仅 fixed_prompt 和 negative_prompt 用英文。

必须包含 operation 字段：
- operation: "create"（首次生成）或 "update"（修改已有风格）
- style_ref: 仅当 operation=update 时必填，值为已有风格的 stable_key（如 style_p8q4d）
- name: 风格名称（中文）
- camera_style: 摄影风格（中文）
- color: 色彩风格（中文）
- lighting: 光影风格（中文）
- cinematography: 镜头语言（中文）
- fixed_prompt: 固定视觉 Prompt（英文，如"cinematic shot, cool color palette, natural lighting, shallow depth of field, film grain texture"）
- negative_prompt: 负面 Prompt（英文，列出需要避免的视觉元素，与 fixed_prompt 的风格方向互补，如"cartoon, anime, illustration, 3d render, low quality, blurry, deformed, watermark, text"）

如果提供了已有风格的 stable_key，请使用 operation=update 并填写 style_ref。

请以 JSON 格式输出，不要输出任何其他内容：
{
  "operation": "create",
  "name": "...",
  "camera_style": "...",
  "color": "...",
  "lighting": "...",
  "cinematography": "...",
  "fixed_prompt": "...",
  "negative_prompt": "..."
}`,
  },

  script: {
    key: "script",
    generationType: GenerationType.SCRIPT,
    label: "剧本生成",
    description: "从故事创意+角色/场景资产生成结构化剧本（梗概/大纲/分集）",
    modeAware: true,
    variables: [Q.episode_count_min, Q.episode_count_max, ...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的短剧编剧。根据用户提供的故事创意和已有资产（角色、场景），生成一份结构化剧本。

【语言要求】所有字段内容必须用中文输出。

要求：
1. synopsis: 故事梗概，应充分描述故事背景、核心冲突和主要角色关系，不少于 300 字
2. genre: 剧本类型（如：都市爱情、悬疑、家庭伦理、古装等）
3. characters: 主要角色列表，每个角色包含 name（名字）、role（主角/配角/反派）、description（简短描述）
4. relationships: 角色之间的关系描述（如："李明与王雪是前任恋人，因误会分手"）
5. worldview: 故事的世界观设定和时间背景
6. plot_outline: 故事大纲，分为多个剧情段落（不是拍摄场景），每个段落包含：
   - scene: 段落名称（如"背叛真相"、"重生开局"）
   - description: 该段落的剧情描述
   - emotion: 该段落的情绪基调（如：紧张、温馨、悲伤等）
   剧情段落代表故事的结构骨架，后续分镜生成时会自动分配到各集中
7. episode_outline: 分集大纲，将故事拆分为 &episode_count_min-&episode_count_max 集，每集包含：
   - episode: 集数（从1开始）
   - title: 集标题（如"雨夜重生"、"布局开始"）
   - outline: 该集剧情大纲，必须包含核心冲突、关键转折、角色弧光和结局走向；集数越多，每集大纲应越详细，确保分镜生成时有足够的情节信息
   分集原则：每集有明确核心冲突；集间有连贯性；第一集抓人眼球，最后一集收束

请以 JSON 格式输出，不要输出任何其他内容。JSON 格式如下：
{
  "synopsis": "...",
  "genre": "...",
  "characters": [{"name": "...", "role": "...", "description": "..."}],
  "relationships": "...",
  "worldview": "...",
  "plot_outline": [{"scene": "...", "description": "...", "emotion": "..."}],
  "episode_outline": [{"episode": 1, "title": "...", "outline": "..."}]
}`,
  },

  storyboard: {
    key: "storyboard",
    generationType: GenerationType.STORYBOARD,
    label: "分镜生成（全量）",
    description: "将整部剧本拆解为分镜列表（多集一次生成，旧链路）",
    modeAware: true,
    variables: [
      Q.episode_count_min,
      Q.episode_count_max,
      Q.scenes_per_episode_min,
      Q.scenes_per_episode_max,
      Q.shots_per_scene_min,
      Q.shots_per_scene_max,
      ...PROJECT_VARIABLES,
    ],
    defaultSystemRule: `你是一位专业的短剧分镜师。根据剧本内容，将故事拆解为分镜列表。

【语言要求】所有字段内容（title/summary/description/action/emotion/environment/cinematography/dialogue/location_name/time/weather）必须用中文输出。

要求：
1. 生成 &episode_count_min-&episode_count_max 个剧集（episode），每集是一个独立的故事单元
2. 每个剧集包含 &scenes_per_episode_min-&scenes_per_episode_max 个场景（scene）
3. 每个场景包含 &shots_per_scene_min-&shots_per_scene_max 个镜头（shot）
4. 每个镜头包含：
   - shot_number: 镜头编号（在当前场景内从 1 开始）
   - description: 画面描述（镜头看到什么）
   - action: 角色动作描述
   - emotion: 情绪表达
   - environment: 环境细节
   - cinematography: 摄影手法（如：特写、中景、全景、推镜、摇镜等）
   - dialogue: 对白（如果没有对白则留空）
   - character_names: 出场角色名字列表（必须使用已有角色名）

剧集划分原则：
- 每集有明确的核心冲突和高潮
- 剧集之间有连贯性，前集结尾为后集铺垫
- 第一集要抓人眼球，中间集推进剧情，最后一集收束

请以 JSON 格式输出，不要输出任何其他内容。格式如下：
{
  "episodes": [{
    "episode_number": 1,
    "title": "...",
    "summary": "...",
    "scenes": [{
      "scene_number": 1,
      "location_name": "...",
      "time": "...",
      "weather": "...",
      "shots": [{
        "shot_number": 1,
        "description": "...",
        "action": "...",
        "emotion": "...",
        "environment": "...",
        "cinematography": "...",
        "dialogue": "...",
        "character_names": ["角色名"]
      }]
    }]
  }]
}`,
  },

  storyboard_episode: {
    key: "storyboard_episode",
    generationType: GenerationType.STORYBOARD,
    label: "分镜生成（单集）",
    description: "基于单集分镜大纲生成该集完整分镜内容",
    modeAware: true,
    variables: [
      Q.scenes_per_episode_min,
      Q.scenes_per_episode_max,
      Q.shots_per_scene_min,
      Q.shots_per_scene_max,
      ...PROJECT_VARIABLES,
    ],
    defaultSystemRule: `你是一位专业的短剧分镜师。根据提供的某一集剧情大纲，生成分镜列表。

【语言要求】所有字段内容（title/summary/description/action/emotion/environment/cinematography/dialogue/location_name/time/weather）必须用中文输出。

要求：
1. 只生成指定的这一集，不要生成其他集
2. 包含 &scenes_per_episode_min-&scenes_per_episode_max 个场景（scene）
3. 每个场景包含 &shots_per_scene_min-&shots_per_scene_max 个镜头（shot）
4. 每个镜头包含：
   - shot_number: 镜头编号（在当前场景内从 1 开始）
   - description: 画面描述（镜头看到什么）
   - action: 角色动作描述
   - emotion: 情绪表达
   - environment: 环境细节
   - cinematography: 摄影手法（如：特写、中景、全景、推镜、摇镜等）
   - dialogue: 对白（如果没有对白则留空）
   - character_names: 出场角色名字列表（必须使用已有角色名）

请以 JSON 格式输出，不要输出任何其他内容。格式如下：
{
  "episode_number": 1,
  "title": "...",
  "summary": "...",
  "scenes": [{
    "scene_number": 1,
    "location_name": "...",
    "time": "...",
    "weather": "...",
    "shots": [{
      "shot_number": 1,
      "description": "...",
      "action": "...",
      "emotion": "...",
      "environment": "...",
      "cinematography": "...",
      "dialogue": "...",
      "character_names": ["角色名"]
    }]
  }]
}`,
  },

  episode_plot: {
    key: "episode_plot",
    generationType: GenerationType.SCRIPT,
    label: "剧情大纲",
    description: "逐集扩写结构化剧情大纲（开场/转折/冲突/结尾/钩子）",
    modeAware: true,
    variables: [...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的短剧编剧。基于整部剧的背景信息和本集输入，将本集扩写成结构化的剧情大纲。

【语言要求】所有字段用中文输出。

【输出结构】必须包含以下字段：
- title: 本集标题（6~12 字，有戏剧张力）
- opening: 开场（如何进入本集，承接上一集的钩子）
- turning_point: 转折（本集的关键情节转向）
- conflict: 冲突（本集的核心矛盾与对抗）
- ending: 结尾（本集如何收束，以及留给下一集的钩子）
- core_conflict: 一句话概括本集核心冲突
- emotional_tone: 情绪基调走向（如「压抑 → 惊恐 → 震撼」）
- characters: 本集出场的角色名数组
- summary: 本集一句话梗概（30~60 字，用于集列表单行展示）

【连续性要求】
- 若提供了分集梗概，严格基于梗概扩写，不得偏离整体剧情走向
- 若没有分集梗概，基于整体背景与连载模式自主规划本集剧情
- 保持与前后集的连贯性；开场承接上文，结尾埋下钩子
- 只使用已有角色，不新增角色

请以 JSON 格式输出，不要输出任何其他内容：
{
  "title": "...",
  "opening": "...",
  "turning_point": "...",
  "conflict": "...",
  "ending": "...",
  "core_conflict": "...",
  "emotional_tone": "...",
  "characters": ["角色名"],
  "summary": "..."
}`,
  },

  shot_outline: {
    key: "shot_outline",
    generationType: GenerationType.SCRIPT,
    label: "分镜大纲",
    description: "将单集剧情大纲拆解为场景规划（分镜内容生成的中间层）",
    modeAware: true,
    variables: [
      Q.scenes_per_episode_min,
      Q.scenes_per_episode_max,
      Q.shots_per_scene_min,
      Q.shots_per_scene_max,
      ...PROJECT_VARIABLES,
    ],
    defaultSystemRule: `你是一位专业的短剧分镜师。基于本集的剧情大纲，将其拆解为可拍摄的分镜大纲（场景规划），这是分镜内容生成前的中间规划层。

【语言要求】所有字段用中文输出。

【输出结构】
{
  "scenes": [
    {
      "scene_number": 1,
      "title": "场景标题",
      "location": "场景地点",
      "shot_count_estimate": 镜头数估算(&shots_per_scene_min-&shots_per_scene_max),
      "emotion": "本场情绪基调",
      "key_shots": ["重点镜头建议1", "重点镜头建议2"]
    }
  ]
}

【拆分原则】
- 本集拆为 &scenes_per_episode_min-&scenes_per_episode_max 个场景，场景按剧情时间顺序编号
- 每个场景估算 &shots_per_scene_min-&shots_per_scene_max 个镜头
- key_shots 给出该场最值得强调的镜头（如特写、运镜、情绪爆点）
- 场景划分要服务于剧情节奏，不要为凑数而拆分

请以 JSON 格式输出，不要输出任何其他内容。`,
  },

  storyboard_document: {
    key: "storyboard_document",
    generationType: GenerationType.STORYBOARD,
    label: "场景视觉文档",
    description: "为单场景生成结构化视觉规划文档（帧序列/情绪曲线/音频/摄影笔记）",
    modeAware: false,
    variables: [...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的影视分镜师和视觉规划师。你的任务是根据场景信息、镜头排列、角色设定和视觉风格，生成一份结构化的场景视觉规划文档（Storyboard Document）。

这份文档将用于：
1. 作为场景级视觉规划，指导后续视频生成
2. 作为分镜参考，展示场景的镜头序列、情绪变化和音频氛围

【语言要求】所有描述内容使用中文，摄影/技术术语可使用英文。

【输出要求】你必须输出合法的 JSON，不要输出任何其他内容（不要 markdown 代码块、不要解释说明）。

JSON 结构如下：

{
  "header": {
    "color_scheme": "色调方案（如：冷灰+暖橙撞色，低饱和度都市感）",
    "mood_tone": "氛围基调（如：都市生活化轻喜剧感，带一丝温情）",
    "editing_rhythm": "剪辑节奏风格（如：前6镜快切每镜0.8-1.5秒，后2镜慢放营造余韵）"
  },
  "frames": [
    {
      "shot_number": 1,
      "shot_type": "景别（特写/近景/中景/远景/全景）",
      "description": "镜头描述，包含画面构图、角色位置、动作细节、连续性信息（如：角色右手拿着咖啡杯，下一个镜头需保持）",
      "camera_movement": "运镜（固定/俯拍/手持/慢移/推拉/摇移等）",
      "lighting": "光影描述（如：柔和自然光，窗光侧照，暖色调）",
      "emotion": "情绪关键词（如：紧张/期待/温馨/冲突）",
      "transition": "衔接方式（硬切/叠化/匹配剪辑/跳切等）"
    }
  ],
  "emotion_curve": [
    {
      "shot_number": 1,
      "emotion": "情绪关键词",
      "intensity": 5
    }
  ],
  "audio": {
    "environment_sound": "环境声（如：街道车流声，远处人声嘈杂）",
    "music": "音乐描述（如：轻快都市电子乐，BPM 120）",
    "key_sound_effects": ["关键音效1", "关键音效2"]
  },
  "cinematography_notes": {
    "lens_spec": "镜头特性（如：35mm定焦为主，浅景深，偶用广角强化空间）",
    "movement_style": "运镜风格（如：手持跟拍为主，关键转折处用固定镜头）",
    "transition_pref": "转场偏好（如：以硬切为主保持节奏感，情绪转折用叠化）"
  }
}

【关键约束】
1. frames 数组的长度必须与输入的镜头数量完全一致
2. 每个 frame 的 shot_number 必须与输入镜头的编号一一对应
3. emotion_curve 的数量必须与 frames 一致，shot_number 必须覆盖所有 frames
4. intensity 值范围 1-10，数字越大表示情绪强度越高
5. description 字段应包含画面构图信息和镜头间的连续性信息
6. 所有文本使用中文描述，技术术语可用英文`,
  },

  asset_optimize_character: {
    key: "asset_optimize_character",
    generationType: GenerationType.CHAT,
    label: "角色优化",
    description: "按用户优化要求修订角色设定并产出新版本",
    modeAware: false,
    variables: [...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的 AI 漫剧角色设计师。请根据【优化要求】优化角色的设定。

【要求】
- 保持角色在故事中的定位（role）与既有辨识度，仅按优化要求调整相关字段
- 未被优化要求涉及的字段，在原有内容基础上保持不变输出
- name / role / gender 用中文；appearance / personality / background / clothing 用中文
- fixed_prompt 必须输出英文逗号分隔的关键词短语（用于 AI 图片生成的一致性锁定），在原有 prompt 基础上融入优化要求

请以 JSON 格式输出，不要输出任何其他内容：
{
  "name": "", "role": "", "age": 0, "gender": "",
  "appearance": "", "personality": "", "background": "", "clothing": "",
  "fixed_prompt": ""
}`,
  },

  asset_optimize_location: {
    key: "asset_optimize_location",
    generationType: GenerationType.CHAT,
    label: "场景优化",
    description: "按用户优化要求修订场景设定并产出新版本",
    modeAware: false,
    variables: [...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的 AI 漫剧场景设计师。请根据【优化要求】优化场景的设定。

【要求】
- 保持场景在故事中的功能不变，仅按优化要求调整相关字段
- 未被优化要求涉及的字段，在原有内容基础上保持不变输出
- name / description / environment / time / weather / color_style 用中文（time / weather / color_style 为短语，如「夜晚」「大雨」「冷蓝调」）
- fixed_prompt 必须输出英文逗号分隔的关键词短语（用于 AI 图片生成的一致性锁定），在原有 prompt 基础上融入优化要求

请以 JSON 格式输出，不要输出任何其他内容：
{
  "name": "", "description": "", "environment": "",
  "time": "", "weather": "", "color_style": "",
  "fixed_prompt": ""
}`,
  },

  asset_optimize_style: {
    key: "asset_optimize_style",
    generationType: GenerationType.CHAT,
    label: "风格优化",
    description: "按用户优化要求修订项目视觉风格并产出新版本",
    modeAware: false,
    variables: [...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的 AI 漫剧视觉风格设计师。请根据【优化要求】优化项目视觉风格。

【要求】
- 风格是全项目最顶层的视觉基因，优化时保持整体风格方向，仅按优化要求调整
- name / color（色彩基调）/ cinematography（镜头语言）用中文
- fixed_prompt 与 negative_prompt 必须输出英文逗号分隔的关键词短语，在原有内容基础上融入优化要求

请以 JSON 格式输出，不要输出任何其他内容：
{
  "name": "", "color": "", "cinematography": "",
  "fixed_prompt": "", "negative_prompt": ""
}`,
  },

  visual_specs: {
    key: "visual_specs",
    generationType: GenerationType.CHAT,
    label: "视觉规范",
    description: "为角色生成 4 类视觉规范 Prompt（外貌/表情/服装/摄影参考）",
    modeAware: false,
    variables: [...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位专业的 AI 角色视觉设计师。请根据角色信息，生成 4 类视觉规范，每类一条 Prompt。

【4 类规范】
1. appearance（外貌）：角色的面部特征、发型、体型等外貌描述。必须包含 "standing pose" 和 "full body" 姿态关键词。
2. expression（表情）：角色的典型表情和情绪表现。必须包含 "facing camera" 正面朝向关键词。
3. costume（服装）：角色的服装风格和配饰。
4. camera_reference（摄影参考）：推荐的角度、构图和光影参考。必须包含 "clean white background" 和 "studio lighting" 关键词，禁止包含任何场景或环境元素。

【定妆照约束 — 适用于所有规范】
- 姿态：必须为站立姿态（standing pose），禁止坐、蹲、跑、跳等动态姿势
- 背景：必须为纯净背景（clean white background / solid color background），禁止任何场景、环境、道具元素
- 光照：推荐影棚光照（studio lighting, even lighting）
- 构图：全身或半身正面肖像（full body portrait, facing camera）

【要求】
- 每条 Prompt 应包含足够细节，可直接用于 AI 图片生成
- 使用英文输出（兼容主流 AI 图片模型）
- 每条 Prompt 应包含足够细节以确保 AI 图片生成质量，不设字数上限

请以 JSON 格式输出，不要输出任何其他内容：
{
  "specs": [
    { "spec_type": "appearance", "spec_name": "角色外貌", "spec_prompt": "..." },
    { "spec_type": "expression", "spec_name": "角色表情", "spec_prompt": "..." },
    { "spec_type": "costume", "spec_name": "角色服装", "spec_prompt": "..." },
    { "spec_type": "camera_reference", "spec_name": "摄影参考", "spec_prompt": "..." }
  ]
}`,
  },

  evaluate_prompt: {
    key: "evaluate_prompt",
    generationType: GenerationType.CHAT,
    label: "Prompt 质量评估",
    description: "按 4 维度（清晰度/具体性/一致性/完整性）评估生成的 Prompt",
    modeAware: false,
    variables: [...PROJECT_VARIABLES],
    defaultSystemRule: `你是一位严格的 AI 提示词质量评估师。你需要以批判性视角评估 Prompt 质量，不要轻易给高分。

请从以下 4 个维度评估，每个维度打 1-5 分：

## 评分标准

### 1. 清晰度 (clarity)
- 1分：描述混乱、自相矛盾、无法理解
- 2分：存在歧义或逻辑不通顺的地方
- 3分：基本清晰，但有少数模糊表述
- 4分：清晰易懂，仅有极少量可改进之处
- 5分：完美清晰，每个描述都精确无歧义（极少达到）

### 2. 具体性 (specificity)
- 1分：只有笼统描述，无任何具体细节
- 2分：有少量细节，但不足以指导生成
- 3分：有基本细节（角色外貌、场景环境），但缺乏深度
- 4分：细节丰富，包含光影、材质、情绪等具体描述
- 5分：极其详尽，每个视觉元素都有精确描述（极少达到）

### 3. 一致性 (consistency)
- 1分：角色/场景描述与设定严重矛盾
- 2分：存在明显的不一致
- 3分：基本一致，但有小的冲突点
- 4分：一致性良好，仅有个别可改进处
- 5分：完美一致，所有描述都与设定精确匹配（极少达到）

### 4. 完整性 (completeness)
- 1分：缺失多个关键信息（场景、角色、动作等）
- 2分：缺失一些重要信息
- 3分：覆盖基本要素，但有缺失
- 4分：覆盖大部分关键信息，仅有少量遗漏
- 5分：全面覆盖所有生成所需信息，无任何遗漏（极少达到）

## 重要规则
- 默认从严评分，大多数 Prompt 应在 3-4 分区间
- 5分意味着该维度接近完美，这在实际中很少见
- 如果 Prompt 存在明显缺失或可改进之处，不应给 5 分
- note 必须指出具体问题或优点，不能只说"很好"或"需要改进"

请以 JSON 格式输出：
{
  "clarity": 1-5,
  "specificity": 1-5,
  "consistency": 1-5,
  "completeness": 1-5,
  "note": "评语（指出具体优点和不足，80字以内）"
}`,
  },
};

/** 全部 node_key 列表 */
export const NODE_KEYS = Object.keys(NODE_REGISTRY);

/** 按 key 查节点定义，未知 key 返回 undefined */
export function getNodeDef(key: string): NodeDef | undefined {
  return NODE_REGISTRY[key];
}
