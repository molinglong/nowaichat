"use client"

import { useState } from "react"

/* ── 认证页(登录/注册)共用表单控件 ─────────────────────────
   两个页面的输入框/标签/错误条/密码框/按钮都从这里引用，
   保证视觉一致；样式 token 与 globals.css 的中性灰变量对齐 ── */

/* 输入框：细边框，聚焦时 accent 色环点亮 */
export const inputClass =
  "h-11 w-full rounded-[10px] border border-line-strong bg-surface px-3.5 text-sm text-content-primary outline-none transition placeholder:text-content-muted focus:border-accent/60 focus:ring-[3px] focus:ring-accent-soft/90"

export const labelClass =
  "mb-1.5 block text-[12.5px] font-medium tracking-[0.02em] text-content-secondary"

/* 主按钮：hover 微抬升 + 按压缩放（外层套 auth-reveal wrapper，避免入场动画 fill 拦截 transform） */
export const primaryButtonClass =
  "flex h-11 w-full items-center justify-center rounded-[10px] bg-accent text-sm font-medium text-accent-foreground transition hover:-translate-y-px hover:bg-accent-hover hover:shadow-[0_8px_20px_rgb(var(--fg)/0.14)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55"

/* 底部切换链接：淡底胶囊,hover 边框加深(与全站胶囊风一致) */
export const footerLinkClass =
  "inline-flex items-center rounded-full border border-line bg-surface-subtle/60 px-2.5 py-1 text-xs font-medium text-content-primary transition align-middle hover:bg-surface-muted hover:border-line-strong active:scale-95"

/* 错误提示条：灰底低调 + 红点，出现时轻摇（不用大红块） */
export function ErrorBar({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="auth-shake flex items-center gap-2.5 rounded-[10px] border border-line bg-surface-subtle px-3.5 py-2.5 text-[13px] text-content-primary"
    >
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#e5484d] shadow-[0_0_0_3px_rgba(229,72,77,0.16)]" />
      {message}
    </div>
  )
}

/* 密码框 + 右侧明文/密文切换 */
export function PasswordInput({
  id,
  placeholder,
  value,
  onChange,
}: {
  id: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputClass} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        title={show ? "隐藏密码" : "显示密码"}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-content-muted transition hover:bg-surface-subtle hover:text-content-secondary"
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
