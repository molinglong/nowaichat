import { tool } from "ai"
import { z } from "zod"

/**
 * 行程规划工具(plan_trip)
 *
 * 设计目标:用户提出旅游/出行规划意图时,模型产出结构化行程 JSON,
 * 前端渲染为「地图 + 时间线」交互卡片(坐标经服务端高德 POI 校准,
 * 段间路径由前端调高德 Walking/Transfer/Driving 真实规划)。
 *
 * 与 generate_mask 的差异:有 execute(服务端做坐标校准后原样返回),
 * 但纯只读不落库 —— 行程随消息正文持久化,历史回放走 metadata.toolCalls
 * 同一渲染分支;因此临时模式也安全可用(对比模式不注入)。
 *
 * schema 只定义 AI 需要产出的字段;展示用的配色(每日主题色)由前端
 * 调色板按天序分配,不占模型 token。本文件纯常量无服务端依赖,
 * 客户端组件可安全 import。
 */

export const TRIP_TOOL_NAME = "plan_trip"

/** 段间交通方式:walk 步行 / transit 地铁公交 / drive 打车 */
export type TripMoveMode = "walk" | "transit" | "drive"

const TRIP_MOVE_MODES: TripMoveMode[] = ["walk", "transit", "drive"]

/** 单日颜色调色板(前端按 day 序号取模分配;格式 "R G B" 空格串,便于拼 rgba) */
export const TRIP_DAY_COLORS = [
  "59 130 246", // 蓝
  "245 158 11", // 琥珀
  "16 185 129", // 翠绿
  "139 92 246", // 紫
  "236 72 153", // 玫红
  "14 165 233", // 天蓝
  "132 204 22", // 橄榄
] as const

export function tripDayColor(dayIndex: number): string {
  return TRIP_DAY_COLORS[dayIndex % TRIP_DAY_COLORS.length]
}

/** 行程中的一站(AI 产出 lat/lng 为 GCJ-02 近似值,服务端会做 POI 校准) */
export const tripStopSchema = z.object({
  time: z.string().min(1).max(12).describe("到达/开始时间,24 小时制 HH:mm,如 09:00"),
  name: z.string().trim().min(1).max(30).describe("地点名称,用大众熟知的正式名称(利于 POI 搜索)"),
  lat: z.number().min(-90).max(90).describe("纬度,GCJ-02 坐标(高德系),给近似值即可"),
  lng: z.number().min(-180).max(180).describe("经度,GCJ-02 坐标(高德系),给近似值即可"),
  tag: z.string().min(1).max(10).describe("分类标签:美食/文化/自然/购物/亲子/夜景/打卡等,取其一"),
  budget: z.number().min(0).max(100000).describe("该站人均花费,元;免费填 0"),
  desc: z.string().min(1).max(60).describe("一句话看点/推荐理由,不超过 60 字"),
})

const tripDaySchema = z.object({
  day: z.number().int().min(1).max(7).describe("第几天,从 1 开始连续编号"),
  theme: z.string().min(1).max(20).describe("当日主题,如「经典地标」「文艺街区」"),
  stops: z
    .array(tripStopSchema)
    .min(1)
    .max(6)
    .describe("当日行程站点,按游览先后顺序排列,每天 3-6 站为宜"),
  moves: z
    .array(z.enum(["walk", "transit", "drive"]))
    .max(5)
    .describe(
      "段间交通方式,长度必须等于 stops 数量减一:相邻两站直线距离约 1.2km 内用 walk;" +
        "市内中长距离优先 transit(地铁/公交);跨区、赶时间或带行李用 drive(打车)"
    ),
})

export const tripToolSchema = z.object({
  city: z.string().trim().min(1).max(20).describe("目的地城市,如「成都」"),
  days: z.array(tripDaySchema).min(1).max(7).describe("按天拆解的行程,1-7 天"),
  summary: z.object({
    stay: z.string().min(1).max(30).describe("住宿建议区域,如「春熙路/太古里一带」"),
    transport: z.string().min(1).max(40).describe("市内交通建议,一句话"),
    budget: z.number().min(0).max(1000000).describe("人均总预估(含大交通与住宿),元;不确定可按经验估"),
  }),
})

export type TripToolInput = z.infer<typeof tripToolSchema>
export type TripStop = z.infer<typeof tripStopSchema>
export type TripDay = z.infer<typeof tripDaySchema>

/**
 * 渲染层单站:AI 产出字段 + 服务端校准标记。
 * cal=false 表示该站 POI 校准未命中(位置为 AI 近似值),前端据此标「位置为近似」;
 * 缺省(undefined)视为已校准/未知(历史回放的消息无此字段,不标)。
 */
export type TripStopData = TripStop & { cal?: boolean }

/** 归一化后的行程数据(前端渲染用:补齐 moves、附 dayColor) */
export interface TripData {
  city: string
  days: Array<{
    day: number
    theme: string
    color: string
    stops: TripStopData[]
    /** 段间交通,长度恒等于 stops.length - 1 */
    moves: TripMoveMode[]
  }>
  summary: TripToolInput["summary"]
}

/** 工具输出(execute 校准后返回;ok:false 时 trip 缺省) */
export type TripToolOutput =
  | { ok: true; trip: TripData; calibrated: number; total: number }
  | { ok: false; message: string }

/** 两点球面距离(km),moves 缺项补齐与服务端校准距离护栏共用 */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function isValidCoord(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

/**
 * 从任意来源(tool part input / 历史 metadata input)提取归一化行程,
 * 逐字段兜底、剔除非法站点,核心数据缺失返回 null。
 * moves 长度强制归一为 stops.length - 1(缺项按相邻距离补 walk/drive,多余截断)。
 */
export function toTripData(input: unknown): TripData | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>
  const city = typeof raw.city === "string" ? raw.city.trim() : ""
  const rawDays = Array.isArray(raw.days) ? raw.days : []
  if (!city || rawDays.length === 0) return null

  const days: TripData["days"] = []
  rawDays.forEach((d, i) => {
    if (!d || typeof d !== "object") return
    const day = d as Record<string, unknown>
    // cal(校准标记)随对象原样透传:execute 校准阶段原地写入,历史回放无此字段
    const stops = (Array.isArray(day.stops) ? day.stops : []).filter(
      (s): s is TripStopData =>
        !!s &&
        typeof s === "object" &&
        typeof (s as TripStopData).name === "string" &&
        !!(s as TripStopData).name.trim() &&
        isValidCoord((s as TripStopData).lat) &&
        isValidCoord((s as TripStopData).lng) &&
        Math.abs((s as TripStopData).lat) <= 90 &&
        Math.abs((s as TripStopData).lng) <= 180
    )
    if (stops.length === 0) return
    const moves: TripMoveMode[] = (Array.isArray(day.moves) ? day.moves : [])
      .filter((m): m is TripMoveMode => TRIP_MOVE_MODES.includes(m))
      .slice(0, stops.length - 1)
    while (moves.length < stops.length - 1) {
      const prev = moves.length > 0 ? stops[moves.length] : stops[0]
      const next = stops[moves.length + 1]
      moves.push(next && haversineKm(prev, next) <= 1.2 ? "walk" : "drive")
    }
    days.push({
      day: typeof day.day === "number" ? day.day : i + 1,
      theme: typeof day.theme === "string" && day.theme.trim() ? day.theme.trim() : "行程",
      color: tripDayColor(i),
      stops,
      moves,
    })
  })
  if (days.length === 0) return null

  const rawSummary =
    raw.summary && typeof raw.summary === "object" ? (raw.summary as Record<string, unknown>) : {}
  const stopsBudgetSum = days.reduce(
    (acc, d) => acc + d.stops.reduce((a, s) => a + (typeof s.budget === "number" ? s.budget : 0), 0),
    0
  )
  return {
    city,
    days,
    summary: {
      stay: typeof rawSummary.stay === "string" ? rawSummary.stay : "",
      transport: typeof rawSummary.transport === "string" ? rawSummary.transport : "",
      budget: typeof rawSummary.budget === "number" ? rawSummary.budget : Math.round(stopsBudgetSum),
    },
  }
}

/** 输出形状守卫(历史回放 output 走 JSON 序列化,需要运行时判别) */
export function isTripToolOutput(o: unknown): o is TripToolOutput {
  return !!o && typeof o === "object" && typeof (o as TripToolOutput).ok === "boolean"
}

/** 创建行程规划工具(有 execute:服务端坐标校准,见 trip-tool.server.ts) */
export function createTripTool() {
  return tool({
    description:
      "生成一份多日旅游行程(结构化 JSON),前端会渲染成「地图+时间线」交互卡片:" +
      "每天 3-6 个按顺序游览的站点、站间交通方式与当日主题。当用户提出旅游/出行规划、" +
      "游玩安排、行程推荐等意图时调用。坐标给近似值即可,系统会自动校准到真实位置。",
    inputSchema: tripToolSchema,
  })
}

/** 注入 system prompt 的使用规则段 */
export const TRIP_TOOL_PROMPT: string = [
  "## 行程规划(plan_trip 工具)",
  "- 用户提出旅游/出行/游玩规划意图(「帮我规划成都3天」「五一去哪玩,做个行程」)时,调用本工具生成结构化行程,前端会渲染成地图卡片",
  "- 关键信息不足时(天数、同行人、预算、偏好)先用 ask_clarification 问清(一次问全),再规划;用户已说明的不重复问",
  "- 每天 3-6 站、按游览先后排序,同一天站点尽量同片区,避免来回折返",
  "- moves 长度必须等于该天 stops 数减一:相邻站直线约 1.2km 内 walk;市内中长距离优先 transit(地铁/公交);跨区/赶时间/带行李 drive",
  "- 站点名称用大众熟知的正式名称(利于系统校准到真实位置);坐标给 GCJ-02 近似值即可,系统会自动校准",
  "- budget 单位为元(该站人均);summary.budget 是人均总预估,含大交通与住宿,与各站小计口径不同",
  "- 调用后正文不要再重复罗列行程内容(卡片已完整展示),只补 1-2 句关键提醒(天气/预约/错峰)",
].join("\n")
