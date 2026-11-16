# dsh-music

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件：你在听的歌，和 AI 一起出现在 DSH 里。

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): the music you are listening to, shown in DSH alongside the AI.

## 效果 / What it does

- **运行指示器里的歌词**：AI 干活时，「Deep diving …」换成正在唱的那句，唱到哪个字亮到哪个字，用的是 DSH 自己的扫光样式。间奏里留着上一句，长间奏才换回原来的文字。
  **Lyrics in the running indicator**: while the AI works, "Deep diving …" becomes the line being sung, lighting up word by word in DSH's own shimmer style. The line stays through short breaks; DSH's label comes back only in long instrumentals.
- **输入框下那一栏**：显示小封面和当前歌词（外文歌带翻译）；鼠标移上去换回 DSH 原来的统计，旁边有播放 / 暂停键。没在放歌时只有一个 ▶，点一下打开上次用的播放器并开始播放。
  **The row under the composer**: a small cover and the current line (with a translation for songs in other languages). Hover it to get DSH's own readings back, with a play/pause button. With nothing playing there is just a ▶, which opens the player you used last and starts it.
- **上下文占用变成发光线**：歌词显示时，上下文占用的小圆圈抽成一条发光线，贴在输入框下沿，长度就是占用比例。
  **Context usage as a glowing line**: while the lyric shows, the context-usage ring unwinds into a glowing line along the bottom edge of the composer, as long as the share used.
- **封面背景**：整个窗口底下铺着缓缓流动的封面颜色，侧栏变成半透明。暂停时慢慢停住，跟着深色 / 浅色主题走。
  **Cover background**: the cover's colours flow slowly behind the whole window and the sidebar turns translucent. It eases to a stop when the music pauses and follows the dark or light theme.
- **鲸尾跟着鼓点**：运行指示器里的鲸尾按歌曲的节拍摆动；节奏强烈的歌改成「转身」，每拍转一个来回。装了 [dsh-motion](https://github.com/Sinales733/dsh-whale/tree/main/motion) 时由它来画，没装时直接画在 DSH 原来的图标上。
  **A whale tail on the beat**: the tail in the running indicator moves to the song's beat; lively songs get a full turn on every beat instead. With [dsh-motion](https://github.com/Sinales733/dsh-whale/tree/main/motion) installed it draws the tail; without it, the tail is drawn over DSH's own icon.
- **等你批准时调小音量**：AI 停下来等你批准操作时，播放器的音量降下来，你点完就恢复。只动播放器自己在 Windows 音量合成器里的音量；降着的时候你自己调了音量，就按你调的来。
  **Volume steps back while the AI waits for you**: when the AI stops to ask for your approval, the player's volume goes down, and comes back once you answer. Only the player's own volume in the Windows volume mixer is touched; if you change it yourself meanwhile, your setting stays.

所有过渡都跟着音乐走：开始放歌、暂停、切歌时才有动画；切换会话、打开别的页面再回来，插件的显示原样接上，不重播。

Every transition follows the music: things animate when a song starts, pauses or changes, not when you switch sessions or come back from another page, where everything picks up as it was.

## 要求 / Requirements

- Windows 10 / 11（用到系统的媒体控制、音量合成器和环回采集，自带的 Windows PowerShell 5.1 即可）
  Windows 10 / 11 (it uses the system media controls, the volume mixer and loopback capture; the built-in Windows PowerShell 5.1 is enough)
- DSH 桌面版，在 0.2.2 上开发和测试
  DSH desktop, developed and tested on 0.2.2
- 会向 Windows 报告播放信息的音乐软件：Spotify、网易云音乐、QQ 音乐、Apple Music、酷狗、foobar2000。网易云音乐不报告播放进度，插件改读它自己的日志来算进度。
  A music player that reports to Windows' media controls: Spotify, NetEase Cloud Music, QQ Music, Apple Music, KuGou, foobar2000. NetEase Cloud Music reports no playing position, so the plugin reads its position from the player's own log.

## 安装 / Install

```bash
git clone https://github.com/Sinales733/dsh-music.git
dsh plugin --profile desktop add link:/path/to/dsh-music
```

桌面版的 `dsh` 在安装目录下的 `resources/runtime/cli/bin/dsh.cmd`。也可以下载 [Releases](https://github.com/Sinales733/dsh-music/releases) 里的 `.tgz` 包，解压后用 `link:<解压目录>/package` 添加。装好后刷新 DSH 窗口。

The desktop `dsh` is `resources/runtime/cli/bin/dsh.cmd` in the install folder. You can also download the `.tgz` from [Releases](https://github.com/Sinales733/dsh-music/releases), unpack it and add `link:<folder>/package` the same way. Reload the DSH window afterwards.

卸载 / Uninstall：`dsh plugin --profile desktop remove dsh-music`，刷新窗口后一切恢复原样。Reload the window and everything is as it was.

## 设置 / Settings

在 DSH 的插件管理里打开 dsh-music 的页面。

Open dsh-music's page in DSH's plugin manager.

| 设置 / Setting | 说明 / What it does |
|---|---|
| 封面背景 / Cover background | 关、淡、中、浓 / off, light, medium, strong |
| 等你批准时的音量 / Volume while waiting for approval | 30%、50%（默认 / default）、70% |
| 跟鼓点 / Follow the beat | 鲸尾和背景跟着重拍动 / the tail and the background move with the kick |
| 歌词快慢 / Lyric timing | 每个播放器单独调，单位毫秒，正数让歌词提前 / per player, in milliseconds; positive shows lyrics earlier |

## 隐私与网络 / Privacy & network

- **鼓点**：用 Windows 的环回采集「听」电脑正在放的声音，只在内存里找重拍，不录音、不保存、不上传。听到的是电脑的全部声音，别的声音也可能被当成鼓点。
  **Beats**: Windows loopback capture "listens" to what the computer is playing, and kicks are found in memory only; nothing is recorded, saved or sent anywhere. It hears all of the computer's sound, so other sounds can be taken for kicks too.
- **歌词**：用歌名、歌手、专辑和时长，向网易云音乐、QQ 音乐和 [LRCLIB](https://lrclib.net) 查歌词。前两个是非官方接口，哪天对方改了可能就查不到了。插件不发出别的网络请求。
  **Lyrics**: looked up by title, artist, album and length on NetEase Cloud Music, QQ Music and [LRCLIB](https://lrclib.net). The first two are unofficial interfaces and may stop working if they change. The plugin makes no other network requests.
- **本地文件 / Local files**：设置和每首歌测出的节奏、激烈程度在 `%LOCALAPPDATA%\dsh-music\`；封面缓存和运行日志在 `%TEMP%\dsh-music\`。
  Settings and each song's measured tempo and intensity are in `%LOCALAPPDATA%\dsh-music\`; the cover cache and a log in `%TEMP%\dsh-music\`.

## 开发 / Development

源码在 `src/`：`src/host/` 是 DSH 主进程里跑的部分（播放器、歌词、音量，系统操作在 `bridge.ps1`），`src/client/` 是窗口里的部分。`node build.mjs` 把它们构建到 `lib/`；链接安装时 DSH 会在 `lib/` 变化后自动重载窗口里的部分。

The source is in `src/`: `src/host/` runs in DSH's main process (players, lyrics, volume; the system access is in `bridge.ps1`), `src/client/` runs in the window. `node build.mjs` builds them into `lib/`; with a linked install, DSH reloads the window part by itself when `lib/` changes.

## 致谢与许可 / Credits & License

插件代码采用 [MIT License](LICENSE)。改写自其他项目的部分（lx-music-desktop、Lyricify、DeepSeek Harness、NAudio）及其许可见 [NOTICE](NOTICE)。鲸尾的骨架和动画帧来自 [dsh-motion](https://github.com/Sinales733/dsh-whale/tree/main/motion)，其中「转身」帧取自 DeepSeek Harness 的官方动画，版权归原作者所有。

The plugin code is under the [MIT License](LICENSE). Parts adapted from other projects (lx-music-desktop, Lyricify, DeepSeek Harness, NAudio) and their licenses are listed in [NOTICE](NOTICE). The whale-tail rig and frames come from [dsh-motion](https://github.com/Sinales733/dsh-whale/tree/main/motion); the "turn" frames are taken from DeepSeek Harness's official animation and belong to their authors.
