# Retro Radio 规划（Vite + Web Audio + PWA）

## 目标
- 做一个“复古收音机”网页小产品：开机、扫台、换台、有质感的过场噪声与屏幕效果。
- 视觉动效与真实音频挂钩：使用 Web Audio API 分析频谱来驱动均衡器与扬声器点阵律动。
- 电台内容系统：用 `JSON` 描述电台与音源；支持用户导入/导出配置；支持拖入本地音频临时播放。
- 离线可玩：即使完全断网，也能播放内置“雨声 / 森林 / 机场候车”以及可调噪音叠加；并通过 PWA 缓存应用壳与配置。

## 非目标（本阶段不做）
- 后端服务、账号体系、云同步。
- 商业化、付费墙、版权内容分发。
- “连续调谐到任意频率”的真实电台模拟（本阶段采用点击扫台的离散电台）。

## 技术选型
- 构建与开发：Vite（拆分文件、模块化、热更新、本地预览、构建产物用于 PWA）。
- 音频：Web Audio API
  - `AudioContext` 统一管理
  - `AnalyserNode` 输出真实频谱/波形，驱动 SVG 动效
  - 支持三类音源：
    - `synth`：程序化合成（雨/森林/机场/白噪/粉噪/棕噪），保证离线可用
    - `url`：远程音频（可选，受 CORS/网络影响）
    - `file`：用户拖入/选择的本地音频（会话内可用；后续可扩展持久化）
- PWA：`vite-plugin-pwa`（Workbox 预缓存，离线可打开与可播放内置合成音源）

## 目录结构（建议）
```
retro-radio/
  index.html
  package.json
  vite.config.js
  docs/
    PLAN.md
  public/
    manifest.webmanifest
    icons/
      icon-192.png
      icon-512.png
  src/
    styles.css
    main.js
    app/
      ui.js
      state.js
      stations.js
    audio/
      engine.js
      synth.js
    pwa/
      register-sw.js
    stations/
      default.stations.json
      schema.json
```

## 电台 JSON（MVP）
- 文件：`src/stations/default.stations.json`
- 结构：`{ "version": 1, "stations": Station[] }`

`Station`（MVP 字段）：
```json
{
  "id": "rain",
  "name": "RAIN STUDIO",
  "freq": "88.5",
  "band": "FM",
  "category": "AMBIENT",
  "source": { "kind": "synth", "preset": "rain", "params": { "intensity": 0.7 } },
  "texture": { "color": "pink", "amount": 0.12 }
}
```

说明：
- `source.kind`：
  - `synth`：离线必有（`preset`: `rain|forest|airport|noise`）
  - `url`：`{ "kind":"url", "url":"https://..." }`
- `texture`：收音机质感叠加（白/粉/棕噪 + 强度），作为“上层噪音”混入主音源。

## 交互与体验（MVP）
- `POWER`：第一次开机时 `AudioContext.resume()`；关机时停止播放并冻结动效。
- `TUNING`（点击扫台）：
  - 进入 “SCANNING” 状态：显示雪花、播放过场静噪、频谱短暂紊乱
  - 约 400–700ms 后切台：静噪淡出 → 新台淡入 → 频谱稳定
- 真实频谱动效：
  - 均衡器：8 段频带映射到 SVG 柱高
  - 扬声器点阵：选取部分点作为“可动点”，亮度/律动由低频能量驱动
- 电台列表 + 类型切换：
  - 按 `category` 分组/筛选（AMBIENT/NOISE/…）
  - 点击列表可直接切台（可选：保持“旋钮扫台”为主入口）
- 导入/导出：
  - `Import JSON`：读取并校验 `version/stations`，替换当前电台列表
  - `Export JSON`：导出当前列表
- 拖入本地音频：
  - 拖入后创建临时电台 `LOCAL FILE` 并立即播放

## PWA / 离线策略（MVP）
- 预缓存应用壳（HTML/CSS/JS/图标/默认 JSON）。
- 内置音源为程序合成：离线也能播放（不依赖下载音频文件）。
- 电台配置持久化：localStorage（后续可升级到 IndexedDB）。

## 主要风险与取舍
- 浏览器自动播放限制：必须由用户手势触发（POWER 点击作为入口）。
- 远程音频的 CORS/可用性：默认以合成音源为主，远程作为可选增强。
- 性能：点阵 DOM 更新控制在“子集更新”，避免每帧更新上千节点。
- PWA 缓存与更新：需要考虑版本升级策略（本阶段先采用常规 Workbox 策略）。

## 里程碑
- M1（本次实现）：Vite + 拆分结构、修复坏链、WebAudio 频谱驱动、合成雨/森林/机场 + 可调噪音叠加、JSON 导入/导出、PWA 离线壳。
- M2：更丰富的电台编辑器（可视化编辑、校验提示）、本地音频持久化（IndexedDB）、更精致的扫台 UI。
- M3：移动端优化与“可选”iOS 套壳（WKWebView），加入系统媒体控制（若需要）。

