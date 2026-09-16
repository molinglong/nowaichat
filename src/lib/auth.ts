import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./db"

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        // 登录标识兼容邮箱与用户名:先按 email 查,查不到再按 name 兑底
        const identifier = credentials.email as string
        const user =
          (await prisma.user.findUnique({
            where: { email: identifier },
          })) ??
          (await prisma.user.findFirst({
            where: { name: identifier },
          }))

        if (!user || !user.passwordHash) return null

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        )

        if (!isValid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.sub = user.id  // explicitly set sub for reliability
      }
      return token
    },
    async session({ session, token }) {
      const userId = (token.sub ?? token.id) as string | undefined
      if (!userId || !session.user) return session

      session.user.id = userId
      return session
    },
  },
})
