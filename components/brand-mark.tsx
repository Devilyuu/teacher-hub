/**
 * 品牌标记「仪表环」：四分之三厚环 + 轴心点，开口留白。
 *
 * 2026-08-31 定稿（候选走过三角家族与沉淀/墨滴/档案页等六案，用户选定此稿）：
 * 它是「驾驶舱/仪表盘」的极简缩写，和应用图标（暗夜仪表罗盘）同一种气质，
 * 但不是罗盘——罗盘只是课题模块的隐喻，不拿来当全平台标志（layout.tsx 旧注）。
 *
 * 墨黑单色、跟 currentColor 走：亮色下配 text-primary 是墨，暗色下自动反白。
 * 不许上色——健康度六色的禁令对品牌标记同样生效。
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden>
      {/* 环长 3/4（dasharray 按 r=29 的周长 182.2 切 75%），旋转让开口朝上 */}
      <circle
        cx="48"
        cy="48"
        r="29"
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray="136.7 45.6"
        transform="rotate(135 48 48)"
      />
      <circle cx="48" cy="48" r="7" fill="currentColor" />
    </svg>
  );
}
