/**
 * 方正书版数学字体伪汉字映射层。
 *
 * 人教版教材与大量学术期刊 PDF 由方正书版排版,数学斜体字母与根号被
 * 映射到犭旁生僻汉字上(ToUnicode CMap 即如此),提取结果表现为:
 * 槡=√、犪=a、犫=b、狓=x、犕犲犪狀=Mean、犽狏=kv。
 *
 * 对照表按方正赋码顺序硬编码,主链中夹有犬/犭/犰/狈等常用字形成跳位,
 * 已用真实语料锚定:a-f、k、n、p、t、v、x、y、M、C 十余处。
 * 这些字均为生僻字,普通正文几乎不会出现,无条件映射的误伤概率可忽略。
 */
const LOWER_SRC = '犪犫犮犱犲犳犵犺犻犼犽犾犿狀狅狆狇狉狊狋狌狏狑狓狔狕'
const LOWER_DST = 'abcdefghijklmnopqrstuvwxyz'
const UPPER_SRC = '犃犅犆犇犈犉犌犎犐犑犓犔犕犖犗犘犙犚犛犜犝犞犠犡犢犣'
const UPPER_DST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const TABLE = new Map<string, string>([
  ['槡', '√'],
  ...[...LOWER_SRC].map((ch, i) => [ch, LOWER_DST[i]] as const),
  ...[...UPPER_SRC].map((ch, i) => [ch, UPPER_DST[i]] as const),
])

export interface MapResult {
  text: string
  /** 命中映射的字符数,用于转换提示 */
  hits: number
}

/** 逐字符替换方正伪汉字;1:1 单字符替换,不影响任何几何宽度估算 */
export function mapFounderMath(text: string): MapResult {
  if (!text) return { text, hits: 0 }
  let hits = 0
  let out = ''
  for (const ch of text) {
    const mapped = TABLE.get(ch)
    if (mapped !== undefined) {
      out += mapped
      hits++
    } else {
      out += ch
    }
  }
  return { text: out, hits }
}
