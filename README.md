# dsh-music

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件：你在听的歌，和 AI 一起出现在 DSH 里。

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): the music you are listening to, shown in DSH alongside the AI.

## 效果 / What it does

- **运行指示器里的歌词**：AI 干活时，「Deep diving …」换成正在唱的那句，唱到哪个字亮到哪个字，用的是 DSH 自己的扫光样式。间奏里留着上一句，长间奏才换回原来的文字。
  **Lyrics in the running indicator**: while the AI works, "Deep diving …" becomes the line being sung, lighting up word by word in DSH's own shimmer style. The line stays through short breaks; DSH's label comes back only in long instrumentals.
- **输入框下那一栏**：显示小封面和当前歌词（外文歌带翻译），换句、换歌时宽度平滑过渡。鼠标移上去换回 DSH 原来的统计，旁边是一个封面小胶囊：播放 / 暂停键叠在小封面上，封面后面一排竖线跟着节拍跳，点一下播放或暂停。在胶囊上滚动滚轮切歌（往下是下一首，往上是上一首），鼠标停在胶囊上时，它两端有很淡的左右箭头提示，小封面朝切换的方向滑走。没在放歌时只有一个 ▶，点一下打开上次用的播放器并开始播放。
  **The row under the composer**: a small cover and the current line (with a translation for songs in other languages), gliding to its new width when the line or the song changes. Hover it to get DSH's own readings back, with a cover capsule: the play / pause button lies on the small cover, bars after it move with the beat, and a click plays or pauses. Scroll on the capsule to skip (down: next, up: previous); faint chevrons at its ends say so while the pointer is on it, and its cover slides the way the song went. With nothing playing there is just a ▶, which opens the player you used last and starts it.
- **跟着音乐的光**：新会话里，输入框边缘一圈细光跟着节拍亮。发出第一条消息时，输入框滑到底部，光圈从顶部正中断开、沿两侧退下去，把歌词带出来；同时窗口下边沿亮起，沿着窗口边框绕满一圈，之后整个窗口边缘跟着节拍轻轻发亮。暂停时慢慢熄灭，回到新会话时原路收回。光的颜色取自封面。
  **Light with the music**: in a new session a thin ring of light along the composer brightens on each beat. On your first message the composer glides down, the ring opens at the top and draws back down both sides, bringing the lyric in, while the window's bottom edge lights and the light runs round the whole window; then the window's edge glows softly with the beat. It fades when the music pauses and draws back when you start a new session. Its colour comes from the cover.
- **上下文占用变成发光线**：歌词显示时，上下文占用的小圆圈抽成一条发光线，贴在输入框下沿，长度就是占用比例。
  **Context usage as a glowing line**: while the lyric shows, the context-usage ring unwinds into a glowing line along the bottom edge of the composer, as long as the share used.
- **封面背景**：整个窗口底下铺着缓缓流动的封面颜色，侧栏变成半透明。暂停时慢慢停住，跟着深色 / 浅色主题走。
  **Cover background**: the cover's colours flow slowly behind the whole window and the sidebar turns translucent. It eases to a stop when the music pauses and follows the dark or light theme.
- **鲸尾跟着鼓点**：运行指示器里的鲸尾按歌曲的节拍摆动；节奏强烈的歌改成「转身」，每拍转一个来回。装了 [dsh-motion](https://github.com/Sinales733/dsh-motion) 时由它来画，没装时直接画在 DSH 原来的图标上。
  **A whale tail on the beat**: the tail in the running indicator moves to the song's beat; lively songs get a full turn on every beat instead. With [dsh-motion](https://github.com/Sinales733/dsh-motion) installed it draws the tail; without it, the tail is drawn over DSH's own icon.
- **等你批准时调小音量**：AI 停下来等你批准操作时，播放器的音量降下来，你点完就恢复。只动播放器自己在 Windows 音量合成器里的音量；降着的时候你自己调了音量，就按你调的来。
  **Volume steps back while the AI waits for you**: when the AI stops to ask for your approval, the player's volume goes down, and comes back once you answer. Only the player's own volume in the Windows volume mixer is touched; if you change it yourself meanwhile, your setting stays.

所有过渡都跟着音乐走：开始放歌、暂停、切歌时才有动画；切换会话、打开别的页面再回来，插件的显示原样接上，不重播。

Every transition follows the music: things animate when a song starts, pauses or changes, not when you switch sessions or come back from another page, where everything picks up as it was.

## 要求 / Requirements

- Windows 10 / 11（用到系统的媒体控制、音量合成器和环回采集，自带的 Windows PowerShell 5.1 即可）
  Windows 10 / 11 (it uses the system media controls, the volume mixer and loopback capture; the built-in Windows PowerShell 5.1 is enough)
- DSH 桌面版，在 0.2.2 上开发和测试
  DSH desktop, developed and tested on 0.2.2
- 会向 Windows 报告播放信息的音乐软件：Spotify、网易云音乐、QQ 音乐、Apple Music、酷狗、foobar2000；汽水音乐、酷我、波点、TIDAL、Deezer、Amazon Music、YouTube Music 桌面版、Cider、MusicBee、AIMP、iTunes、Qobuz、Windows 媒体播放器等也按它们报告的名字认得（这些没有逐个试过）。网易云音乐不报告播放进度，插件改读它自己的日志来算进度。酷狗不报告进度和歌手，插件从酷狗进程里直接读进度、时长和播放状态（只读，位置来自 [AF Media Bar](https://github.com/Fervent-Tempo/AF-Media-Bar)，目前认得 20.1.61.28014 和 20.1.51.2797x 这几版），歌手从酷狗窗口标题里取；别的版本读不到进度，只显示歌名、不显示歌词。QQ 音乐没有会员时只放一分钟试听，歌词会对到试听的那一段。演唱会版（Live）只用同一场、长度差不多的现场版歌词；找不到时只显示歌名，不拿录音室版的歌词凑。
  A music player that reports to Windows' media controls: Spotify, NetEase Cloud Music, QQ Music, Apple Music, KuGou, foobar2000; Soda Music, Kuwo, Bodian, TIDAL, Deezer, Amazon Music, the YouTube Music desktop app, Cider, MusicBee, AIMP, iTunes, Qobuz, Windows Media Player and others are recognised by the names they report (not each tried). NetEase Cloud Music reports no playing position, so the plugin reads its position from the player's own log. KuGou reports neither a position nor the artist: the plugin reads the position, length and play state out of KuGou's memory (read only; the addresses come from [AF Media Bar](https://github.com/Fervent-Tempo/AF-Media-Bar) and are known for builds 20.1.61.28014 and 20.1.51.2797x), and the artist from its window's title. With another build the position cannot be read, and only the song's name shows, no lyrics. QQ Music without a membership plays a one-minute preview, and the lyrics follow that minute. A live recording takes only lyrics of a live cut about as long; with none, only the song's name shows rather than the studio cut's lyrics.

## 安装 / Install

```bash
dsh plugin --profile desktop add dsh-whale-music
```

npm 上的包名是 `dsh-whale-music`（`dsh-music` 这个名字在 npm 上已被别人占用）。也可以从源码安装：

```bash
git clone https://github.com/Sinales733/dsh-music.git
dsh plugin --profile desktop add link:/path/to/dsh-music
```

桌面版的 `dsh` 在安装目录下的 `resources/runtime/cli/bin/dsh.cmd`；网页版把 `desktop` 换成 `web`。也可以下载 [Releases](https://github.com/Sinales733/dsh-music/releases) 里的 `.tgz` 包，解压后用 `link:<解压目录>/package` 添加。装好后刷新 DSH 窗口。

On npm the package is `dsh-whale-music` (the name `dsh-music` is taken there). Install it with `dsh plugin --profile desktop add dsh-whale-music` (`--profile web` for the web app), link a clone of this repository, or unpack the `.tgz` from [Releases](https://github.com/Sinales733/dsh-music/releases) and add `link:<folder>/package`. The desktop `dsh` is `resources/runtime/cli/bin/dsh.cmd` in the install folder. Reload the DSH window afterwards.

卸载 / Uninstall：`dsh plugin --profile desktop remove dsh-whale-music`，刷新窗口后一切恢复原样。Reload the window and everything is as it was.

## 设置 / Settings

在 DSH 的插件管理里打开 dsh-whale-music 的页面。页面最上面是一个缩小的 DSH 窗口（你上一次打开的对话），歌词行、运行指示器、窗口边缘光和封面背景都在上面实时跑，改设置马上就能看到效果。

Open dsh-whale-music's page in DSH's plugin manager. At its top is a small copy of the DSH window (the conversation you last had open) with the lyric row, the running indicator, the window's edge light and the cover background running live on it, so a change shows at once.

| 设置 / Setting | 说明 / What it does |
|---|---|
| 封面背景 / Cover background | 关、淡、中、浓 / off, light, medium, strong |
| 显示歌词 / Show lyrics | 关掉后输入栏下面只显示歌名和封面 / off: the row under the composer shows only the song and its cover |
| 显示翻译 / Show translations | 外文歌的歌词后面跟着中文翻译，可以关掉 / the translation after each line of a song in another language; can be turned off |
| 窗口边缘光 / Window edge light | 对话时窗口边缘跟着节拍发亮，可以关掉 / the window's edge glowing with the beat in a conversation; can be turned off |
| 等你批准时的音量 / Volume while waiting for approval | 0–100% 滑动调节，默认 50% / a slider, 0–100%, 50% by default |
| 跟鼓点 / Follow the beat | 鲸尾和背景跟着重拍动 / the tail and the background move with the kick |
| 歌词快慢 / Lyric timing | 先选播放器再填，单位毫秒，正数让歌词提前 / pick a player, then its value in milliseconds; positive shows lyrics earlier |

## 隐私与网络 / Privacy & network

- **鼓点**：用 Windows 的环回采集「听」电脑正在放的声音，只在内存里找重拍，不录音、不保存、不上传。听到的是电脑的全部声音，别的声音也可能被当成鼓点。
  **Beats**: Windows loopback capture "listens" to what the computer is playing, and kicks are found in memory only; nothing is recorded, saved or sent anywhere. It hears all of the computer's sound, so other sounds can be taken for kicks too.
- **歌词**：用歌名、歌手、专辑和时长，向网易云音乐、QQ 音乐、酷狗和 [LRCLIB](https://lrclib.net) 查歌词（歌名加歌手搜不到时，像 Lyricify 那样只用歌名再搜一次；在 QQ 音乐、酷狗里放的歌优先用它们自己的歌词）。前三个是非官方接口，哪天对方改了可能就查不到了。网易云和 QQ 的逐字歌词是按它们自己那一版歌对的时间，播放器放的是另一版（比如前奏长两秒）时，插件拿 LRCLIB 的同一首歌对照，整体错开就把歌词整体挪过去。插件不发出别的网络请求。
  **Lyrics**: looked up by title, artist, album and length on NetEase Cloud Music, QQ Music, KuGou and [LRCLIB](https://lrclib.net) (a source with no match for title and artist is searched again by the title alone, as Lyricify does; a song played in QQ Music or KuGou takes that service's own lyrics first). The first three are unofficial interfaces and may stop working if they change. NetEase's and QQ's word-timed lyrics follow their own cut of a song; when the player plays another cut (a longer intro, say), they are checked against LRCLIB's lyrics for the song and moved by the steady difference. The plugin makes no other network requests.
- **本地文件 / Local files**：设置和每首歌测出的节奏、激烈程度在 `%LOCALAPPDATA%\dsh-music\`；封面缓存和运行日志在 `%TEMP%\dsh-music\`。
  Settings and each song's measured tempo and intensity are in `%LOCALAPPDATA%\dsh-music\`; the cover cache and a log in `%TEMP%\dsh-music\`.

## 开发 / Development

源码在 `src/`：`src/host/` 是 DSH 主进程里跑的部分（播放器、歌词、音量，系统操作在 `bridge.ps1`），`src/client/` 是窗口里的部分。`node build.mjs` 把它们构建到 `lib/`；链接安装时 DSH 会在 `lib/` 变化后自动重载窗口里的部分。

The source is in `src/`: `src/host/` runs in DSH's main process (players, lyrics, volume; the system access is in `bridge.ps1`), `src/client/` runs in the window. `node build.mjs` builds them into `lib/`; with a linked install, DSH reloads the window part by itself when `lib/` changes.

## 致谢与许可 / Credits & License

插件代码采用 [MIT License](LICENSE)。改写自其他项目的部分（lx-music-desktop、Lyricify、DeepSeek Harness、NAudio）及其许可见 [NOTICE](NOTICE)。鲸尾的骨架和动画帧来自 [dsh-motion](https://github.com/Sinales733/dsh-motion)，其中「转身」帧取自 DeepSeek Harness 的官方动画，版权归原作者所有。

The plugin code is under the [MIT License](LICENSE). Parts adapted from other projects (lx-music-desktop, Lyricify, DeepSeek Harness, NAudio) and their licenses are listed in [NOTICE](NOTICE). The whale-tail rig and frames come from [dsh-motion](https://github.com/Sinales733/dsh-motion); the "turn" frames are taken from DeepSeek Harness's official animation and belong to their authors.
