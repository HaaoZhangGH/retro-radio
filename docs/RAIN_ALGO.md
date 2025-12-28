# Rain Radio 随机算法（思路与参数）

## 核心想法
- 用户不做“场景选择”，每次打开页面都会自动生成一段“天气”（Weather）。
- Weather 由一个 `seed` 决定：雨势曲线、雷暴倾向、雷声远近比例、风的概率、空间感等都由 seed 派生。
- UI 仅展示“我们随机到了什么”（便于测试与调参），而不是让用户手动选项。

## Autoplay 现实约束
- 浏览器通常禁止“无手势自动播放有声内容”。
- 因此实现策略是：页面加载即生成 Weather，并进入“Power On”的 UI 状态；但音频会在用户第一次点击/按键后自动 `resume()` 并开始播放（POWER 可随时关闭）。

## 参数与范围（MVP）
由 `seed -> rng()` 生成以下参数（范围为建议值，后续可调）：
- `rainIntensity`（雨势基线）：`0.35..0.95`
- `rainDriftSpeed`（雨势缓慢起伏速度）：`0.03..0.12 Hz`
- `dropletRate`（雨滴事件密度）：与 `rainIntensity` 相关，并带少量随机扰动
- `windChance`（风声出现概率）：`0.05..0.25`
- `space`（空间标签）：`window | outdoor | cabin`（仅用于展示与细微滤波差异）
- `thunderProfile`（雷暴倾向，随机得到其一）：
  - `rare`：平均 90–240s 一次
  - `medium`：平均 45–120s 一次
  - `stormy`：平均 20–60s 一次
- `thunderNearness`（远雷/近雷比例）：`0..1`（0 更偏远雷，1 更偏近雷）

## 生成逻辑（简述）
1. 生成 `seed`（例如使用 `crypto.getRandomValues`）。
2. 初始化可复现 RNG（如 `mulberry32(seed)`）。
3. 派生 Weather 参数：
   - 雨势相关：`rainIntensity`、`rainDriftSpeed`
   - 雷暴相关：从 3 档中抽签得到 `thunderProfile`，并抽 `thunderNearness`
   - 空间标签：从 `window/outdoor/cabin` 抽签（或按权重）
4. 运行时调度：
   - 雨层：连续噪音层 + 滤波（随 `rainIntensity` 慢速摆动）
   - 雨滴：事件层（短包络 + 频带随机 + 立体声随机）
   - 风声：低频带噪音层，按 `windChance` 偶发淡入淡出
   - 雷声：按 `thunderProfile` 的平均间隔生成“下一次雷”的到达时间；每次雷由：
     - 闪电时刻（可选：屏幕闪光）
     - 声音时刻 = 闪电 + `delay`（远雷 delay 更长）
     - 声型（远雷更闷更长；近雷更尖更短），并加入低频滚动

## UI 展示（测试用）
- 状态栏展示：`NOW: Rain=0.78 · Thunder=RARE · Space=WINDOW`
- 增加按钮 `New Weather`（仅用于测试），点击后重新生成 Weather 并立即切换。

