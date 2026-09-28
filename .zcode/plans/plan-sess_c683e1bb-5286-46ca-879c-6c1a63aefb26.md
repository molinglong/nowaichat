# 聊天记录滑动卡顿修复方案（阶段 1 快修 + 阶段 2 虚拟化根治）

## 根因回顾
1. OutlineSidebar scroll-spy 每帧对每条消息做全文档 `querySelector`（标题 id 从未写入 DOM，getElementById 必 miss）。
2. 消息列表无虚拟化，全会话消息常驻 DOM；`content-visibility` 裁剪又把最重的消息（工具卡/估算高 >2600px）豁免在外。
3. `containIntrinsicSize` 用粗估高度，上滑进入视口时集中排版造成跳变/顿挫。
4. 防御项：Tauri 失焦灰罩 `.tauri-blur-overlay` 以 `opacity:0` 常驻一层全屏 backdrop-filter。

---

## 阶段 1：快修（低风险，先行落地）

### 1.1 新建 `src/components/chat/chat-list-bridge.ts`
模块级共享桥，阶段 1、2 复用：
- `heightStore`：`Map<messageId, number>`，存消息真实高度（get/set）。
- `estimatePlaceholderHeight()`：从 MessageBubble.tsx:40 平移过来（导出共用）。
- `virtualizerBridge`：注册/注销虚拟化实例 + `messageIdAtContainerTop(topPx)`（阶段 2 用，含滚动容器 `md:pt-12` padding 的坐标换算）。

### 1.2 `MessageBubble.tsx`：真实高度回填 + 取消豁免
- wrapper 上挂共享 ResizeObserver（单例复用，避免每消息一个 observer），测得真实高度写 `heightStore`；`containIntrinsicSize` 改为 `auto ${heightStore.get(id) ?? estimate}px`。测量值只在变化时触发本地更新，无循环（RO 报告值稳定后不再 fire）。
- 删除 [MessageBubble.tsx:446-449](D:\项目表1\aichatt\src\components\chat\MessageBubble.tsx#L446) 的两类豁免（工具卡消息 / 估算 >2600px）：真实高度回填后裁剪是安全的，重消息重新享受屏外裁剪；首帧用估算值，进入视口测量一次后永久精确（配合 Chromium last-remembered size，二次回看零跳变）。

### 1.3 `OutlineSidebar.tsx`：消灭每帧 querySelector
- `update()` 里把「每 tick 现查 DOM」改为：`nodesRef` 缓存 messageId→element；缓存命中且 `isConnected` 直接用，miss 才走现有 getElementById/querySelector 链并回填。每帧成本从 O(ticks × 全文档扫描) 降为 O(ticks) 缓存读取，查询只在首次见到某消息时发生一次。
- MutationObserver、rAF 节流、跳转逻辑全部不动。

### 1.4 `globals.css`：失焦灰罩加固
- `.tauri-blur-overlay` 默认加 `visibility: hidden`（配 transition delay 保住 240ms 过渡），blurred 时 `visibility: visible`。保证聚焦态这层全屏 backdrop-filter 零合成开销。

---

## 阶段 2：消息列表虚拟化（根治，@tanstack/react-virtual v3）

### 2.1 依赖与总原则
- 新增 `@tanstack/react-virtual@^3`（React 18 兼容）。
- **ChatPanel 绝不直接持有 virtualizer**：`useVirtualizer` 每个滚动帧都会触发所属组件重渲染，放进 ChatPanel 会让整个面板每帧 reconcile。放在 MessageList 内部——它每帧重渲染的成本只有「memo 过的 MessageBubble 列表 + 一个 sized div」。
- 动态高度：`measureElement` 挂在 item 定位 wrapper 上；`estimateSize` 读 `heightStore`（二次打开会话时直接命中真实高度，无校正抖动），miss 用 `estimatePlaceholderHeight`。流式期间末条长高由 RO 自动重测，与现有 150ms 贴底定时器（`scrollTop = scrollHeight`）天然配合，不需要改跟随逻辑。
- 虚拟化模式下 item wrapper 用 `translateY` 定位、容器 `height: totalSize; minHeight: '100%'`；**MessageBubble 的 content-visibility 关闭**（新增 `contentVisibilityOff` prop，并加入 `areMessageBubblePropsEqual` 比较），否则 overscan 项被 CV 跳过会给 measureElement 喂占位高度造成反馈循环。

### 2.2 各文件改动
- **`MessageList.tsx`**：新增 `virtualized?: boolean` prop。为 true 时走虚拟化渲染分支（`getVirtualItems()` + `measureElement` + `getItemKey: message.id`）；为 false（CompareLane 对比泳道）保持现状完全不变。j/k 键盘导航在虚拟化分支改用 `virtualizer.scrollToIndex(index, { align: 'auto' })`（等价现 scrollIntoView nearest），refsMap 仍由 wrapper ref 复合维护（Enter 复制继续可用）。挂载时向 bridge 注册 virtualizer 实例，卸载注销。
- **`ChatPanel.tsx`**：单聊模式给 MessageList 传 `virtualized`（对比模式 ComparePanel 自带泳道，暂不虚拟化）。滚动容器、贴底跟随、回到底部按钮、TopFade、拖拽区零改动——它们只依赖 scrollTop/scrollHeight/scroll 事件，全部继续成立。
- **`OutlineSidebar.tsx`**：`update()` 优先走 bridge：virtualizer 在注册态时用测量数据算「视口顶 24px 处的消息」（纯算术，无 DOM 访问），未注册时回退 1.3 的缓存方案。`handleJump` 走 bridge 的 `jumpToMessage`（内部 `scrollToIndex`）。
- 现有 `content-visibility`/wrapperStyle 逻辑仅服务非虚拟化路径与 CompareLane。

### 2.3 已知取舍（接受后再动工）
- 浏览器页内查找（Ctrl+F）搜不到屏外消息；跨消息长距离选词、全选复制受限——所有主流聊天产品虚拟化的共同代价。
- 打开历史会话时起始位置在顶部（与现状一致，已核实现无 mount 滚到底逻辑），不引入新行为。

---

## 验证
1. `npm run build` + lint + tsc 通过。
2. 手工回归（长会话 ≥50 轮）：上下滑动、大纲跳转、j/k 导航、复制三种格式、编辑消息、重新生成、生成中向上滚动再回到底部、切换会话、对比模式两条泳道、欢迎页空状态、消息含图表/公式/代码块/附件的会话。
3. 性能对比：Performance 面板录制滚动 trace（Scripting 时间应大幅下降，OutlineSidebar update 中 querySelector 消失）；`document.querySelectorAll('*').length` 对比（长会话应从数万降到数百量级）。

## 交付顺序
阶段 1 先改先验（1.1–1.4 一次提交粒度），确认无回归后叠加阶段 2。全程不动 useChat 流式管线、memo 比较器的 text 跳过策略与打字机实现。