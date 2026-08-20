"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useTaskPolling, type ActiveTask } from "@/hooks/use-task-polling";

// ============================================
// 风格配置（对照原型 prototype-v2/03-assets.html 风格部分）
//   当前风格模板卡（渐变头图 + 切换模板 select）/
//   Prompt 配置卡（fixed/negative/色彩基调/镜头语言 + AI 优化区）/
//   锁定说明卡 + lockable 禁用
// ============================================

interface StyleData {
  id?: string;
  name: string;
  camera_style: string | null;
  color: string | null;
  lighting: string | null;
  cinematography: string | null;
  fixed_prompt: string;
  negative_prompt?: string | null;
}

/** 预置风格模板（与创建向导 Step2 一致） */
const STYLE_TEMPLATES = [
  {
    key: "live",
    name: "真人电影风",
    icon: "🎥",
    gradient: "from-slate-600 via-slate-800 to-slate-950",
    description: "写实电影质感，适合都市、悬疑、职场类题材。接近真人拍摄效果。",
    camera_style: "电影感构图，浅景深，中近景为主",
    color: "自然写实色彩，低饱和",
    lighting: "cinematic lighting，低调布光，注重光影层次",
    cinematography: "35mm film 质感，写实镜头语言",
    fixed_prompt: "photorealistic, cinematic lighting, 35mm film, shallow depth of field, ultra detailed, realistic skin texture",
    negative_prompt: "cartoon, anime, illustration, 3d render, cgi, painting, low quality, blurry, deformed, bad anatomy, watermark, text, oversaturated",
  },
  {
    key: "anime",
    name: "日漫风",
    icon: "🌸",
    gradient: "from-pink-400 via-rose-500 to-purple-700",
    description: "日式动画风格，赛璐璐上色，大眼睛细线条。适合校园、恋爱、异能战斗。",
    camera_style: "动画式构图，特写与全景交替",
    color: "高饱和鲜艳色彩，赛璐璐上色",
    lighting: "明亮通透，高光阴影二分",
    cinematography: "key visual 级别的画面表现力",
    fixed_prompt: "anime style, cel shading, vibrant colors, key visual, detailed background, high quality illustration",
    negative_prompt: "photorealistic, 3d render, realistic skin texture, muted colors, blurry, low quality, deformed, bad anatomy, watermark, text",
  },
  {
    key: "guofeng",
    name: "国漫风",
    icon: "🏮",
    gradient: "from-red-500 via-orange-600 to-amber-800",
    description: "中式动画质感，水墨与工笔结合。适合仙侠、玄幻、古装题材。",
    camera_style: "国风构图，留白与对称",
    color: "水墨与工笔结合的东方色彩",
    lighting: "柔和氛围光，仙气飘逸",
    cinematography: "工笔细描与水墨晕染结合",
    fixed_prompt: "chinese animation style, guofeng, ink wash elements, ornate details, elegant composition, soft atmospheric lighting",
    negative_prompt: "photorealistic, western cartoon style, neon cyberpunk, oversaturated, blurry, low quality, deformed, bad anatomy, watermark, text",
  },
  {
    key: "manga",
    name: "漫画风",
    icon: "📖",
    gradient: "from-gray-200 via-gray-400 to-gray-700",
    description: "黑白漫画分格，网点纸质感，强对比线稿。适合热血、推理题材。",
    camera_style: "漫画分格构图，视觉引导线明确",
    color: "黑白灰 + 网点纸质感",
    lighting: "强对比明暗，戏剧性打光",
    cinematography: "夸张透视与速度线",
    fixed_prompt: "manga panel style, black and white, screentone texture, bold linework, dramatic shading, high contrast",
    negative_prompt: "color, painting, soft shading, photorealistic, 3d render, blurry, low quality, deformed, bad anatomy, watermark, text",
  },
];

/** 按风格名匹配模板（头图 icon / 渐变 / 切换 select 当前项） */
function matchTemplate(name: string | null | undefined) {
  const n = name || "";
  if (n.includes("日漫")) return STYLE_TEMPLATES[1];
  if (n.includes("国漫")) return STYLE_TEMPLATES[2];
  if (n.includes("漫画")) return STYLE_TEMPLATES[3];
  return STYLE_TEMPLATES[0];
}

export function StyleForm({
  projectId,
  initial,
  activeTask,
  assetLocked = false,
  plotCount = 0,
}: {
  projectId: string;
  initial: StyleData | null;
  activeTask?: ActiveTask | null;
  assetLocked?: boolean;
  plotCount?: number;
}) {
  const router = useRouter();
  const toForm = (s: StyleData | null) => s ? {
    name: s.name, camera_style: s.camera_style || "", color: s.color || "",
    lighting: s.lighting || "", cinematography: s.cinematography || "",
    fixed_prompt: s.fixed_prompt, negative_prompt: s.negative_prompt || "",
  } : { name: "", camera_style: "", color: "", lighting: "", cinematography: "", fixed_prompt: "", negative_prompt: "" };

  const [form, setForm] = useState<Record<string, string>>(toForm(initial));
  const [loading, setLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [optimizing, setOptimizing] = useState(false);

  const { isGenerating, createTask } = useTaskPolling({
    projectId,
    initialTask: activeTask,
    onDone: (status) => {
      if (status === "success") toast.success("风格生成完成");
      else toast.error("风格生成失败");
      router.refresh();
    },
  });

  // Sync when initial changes (after AI generates new style)
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setForm(toForm(initial));
  }

  const currentTemplate = matchTemplate(form.name || initial?.name);

  // ---------- 重新生成风格（⟳，lockable） ----------
  const handleRegenerate = async () => {
    const confirmed = window.confirm("AI 将重新生成风格并替换现有配置，是否继续？");
    if (!confirmed) return;
    try {
      await createTask("regenerate_style", {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  // ---------- 切换模板：预填表单（保存前不落库） ----------
  const handleSwitchTemplate = (key: string) => {
    const tpl = STYLE_TEMPLATES.find(t => t.key === key);
    if (!tpl) return;
    setForm({
      name: tpl.name,
      camera_style: tpl.camera_style,
      color: tpl.color,
      lighting: tpl.lighting,
      cinematography: tpl.cinematography,
      fixed_prompt: tpl.fixed_prompt,
      negative_prompt: tpl.negative_prompt,
    });
    toast.info("已填充模板配置，点击「保存修改」生效");
  };

  // ---------- AI 优化（✨ 用提示词优化风格） ----------
  const handleOptimize = async () => {
    if (!initial?.id) {
      toast.error("尚未生成风格，无法优化");
      return;
    }
    if (!aiPrompt.trim()) {
      toast.error("请输入优化提示词");
      return;
    }
    setOptimizing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/assets/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "visual_style", entity_id: initial.id, prompt: aiPrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "优化失败");

      setForm(toForm({ ...initial, ...data.data }));
      setAiPrompt("");
      toast.success(`风格已优化（v${data.version}）`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "优化失败");
    } finally {
      setOptimizing(false);
    }
  };

  // ---------- 保存 / 重置 ----------
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.fixed_prompt.trim()) { toast.error("名称和固定 Prompt 不能为空"); return; }
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/style`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error || "保存失败"); return; }
    toast.success("视觉风格已保存");
  };

  const handleResetTemplate = () => {
    const tpl = currentTemplate;
    setForm({
      name: tpl.name, camera_style: tpl.camera_style, color: tpl.color,
      lighting: tpl.lighting, cinematography: tpl.cinematography,
      fixed_prompt: tpl.fixed_prompt, negative_prompt: tpl.negative_prompt,
    });
    toast.info("已重置为模板默认，点击「保存修改」生效");
  };

  const lockable = assetLocked ? "opacity-40 pointer-events-none cursor-not-allowed" : "";

  return (
    <div className="flex flex-col gap-0">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground">风格配置</h2>
          <p className="text-xs text-muted-foreground/70 mt-1">
            风格是最顶层的视觉基因，注入到所有图片 / 视频 Prompt
          </p>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={assetLocked || isGenerating}
          className={`px-3.5 py-2 rounded-lg bg-primary/15 border border-primary/40 text-primary text-xs hover:bg-primary/25 transition disabled:opacity-40 ${lockable}`}
        >
          {isGenerating ? "⟳ 生成中..." : "⟳ 重新生成风格"}
        </button>
      </div>

      {/* 风格锁定说明（锁定态显示） */}
      {assetLocked && (
        <div className="mb-5 bg-locked/15 border border-locked/50 rounded-xl p-4 flex gap-3">
          <span className="text-muted-foreground text-lg leading-none mt-0.5">🔒</span>
          <div className="flex-1">
            <div className="text-sm text-foreground/80 font-medium mb-1">风格配置已锁定</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              风格是最顶层的视觉基因，已注入到全部已生成的 Prompt 中。锁定后不可修改，确保整部剧视觉语言统一
              （已生成 {plotCount} 集剧情）。
              <br />
              <span className="text-muted-foreground/70">如需换风格：设置页 → 危险操作 → 清空全部剧情（会连带删除分镜与 Prompt）。</span>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="grid lg:grid-cols-3 gap-5 items-start">
        {/* 当前风格模板卡 */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className={`h-32 bg-gradient-to-br ${currentTemplate.gradient} flex items-center justify-center text-4xl`}>
            {currentTemplate.icon}
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground">{currentTemplate.name}</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">当前</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">{currentTemplate.description}</p>

            <div className="pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground mb-2">切换风格模板</div>
              <select
                value={currentTemplate.key}
                onChange={e => handleSwitchTemplate(e.target.value)}
                disabled={assetLocked}
                className={`lockable w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none ${lockable}`}
              >
                {STYLE_TEMPLATES.map(t => (
                  <option key={t.key} value={t.key}>
                    {t.name}{t.key === currentTemplate.key ? "（当前）" : ""}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-stale mt-2 leading-relaxed">
                ⚠ 只能在生成第一集剧情前切换。有剧情后锁定，换风格需清空全部剧情
              </p>
            </div>
          </div>
        </div>

        {/* Prompt 配置卡 */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-foreground/80">
                  fixed_prompt <span className="text-xs text-muted-foreground/70">（正向风格描述，注入所有 Prompt 头部）</span>
                </label>
                <span className="text-[10px] text-muted-foreground/60 font-mono">EN</span>
              </div>
              <textarea
                rows={4}
                value={form.fixed_prompt}
                onChange={e => setForm({ ...form, fixed_prompt: e.target.value })}
                disabled={assetLocked}
                className={`lockable w-full bg-surface2 border border-border rounded-lg px-3.5 py-2.5 text-xs text-muted-foreground font-mono leading-relaxed focus:border-primary focus:outline-none resize-none ${lockable}`}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-foreground/80">
                  negative_prompt <span className="text-xs text-muted-foreground/70">（负向词，排除不想要的元素）</span>
                </label>
                <span className="text-[10px] text-muted-foreground/60 font-mono">EN</span>
              </div>
              <textarea
                rows={3}
                value={form.negative_prompt}
                onChange={e => setForm({ ...form, negative_prompt: e.target.value })}
                disabled={assetLocked}
                className={`lockable w-full bg-surface2 border border-border rounded-lg px-3.5 py-2.5 text-xs text-muted-foreground font-mono leading-relaxed focus:border-primary focus:outline-none resize-none ${lockable}`}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-foreground/80 mb-2">色彩基调</label>
                <Input
                  value={form.color}
                  onChange={e => setForm({ ...form, color: e.target.value })}
                  disabled={assetLocked}
                  className={`lockable bg-surface2 text-xs ${lockable}`}
                />
              </div>
              <div>
                <label className="block text-sm text-foreground/80 mb-2">镜头语言偏好</label>
                <Input
                  value={form.cinematography}
                  onChange={e => setForm({ ...form, cinematography: e.target.value })}
                  disabled={assetLocked}
                  className={`lockable bg-surface2 text-xs ${lockable}`}
                />
              </div>
            </div>

            {/* AI 优化区 */}
            <div className="pt-5 border-t border-border">
              <label className="block text-sm text-foreground/80 mb-2">✨ 用提示词优化风格</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="如：更暗一点，加强雨夜氛围，参考《银翼杀手2049》的色调…"
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  disabled={assetLocked || optimizing}
                  className={`lockable flex-1 bg-surface2 border border-border rounded-lg px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none ${lockable}`}
                />
                <button
                  type="button"
                  onClick={handleOptimize}
                  disabled={assetLocked || optimizing || !initial?.id}
                  className={`lockable px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition whitespace-nowrap disabled:opacity-40 ${lockable}`}
                >
                  {optimizing ? "优化中..." : "优化生成"}
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={loading || assetLocked}
                className={`lockable px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition disabled:opacity-40 ${lockable}`}
              >
                {loading ? "保存中..." : "保存修改"}
              </button>
              <button
                type="button"
                onClick={handleResetTemplate}
                disabled={assetLocked}
                className={`lockable px-5 py-2.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-xs hover:border-muted-foreground/50 transition ${lockable}`}
              >
                重置为模板默认
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
