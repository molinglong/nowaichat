"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致")
      return
    }

    if (password.length < 6) {
      setError("密码长度至少为 6 位")
      return
    }

    setLoading(true)

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "注册失败")
        setLoading(false)
        return
      }

      router.push("/login?registered=1")
    } catch {
      setError("网络错误，请稍后重试")
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-surface rounded-2xl shadow-lg border border-line p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-content-primary">
            注册
          </h1>
          <p className="text-content-secondary mt-2">
            创建你的新账户
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
              htmlFor="name"
              className="block text-sm font-medium text-content-secondary mb-1.5"
            >
              用户名
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="你的名字"
              className="w-full px-4 py-2.5 rounded-lg border border-line-strong bg-surface text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-line-strong focus:border-transparent transition"
            />
          </div>

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
              placeholder="至少 6 位"
              className="w-full px-4 py-2.5 rounded-lg border border-line-strong bg-surface text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-line-strong focus:border-transparent transition"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-content-secondary mb-1.5"
            >
              确认密码
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入密码"
              className="w-full px-4 py-2.5 rounded-lg border border-line-strong bg-surface text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-line-strong focus:border-transparent transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium transition focus:outline-none focus:ring-2 focus:ring-line-strong focus:ring-offset-2 dark:focus:ring-offset-surface"
          >
            {loading ? "注册中..." : "注册"}
          </button>
        </form>

        <p className="text-center text-sm text-content-secondary mt-6">
          已有账户？{" "}
          <Link
            href="/login"
            className="text-content-primary hover:underline font-medium"
          >
            立即登录
          </Link>
        </p>
      </div>
    </div>
  )
}
