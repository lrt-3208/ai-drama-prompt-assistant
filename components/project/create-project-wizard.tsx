"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// ============================================
// 创建项目向导（独立页面 /projects/new）
// 严格对照原型 prototype-v2/01-create.html：
//   Step1 基础信息（含连载模式）→ Step2 选择风格 → Step3 生成配置
// ============================================

interface GenConfig {
  character_count: { min: number; max: number };
  location_count: { min: number; max: number };
  episode_count: { min: number; max: number };
  scenes_per_episode: { min: number; max: number };
  shots_per_scene: { min: number; max: number };
}

const DEFAULT_GEN_CONFIG: GenConfig = {
  character_count: { min: 3, max: 8 },
  location_count: { min: 3, max: 8 },
  episode_count: { min: 3, max: 10 },
  scenes_per_episode: { min: 2, max: 6 },
  shots_per_scene: { min: 2, max: 6 },
};

/** 对照原型 01-create.html Step3 */
const CONFIG_FIELDS: {
  key: keyof GenConfig;
  label: string;
  hint: string;
  unit: string;
  dividerBefore?: boolean;
}[] = [
  { key: "character_count", label: "角色库数量", hint: "初始生成的角色数", unit: "个" },
  { key: "location_count", label: "场景库数量", hint: "初始生成的场景数", unit: "个" },
  {
    key: "episode_count",
    label: "Episode 骨架数",
    hint: "仅生成集号+占位标题，骨架数取上限值",
    unit: "集（后续可无限追加）",
    dividerBefore: true,
  },
  { key: "scenes_per_episode", label: "每集场景数", hint: "分镜生成时使用", unit: "" },
  { key: "shots_per_scene", label: "每场景镜头数", hint: "分镜生成时使用", unit: "" },
];

/** 连载模式（对照原型 01-create.html Step1 select + 说明卡） */
const SERIALIZATION_MODES = [
  { value: "continuous", label: "连续剧情（集间强关联）" },
  { value: "episodic", label: "单元剧（每集独立故事）" },
  { value: "mixed", label: "混合（主线 + 单元）" },
] as const;

/** 预置风格模板（对照原型 01-create.html Step2 四张卡片） */
const STYLE_TEMPLATES = [
  {
    key: "live",
    name: "真人电影风",
    icon: "🎥",
    gradient: "from-slate-600 via-slate-800 to-slate-950",
    description: "写实电影质感，适合都市、悬疑、职场类题材。接近真人拍摄效果。",
    tags: ["photorealistic", "cinematic lighting", "35mm film", "shallow DOF"],
    camera_style: "电影感构图，浅景深，中近景为主",
    color: "自然写实色彩，低饱和",
    lighting: "cinematic lighting，低调布光，注重光影层次",
    cinematography: "35mm film 质感，写实镜头语言",
    fixed_prompt:
      "photorealistic, cinematic lighting, 35mm film, shallow depth of field, ultra detailed, realistic skin texture",
    isDefault: true,
  },
  {
    key: "anime",
    name: "日漫风",
    icon: "🌸",
    gradient: "from-pink-400 via-rose-500 to-purple-700",
    description: "日式动画风格，赛璐璐上色，大眼睛细线条。适合校园、恋爱、异能战斗。",
    tags: ["anime style", "cel shading", "vibrant colors", "key visual"],
    camera_style: "动画式构图，特写与全景交替",
    color: "高饱和鲜艳色彩，赛璐璐上色",
    lighting: "明亮通透，高光阴影二分",
    cinematography: "key visual 级别的画面表现力",
    fixed_prompt:
      "anime style, cel shading, vibrant colors, key visual, detailed background, high quality illustration",
  },
  {
    key: "guofeng",
    name: "国漫风",
    icon: "🏮",
    gradient: "from-red-500 via-orange-600 to-amber-800",
    description: "中式动画质感，水墨与工笔结合。适合仙侠、玄幻、古装题材。",
    tags: ["chinese animation", "guofeng", "ink wash", "ornate detail"],
    camera_style: "国风构图，留白与对称",
    color: "水墨与工笔结合的东方色彩",
    lighting: "柔和氛围光，仙气飘逸",
    cinematography: "工笔细描与水墨晕染结合",
    fixed_prompt:
      "chinese animation style, guofeng, ink wash elements, ornate details, elegant composition, soft atmospheric lighting",
  },
  {
    key: "manga",
    name: "漫画风",
    icon: "📖",
    gradient: "from-gray-200 via-gray-400 to-gray-700",
    description: "黑白漫画分格，网点纸质感，强对比线稿。适合热血、推理题材。",
    tags: ["manga panel", "black and white", "screentone", "bold linework"],
    camera_style: "漫画分格视角，张力构图",
    color: "黑白灰，网点纸质感",
    lighting: "强对比明暗，速度线与集中线",
    cinematography: "bold linework，强对比线稿",
    fixed_prompt:
      "manga panel style, black and white, screentone texture, bold linework, high contrast ink illustration",
  },
] as const;

const WIZARD_STEPS = [
  { n: 1, label: "基础信息" },
  { n: 2, label: "选择风格" },
  { n: 3, label: "生成配置" },
];

/** 步骤指示器（对照原型：w-7 圆点 + w-16 连接线，当前/完成✓/未到三态） */
function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-10">
      {WIZARD_STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2">
          {i > 0 && <div className="w-16 h-px bg-border" />}
          <div
            className={
              s.n === current
                ? "w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium"
                : s.n < current
                ? "w-7 h-7 rounded-full bg-primary/30 text-primary text-xs flex items-center justify-center"
                : "w-7 h-7 rounded-full bg-surface2 border border-border text-muted-foreground text-xs flex items-center justify-center"
            }
          >
            {s.n < current ? "✓" : s.n}
          </div>
          <span
            className={`text-sm ${
              s.n === current
                ? "text-foreground"
                : s.n < current
                ? "text-muted-foreground"
                : "text-muted-foreground"
            }`}
          >
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CreateProjectWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [genre, setGenre] = useState("");
  const [serializationMode, setSerializationMode] = useState<string>("continuous");
  const [styleKey, setStyleKey] = useState<string>("live");
  const [styleTweak, setStyleTweak] = useState("");
  const [genConfig, setGenConfig] = useState<GenConfig>(DEFAULT_GEN_CONFIG);
  const [loading, setLoading] = useState(false);

  const activeStyle = STYLE_TEMPLATES.find((s) => s.key === styleKey) ?? STYLE_TEMPLATES[0];

  const goNext = () => {
    if (step === 1) {
      if (!name.trim()) {
        toast.error("项目名称不能为空");
        return;
      }
      if (!synopsis.trim()) {
        toast.error("故事创意不能为空");
        return;
      }
    }
    setStep(step + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("项目名称不能为空");
      return;
    }
    setLoading(true);

    try {
      // 1. 创建项目
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          synopsis,
          genre,
          serialization_mode: serializationMode,
          generation_config: genConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");

      const projectId = data.data.id;

      // 2. 创建视觉风格（模板 fixed_prompt + 微调拼接）
      const fixedPrompt = styleTweak.trim()
        ? `${activeStyle.fixed_prompt}, ${styleTweak.trim()}`
        : activeStyle.fixed_prompt;
      const styleRes = await fetch(`/api/projects/${projectId}/style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: activeStyle.name,
          camera_style: activeStyle.camera_style,
          color: activeStyle.color,
          lighting: activeStyle.lighting,
          cinematography: activeStyle.cinematography,
          fixed_prompt: fixedPrompt,
        }),
      });
      if (!styleRes.ok) {
        const styleData = await styleRes.json().catch(() => ({}));
        toast.warning(
          `项目已创建，但风格设置失败：${styleData.error || "未知错误"}，可稍后在项目设置中配置`
        );
      }

      toast.success("创建成功，开始初始化");
      router.push(`/init/${projectId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* 面包屑顶栏（对照原型顶栏） */}
      <div className="border-b border-border bg-card/60 backdrop-blur sticky top-14 z-20 -mx-6 px-6 mb-4">
        <div className="h-14 flex items-center gap-3">
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground text-sm">
            ← 工作台
          </Link>
          <span className="text-border">/</span>
          <span className="text-sm text-foreground font-medium">创建项目</span>
        </div>
      </div>

      <StepIndicator current={step} />

      {/* ============ Step 1 基础信息 ============ */}
      {step === 1 && (
        <section className="bg-card border border-border rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-foreground mb-1">项目基础信息</h2>
          <p className="text-sm text-muted-foreground mb-8">
            描述你的漫剧创意，AI 会基于此构建角色库与场景库。
          </p>

          <div className="space-y-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="wiz-name">
                项目名称 <span className="text-red-400">*</span>
              </Label>
              <Input
                id="wiz-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：都市异能：觉醒"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="wiz-synopsis">
                故事创意 <span className="text-red-400">*</span>
              </Label>
              <Textarea
                id="wiz-synopsis"
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                placeholder="一句话描述你的故事：主角是谁、发生了什么、核心冲突是什么…"
                rows={5}
                className="resize-none leading-relaxed"
              />
              <p className="text-xs text-muted-foreground/70">
                ▸ 越详细，AI 生成的角色与场景越贴合你的构想
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="wiz-genre">题材类型</Label>
                <Input
                  id="wiz-genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="如：都市异能 / 悬疑"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>连载模式</Label>
                <Select value={serializationMode} onValueChange={(v) => setSerializationMode(v as string)}>
                  <SelectTrigger className="w-full h-10">
                    {/* base-ui SelectValue 渲染的是原始 value，label 需显式传入 */}
                    <SelectValue>
                      {SERIALIZATION_MODES.find((m) => m.value === serializationMode)?.label ??
                        "选择连载模式"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SERIALIZATION_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 连载模式说明卡（对照原型 primary/8 说明卡） */}
            <div className="bg-primary/10 border border-primary/25 rounded-lg p-4 flex gap-3">
              <span className="text-primary text-lg leading-none mt-0.5">ⓘ</span>
              <div className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-primary font-medium">连载模式</span>
                决定 AI 生成剧情大纲时的上下文策略：
                <br />· <span className="text-foreground/80">连续剧情</span> — 生成第 N 集时会读取第
                1~N-1 集的剧情摘要作为上下文
                <br />· <span className="text-foreground/80">单元剧</span> —
                每集独立生成，只共享角色库/场景库/世界观
                <br />· <span className="text-foreground/80">混合</span> — 读取主线进度 +
                本集独立设定
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-8 pt-6 border-t border-border">
            <Button onClick={goNext}>下一步：选择风格 →</Button>
          </div>
        </section>
      )}

      {/* ============ Step 2 选择风格 ============ */}
      {step === 2 && (
        <section className="bg-card border border-border rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-foreground mb-1">选择漫剧风格</h2>
          <p className="text-sm text-muted-foreground mb-2">
            风格决定后续<span className="text-primary">全部 Prompt 的视觉基因</span>
            ，创建后可在设置中切换（会导致已生成 Prompt 全部过期）。
          </p>
          <p className="text-xs text-muted-foreground/70 mb-8">
            ▸ 四种预置风格开箱即用，可通过下方「风格微调」追加个性化描述
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {STYLE_TEMPLATES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStyleKey(s.key)}
                className={`relative text-left bg-surface2 border-2 rounded-xl overflow-hidden transition ${
                  styleKey === s.key
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {styleKey === s.key && (
                  <span className="absolute top-3 right-3 z-10 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                    ✓
                  </span>
                )}
                <div
                  className={`h-32 bg-gradient-to-br ${s.gradient} flex items-center justify-center text-4xl`}
                >
                  {s.icon}
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-foreground">{s.name}</h3>
                    {"isDefault" in s && s.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        默认
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    {s.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.tags.map((t) => (
                      <code
                        key={t}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-background text-muted-foreground"
                      >
                        {t}
                      </code>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* 风格微调（对照原型） */}
          <div className="bg-surface2 border border-border rounded-xl p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h4 className="text-sm font-medium text-foreground">风格微调（可选）</h4>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  在选定风格基础上追加自定义描述，会拼接到 fixed_prompt 尾部
                </p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 shrink-0">
                {activeStyle.name}
              </span>
            </div>
            <Textarea
              rows={2}
              value={styleTweak}
              onChange={(e) => setStyleTweak(e.target.value)}
              placeholder="如：偏冷色调、低饱和度、夜景为主、赛博朋克霓虹感…"
              className="resize-none bg-background"
            />
          </div>

          <div className="flex justify-between mt-8 pt-6 border-t border-border">
            <Button variant="outline" onClick={() => setStep(1)} disabled={loading}>
              ← 上一步
            </Button>
            <Button onClick={goNext}>下一步：生成配置 →</Button>
          </div>
        </section>
      )}

      {/* ============ Step 3 生成配置 ============ */}
      {step === 3 && (
        <section className="bg-card border border-border rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-foreground mb-1">生成配置</h2>
          <p className="text-sm text-muted-foreground mb-8">
            初始化时生成的资产数量。这些数量只影响初始化，后续可手动增删。
          </p>

          <div className="space-y-5 mb-8">
            {CONFIG_FIELDS.map(({ key, label, hint, unit, dividerBefore }) => (
              <div key={key}>
                {dividerBefore && <div className="border-t border-border pt-5" />}
                <div className="flex items-center gap-4">
                  <div className="w-40 shrink-0">
                    <div className="text-sm text-foreground">{label}</div>
                    <div className={`text-xs ${key === "episode_count" ? "text-stale" : "text-muted-foreground"}`}>
                      {hint}
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    value={genConfig[key].min}
                    onChange={(e) =>
                      setGenConfig({
                        ...genConfig,
                        [key]: { ...genConfig[key], min: Number(e.target.value) },
                      })
                    }
                    className="w-16 text-center"
                  />
                  <span className="text-muted-foreground text-sm">~</span>
                  <Input
                    type="number"
                    min={0}
                    value={genConfig[key].max}
                    onChange={(e) =>
                      setGenConfig({
                        ...genConfig,
                        [key]: { ...genConfig[key], max: Number(e.target.value) },
                      })
                    }
                    className="w-16 text-center"
                  />
                  {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* 初始化提示（对照原型 stale 警示卡） */}
          <div className="bg-stale/10 border border-stale/30 rounded-lg p-5">
            <div className="flex gap-3">
              <span className="text-stale text-lg leading-none mt-0.5">⚠</span>
              <div>
                <div className="text-sm text-stale font-medium mb-2">初始化会生成什么？</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-2 text-foreground/80">
                    <span className="text-green-500">✓</span>项目基础信息 + 故事元数据
                  </div>
                  <div className="flex items-center gap-2 text-foreground/80">
                    <span className="text-green-500">✓</span>风格配置（fixed_prompt / negative）
                  </div>
                  <div className="flex items-center gap-2 text-foreground/80">
                    <span className="text-green-500">✓</span>角色库（含 fixed_prompt）
                  </div>
                  <div className="flex items-center gap-2 text-foreground/80">
                    <span className="text-green-500">✓</span>场景库（含 fixed_prompt）
                  </div>
                  <div className="flex items-center gap-2 text-foreground/80">
                    <span className="text-green-500">✓</span>Episode 骨架列表（空壳）
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-red-400">✗</span>剧情大纲（后续逐集手动生成）
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-red-400">✗</span>分镜大纲（后续逐集手动生成）
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-red-400">✗</span>分镜内容 / Prompt
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between mt-8 pt-6 border-t border-border">
            <Button variant="outline" onClick={() => setStep(2)} disabled={loading}>
              ← 上一步
            </Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? "创建中..." : "创建并初始化 →"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
