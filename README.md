# Haruhikage

Why play Haruhikage???

## 春日影 · Now Playing

一个 WinUI 3 (Fluent Design) 风格的网页音乐播放器，为《春日影 (MyGO!!!!! ver.)》而写。

- 视频背景：`Video/cry.mp4`，与音频同一条时间轴 —— 播放、暂停、拖动进度、循环都跟随音频，播放中做速率微调把漂移压在 0.1s 内（偏移是用片源内嵌字幕的换行时刻校准出来的）；画面自动裁掉片源上下黑边
- 音频：`Music/cry.m4a`，循环播放
- 逐词歌词：解析 `Lyric/cry.ttml`（TTML / AMLL），逐音节卡拉 OK 填充
- 模糊度可调：播放栏右侧的圆环按钮 → 两个滑杆，背景视频 0–24px、歌词/播放面板 0–80px（面板透明度由亚克力底色决定），设置会记住
- 封面：`assets/cover.jpg`（从 MV 中提取的画面）

### 运行

```bash
node serve.mjs          # → http://127.0.0.1:8777
```

用 Python 的 `python -m http.server` 也能打开，但它不支持 Range 请求，
音频将无法拖动进度条，建议用上面的命令。

直接双击 `index.html` 也能看（歌词会使用 `assets/lyrics-data.js` 中的预解析结果）。

### 操作

| 操作 | 说明 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| ← / → | 快退 / 快进 5 秒 |
| ↑ / ↓ | 音量 |
| [ / ] | 背景模糊 −2 / +2 px |
| { / } | 面板模糊 −4 / +4 px |
| F | 全屏 |
| Esc | 退出沉浸模式 |
| 点击歌词 | 跳转到该句 |
| 点击封面 | 播放 / 暂停（MV 一起暂停） |
| 标题栏 — / □ / ✕ | 沉浸模式 / 全屏 / 关闭 |

### 结构

```
index.html            页面结构 + SVG 图标
styles.css            Fluent 深色主题：亚克力、Mica、圆角、动效
app.js                TTML 解析、逐词渲染、播放控制
assets/cover.jpg      封面
assets/lyrics-data.js 歌词预解析（file:// 兜底）
```
