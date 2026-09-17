"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ErrorBar,
  PasswordInput,
  footerLinkClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from "@/components/auth-controls"

/**
 * 临时聊天登录入口(/login/ephemeral):
 * - 仅接受访客密码(主密码在此入口会被拒绝,防止公共电脑上误泄露)
 * - 登录成功进入临时模式:空历史、无账户设置,对话进隔离区
 * - 隔离区对话可在正常模式 设置→账号信息 中找回
 */
export default function EphemeralLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const res = await signIn("credentials", {
      email,
      password,
      // 临时入口标志:服务端 authorize 据此拒绝主密码、允许访客密码
      ephemeralEntry: "1",
      redirect: false,
    })

    setLoading(false)

    if (res?.error) {
      if (res.error === "EPHEMERAL_ENTRY_MAIN_PASSWORD") {
        setError("此入口仅支持访客密码，主密码请使用正常登录入口")
      } else if (res.error === "RATE_LIMITED") {
        setError("尝试次数过多，请一分钟后再试")
      } else {
        setError("邮箱/用户名或访客密码错误")
      }
      return
    }

    router.push("/chat")
    router.refresh()
  }

  return (
    <div>
      <h2 className="font-ultra auth-reveal auth-delay-1 text-[30px] tracking-[0.06em] text-content-primary">
        临时聊天
      </h2>
      <p className="auth-reveal auth-delay-2 mb-7 mt-2 text-[13.5px] text-content-secondary">
        使用访客密码登录。对话将隔离保存，不会出现在正常历史记录中，且无法访问账户设置
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBar message={error} />}

        <div className="auth-reveal auth-delay-3">
          <label htmlFor="email" className={labelClass}>
            邮箱或用户名
          </label>
          <input
            id="email"
            type="text"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com 或用户名"
            className={inputClass}
          />
        </div>

        <div className="auth-reveal auth-delay-4">
          <label htmlFor="password" className={labelClass}>
            访客密码
          </label>
          <PasswordInput
            id="password"
            placeholder="••••••••"
            value={password}
            onChange={setPassword}
          />
        </div>

        {/* reveal 放在 wrapper 上，避免入场动画 fill 拦截按钮的 hover/active transform */}
        <div className="auth-reveal auth-delay-5">
          <button type="submit" disabled={loading} className={primaryButtonClass}>
            {loading ? (
              <>
                <span className="h-[15px] w-[15px] animate-spin rounded-full border-2 border-accent-foreground/35 border-t-accent-foreground" />
                <span className="ml-2">登录中…</span>
              </>
            ) : (
              "进入临时聊天"
            )}
          </button>
        </div>
      </form>

      <p className="auth-reveal auth-delay-5 mt-6 text-center text-[13.5px] text-content-secondary">
        账号主人？{" "}
        <Link href="/login" className={footerLinkClass}>
          使用主密码登录
        </Link>
      </p>
    </div>
  )
}
