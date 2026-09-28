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

/**
 * 去AI味文风纪律 —— 小说/故事类正文的写作侧提示词(与上面的规则替换互补:
 * 生成时约束 + 生成后替换,两头夹)。移植自外部「去AI味提示词」方法论:
 * 模仿人类写作的不规律与缺陷感,而不是整齐、完整、对称。
 *
 * 适配差异(有意为之):
 * 1) 剔除「偶尔用错别字」「伏笔可以不收」等会降低成稿质量的条目;
 * 2) 按项目提示词规范改写为正向、可观察的指令(见 lib/ai/style-presets.ts 头部);
 * 3) 不含标题 —— 画布生成、write_document 工具、小说面具共用同一份规则,
 *    各注入点自配标题与适用范围。
 */
export const DEAI_WRITING_DISCIPLINE: string = [
  '文风纪律(去AI味):',
  '1. 句长交错:2-4 字的短句与 20 字以上的长句混着用,不连续写长度相近的句子;并列排比最多三句,只放在情绪最高点',
  '2. 比喻节制:仿佛、宛如、犹如、好似全文最多出现一处,其余换成具体动作、身体反应或物件',
  '3. 滥词清理:顿时、瞬间、不禁、缓缓、淡淡这类词能删就删,优先换成动作、对白或具体细节',
  '4. 段落参差:一句成段与三五句成段交替;对白可以连着对白,不必每句后面都挂动作描写',
  '5. 情绪与内心:情绪落在身体与行为上(手指发麻、喉咙发干、忽然想笑),不写"他愤怒了"式标签;情绪可以反常、跳跃,不走线性升级;内心独白用口语腔(带语气词、半截话),不写成书面分析',
  '6. 人物口吻稳定:每个人有固定的口头禅、句长习惯与称呼方式;对白用口语,允许半截话与答非所问;遮住说话人名字应能分辨出是谁',
  '7. 段落开头方式轮换:动作、对白、环境、心理、物件交替开场,不连续用人名起头',
  '8. 段尾落在具体动作、对白或细节上,不用总结性的句子收束段落',
  '9. 重点场景写足细节与感官,过场一两句带过;允许少量闲笔(窗外的猫、路过的雨)与一两处不完整的意识流碎片,增加生活质感',
  '10. 偶尔用一句克制的叙述旁白(如"他当时还不知道")留宿命感,不频繁跳出故事评论',
  '情节、人物设定与用户显式要求优先于以上文风纪律。',
].join('\n')
