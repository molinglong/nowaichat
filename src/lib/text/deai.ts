/**
 * 去AI味(de-AI-flavor)纯规则库 —— 移植自 NovelWriter 的 novelwriter-humanizer.js。
 *
 * 定位:对 AI 生成的小说正文做零 token 的本地"去味"——五类高频套话词典
 * (副词动词/过度描写/逻辑连接词/对话引导词/成语滥用)按序正则替换。
 * 纯函数、无依赖,前端(写作画布工具条)与服务端均可安全 import。
 *
 * 与源实现的差异(有意为之,源规则会毁文):
 * 1) 移除 trimModifiers(/真的./ → '.')与 passiveToActive(/被.*所/)——
 *    前者把"真的X"整体换成一个句点,后者贪婪跨标点吞掉半句话;
 * 2) 移除 /般/、/似的/ → '' ——"一般""像…似的"是正常中文表达;
 * 3) /如同/ 由删除改为 → '像'("眼神如同鹰"删成"眼神鹰"不通);
 * 4) 空白清理只折叠空格/制表符,保留换行(源实现 \s+ 会吃掉段落分隔)。
 */

export interface DeaiResult {
  /** 替换后的文本 */
  text: string
  /** 命中替换的总次数 */
  hits: number
  /** 各分类命中数(仅含命中的分类,用于展示动了哪几类) */
  byCategory: Array<{ label: string; hits: number }>
}

interface DeaiCategory {
  label: string
  rules: ReadonlyArray<{ pattern: RegExp; replacement: string }>
}

/** 规则按分类组织,应用顺序即数组顺序(与源实现一致) */
const DEAI_CATEGORIES: readonly DeaiCategory[] = [
  {
    label: '副词动词',
    rules: [
      { pattern: /不禁[（(]/g, replacement: '' },
      { pattern: /缓缓/g, replacement: '慢慢' },
      { pattern: /淡淡的笑/g, replacement: '笑了笑' },
      { pattern: /微微一笑/g, replacement: '笑了' },
      { pattern: /嘴角微微上扬/g, replacement: '嘴角上扬' },
      { pattern: /眼神中闪过/g, replacement: '' },
      { pattern: /目光微凝/g, replacement: '盯着' },
      { pattern: /若有所思/g, replacement: '' },
      { pattern: /心中一动/g, replacement: '' },
      { pattern: /眼底/g, replacement: '眼中' },
      { pattern: /双眸/g, replacement: '眼睛' },
      { pattern: /纤细的手指/g, replacement: '手指' },
      { pattern: /修长/g, replacement: '' },
      { pattern: /如玉/g, replacement: '' },
    ],
  },
  {
    label: '过度描写',
    rules: [
      { pattern: /如同/g, replacement: '像' },
      { pattern: /仿佛/g, replacement: '好像' },
      { pattern: /好似/g, replacement: '像' },
      { pattern: /恰似/g, replacement: '就像' },
      { pattern: /宛如/g, replacement: '好像' },
      { pattern: /犹如/g, replacement: '如同' },
      { pattern: /像是/g, replacement: '像' },
    ],
  },
  {
    label: '逻辑连接词',
    rules: [
      { pattern: /然而/g, replacement: '但是' },
      { pattern: /随即/g, replacement: '然后' },
      { pattern: /顿时/g, replacement: '' },
      { pattern: /赫然/g, replacement: '' },
      { pattern: /只见/g, replacement: '' },
      { pattern: /就在这时/g, replacement: '' },
      { pattern: /与此同时/g, replacement: '同时' },
    ],
  },
  {
    label: '对话引导词',
    rules: [
      { pattern: /"……"/g, replacement: '"…"' },
      { pattern: /他沉声道/g, replacement: '他说' },
      { pattern: /她轻声道/g, replacement: '她说' },
      { pattern: /冷冷地/g, replacement: '' },
      { pattern: /一字一顿/g, replacement: '' },
    ],
  },
  {
    label: '成语滥用',
    rules: [
      { pattern: /心潮澎湃/g, replacement: '心里激动' },
      { pattern: /怒火中烧/g, replacement: '很生气' },
      { pattern: /喜上眉梢/g, replacement: '很高兴' },
      { pattern: /惊恐万分/g, replacement: '非常害怕' },
      { pattern: /恍然大悟/g, replacement: '突然明白' },
      { pattern: /咬牙切齿/g, replacement: '生气地说' },
      { pattern: /面面相觑/g, replacement: '互相看着' },
    ],
  },
]

/**
 * 规则替换去味:按分类顺序应用全部规则,返回替换结果与命中统计。
 * 空替换后可能产生的多余空白由二次清理兜底。
 */
export function deAiFlavor(input: string): DeaiResult {
  let result = input
  let total = 0
  const byCategory: DeaiResult['byCategory'] = []

  for (const cat of DEAI_CATEGORIES) {
    let catHits = 0
    for (const rule of cat.rules) {
      const matches = result.match(rule.pattern)
      if (matches && matches.length > 0) {
        catHits += matches.length
        result = result.replace(rule.pattern, rule.replacement)
      }
    }
    if (catHits > 0) byCategory.push({ label: cat.label, hits: catHits })
    total += catHits
  }

  // 二次清理:折叠连续空格/制表符(保留换行段落),去掉"。，"这类标点残渣
  result = result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/。[,,.](?=[^\s])/g, '')
    .trim()

  return { text: result, hits: total, byCategory }
}
