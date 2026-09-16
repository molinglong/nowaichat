"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"

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
    <div className="w-full max-w-md">
      <div className="bg-surface rounded-2xl shadow-lg border border-line p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-content-primary">
            登录
          </h1>
          <p className="text-content-secondary mt-2">
            登录你的账户以继续
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-sm rounded-lg px-4 py-3 border border-red-200 dark:border-red-900/50">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-content-secondary mb-1.5"
            >
              邮箱
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-2.5 rounded-lg border border-line-strong bg-surface text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-line-strong focus:border-transparent transition"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-content-secondary mb-1.5"
            >
              密码
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 rounded-lg border border-line-strong bg-surface text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-line-strong focus:border-transparent transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium transition focus:outline-none focus:ring-2 focus:ring-line-strong focus:ring-offset-2 dark:focus:ring-offset-surface"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <p className="text-center text-sm text-content-secondary mt-6">
          还没有账户？{" "}
          <Link
            href="/register"
            className="text-content-primary hover:underline font-medium"
          >
            立即注册
          </Link>
        </p>
      </div>
    </div>
  )
}
