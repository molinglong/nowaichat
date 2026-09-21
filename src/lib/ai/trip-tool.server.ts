import { tool } from "ai"
import {
  tripToolSchema,
  toTripData,
  haversineKm,
  type TripToolOutput,
  type TripStopData,
} from "@/lib/ai/trip-tool"
import { resolveAmapConfig } from "@/lib/amap-config.server"

/**
 * plan_trip 工具工厂(服务端):execute 内对 AI 给出的每站坐标做高德 POI 校准。
 *
 * 校准策略(全部失败降级,绝不阻塞出卡片):
 * - WS Key 解析:设置页配置(AmapKey 表)优先 → AMAP_WS_KEY 环境变量兜底;
 *   「Web服务」Key 需在高德控制台配 IP 白名单放行服务器出口 IP
 * - 每站调 v3/place/text 关键字搜索,取首个 POI 坐标;城市归属不符/无结果/超时 → 保留 AI 近似坐标
 * - 免费档 QPS 限制:3 站一批串行推进
 * - 校准结果(命中数/失败原因)打终端日志 —— AI 编的坐标不准会导致前端路径规划
 *   整段失败降级直线,这里必须可观测
 * - 纯只读,不落库(行程随消息正文持久化),临时模式安全
 */
export function createTripTool(userId?: string) {
  return tool({
    description:
      "生成一份多日旅游行程(结构化 JSON),前端会渲染成「地图+时间线」交互卡片:" +
      "每天 3-6 个按顺序游览的站点、站间交通方式与当日主题。当用户提出旅游/出行规划、" +
      "游玩安排、行程推荐等意图时调用。坐标给近似值即可,系统会自动校准到真实位置。",
    inputSchema: tripToolSchema,
    execute: async (input): Promise<TripToolOutput> => {
      const trip = toTripData(input)
      if (!trip) {
        return { ok: false, message: "行程数据不完整,请补充后重试" }
      }

      const allStops = trip.days.flatMap((d) => d.stops)
      const key = userId ? (await resolveAmapConfig(userId)).wsKey : process.env.AMAP_WS_KEY || ""
      if (!key || allStops.length === 0) {
        if (!key) {
          console.warn(
            `[plan_trip] 未配置高德 Web服务 Key(设置页/AMAP_WS_KEY),跳过坐标校准(${allStops.length} 站使用 AI 近似坐标)`
          )
        }
        return { ok: true, trip, calibrated: 0, total: allStops.length }
      }

      // 3 站一批串行(免费档 QPS 限制);单站失败保留 AI 坐标并记录原因
      let calibrated = 0
      const failReasons: string[] = []
      const BATCH = 3
      for (let i = 0; i < allStops.length; i += BATCH) {
        const batch = allStops.slice(i, i + BATCH)
        await Promise.all(
          batch.map((stop) =>
            calibrateStop(stop, trip.city, key).then((r) => {
              if (r.hit) {
                calibrated++
              } else if (r.reason) {
                failReasons.push(`${stop.name}: ${r.reason}`)
              }
            })
          )
        )
      }
      const uniqReasons = Array.from(new Set(failReasons))
      if (calibrated === 0) {
        console.warn(
          `[plan_trip] POI 坐标校准 0/${allStops.length} 全部失败(AI 近似坐标可能导致前端路径规划降级直线): ${uniqReasons.slice(0, 3).join(" | ")}`
        )
      } else {
        console.log(
          `[plan_trip] POI 坐标校准 ${calibrated}/${allStops.length}${uniqReasons.length ? `(未命中: ${uniqReasons.slice(0, 3).join(" | ")})` : ""}`
        )
      }
      return { ok: true, trip, calibrated, total: allStops.length }
    },
  })
}

/**
 * 单站坐标校准:高德 POI 关键字搜索,命中则原地改写 stop.lat/lng(GCJ-02)。
 * 未命中时标记 stop.cal=false(前端据此标注「位置为近似」),并返回失败原因用于终端日志。
 *
 * 小县城适配(宜州这类县级市实测教训):
 * - citylimit=true 限定城市内搜索:县级市 POI 的 cityname 常返回地级市名(宜州→河池市),
 *   若拿 cityname 做二次校验会误杀正确结果,故校验改用「距离护栏」替代;
 * - 「怀远古镇」这类带后缀的镇级 POI 在库里常搜不到,无结果时剥掉后缀用基础名重试一次
 *   (搜到镇政府/镇中心也比 AI 编造坐标强);
 * - 距离护栏:校准点距 AI 近似坐标 >150km 视为异城同名(防 city 参数失效全国搜索),拒收。
 */
const POI_NAME_SUFFIX = /(风景名胜区|旅游度假区|风景区|景区|古镇|古城|度假区|公园)$/
const CALIBRATE_MAX_JUMP_KM = 150

async function calibrateStop(
  stop: TripStopData,
  city: string,
  key: string
): Promise<{ hit: boolean; reason?: string }> {
  const attempt = async (kw: string): Promise<{ hit: boolean; reason?: string; lng?: number; lat?: number }> => {
    try {
      const url =
        "https://restapi.amap.com/v3/place/text" +
        `?keywords=${encodeURIComponent(kw)}&city=${encodeURIComponent(city)}&citylimit=true` +
        "&offset=1&page=1&extensions=base" +
        `&key=${encodeURIComponent(key)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return { hit: false, reason: `HTTP ${res.status}` }
      const data = (await res.json()) as {
        status?: string
        info?: string
        infocode?: string
        pois?: Array<{ location?: string }>
      }
      if (data.status !== "1") {
        return { hit: false, reason: `${data.info || "API错误"}(${data.infocode || "-"})` }
      }
      if (!Array.isArray(data.pois) || data.pois.length === 0) {
        return { hit: false, reason: "无结果" }
      }
      const [lngStr, latStr] = (data.pois[0].location || "").split(",")
      const lng = Number(lngStr)
      const lat = Number(latStr)
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng === 0 || lat === 0) {
        return { hit: false, reason: "坐标非法" }
      }
      return { hit: true, lng, lat }
    } catch (err) {
      return { hit: false, reason: err instanceof Error ? err.message : "网络异常" }
    }
  }

  let r = await attempt(stop.name)
  if (!r.hit && r.reason === "无结果") {
    const base = stop.name.replace(POI_NAME_SUFFIX, "")
    if (base && base !== stop.name) r = await attempt(base)
  }
  if (!r.hit) {
    stop.cal = false
    return { hit: false, reason: r.reason }
  }
  // 距离护栏:AI 近似坐标通常至少落在正确市域,校准点若距其过远则是同名异地
  const jumpKm = haversineKm(stop, { lat: r.lat!, lng: r.lng! })
  if (jumpKm > CALIBRATE_MAX_JUMP_KM) {
    stop.cal = false
    return { hit: false, reason: `同名异地(${Math.round(jumpKm)}km 外)` }
  }
  stop.lng = r.lng!
  stop.lat = r.lat!
  return { hit: true }
}
