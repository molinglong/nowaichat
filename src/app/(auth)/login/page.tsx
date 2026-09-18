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

export default function LoginPage() {
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
      redirect: false,
    })

    setLoading(false)

    if (res?.error) {
      setError("邮箱或密码错误")
      return
    }

    router.push("/chat")
    router.refresh()
  }

  return (
    <div>
      <h2 className="font-ultra auth-reveal auth-delay-1 text-[30px] tracking-[0.06em] text-content-primary">
        欢迎回来
      </h2>
      <p className="auth-reveal auth-delay-2 mb-7 mt-2 text-[13.5px] text-content-secondary">
        登录你的账户以继续
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
            密码
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
              "登 录"
            )}
          </button>
        </div>
      </form>

      <p className="auth-reveal auth-delay-5 mt-6 text-center text-[13.5px] text-content-secondary">
        还没有账户？{" "}
        <Link href="/register" className={footerLinkClass}>
          立即注册
        </Link>
        <span className="mx-2 text-line">·</span>
        公共电脑？{" "}
        <Link href="/login/ephemeral" className={footerLinkClass}>
          临时聊天
        </Link>
      </p>
    </div>
  )
}
