# -*- coding: utf-8 -*-
"""
课本 PDF -> 知识库标准 HTML 转换器(本地秒级,替代 AI 逐本转录)

输入:文字型 PDF + 版面配置 YAML(由勘测提示词产出,见 scripts/pdf2html-prompt.md)
输出:符合 import-knowledge-html.cjs 解析标准的单文件 HTML(cover 元数据 + h2/h3/h4
      + 栏目 div + 正文 p + 图注占位,扁平 body,无 h1/h5/h6/ul/ol/li/img)

移植自豆包《中外历史纲要(上)》实测定型的 convert7.py 逻辑(v7):
  - 页面级栏目归属:栏目标签按"框归属"分配内容,无框退化为同侧连续收集,
    标签之间不互相消费;字号带区分正文/栏目/标题,防地图标注混入。
  - 课末栏目(position: end)内容常与正文同字号,按标签位置收集,不限侧。

用法:
  python scripts/pdf2html-textbook.py <pdf> --layout scripts/layouts/pep-history.yaml \
      [--out x.html] [--title ..] [--grade ..] [--publisher ..] [--start N] [--end N]

  --start/--end 为 1 起始页码(含),缺省自动探测:首个含单元/课标题且有正文行的页起,
  至最后一个有正文行的页止(自动跳过封面/版权/目录/封底)。
"""
import argparse
import io
import re
import sys

try:
    import pymupdf as fitz
except ImportError:  # 旧版 PyMuPDF 模块名
    import fitz

try:
    import yaml
except ImportError:
    sys.exit('缺少 PyYAML,请先: pip install pyyaml')


def load_layout(path):
    with open(path, encoding='utf-8') as f:
        cfg = yaml.safe_load(f)
    lay = cfg['layout']
    lay['book'] = cfg.get('book', {})
    # 侧栏/课末标签集合与 class 映射
    lay['col_map'] = {}
    lay['side_tags'] = []
    lay['end_tags'] = []
    for c in lay.get('columns') or []:
        lay['col_map'][c['tag']] = c.get('cls') or ''
        (lay['end_tags'] if c.get('position') == 'end' else lay['side_tags']).append(c['tag'])
    return lay


class Converter:
    def __init__(self, doc, lay, args):
        self.doc = doc
        self.lay = lay
        self.args = args
        hs = lay['heading_sizes']
        self.unit_size = hs['unit']
        self.lesson_size = hs['lesson']
        self.section_size = hs['section']
        self.body_min = lay['body_min']
        self.col_min = lay.get('column_size_min') or lay['column_size'] - 0.15
        self.col_size = lay['column_size']
        self.prefix = lay.get('figure_prefix') or '▲'
        self.lesson_low = self.lesson_size - 0.8   # 课标题带下界,也是正文上界
        self.unit_low = self.unit_size - 0.8
        self.tags = set(lay['col_map'])
        # 标题形态特征(可选,书系级):单元/课标题须匹配的锚定正则,防扉页大字/「目录」误判
        self.unit_re = re.compile(lay['unit_pattern']) if lay.get('unit_pattern') else None
        self.lesson_re = re.compile(lay['lesson_pattern']) if lay.get('lesson_pattern') else None

    def head_ok(self, band, text):
        pat = self.unit_re if band == 'unit' else self.lesson_re if band == 'lesson' else None
        return pat is None or bool(pat.match(text))

    # ---------- 基础提取 ----------
    def get_rects(self, page):
        """候选栏目框:有填充或描边、尺寸够大的矩形。"""
        rects = []
        for dr in page.get_drawings():
            r = dr['rect']
            if dr.get('fill') is None and dr.get('color') is None:
                continue
            if r.width >= 60 and r.height >= 25:
                rects.append(fitz.Rect(r))
        return rects

    def get_lines(self, page):
        d = page.get_text('dict')
        lines = []
        mid = page.rect.width / 2
        for b in d['blocks']:
            if b['type'] != 0:
                continue
            for l in b['lines']:
                txt = ''.join(s['text'] for s in l['spans'])
                if not txt.strip():
                    continue
                maxsz = max(s['size'] for s in l['spans'])
                x0, y0, x1, y1 = l['bbox']
                cx = (x0 + x1) / 2
                lines.append({'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1,
                              'text': txt, 'size': maxsz, 'cx': cx,
                              'side': 'L' if cx < mid else 'R'})
        lines.sort(key=lambda a: (round(a['y0']), a['x0']))
        return lines

    def cleanup(self, lines):
        """丢页眉页脚/页码/水印/装饰小字;图注行保留并与紧邻小字行合并。"""
        rules = self.lay.get('drop') or []
        out = []
        i = 0
        while i < len(lines):
            ln = lines[i]
            t = ln['text'].strip()
            if self.drop_hit(rules, ln, t):
                i += 1
                continue
            if ln['y0'] < 40 and ln['size'] <= 9.6:
                i += 1
                continue  # 顶部小字(页眉残留)
            if re.fullmatch(r'\d{1,3}', t) and ln['size'] <= 11:
                i += 1
                continue  # 孤立页码兜底
            if not t.startswith(self.prefix) and ln['size'] < self.col_min:
                i += 1
                continue  # 地图标注/装饰小字
            if t == self.prefix:
                i += 1
                continue  # 空图注:前缀独行丢弃
            # 图注被拆行时(前缀行 + 紧邻小字行),合并为一条
            if t.startswith(self.prefix) and len(t.replace(self.prefix, '').strip()) <= 2:
                cap = t
                j = i + 1
                while j < len(lines):
                    nx = lines[j]
                    nt = nx['text'].strip()
                    if (nx['size'] < self.body_min and nx['y0'] - ln['y1'] < 25
                            and not self.is_label(nt) and not nt.startswith(self.prefix)):
                        cap += nt
                        j += 1
                    else:
                        break
                ln = dict(ln, text=cap)
                i = j
            else:
                i += 1
            out.append(ln)
        return out

    def drop_hit(self, rules, ln, t):
        for rule in rules:
            if isinstance(rule, str):
                if rule in t:
                    return True
                continue
            kind = rule.get('kind', 'text')
            if 'size' in rule and abs(ln['size'] - rule['size']) > 0.6:
                continue
            if ln['y0'] < rule.get('y_min', 0):
                continue
            if kind == 'page-number':
                if re.fullmatch(r'\d{1,3}', t):
                    return True
            elif kind == 'header':
                return True
            elif kind == 'text':
                if rule.get('match', '') in t:
                    return True
        return False

    # ---------- 结构判定 ----------
    def is_label(self, t):
        return t in self.tags

    def tag_position(self, t):
        return 'end' if t in self.lay['end_tags'] else 'side'

    def band(self, size):
        """字号带:unit/lesson/section/col/body/None"""
        if size >= self.unit_low:
            return 'unit'
        if size >= self.lesson_low:
            return 'lesson'
        if abs(size - self.section_size) <= 1.0:
            return 'section'
        if size >= self.body_min:
            return 'body'
        if size >= self.col_min:
            return 'col'
        return None

    def is_section_title(self, ln):
        t = ln['text'].strip()
        if self.is_label(t) or self.band(ln['size']) != 'section':
            return False
        return not t.startswith('—')

    def find_label_box(self, rects, bb):
        cx, cy = (bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2
        for r in rects:
            if r.x0 <= cx <= r.x1 and r.y0 <= cy <= r.y1:
                return r
            if r.x0 <= cx <= r.x1 and r.y0 - 25 <= bb.y1 <= r.y1:
                return r
            if r.y0 <= cy <= r.y1 and r.x0 - 25 <= bb.x1 <= r.x1:
                return r
        return None

    @staticmethod
    def in_box(r, x, y, pad=0):
        return r.x0 - pad <= x <= r.x1 + pad and r.y0 - pad <= y <= r.y1 + pad

    # ---------- 单页处理 ----------
    def process_page(self, idx):
        page = self.doc[idx]
        rects = self.get_rects(page)
        lines = self.cleanup(self.get_lines(page))

        label_lines = [ln for ln in lines if self.is_label(ln['text'].strip())]
        labels_with_box = []
        for ln in label_lines:
            bb = fitz.Rect(ln['x0'], ln['y0'], ln['x1'], ln['y1'])
            labels_with_box.append((ln, self.find_label_box(rects, bb)))

        items = []           # (label_ln, [rows])
        assigned = set()

        # 有框标签:框内所有栏目带(或课末栏目正文带)的行归该标签
        for ln, box in labels_with_box:
            if box is None:
                continue
            pos = self.tag_position(ln['text'].strip())
            lo, hi = (self.body_min, self.lesson_low) if pos == 'end' \
                else (self.col_min, self.body_min)
            content = []
            for other in lines:
                if other is ln or self.is_label(other['text'].strip()):
                    continue
                if not (lo <= other['size'] < hi):
                    continue
                if other['text'].strip().startswith(self.prefix):
                    continue
                cxj, cyj = (other['x0'] + other['x1']) / 2, (other['y0'] + other['y1']) / 2
                if self.in_box(box, cxj, cyj):
                    content.append(other)
                    assigned.add(id(other))
            content.sort(key=lambda a: (round(a['y0']), a['x0']))
            items.append((ln, content))

        # 无框标签:退化为"标签之后、连续若干行"。侧栏栏目同侧+栏目带+排除短标注;
        # 课末栏目内容与正文同字号,按标签位置收集、不限侧。
        for ln, box in labels_with_box:
            if box is not None:
                continue
            pos = self.tag_position(ln['text'].strip())
            lo, hi = (self.body_min, self.lesson_low) if pos == 'end' \
                else (self.col_min, self.body_min)
            content = []
            idx0 = lines.index(ln)
            for j in range(idx0 + 1, len(lines)):
                other = lines[j]
                if id(other) in assigned:
                    continue
                ot = other['text'].strip()
                if self.is_label(ot) or other['size'] >= self.lesson_low:
                    break
                if self.is_section_title(other):
                    break
                ok_size = lo <= other['size'] < hi
                ok_side = pos == 'end' or other['side'] == ln['side']
                ok_text = other['size'] >= self.col_min or not ot.startswith(self.prefix)
                if ok_size and ok_side and ok_text and (pos == 'end' or len(ot) >= 3):
                    content.append(other)
                    assigned.add(id(other))
            content.sort(key=lambda a: (round(a['y0']), a['x0']))
            items.append((ln, content))

        # 剩余行:图注 / 正文
        body_lines, fig_lines = [], []
        for ln in lines:
            if id(ln) in assigned or self.is_label(ln['text'].strip()):
                continue
            t = ln['text'].strip()
            if t.startswith(self.prefix):
                fig_lines.append(ln)
            elif self.body_min <= ln['size'] < self.lesson_low and not self.is_section_title(ln):
                body_lines.append(ln)

        items.sort(key=lambda it: (round(it[0]['y0']), it[0]['x0']))
        return {'items': items, 'body': body_lines, 'figs': fig_lines}

    # ---------- 段落合并(缩进启发式,跨行拼段) ----------
    @staticmethod
    def merge_texts(lines):
        if not lines:
            return []
        paras, cur, prev_x = [], '', None
        for ln in lines:
            t = ln['text'].strip()
            if prev_x is not None and ln['x0'] > prev_x + 12 and cur:
                paras.append(cur)
                cur = t
            elif cur:
                cur += t
            else:
                cur = t
            prev_x = ln['x0']
        if cur:
            paras.append(cur)
        return paras

    # ---------- 全书构建 ----------
    def build(self):
        html = []
        stats = {'unit': 0, 'lesson': 0, 'section': 0, 'fig': 0, 'col': 0, 'p': 0}
        col_stats = {}

        def emit_body(lines):
            for p in self.merge_texts(lines):
                html.append('  <p>%s</p>' % p)
                stats['p'] += 1

        for idx in range(self.start, self.end + 1):
            page = self.doc[idx]
            pg = self.process_page(idx)

            # 标题扫描(同级连续行合并;栏目/课末标签先行排除)
            clean = self.cleanup(self.get_lines(page))
            heads = []   # (y, band, title)
            i = 0
            while i < len(clean):
                ln = clean[i]
                t = ln['text'].strip()
                b = self.band(ln['size'])
                if self.is_label(t):
                    i += 1
                    continue
                if b in ('unit', 'lesson'):
                    if not self.head_ok(b, t):
                        i += 1
                        continue  # 大字但不像单元/课标题(扉页书名、目录头等),整行丢弃
                    title, j = t, i + 1
                    while (j < len(clean) and not self.is_label(clean[j]['text'].strip())
                           and self.band(clean[j]['size']) == b):
                        title += clean[j]['text'].strip()
                        j += 1
                    heads.append((ln['y0'], b, title))
                    i = j
                    continue
                if self.is_section_title(ln):
                    heads.append((ln['y0'], 'section', t))
                i += 1

            events = []
            for it in pg['items']:
                events.append(('col', it[0]['y0'], it))
            for ln in pg['body']:
                events.append(('body', ln['y0'], ln))
            for ln in pg['figs']:
                events.append(('fig', ln['y0'], ln))
            for (y, b, ttl) in heads:
                events.append((b, y, ttl))
            events.sort(key=lambda e: (round(e[1]), e[0] == 'body', e[0]))

            bodybuf = []
            for kind, _, payload in events:
                if kind == 'body':
                    bodybuf.append(payload)
                    continue
                if bodybuf:
                    emit_body(bodybuf)
                    bodybuf = []
                if kind in ('unit', 'lesson', 'section'):
                    cls = ' class="chapter-title"' if kind == 'unit' else ''
                    html.append('  <h%d%s>%s</h%d>' % (
                        {'unit': 2, 'lesson': 3, 'section': 4}[kind], cls, payload,
                        {'unit': 2, 'lesson': 3, 'section': 4}[kind]))
                    stats[kind] += 1
                elif kind == 'fig':
                    t = payload['text'].strip()
                    html.append('  <p>【%s(图略)】</p>' % t.replace(self.prefix, '图注:'))
                    stats['fig'] += 1
                elif kind == 'col':
                    label, rows = payload
                    tag = label['text'].strip()
                    cls = self.lay['col_map'][tag]
                    html.append('  <div%s>' % (' class="%s"' % cls if cls else ''))
                    for r in rows:
                        html.append('    <p>%s</p>' % r['text'].strip())
                        stats['p'] += 1
                    html.append('  </div>')
                    stats['col'] += 1
                    col_stats[cls or '(无class)'] = col_stats.get(cls or '(无class)', 0) + 1
            if bodybuf:
                emit_body(bodybuf)
        self.stats, self.col_stats = stats, col_stats
        return html


def detect_range(doc, conv):
    """自动探测正文起止页(0 起始)。起始页 = 首个『单元/课标题通过形态特征校验
    且有 ≥2 正文行』的页——unit/lesson_pattern 已拦掉扉页书名、版权页、目录头等
    大字假标题,无需再叠加栏目信号(那会误伤导言页等正文稀疏的页)。"""

    def scan():
        for idx in range(min(30, doc.page_count)):
            lines = conv.cleanup(conv.get_lines(doc[idx]))
            has_head = any(
                conv.band(l['size']) in ('unit', 'lesson')
                and conv.head_ok(conv.band(l['size']), l['text'].strip())
                for l in lines)
            if has_head and sum(1 for l in lines if conv.band(l['size']) == 'body') >= 2:
                return idx
        return None

    start = scan()
    if start is None:
        print('⚠ 未找到带合法单元/课标题的起始页,请用 --start 手动指定')
    end = None
    for idx in range(doc.page_count - 1, -1, -1):
        lines = conv.cleanup(conv.get_lines(doc[idx]))
        if sum(1 for l in lines if conv.band(l['size']) == 'body') >= 2:
            end = idx
            break
        if start is not None and idx < start:
            break
    return (start, end)


def main():
    ap = argparse.ArgumentParser(description='课本 PDF -> 标准 HTML(知识库导入用)')
    ap.add_argument('pdf')
    ap.add_argument('--layout', required=True, help='版面配置 YAML(scripts/layouts/*.yaml)')
    ap.add_argument('--out', help='输出 HTML 路径,缺省与 PDF 同目录 <名>.kb.html')
    ap.add_argument('--title', help='覆盖书名(学科名)')
    ap.add_argument('--grade', help='覆盖册别(如「必修 中外历史纲要（下）」)')
    ap.add_argument('--publisher', help='覆盖出版社')
    ap.add_argument('--start', type=int, help='起始页(1 起始,含);缺省自动探测')
    ap.add_argument('--end', type=int, help='结束页(含);缺省自动探测')
    args = ap.parse_args()

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    lay = load_layout(args.layout)
    doc = fitz.open(args.pdf)

    book = lay['book']
    title = args.title or book.get('title') or ''
    grade = args.grade or book.get('grade') or ''
    publisher = args.publisher or book.get('publisher') or ''
    if not title:
        sys.exit('配置缺少 book.title,且未用 --title 指定')

    conv = Converter(doc, lay, args)
    s = detect_range(doc, conv) if not (args.start or args.end) else None
    start = (args.start or (s[0] + 1 if s and s[0] is not None else 1)) - 1
    end = (args.end or (s[1] + 1 if s and s[1] is not None else doc.page_count)) - 1
    conv.start, conv.end = start, end

    body = conv.build()
    head = ('<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8">'
            f'<title>{title} {grade}</title></head>\n<body>\n'
            '  <div class="cover">\n'
            f'    <div class="book-name">{title}</div>\n'
            f'    <div class="grade">{grade}</div>\n'
            f'    <div class="publisher">{publisher}</div>\n'
            '  </div>\n')
    full = head + '\n'.join(body) + '\n</body>\n</html>\n'

    out = args.out or args.pdf.rsplit('.', 1)[0] + '.kb.html'
    with open(out, 'w', encoding='utf-8') as f:
        f.write(full)

    st = conv.stats
    print(f'完成: {out}')
    print(f'页范围: P{start + 1}-P{end + 1} / 全书 {doc.page_count} 页')
    print(f"结构: 单元(h2) {st['unit']} | 课(h3) {st['lesson']} | 小节(h4) {st['section']}"
          f" | 栏目div {st['col']} | 图注 {st['fig']} | 段落 {st['p']} | 共 {len(full)} 字符")
    if conv.col_stats:
        print('栏目分布:', ' | '.join(f'{k} {v}' for k, v in sorted(conv.col_stats.items())))
    if st['unit'] == 0 and st['lesson'] == 0:
        print('⚠ 未识别出任何单元/课标题——heading_sizes 字号带可能不匹配,请核对配置')


if __name__ == '__main__':
    main()
