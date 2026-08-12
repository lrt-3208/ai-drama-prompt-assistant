"use client";

// ============================================
// 情绪曲线 — SVG 折线图（显式颜色，不依赖主题）
// 红色轴线 + 情绪关键词/强度标注 + 镜号横轴
// ============================================

import type { EmotionPoint } from "@/lib/storyboard/document-types";

interface EmotionCurveProps {
  data: EmotionPoint[];
}

export function EmotionCurve({ data }: EmotionCurveProps) {
  if (!data || data.length === 0) {
    return <div className="py-10 text-center text-[11px] text-gray-400">暂无情绪曲线数据</div>;
  }

  const width = 440;
  const height = 210;
  const padding = { top: 34, right: 20, bottom: 34, left: 28 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const xStep = data.length > 1 ? plotW / (data.length - 1) : 0;
  const yScale = (val: number) => padding.top + plotH - ((val - 1) / 9) * plotH;
  const xPos = (i: number) => (data.length > 1 ? padding.left + i * xStep : padding.left + plotW / 2);

  const points = data.map((d, i) => `${xPos(i)},${yScale(d.intensity)}`).join(" ");

  // 首尾点文字锚点调整，避免边缘裁剪
  const anchor = (i: number) => (i === 0 ? "start" : i === data.length - 1 ? "end" : "middle");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {/* Y 轴网格线 + 刻度 */}
      {[1, 5, 10].map((v) => (
        <g key={v}>
          <line
            x1={padding.left}
            y1={yScale(v)}
            x2={width - padding.right}
            y2={yScale(v)}
            stroke="#e5e7eb"
            strokeDasharray="4 4"
          />
          <text x={padding.left - 6} y={yScale(v) + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
            {v}
          </text>
        </g>
      ))}

      {/* 情绪轴线 */}
      <polyline
        points={points}
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* 数据点 + 标注 */}
      {data.map((d, i) => (
        <g key={i}>
          <circle
            cx={xPos(i)}
            cy={yScale(d.intensity)}
            r="4"
            fill="#ef4444"
            stroke="#ffffff"
            strokeWidth="1.5"
          />
          {/* 情绪关键词 */}
          <text
            x={xPos(i)}
            y={yScale(d.intensity) - 16}
            textAnchor={anchor(i)}
            fontSize="10"
            fontWeight="600"
            fill="#374151"
          >
            {d.emotion}
          </text>
          {/* 强度值 */}
          <text x={xPos(i)} y={yScale(d.intensity) - 6} textAnchor={anchor(i)} fontSize="8" fill="#9ca3af">
            {d.intensity}/10
          </text>
          {/* 横轴镜号 */}
          <text
            x={xPos(i)}
            y={height - padding.bottom + 14}
            textAnchor="middle"
            fontSize="9"
            fill="#9ca3af"
          >
            S{d.shot_number}
          </text>
        </g>
      ))}
    </svg>
  );
}
