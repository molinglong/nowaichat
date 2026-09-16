/**
 * Tauri 桌面客户端专用 Next.js 配置
 *
 * 与 next.config.mjs 的差异:
 * - output: 'export'     静态导出,产物在 out/
 * - trailingSlash        Tauri 本地协议加载需要
 * - images.unoptimized   next/image 在静态导出时不能优化
 * - 删除 standalone 相关(serverComponentsExternalPackages + outputFileTracingIncludes)
 *
 * 用法:
 *   next build --config next.config.desktop.mjs
 *   (或通过 src-tauri/tauri.conf.json 的 beforeBuildCommand 自动调用)
 */

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // 静态导出没有 server runtime,不需要:
  // - serverComponentsExternalPackages
  // - outputFileTracingIncludes
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  webpack: (config) => {
    // Handle node: protocol imports that Prisma v7 uses
    // (静态导出产物里没有 server code,但 client bundle 仍可能引用)
    config.externals.push(({ request }, callback) => {
      if (request && /^node:/.test(request)) {
        return callback(null, `commonjs ${request}`)
      }
      callback()
    })
    return config
  },
}
export default nextConfig
