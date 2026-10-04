# 课本 PDF → 知识库标准 HTML(流水线与提示词)

输出结构精确对齐 `import-knowledge-html.cjs` 的解析规则。两条路径:

| 路径 | 适用 | 耗时 | AI 参与 |
|---|---|---|---|
| **快路径(推荐)**:勘测出配置 → 本地转换器秒转全书 | 同书系第 2 本起 | 几分钟 | **零**(配置已沉淀) |
| 快路径·新书系首本 | 版面规则未知 | ~10 分钟 | 只做勘测(5-10 分钟),不转录全书 |
| **兜底路径**:AI 直接转录全书 | 无本地代码执行环境/零散小资料 | 30-40 分钟 | 全程 |

流水线(快路径):

1. **勘测**(AI,新书系只做一次):用下面的勘测提示词,AI 分析 PDF 版面输出 YAML 配置 → 存为 `scripts/layouts/<书系>.yaml`
2. **转换**(本地,秒级):`python scripts/pdf2html-textbook.py <pdf> --layout scripts/layouts/<书系>.yaml [--grade "必修 中外历史纲要（下）"]` → 标准 HTML。册别每本不同,用 `--grade` 覆盖;页范围默认自动探测(自动跳过扉页/版权/目录,依据配置的 unit/lesson_pattern 标题形态校验),必要时 `--start/--end` 手动指定。同书系配置直接复用,全程零 AI
3. **质检**:`node scripts/verify-textbook-html.cjs <html路径>`(禁令/包裹容器/cover 硬性检查 + 结构计数与各章字数分布,供对照 PDF 目录)
4. **入库**:`node scripts/import-knowledge-html.cjs <html路径> [--user admin@qq.com] [--subject xx] [--kind textbook|material] [--title 覆盖书名]`;`--kind` 不传时按标题自动判:含「答题模板/提纲/秘籍/讲义/笔记」→ material(资料),否则 textbook(课本)

## 为什么要有这个标准(脚本解析的硬约束)

- 脚本只识别 body 顶层的 `h2/h3/h4`、`div`、`table`、`p`,**其他标签(bare 列表、h1/h5/h6、img)的内容直接丢弃**
- `<div class="cover">` 里 book-name/grade/publisher 三个字段用正则取文本,**嵌套标签会取到空**
- 任何外层包裹容器会把整本书吞成一个 div,结构全毁
- `<ol>` 序号是浏览器渲染的,纯文本化后丢失,所以列表必须手写序号
- 扫描版/图片型 PDF 交给 AI 硬转会大量编造,提示词第 0 步强制先验类型,图片型直接拒绝并报告

## 勘测提示词(新书系首本用;整段复制给 AI,随消息附上 PDF)

> AI 需要能在你本机跑 Python(装 PyMuPDF)才能走勘测;豆包默认可以。勘测只产出规则配置,不转录正文——这是快路径比兜底快 3-4 倍的原因。

```text
你是一名教材版面分析员。我要把一本课本 PDF 批量转成结构化 HTML,但**你的任务不是转录全书**,而是探测这本书的版面规则,输出一份 YAML 配置,供本地转换脚本使用。全书转录由本地脚本完成,你只负责把规则探测准确。

【第 0 步:PDF 类型检查(必须最先执行)】
- 先用 PyMuPDF 检查 PDF 文字层:统计各页 get_text 的字符数。
- 若绝大多数页面无文字层(扫描件/图片型 PDF):立即停止,禁止探测,只回复:
  【无法处理:图片型 PDF】检测结果:共 N 页,未检测到可用文字层。处理建议:请提供含文字层的 PDF,或先用 OCR 工具处理。
- 混合型(部分页有文字层)先停下报告页码区间,等我决定。
- 仅当文字层清晰、连续时,才继续勘测。

【勘测方法(用 PyMuPDF 在本机分析,不要转录正文)】
1. 统计全书所有 span 的字号分布(四舍五入到 0.1),每档字号附 3-5 个样例文本;
2. 对照 PDF 目录页,确定哪一档字号是单元/章标题、哪一档是课标题、哪一档是小节标题;多行大字号标题要说明需合并;并为单元/课标题各给一条锚定正则(标题形态特征,如「^第X单元」「^第X课」——PDF 提取常在字间插空格,正则须容忍;用于防扉页书名大字/目录头被误判为标题);
3. 全文搜索栏目标签(如「学习聚焦」「思考点」「例题」「练习」等课本特色栏目词),逐个记录:标签文字、内容字号、位置(正文页侧/课末)、是否有背景框;
4. 确认正文最小字号(小于它的行不进正文)与图注行前缀(如「▲」);
5. 记录页眉/页脚/页码/水印的特征(位置或文字模式),供转换脚本丢弃;
6. 抽 2 个含栏目的页做样页验证:按行列出(字号, 位置, 你的归类判断),确认规则能正确切分正文/栏目/标题。

【输出 1:版面配置 YAML(严格按此 schema,缺项写 null,不要猜)】
book:
  title: 学科名            # 如「历史」,必要时带模块名
  grade: 册别              # 如「必修 中外历史纲要（上）」
  publisher: 出版社全称
layout:
  heading_sizes:           # 各级标题字号(精确到 0.1)
    unit: 0                # 单元/章 → h2.chapter-title
    lesson: 0              # 课 → h3
    section: 0             # 小节 → h4
  unit_pattern: ''         # 单元标题锚定正则,如「^第\S{1,3}单元」「^第.{1,3}章」
  lesson_pattern: ''       # 课标题锚定正则,如「^第\s*\d{1,2}\s*课」
  body_min: 0              # 正文最小字号
  column_size: 0           # 栏目内容字号
  column_size_min: 0       # 栏目收集下限(防地图标注/装饰小字混入)
  columns:                 # 栏目清单,cls 只能取: example|exercise|think|explore|reading|history|summary|空
    - { tag: 栏目名, cls: think, position: side }   # position: side=页侧栏目, end=课末栏目;cls 留空表示该栏目内容并回正文
  figure_prefix: ''        # 图注行前缀,如「▲」
  drop: []                 # 页眉/页脚/水印特征
notes: 样页验证结论与特例说明

参考示例(人教高中历史《中外历史纲要(上)》实测值,版式相近的书系可直接对照):
layout:
  heading_sizes: { unit: 27.5, lesson: 24.0, section: 14.0 }
  unit_pattern: '^第\s*\S{1,3}\s*单元'
  lesson_pattern: '^第\s*\d{1,2}\s*课|活动课|后记'
  body_min: 11.6
  column_size: 10.5
  column_size_min: 10.35
  columns:
    - { tag: 学习聚焦, cls: '', position: side }
    - { tag: 思考点, cls: think, position: side }
    - { tag: 学思之窗, cls: think, position: side }
    - { tag: 史料阅读, cls: reading, position: side }
    - { tag: 历史纵横, cls: history, position: side }
    - { tag: 探究与拓展, cls: explore, position: end }
    - { tag: 问题探究, cls: explore, position: end }
    - { tag: 学习拓展, cls: explore, position: end }
  figure_prefix: '▲'

【输出 2:样页验证结论】
规则是否足以正确切分;有哪些特例(地图标注、多行标题、无框栏目等)与建议参数。

【禁令】
- 不要转录全书正文,不要输出全书 HTML;
- 所有字号/标签必须来自实测统计,禁止臆测;
- 除 YAML 与验证结论外不输出任何内容。

现在开始勘测我提供的 PDF。
```

勘测完成后:把 YAML 存为 `scripts/layouts/<书系>.yaml`,交给我本地跑转换器。

## 兜底路径提示词(AI 直接转录全书;无本地代码执行环境时用)

```text
你是一名专业的教材数字化转换员。我要把一本课本 PDF 转成结构化 HTML,供知识库导入脚本自动解析。请严格遵守以下规范,宁可保守也不要自由发挥。

【第 0 步:PDF 类型检查(收到 PDF 后必须最先执行,先于一切转换工作)】
- 先判断这份 PDF 是否为"图片型 PDF"(扫描件/照片型:每页是整页图片,没有真实文字层,或只能提取出零星乱码)。
- 若判定为图片型 PDF:立即停止,禁止转换,禁止输出任何 HTML,禁止凭对图片的模糊辨认硬写内容。只回复一段检测报告后结束,格式:
  【无法转换:图片型 PDF】
  检测结果:共 N 页,未检测到可用文字层。(混合型则写明:第 X–Y 页为扫描图,其余页面有文字层)
  处理建议:请提供含文字层的 PDF,或先用 OCR 工具转出带文字层的 PDF 再发;也可以将课本页面逐张拍照/截图直接发给我。
- 混合型 PDF(部分页有文字层、部分是扫描图)同样先停下报告,等我决定,不得只转有文字层的部分而静默跳过扫描页。
- 我直接发送的单页图片文件(jpg/png)视为可正常阅读的材料,按本规范正常转换,不受本条限制。
- 仅当 PDF 文字层清晰、连续、可核对时,才继续执行下方转换规范。

【总体要求】
- 输入:我提供的课本 PDF(可能分多张图片或多个文件发送)。
- 输出:一个完整的单文件 HTML(UTF-8),不要输出任何解释、前言、总结或代码块标记之外的话,只输出 HTML 代码。
- 忠实转录:完整转录 PDF 全部正文,不概括、不省略、不改写、不扩写;页眉、页脚、页码一律丢弃。
- 篇幅过长时分多轮输出:从上轮中断处无缝继续,不重复已输出的内容;第一轮输出 <!DOCTYPE html> 到 <body>,后续轮只输出 body 内的接续内容,最后一轮以 </body></html> 结束。

【body 顶层结构(必须扁平,禁止任何包裹容器)】
<body> 的直接子元素只能是以下几种,按顺序排列,禁止用 <div class="container"> 之类的外壳把整本书包起来:

1. 封面元数据(必须,放最前):
<div class="cover">
  <div class="book-name">学科名,必要时带模块名,如:数学 / 思想政治 哲学与文化</div>
  <div class="grade">册别,如:七年级 上册 / 必修4</div>
  <div class="publisher">出版社全称,如:人民教育出版社</div>
</div>
注意:book-name/grade/publisher 三个 div 内必须是纯文本,禁止嵌套任何标签。

2. 目录(建议省略):如确要保留,写 <div class="toc">…</div>,此块不会入库。

3. 正文,只允许这些顶层元素:
- <h2 class="chapter-title">第一章 有理数</h2> —— 章/单元/专题级标题(全书最高层级就是 h2,必须带 class="chapter-title")
- <h2>致同学</h2> —— 前言/致同学/附录等不属于任何章的内容,用不带 class 的 h2
- <p>…</p> —— 正文段落(章标题后、第一个节标题前的段落会自动归为"章引言")
- <h3>1.1 正数和负数</h3> —— 节/课时级标题
- <h4>小节标题</h4> —— 小节级标题;h4 是切块的拆分点,内容较多的节尽量多用 h4 分段
- 栏目 div(见下)
- <table>…</table> —— 表格

【栏目 div(课本特殊栏目用语义化 class)】
- 例题 → <div class="example">…</div>
- 练习/课后习题 → <div class="exercise">…</div>
- 思考 → <div class="think">…</div>
- 探究/实验 → <div class="explore">…</div>
- 阅读与思考 → <div class="reading">…</div>
- 数学史料/数学文化/科学家小传 → <div class="history">…</div>
- 本章小结/归纳 → <div class="summary">…</div>
- 没有对应 class 的其他栏目,用不带 class 的 <div> 包裹即可
栏目规则:
- 每个 div 只装该栏目自己的内容;
- 栏目 div 内禁止再出现 h2/h3/h4;栏目内"例1""分析""解"等用 <p> 书写;
- 栏目外的普通正文直接用 <p>,禁止装进 div。

【硬性禁令】
1. 禁止使用 h1、h5、h6 —— 导入脚本不识别,其内容会整段丢失。
2. 禁止使用 <ul>/<ol>/<li> —— 列表序号会丢失。每个列表项写成独立段落,序号写成文字:
   <p>1. 先通分,再相加</p>
   <p>2. 约分</p>
   无序列表写 <p>· xxx</p>
3. 禁止 <img>。所有插图改写为一行文字占位,保留图号与图题:
   <p>【图1.2-3 函数图象(图略)】</p>
4. 禁止把章节或多个段落包进一个大 div;div 只用于栏目。
5. 禁止在 <p> 内嵌套 <div> 或 <table>。
6. 禁止用 HTML 实体(&#x…;)编码汉字,直接输出 UTF-8 汉字。

【数学公式/化学式】
- 一律用 LaTeX 纯文本写在段落里:行内 $a^2+b^2=c^2$,独立公式 $$\frac{1}{2}$$
- 禁止 MathML、MathJax 标签、公式图片、特殊 span 包裹。
- 化学式同样用 LaTeX,如 $H_2O$、$CO_2$。

【表格】
- 用标准 <table><tr><td>,单元格内容保持简短;
- 不用 rowspan/colspan;复杂表格可拆成多个小表,或在表后用 <p> 补文字说明。

【输出骨架示例(严格模仿此结构)】
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>数学 七年级 上册</title></head>
<body>
  <div class="cover">
    <div class="book-name">数学</div>
    <div class="grade">七年级 上册</div>
    <div class="publisher">人民教育出版社</div>
  </div>
  <h2 class="chapter-title">第一章 有理数</h2>
  <p>本章引言:温度、海拔……(章首语原文)</p>
  <h3>1.1 正数和负数</h3>
  <p>像 3、1.8%、3.5 这样大于 0 的数叫做正数……</p>
  <div class="example">
    <p>例1 (题目原文)</p>
    <p>解:(解答原文)</p>
  </div>
  <div class="think">
    <p>观察图 1.1-2 中的温差……(图略)</p>
  </div>
  <div class="exercise">
    <p>1. 读出下列各数……</p>
    <p>2. ……</p>
  </div>
  <h2 class="chapter-title">第二章 整式的加减</h2>
  ……
</body>
</html>

【输出前自检】
- body 顶层无包裹容器、无 h1/h5/h6、无 ul/ol/li、无 img;
- cover 三个字段均为纯文本;
- 每一章都有 <h2 class="chapter-title">,章号章名与 PDF 目录一致、顺序一致、一章不落;
- 所有例题/练习/思考/探究/阅读与思考/小结都进了对应栏目 div;
- 公式均为 $…$ 格式的 LaTeX;
- 除 HTML 代码外不输出任何文字。

现在开始转换我提供的 PDF。
```

## 导入后验收清单

- 脚本输出的「切块统计」每章都有块;总块数、字数量级合理(整本教材全文应 5 万字以上,只有几千字说明转换丢了内容,重点排查列表和图片占位)
- 示例切块的首尾内容与 PDF 翻页处对照,无截断、无乱码
- `KnowledgeDoc.title = book-name + grade`,同书重导会先删旧再导(幂等),改了结构重导即可

## 附:非课本类资料(答题模板/讲义)

同一标准通用:专题 → h2,节 → h3,模板/设问 → h4,正文 → p/div。
`prep-answer-template-html.cjs` 是历史上给豆包自由导出 HTML 的补救脚本,新资料按本提示词直接转换即可,不再需要它。
