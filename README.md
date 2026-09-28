# 键盘焦点巡检（Keyboard Focus Inspector）

Chrome Manifest V3 扩展，帮助验收人员追踪动态页面上的键盘焦点：记录每次 `focusin` 的来源、元素名称与可访问性问题，支持历史定位与 JSON 导出。基于 TypeScript 5.8 + React 19。

## 功能

- **按需注入**：仅在点击弹窗“开始”后向当前 `http/https` 标签页注入 content script；重复开始不会重复监听。各标签页状态独立；关闭弹窗后巡检继续，重开弹窗自动恢复；整页导航自动清空并停止。受限页面（`chrome://`、扩展页、`file://` 等）显示明确原因。
- **真实 focusin 记录**：序号、毫秒时间、元素标签、名称与来源。来源区分 `Tab`、`Shift+Tab`、`鼠标`、`其他`（依据最近 1 秒内的按键/鼠标输入推断），不拦截任何按键、不改变页面焦点，且忽略扩展自身产生的交互。
- **名称解析顺序**：`aria-labelledby` 引用文本 → `aria-label` → 关联 `label` → 元素自身文本（不读取输入框 `value`）。
- **问题标记（按事件发生时快照）**：正 `tabindex`、焦点进入 `aria-hidden="true"` 祖先区域、无名称按钮或链接，每条问题附带判定依据。仅检查顶层普通 DOM；iframe 与 Shadow DOM 内的焦点不记录，弹窗中有明确提示。
- **稳定定位**：点击历史项平滑滚动到原元素并显示红色描边，滚动、缩放、布局变化时描边通过 `requestAnimationFrame` 实时跟随。元素删除后标记“已移除”，不会因相同选择器或文字误定位到新元素；同一节点重新插回后可再次定位。历史名称与问题始终保留事件时的快照。
- **列表与导出**：顺序列表、问题筛选、一键导出 JSON；暂停保留全部历史；清空同时移除页面上的描边效果。

## 构建与加载

```bash
npm ci
npm run build
```

1. 打开 Chrome，访问 `chrome://extensions`。
2. 右上角开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本仓库的 `dist/` 目录。

## 启动动态示例页

示例页必须通过 http 访问（`file://` 页面无法注入脚本）：

```bash
npx --yes serve -l 4173 dist
```

然后打开 `http://localhost:4173/demo/index.html`。

也可以使用任意静态服务器，例如：

```bash
python3 -m http.server 4173 -d dist
# 访问 http://localhost:4173/demo/index.html
```

## 核心操作

1. 在示例页（或任意 http/https 页面）点击工具栏的扩展图标。
2. 点击 **开始**，随后用 Tab、Shift+Tab、鼠标移动焦点；弹窗会每秒刷新记录。
3. 点击 **暂停** 停止采集（历史保留），点击 **清空** 删除历史并取消描边。
4. 点击任意历史项：页面滚动到原元素并出现跟随描边；元素被删除时该项显示“已移除”。
5. 勾选 **只看问题** 筛选有问题的焦点；点击 **导出 JSON** 保存巡检结果。
6. 关闭弹窗不影响采集；在示例页可验证：删除/插回同一节点、“增减间距”后的描边跟随、整页导航（如刷新）后状态清空。

## 代码结构

```
public/manifest.json      MV3 配置（activeTab + scripting，无 host_permissions）
public/popup.html         弹窗入口
public/demo/index.html    动态示例页
src/types.ts              消息与记录类型
src/inspector.ts          采集核心：focusin 监听、名称解析、问题判定、快照、定位描边
src/content.ts            content script：安装单例、消息路由、pagehide 清理
src/bridge.ts             弹窗侧：标签页能力判断、按需注入、消息收发
src/popup.tsx             React 弹窗：控制按钮、列表、筛选、导出
test/inspector.test.ts    vitest + jsdom 单元测试
```

## 测试

```bash
npm test
```

覆盖名称解析顺序、三类问题判定、来源区分、暂停/清空语义、节点删除与插回身份保持、历史快照不可变性等。
