# dsh-music bridge: Windows system access for the dsh-music plugin (Windows PowerShell 5.1, ships with Windows).
# stdin : one JSON command per line   {"c":"play"|"pause"|"toggle"|"next"|"prev"}
#                                      {"c":"vol","p":"Spotify","v":0.3,"ms":800}   fade a process's session volume
#                                      {"c":"duck","p":"Spotify","f":0.5,"ms":600}   fade to a fraction of its own level
#                                      {"c":"getvol","p":"Spotify"}                  report a process's session volume
#                                      {"c":"restore","ms":800}                      fade every changed process back
#                                      {"c":"http","id":"1","url":...,"method":"POST","headers":{},"body":"..."}
#                                                                                    -> {"t":"http","id":"1","status":200,"body":"..."}
#                                      {"c":"quit"}
# stdout: one JSON event per line     ready | media | cover | mic | vol | error
# Closing stdin also quits. On quit every volume this bridge changed is put back.
# Core Audio interface layouts follow NAudio (MIT, https://github.com/naudio/NAudio).
param(
    # music players by their media id (a program's name, or a Store app's id); others only with -AnyApp
    [string]$Players = 'Spotify|cloudmusic|NetEase|QQMusic|AppleMusic|Apple\.Music|foobar|Kugou|KuGou|SodaMusic|kwmusic|bodian|TIDAL|WiMPMusic|Deezer|Amazon ?Music|youtube-music|YouTube Music|music\.youtube\.com|Cider|MusicBee|AIMP|iTunes|Qobuz|ZuneMusic|Media\.Player|Salt Player|Winamp|Dopamine|Feishin|plexamp|SoundCloud|Musicloud|lx-music|MusicPlayer2|HyPlayer|LyricEase',
    [string]$MicApps = 'Typeless',
    [string]$CoverDir = (Join-Path $env:TEMP 'dsh-music'),
    [switch]$AnyApp
)
$ErrorActionPreference = 'Stop'
# Soda Music reports its Chinese name (char codes: Windows PowerShell reads this file as ANSI)
if ($PSBoundParameters.Keys -notcontains 'Players') { $Players += '|' + (-join [char[]](0x6C7D, 0x6C34, 0x97F3, 0x4E50)) }
$utf8 = New-Object System.Text.UTF8Encoding $false
$stdout = New-Object System.IO.StreamWriter ([Console]::OpenStandardOutput()), $utf8
$stdout.AutoFlush = $true
$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), $utf8
function Emit($o) { $stdout.WriteLine((ConvertTo-Json $o -Compress -Depth 4)) }
$lastError = ''
function EmitError($m) { if ($m -ne $script:lastError) { $script:lastError = $m; Emit @{ t = 'error'; m = $m } } }

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
namespace DshMusic {
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        int EnumAudioEndpoints();
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    }
    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2 {
        int GetAudioSessionControl();
        int GetSimpleAudioVolume();
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
    }
    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator {
        [PreserveSig] int GetCount(out int n);
        [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s);
    }
    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2 {
        int GetState(); int GetDisplayName(); int SetDisplayName(); int GetIconPath(); int SetIconPath();
        int GetGroupingParam(); int SetGroupingParam(); int RegisterNotification(); int UnregisterNotification();
        int GetSessionIdentifier(); int GetSessionInstanceIdentifier();
        [PreserveSig] int GetProcessId(out uint pid);
    }
    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume {
        [PreserveSig] int SetMasterVolume(float v, ref Guid ctx);
        [PreserveSig] int GetMasterVolume(out float v);
    }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

    public static class Vol {
        static readonly Dictionary<string, List<ISimpleAudioVolume>> cache = new Dictionary<string, List<ISimpleAudioVolume>>(StringComparer.OrdinalIgnoreCase);
        static readonly Dictionary<string, int> cachedAt = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        // Every audio session on the default output device that belongs to a process with this name.
        static List<ISimpleAudioVolume> Find(string proc) {
            List<ISimpleAudioVolume> list; int at;
            if (cache.TryGetValue(proc, out list) && list.Count > 0 && cachedAt.TryGetValue(proc, out at)
                && unchecked(Environment.TickCount - at) < 2000) return list;
            list = new List<ISimpleAudioVolume>();
            IMMDevice dev; object o; IAudioSessionEnumerator se; int n;
            var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            Guid iid = typeof(IAudioSessionManager2).GUID;
            if (en.GetDefaultAudioEndpoint(0, 1, out dev) == 0 && dev.Activate(ref iid, 23, IntPtr.Zero, out o) == 0
                && ((IAudioSessionManager2)o).GetSessionEnumerator(out se) == 0 && se.GetCount(out n) == 0) {
                for (int i = 0; i < n; i++) {
                    IAudioSessionControl2 c; uint pid; string name = "";
                    if (se.GetSession(i, out c) != 0 || c.GetProcessId(out pid) != 0 || pid == 0) continue;
                    try { name = Process.GetProcessById((int)pid).ProcessName; } catch { }
                    if (string.Equals(name, proc, StringComparison.OrdinalIgnoreCase)) list.Add((ISimpleAudioVolume)c);
                }
            }
            cache[proc] = list; cachedAt[proc] = Environment.TickCount;
            return list;
        }
        public static float Get(string proc) {
            foreach (var v in Find(proc)) { float f; if (v.GetMasterVolume(out f) == 0) return f; }
            return -1f;
        }
        public static int Set(string proc, float value) {
            Guid g = Guid.Empty; int k = 0;
            value = Math.Max(0f, Math.Min(1f, value));
            foreach (var v in Find(proc)) if (v.SetMasterVolume(value, ref g) == 0) k++;
            return k;
        }
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient {
        [PreserveSig] int Initialize(int shareMode, int flags, long bufferDuration, long periodicity, IntPtr format, IntPtr session);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long def, out long min);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr h);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    }
    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devPos, out ulong qpcPos);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    // Bass beats in whatever the computer is playing, heard through WASAPI loopback (analysis only, nothing is kept).
    // The detector follows Lyricify-Backgrounds' AppleMusicSpectrumAnalysis (Apache-2.0): bass (25-190 Hz) and
    // reference (190-760 Hz) envelopes from biquad low-passes, reported 120 times a second, a beat being a bass rise
    // over its slow decibel baseline that the reference band does not share; two of three reports must agree.
    // Events (drained by the script): "b:<strength>" per beat, "t:<bpm>:<activity>:<beats per s>" every 2 s.
    public static class Beat {
        public static readonly System.Collections.Concurrent.ConcurrentQueue<string> Events = new System.Collections.Concurrent.ConcurrentQueue<string>();
        static System.Threading.Thread thread, previous;
        static volatile bool run;
        static volatile int gen;      // each start's number: a thread whose number is not the latest stops
        public static bool Running { get { return thread != null; } }
        public static void Start() {
            if (thread != null) return;
            run = true;
            int my = ++gen;
            var old = previous;
            // the one before it may still be finishing its last packet: let it go first (it stops within ~0.1 s)
            thread = new System.Threading.Thread(() => { if (old != null) old.Join(1000); Loop(my); });
            thread.IsBackground = true; thread.Start();
            previous = thread;
        }
        public static void Stop() { run = false; thread = null; }
        static bool Live(int my) { return run && my == gen; }

        struct Biquad {
            double b0, b1, b2, a1, a2, z1, z2;
            public void Set(double fc, int sr) {
                double w = 2 * Math.PI * Math.Min(fc, sr * 0.49) / sr, s = Math.Sin(w), c = Math.Cos(w), al = s / (2 * 0.70710678), i = 1 / (1 + al);
                b0 = (1 - c) * 0.5 * i; b1 = (1 - c) * i; b2 = b0; a1 = -2 * c * i; a2 = (1 - al) * i; z1 = z2 = 0;
            }
            public double Run(double x) { double y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return double.IsNaN(y) || double.IsInfinity(y) ? 0 : y; }
        }
        static Biquad low, bassTop, refTop;
        static double bassP, refP, atk, rel;
        static int rate, perReport, count;
        // decibel baselines
        static bool init; static double slowBass, slowRef, prevBass, sharp;
        static readonly double[] hist = new double[3]; static int histN, histI;
        static bool high; static double peak; static long lastBeat;
        static readonly List<long> beats = new List<long>(); static double activity; static long lastStats;

        static void Configure(int sr) {
            rate = sr; perReport = Math.Max(1, sr / 120); count = 0;
            low.Set(25, sr); bassTop.Set(190, sr); refTop.Set(760, sr);
            atk = Math.Exp(-1.0 / (sr * 0.006)); rel = Math.Exp(-1.0 / (sr * 0.045));
            bassP = refP = 0; init = false; sharp = 0; histN = histI = 0; high = false;
        }
        static double Db(double p) { return 10 * Math.Log10(Math.Max(p, 1e-12)); }
        static double Range(double v, double a, double b) { double t = Math.Max(0, Math.Min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
        static double Baseline(double cur, double target) {
            double tc = target > cur ? 1.1 : 0.16, mix = 1 - Math.Exp(-(1.0 / 120) / tc);
            return Math.Max(-72, cur + (target - cur) * mix);
        }

        static void Push(double x) {
            x = Math.Max(-4, Math.Min(4, x));
            double l = low.Run(x), bt = bassTop.Run(x), rt = refTop.Run(x), b = bt - l, r = rt - bt;
            bassP = b * b > bassP ? bassP * atk + b * b * (1 - atk) : bassP * rel + b * b * (1 - rel);
            refP = r * r > refP ? refP * atk + r * r * (1 - atk) : refP * rel + r * r * (1 - rel);
            samples++;
            if (++count >= perReport) { count = 0; Report(); }
        }
        static long samples;
        static long Now() { return samples * 1000 / Math.Max(1, rate); }   // audio time, so offline runs behave alike

        // Offline check: run the detector over decoded mono samples and return what it would have emitted.
        public static string[] Offline(float[] mono, int sr) {
            Configure(sr); samples = 0; lastBeat = -1000; lastStats = 0; beats.Clear(); activity = 0;
            string e; while (Events.TryDequeue(out e)) { }
            foreach (var x in mono) Push(x);
            var list = new List<string>();
            while (Events.TryDequeue(out e)) list.Add(e);
            return list.ToArray();
        }

        static void Report() {
            double bd = Db(bassP), rd = Db(refP);
            if (!init) { slowBass = Math.Max(-72, bd - 7); slowRef = rd; prevBass = bd; init = true; }
            double frameRise = Math.Max(0, bd - prevBass); prevBass = bd;
            double bassRise = Math.Max(0, bd - slowBass), refRise = Math.Max(0, rd - slowRef);
            double dominance = Range(bd - rd, 0, 8);
            double target = bd >= -45 ? Range(frameRise, 7, 14) : 0;
            sharp = Math.Max(target, sharp * Math.Exp(-1.0 / (120 * 0.09)));
            double confidence = Math.Max(dominance, Range(dominance, 0.12, 0.3) * sharp * 0.9);
            double bassOnly = bassRise - refRise * (0.7 - dominance * 0.35);
            slowBass = Baseline(slowBass, bd); slowRef = Baseline(slowRef, rd);
            double level = Range(bd, -50, -18), transient = Range(bassOnly, 1.2, 7);
            double resp = Math.Max(0, Math.Min(1, level * confidence * (0.1 + 0.9 * transient)));
            hist[histI] = resp; histI = (histI + 1) % 3; if (histN < 3) histN++;
            double conf = histN < 3 ? 0 : hist[0] + hist[1] + hist[2] - Math.Min(hist[0], Math.Min(hist[1], hist[2])) - Math.Max(hist[0], Math.Max(hist[1], hist[2]));
            activity += (conf - activity) * (1.0 / (120 * 8));                       // ~8 s average of the response
            long now = Now();
            if (!high && conf > 0.32 && now - lastBeat > 180) { high = true; peak = conf; lastBeat = now; beats.Add(now); }
            else if (high) { peak = Math.Max(peak, conf); if (conf < 0.2) { high = false; Events.Enqueue("b:" + peak.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + ":" + lastBeat); } }
            if (now - lastStats > 2000) { lastStats = now; Stats(now); }
        }

        static void Stats(long now) {
            beats.RemoveAll(t => now - t > 16000);
            double bpm = 0;
            if (beats.Count >= 6) {
                var gaps = new List<double>();
                for (int i = 1; i < beats.Count; i++) gaps.Add(beats[i] - beats[i - 1]);
                gaps.Sort();
                double g = gaps[gaps.Count / 2];
                if (g > 0) { bpm = 60000 / g; while (bpm < 70) bpm *= 2; while (bpm > 180) bpm /= 2; }
            }
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            Events.Enqueue("t:" + Math.Round(bpm).ToString(inv) + ":" + activity.ToString("0.000", inv) + ":" + (beats.Count / 16.0).ToString("0.00", inv));
        }

        static void Loop(int my) {
            while (Live(my)) {
                try { Capture(my); } catch (Exception e) { Events.Enqueue("e:" + e.Message); }
                for (int i = 0; i < 20 && Live(my); i++) System.Threading.Thread.Sleep(100);
            }
        }
        static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }

        static void Capture(int my) {
            var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice dev; Check(en.GetDefaultAudioEndpoint(0, 1, out dev));
            Guid iid = typeof(IAudioClient).GUID; object o;
            Check(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
            var ac = (IAudioClient)o;
            IntPtr fmt; Check(ac.GetMixFormat(out fmt));
            int tag = Marshal.ReadInt16(fmt, 0) & 0xffff, ch = Marshal.ReadInt16(fmt, 2), sr = Marshal.ReadInt32(fmt, 4), bits = Marshal.ReadInt16(fmt, 14);
            bool isFloat = tag == 3 || (tag == 0xFFFE && Marshal.ReadInt32(fmt, 24) == 3);
            try { Check(ac.Initialize(0, 0x00020000, 200000, 0, fmt, IntPtr.Zero)); } finally { Marshal.FreeCoTaskMem(fmt); }
            Guid cid = typeof(IAudioCaptureClient).GUID;
            Check(ac.GetService(ref cid, out o));
            var cc = (IAudioCaptureClient)o;
            if (!(isFloat && bits == 32) && bits != 16) throw new Exception("unsupported mix format " + tag + "/" + bits);
            Configure(sr); samples = 0; lastBeat = -1000; lastStats = 0; beats.Clear(); activity = 0;
            float[] fbuf = new float[0]; short[] sbuf = new short[0];
            Check(ac.Start());
            try {
                while (Live(my)) {
                    uint n; Check(cc.GetNextPacketSize(out n));
                    if (n == 0) { System.Threading.Thread.Sleep(8); continue; }
                    IntPtr data; uint frames, flags; ulong dp, qp;
                    Check(cc.GetBuffer(out data, out frames, out flags, out dp, out qp));
                    int total = (int)frames * ch;
                    bool silent = (flags & 2) != 0;
                    if (!silent && bits == 32) { if (fbuf.Length < total) fbuf = new float[total]; Marshal.Copy(data, fbuf, 0, total); }
                    if (!silent && bits == 16) { if (sbuf.Length < total) sbuf = new short[total]; Marshal.Copy(data, sbuf, 0, total); }
                    for (int f = 0; f < frames; f++) {
                        double s = 0;
                        if (!silent) for (int c = 0; c < ch; c++) s += bits == 32 ? fbuf[f * ch + c] : sbuf[f * ch + c] / 32768.0;
                        Push(s / ch);
                    }
                    Check(cc.ReleaseBuffer(frames));
                }
            } finally { ac.Stop(); Marshal.ReleaseComObject(cc); Marshal.ReleaseComObject(ac); }
        }
    }

    // KuGou tells Windows its song but no place in it, and no artist. For the builds whose memory layout is known, the
    // place, the length and play/pause are read out of its memory (read only), the artist out of its window's title.
    // Layouts from AF Media Bar (MIT, github.com/Fervent-Tempo/AF-Media-Bar, Sources/KuGou/KuGouBuildProfile.cs),
    // found there with Cheat Engine; for any other build nothing is read (the host keeps its own clock).
    public static class KuGou {
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
        [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr n, out IntPtr read);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        delegate bool EnumProc(IntPtr w, IntPtr p);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
        [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr w, out int pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr w, System.Text.StringBuilder s, int n);
        [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr w, int i);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr w, int c);

        class Layout { public string Player, Main; public long PlayerSize, MainSize, Pos, DurRoot, Graph; public long[] DurChain; public int DurUnits; }
        // kgplayer.dll holds the place (seconds, a double) and the DirectShow graph (its state: 1 paused, 2 playing),
        // kugou.dll the pointer chain to the length
        static readonly Layout[] Known = {
            new Layout { Player = "1.2.0.523", Main = "20.1.61.28014", PlayerSize = 4587520, MainSize = 39858176,
                Pos = 0x3949F8, DurRoot = 0x024363D8, DurChain = new long[] { 0x30, 0x118 }, Graph = 0x3956C8, DurUnits = 1000 },
            new Layout { Player = "1.2.0.519", Main = "20.1.51.27974",
                Pos = 0x3929D8, DurRoot = 0x023C7B68, DurChain = new long[] { 0x70, 0x30, 0x0, 0x24 }, Graph = 0x3936A8, DurUnits = 1 },
            new Layout { Player = "1.2.0.519", Main = "20.1.51.27972",
                Pos = 0x3929D8, DurRoot = 0x023C9B68, DurChain = new long[] { 0x70, 0x30, 0x0, 0x24 }, Graph = 0x3936A8, DurUnits = 1 },
        };
        static IntPtr handle = IntPtr.Zero, window = IntPtr.Zero;
        static Process proc;
        static long playerBase, mainBase, quartzBase, quartzSize;
        static Layout layout;
        static int nextTry = Environment.TickCount;
        // "KuGou Music" in Chinese, as its windows are named (char codes: PowerShell 5.1 reads this file as ANSI)
        public static readonly string Name = new string(new[] { (char)0x9177, (char)0x72D7, (char)0x97F3, (char)0x4E50 });
        public static string Build = "";   // what was found, for the log: "20.1.61.28014", or "unknown 20.1.70.x / 1.2.0.x"

        static bool Read(long addr, byte[] b) { IntPtr n; return ReadProcessMemory(handle, (IntPtr)addr, b, (IntPtr)b.Length, out n) && (long)n == b.Length; }
        static bool I64(long addr, out long v) { var b = new byte[8]; v = 0; if (!Read(addr, b)) return false; v = BitConverter.ToInt64(b, 0); return true; }
        static bool I32(long addr, out int v) { var b = new byte[4]; v = 0; if (!Read(addr, b)) return false; v = BitConverter.ToInt32(b, 0); return true; }
        static string Ver(FileVersionInfo f) { return f.FileMajorPart + "." + f.FileMinorPart + "." + f.FileBuildPart + "." + f.FilePrivatePart; }

        static void Detach() { if (handle != IntPtr.Zero) CloseHandle(handle); handle = IntPtr.Zero; proc = null; layout = null; window = IntPtr.Zero; quartzBase = 0; }
        static bool Attach() {
            if (handle != IntPtr.Zero) { try { if (!proc.HasExited) return true; } catch { } Detach(); }
            if (unchecked(Environment.TickCount - nextTry) < 0) return false;
            nextTry = Environment.TickCount + 5000;
            // KuGou runs several processes: the one with the player engine maps both modules
            foreach (var p in Process.GetProcessesByName("KuGou")) {
                try {
                    ProcessModule player = null, main = null, quartz = null;
                    foreach (ProcessModule m in p.Modules) {
                        if (string.Equals(m.ModuleName, "kgplayer.dll", StringComparison.OrdinalIgnoreCase)) player = m;
                        else if (string.Equals(m.ModuleName, "kugou.dll", StringComparison.OrdinalIgnoreCase)) main = m;
                        else if (string.Equals(m.ModuleName, "quartz.dll", StringComparison.OrdinalIgnoreCase)) quartz = m;
                    }
                    if (player == null || main == null) continue;
                    string pv = Ver(player.FileVersionInfo), mv = Ver(main.FileVersionInfo);
                    Layout found = null;
                    foreach (var l in Known)
                        if (l.Player == pv && l.Main == mv && (l.PlayerSize == 0 || l.PlayerSize == player.ModuleMemorySize) && (l.MainSize == 0 || l.MainSize == main.ModuleMemorySize)) found = l;
                    Build = found != null ? mv : "unknown " + mv + " / " + pv;
                    if (found == null) { nextTry = Environment.TickCount + 60000; return false; }   // a build not known: look again in a minute
                    handle = OpenProcess(0x0010 | 0x0400, false, p.Id);   // VM_READ | QUERY_INFORMATION
                    if (handle == IntPtr.Zero) return false;
                    proc = p; layout = found; playerBase = player.BaseAddress.ToInt64(); mainBase = main.BaseAddress.ToInt64();
                    quartzBase = quartz != null ? quartz.BaseAddress.ToInt64() : 0; quartzSize = quartz != null ? quartz.ModuleMemorySize : 0;
                    return true;
                } catch { }
            }
            return false;
        }
        // The main window's title: "<artist> - <title> - KuGou Music" (in Chinese) (not the desktop lyric's, a tool window, nor a dialog)
        static string Caption() {
            var t = new System.Text.StringBuilder(512);
            int pid;
            if (window != IntPtr.Zero) {
                GetWindowThreadProcessId(window, out pid);
                if (pid == proc.Id && GetWindowTextW(window, t, 512) > 0) return t.ToString();
                window = IntPtr.Zero;
            }
            string found = "";
            int me = proc.Id;
            EnumWindows((w, x) => {
                int q; GetWindowThreadProcessId(w, out q);
                if (q != me || (GetWindowLongW(w, -20) & 0x80) != 0 || GetWindow(w, 4) != IntPtr.Zero) return true;
                t.Clear();
                if (GetWindowTextW(w, t, 512) <= 0 || t.ToString().IndexOf(Name, StringComparison.Ordinal) < 0) return true;
                window = w; found = t.ToString(); return false;
            }, IntPtr.Zero);
            return found;
        }
        // "<place ms>|<length ms>|<0 unknown, 1 paused, 2 playing>|<window title>", or null
        public static string Now() {
            if (!Attach()) return null;
            try {
                var b = new byte[8];
                if (!Read(playerBase + layout.Pos, b)) { Detach(); return null; }
                double pos = BitConverter.ToDouble(b, 0);
                long a = mainBase + layout.DurRoot, p;
                foreach (var o in layout.DurChain) { if (!I64(a, out p) || p == 0) return null; a = p + o; }
                int d;
                if (double.IsNaN(pos) || double.IsInfinity(pos) || pos < 0 || !I32(a, out d) || d <= 0) return null;
                double dur = (double)d / layout.DurUnits;
                if (dur > 86400 || pos > dur + 2) return null;
                if (quartzBase == 0) {   // the graph's module may load only once something plays
                    proc.Refresh();
                    foreach (ProcessModule m in proc.Modules)
                        if (string.Equals(m.ModuleName, "quartz.dll", StringComparison.OrdinalIgnoreCase)) { quartzBase = m.BaseAddress.ToInt64(); quartzSize = m.ModuleMemorySize; }
                }
                int state = 0, st;
                long g = playerBase + layout.Graph, f, vt;
                bool ok = true;
                foreach (var o in new long[] { 0xC0, 0xB8 }) { if (!I64(g, out p) || p == 0) { ok = false; break; } g = p + o; }
                // the graph's filter: its table of methods lies in quartz.dll, or this is not the object it was
                if (ok && quartzBase != 0 && I64(g, out f) && f != 0 && I64(f, out vt) && vt >= quartzBase && vt < quartzBase + quartzSize
                    && I32(f + 0x28, out st) && (st == 1 || st == 2)) state = st;
                return string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0}|{1}|{2}|{3}",
                    (long)Math.Round(pos * 1000), (long)Math.Round(dur * 1000), state, Caption());
            } catch { Detach(); return null; }
        }
    }

    // Spotify's main window is titled "<artist> - <title>" while a song plays, and changes the moment the song does.
    public static class SpotifyWin {
        public static string Title() {
            foreach (var p in Process.GetProcessesByName("Spotify")) {
                try { var t = p.MainWindowTitle; if (!string.IsNullOrEmpty(t)) return t; } catch { } finally { p.Dispose(); }
            }
            return null;
        }
    }
}
'@

# ---------------------------------------------------------------- SMTC (now playing)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
    $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait(5000)) { throw 'WinRT call timed out' }
    $task.Result
}
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$inputStreamType = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@($inputStreamType))
$mgr = Await ($mgrType::RequestAsync()) $mgrType

# Music players first, a playing one before a paused one; among equals the player that played last, so pausing one
# does not switch over to another player paused long ago. Other apps (browsers, video) only with -AnyApp.
$lastPlaying = ''
function PickSession {
    $best = $null; $bestScore = -1
    foreach ($s in $mgr.GetSessions()) {
        $isPlayer = $s.SourceAppUserModelId -match $Players
        if (-not $isPlayer -and -not $AnyApp) { continue }
        $playing = $s.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
        $score = 4 * [int]$isPlayer + 2 * [int]$playing + [int]($s.SourceAppUserModelId -eq $script:lastPlaying)
        if ($score -gt $bestScore) { $best = $s; $bestScore = $score }
    }
    if ($best -and $best.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { $script:lastPlaying = $best.SourceAppUserModelId }
    $best
}

$session = $null; $mediaKey = ''; $trackKey = ''; $coverTries = 0; $coverHash = ''
New-Item -ItemType Directory -Force -Path $CoverDir | Out-Null
# The player's program file, so the host can start it again later when nothing is playing.
$exeCache = @{}
function ExeOf($app) {
    if (-not $app) { return $null }
    if ($app.Contains('!')) { return "shell:AppsFolder\$app" }
    $c = $exeCache[$app]
    if (-not $c -or (-not $c.path -and $clock.ElapsedMilliseconds - $c.at -gt 60000)) {
        $name = [IO.Path]::GetFileNameWithoutExtension($app)
        $path = (Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1).Path
        $c = @{ path = $path; at = $clock.ElapsedMilliseconds }
        $exeCache[$app] = $c
    }
    $c.path
}
# KuGou's place in the song, read from its memory ([DshMusic.KuGou]); $null when this build is not known. The place is
# sent again only when it moved otherwise than the clock (a jump, a pause): the anchor counts those. Just after a song
# change KuGou can still hold the last song's place for a moment: for 1.5 s a place past 3 s counts as the start.
$kgLast = $null; $kgAnchor = 0; $kgSince = 0; $kgBuild = ''; $kgHold = ''; $kgHoldSince = 0
function KuGouNow($title, [bool]$newTrack) {
    $r = [DshMusic.KuGou]::Now()
    if ([DshMusic.KuGou]::Build -ne $script:kgBuild) { $script:kgBuild = [DshMusic.KuGou]::Build; Emit @{ t = 'log'; m = "KuGou build $($script:kgBuild)" } }
    if (-not $r) { $script:kgLast = $null; return $null }
    $f = $r -split '\|', 4
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $state = switch ($f[2]) { '2' { 'Playing' } '1' { 'Paused' } default { $null } }
    if (-not $state) { $state = [string]$script:session.GetPlaybackInfo().PlaybackStatus }
    $pos = [long]$f[0]; $dur = [long]$f[1]
    if ($newTrack -and $script:trackKey -and -not $script:kgSince) { $script:kgSince = $now }   # from the first sight of the new song
    if ($script:kgSince) { if ($now - $script:kgSince -lt 1500) { if ($pos -gt 3000) { $pos = 0 } } else { $script:kgSince = 0 } }
    $l = $script:kgLast
    $expect = if ($l) { $l.pos + $(if ($l.status -eq 'Playing') { $now - $l.at } else { 0 }) } else { 0 }
    if (-not $l -or $l.status -ne $state -or $l.dur -ne $dur -or [Math]::Abs($pos - $expect) -gt 1200) {
        $script:kgAnchor++
        $script:kgLast = @{ pos = $pos; at = $now; status = $state; dur = $dur }
    }
    # the title reads "<artist> - <title> - <KuGou Music in Chinese>"
    $artist = $null
    $cap = $f[3].Trim() -replace "\s*-\s*$([DshMusic.KuGou]::Name)`$", ''
    if ($title -and $cap.EndsWith(" - $title")) { $artist = $cap.Substring(0, $cap.Length - $title.Length - 3).Trim() }
    $k = $script:kgLast
    @{ status = $state; dur = $dur; pos = $k.pos; at = $k.at; anchor = "kg$($script:kgAnchor)"; artist = $artist }
}
# Spotify tells Windows a new song's name only once its artwork is in: seconds after the song started (5 to 13 s seen on
# this machine), its length and place already the new song's; skipping on quickly, a late name can even come after the
# next song's. Its window's title ("<artist> - <title>") changes as the
# song does, so until Windows has the new name the song is named from the window, and its artwork (still the last
# song's in Windows) is not taken. The artist so named stays for the whole song: once Windows has caught up, and when the
# window shows no song (paused: "Spotify Premium", an ad, closed to the tray), the song keeps the name it had.
$spEarly = $null   # @{ title; artist; stale = the name Windows still had then }
function SpotifyNames($t, $a, $al) {
    $win = [DshMusic.SpotifyWin]::Title()
    $i = if ($win) { $win.IndexOf(' - ') } else { -1 }
    if ($i -gt 0 -and $win -ne "$a - $t" -and -not ($t -and $win.EndsWith(" - $t"))) {
        $wt = $win.Substring($i + 3); $wa = $win.Substring(0, $i)
        if (-not $script:spEarly -or $script:spEarly.title -ne $wt -or $script:spEarly.artist -ne $wa) {
            $script:spEarly = @{ title = $wt; artist = $wa; stale = $t }
        }
    }
    $e = $script:spEarly
    if ($e) {
        if ($e.stale -eq $t -and $e.title -ne $t) {   # Windows still on the last song
            return @{ early = $true; title = $e.title; artist = $e.artist; album = '' }
        }
        if ($e.title -eq $t) { return @{ early = $false; title = $t; artist = $e.artist; album = $al } }   # caught up
        $script:spEarly = $null
    }
    @{ early = $false; title = $t; artist = $a; album = $al }
}
function PollMedia {
    $script:session = PickSession
    $s = $script:session
    if (-not $s) {
        if ($script:mediaKey -ne 'none') { $script:mediaKey = 'none'; $script:trackKey = ''; Emit @{ t = 'media'; app = $null } }
        return
    }
    $p = Await ($s.TryGetMediaPropertiesAsync()) $propType
    $tl = $s.GetTimelineProperties()
    $info = $s.GetPlaybackInfo()
    $status = [string]$info.PlaybackStatus
    # What the player lets others do: skip either way, and (Spotify, not NetEase) shuffle and repeat, with their states;
    # $null where the player does not offer it.
    $ctl = $info.Controls
    $shuffle = if ($ctl.IsShuffleEnabled -and $null -ne $info.IsShuffleActive) { [bool]$info.IsShuffleActive } else { $null }
    $repeat = if ($ctl.IsRepeatEnabled -and $null -ne $info.AutoRepeatMode) { [string]$info.AutoRepeatMode } else { $null }
    $can = "$([bool]$ctl.IsNextEnabled)|$([bool]$ctl.IsPreviousEnabled)|$([bool]$ctl.IsPlaybackPositionEnabled)|$shuffle|$repeat"
    $title = [string]$p.Title; $artist = $p.Artist; $album = $p.AlbumTitle; $early = $false
    if ($s.SourceAppUserModelId -match 'spotify') {
        $n = SpotifyNames $title ([string]$artist) ([string]$album)
        $early = $n.early; $title = $n.title; $artist = $n.artist; $album = $n.album
    }
    $track = "$($s.SourceAppUserModelId)|$title|$artist|$album"
    $dur = [long]$tl.EndTime.TotalMilliseconds; $pos = [long]$tl.Position.TotalMilliseconds
    $at = $tl.LastUpdatedTime.ToUnixTimeMilliseconds(); $stamp = $tl.LastUpdatedTime.Ticks
    $newTrack = $track -ne $script:trackKey
    if ($s.SourceAppUserModelId -match 'kugou') {
        $kg = KuGouNow $p.Title $newTrack
        if ($kg) { $status = $kg.status; $dur = $kg.dur; $pos = $kg.pos; $at = $kg.at; $stamp = $kg.anchor; if (-not $artist) { $artist = $kg.artist } }
        # A new song is sent once KuGou's window names it too (its artist comes from there), or after 1.5 s without:
        # sent first without the artist, it would come again with it, as another song.
        if ($kg -and -not $artist -and $newTrack -and $script:trackKey) {
            $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            if ($script:kgHold -ne $track) { $script:kgHold = $track; $script:kgHoldSince = $now }
            if ($now - $script:kgHoldSince -lt 1500) { return }
        }
    }
    $key = "$track|$status|$stamp|$dur|$can"
    if ($newTrack) { $script:trackKey = $track; $script:coverTries = 4; $script:coverHash = '' }
    if ($key -ne $script:mediaKey) {
        $script:mediaKey = $key
        Emit @{
            t = 'media'; app = $s.SourceAppUserModelId; exe = ExeOf $s.SourceAppUserModelId; title = $title; artist = $artist; album = $album
            status = $status; dur = $dur; pos = $pos; at = $at
            next = [bool]$ctl.IsNextEnabled; prev = [bool]$ctl.IsPreviousEnabled; seek = [bool]$ctl.IsPlaybackPositionEnabled; shuffle = $shuffle; repeat = $repeat
        }
    }
    # Players often publish the artwork a moment after the title, so look a few times after a track change.
    if (-not $early -and $script:coverTries -gt 0 -and $p.Thumbnail) {
        $script:coverTries--
        $rs = Await ($p.Thumbnail.OpenReadAsync()) $streamType
        # PowerShell does not see the stream's own members, so convert it through reflection (the cast happens at run time).
        $ms = New-Object System.IO.MemoryStream
        $asStreamForRead.Invoke($null, @($rs)).CopyTo($ms)
        $bytes = $ms.ToArray()
        if ($bytes.Length -gt 0) {
            $hash = [BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash($bytes)).Replace('-', '').Substring(0, 16)
            if ($hash -ne $script:coverHash) {
                $script:coverHash = $hash
                $ext = if ($bytes[0] -eq 0x89) { 'png' } else { 'jpg' }
                $file = Join-Path $CoverDir "$hash.$ext"
                if (-not (Test-Path -LiteralPath $file)) { [System.IO.File]::WriteAllBytes($file, $bytes) }
                Get-ChildItem -LiteralPath $CoverDir -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 8 | Remove-Item -Force
                Emit @{ t = 'cover'; path = $file }
            }
        }
    }
}

function Control($cmd) {
    $s = $script:session
    if (-not $s) { $s = PickSession }
    if (-not $s) { return }
    $op = switch ($cmd) {
        'play' { $s.TryPlayAsync() } 'pause' { $s.TryPauseAsync() } 'toggle' { $s.TryTogglePlayPauseAsync() }
        'next' { $s.TrySkipNextAsync() } 'prev' { $s.TrySkipPreviousAsync() }
    }
    if ($op) { [void](Await $op ([bool])) }
}
# Jump to a place in the song (ms), where the player allows it.
function Seek($ms) {
    $s = $script:session
    if (-not $s) { $s = PickSession }
    if (-not $s) { return }
    [void](Await ($s.TryChangePlaybackPositionAsync([long]([double]$ms * 10000))) ([bool]))
    $script:mediaKey = ''
}
# The play mode, as far as the player takes it from outside: shuffle on or off, repeat None / Track / List.
$repeatType = [Windows.Media.MediaPlaybackAutoRepeatMode, Windows.Media, ContentType = WindowsRuntime]
function SetMode($m) {
    $s = $script:session
    if (-not $s) { $s = PickSession }
    if (-not $s) { return }
    if ($null -ne $m.shuffle) { [void](Await ($s.TryChangeShuffleActiveAsync([bool]$m.shuffle)) ([bool])) }
    if ($m.repeat) { [void](Await ($s.TryChangeAutoRepeatModeAsync([Enum]::Parse($repeatType, [string]$m.repeat))) ([bool])) }
    $script:mediaKey = ''   # report the new mode at the next look
}

# ---------------------------------------------------------------- per-process volume fades
$fades = @{}      # proc -> @{ from; to; start; ms; restore }
$original = @{}   # proc -> its volume before we turned it down; forgotten once it is back there
$held = @{}       # proc -> the volume our last fade left it at
$clock = [Diagnostics.Stopwatch]::StartNew()
function StartFade($proc, [double]$to, [double]$ms, [bool]$restore = $false) {
    $now = [DshMusic.Vol]::Get($proc)
    if ($now -lt 0) { Emit @{ t = 'vol'; p = $proc; ok = $false }; return }
    if (-not $original.ContainsKey($proc)) { $original[$proc] = $now }
    $fades[$proc] = @{ from = $now; to = $to; start = $clock.ElapsedMilliseconds; ms = [Math]::Max(1, $ms); restore = $restore }
}
function StepFades {
    foreach ($proc in @($fades.Keys)) {
        $f = $fades[$proc]
        $u = [Math]::Min(1.0, [double]($clock.ElapsedMilliseconds - $f.start) / $f.ms)
        $e = $u * $u * (3 - 2 * $u)
        [void][DshMusic.Vol]::Set($proc, $f.from + ($f.to - $f.from) * $e)
        if ($u -ge 1) {
            $fades.Remove($proc)
            # back where it was: forget it, so the next time we read whatever volume you have set by then
            if ($f.restore) { $original.Remove($proc); $held.Remove($proc) } else { $held[$proc] = $f.to }
            Emit @{ t = 'vol'; p = $proc; ok = $true; v = $f.to }
        }
    }
}
# Put every process we turned down back. One whose volume you changed while it was down keeps yours.
function RestoreAll([double]$ms) {
    foreach ($p in @($original.Keys)) {
        if (-not $fades.ContainsKey($p) -and $held.ContainsKey($p) -and [Math]::Abs([DshMusic.Vol]::Get($p) - $held[$p]) -gt 0.02) {
            $original.Remove($p); $held.Remove($p); continue
        }
        StartFade $p $original[$p] $ms $true
    }
}

# ---------------------------------------------------------------- microphone in use (voice-input apps)
# Windows records when each app opens and closes the microphone; LastUsedTimeStop is 0 while it is open.
$micRoot = 'Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged'
$micKeys = @(); $micState = @{}; $micScanAt = -10000
function PollMic {
    if ($clock.ElapsedMilliseconds - $script:micScanAt -gt 10000) {
        $script:micScanAt = $clock.ElapsedMilliseconds
        $root = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($micRoot)
        $script:micKeys = if ($root) { @($root.GetSubKeyNames() | Where-Object { ($_ -split '#')[-1] -match "^($MicApps)\.exe$" }) } else { @() }
    }
    foreach ($name in $script:micKeys) {
        $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$micRoot\$name")
        if (-not $k) { continue }
        $on = [int64]$k.GetValue('LastUsedTimeStop', 1) -eq 0
        $k.Close()
        if ($micState[$name] -ne $on) {
            $micState[$name] = $on
            Emit @{ t = 'mic'; app = ($name -split '#')[-1]; on = $on }
        }
    }
}

# ---------------------------------------------------------------- web requests on behalf of the host
# The host's own connections can be caught by per-app proxy rules (Clash TUN routing the whole DSH process
# abroad); this process is not, so the host may relay a request here. Non-blocking: polled from the main loop.
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]12288
$httpClient = New-Object System.Net.Http.HttpClient
$httpClient.Timeout = [TimeSpan]::FromSeconds(10)
$httpPending = @{}
function StartHttp($m) {
    $req = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::new($m.method)), $m.url
    $type = 'application/json'
    if ($m.headers) {
        foreach ($h in $m.headers.PSObject.Properties) {
            if ($h.Name -eq 'content-type') { $type = $h.Value } else { [void]$req.Headers.TryAddWithoutValidation($h.Name, [string]$h.Value) }
        }
    }
    if ($null -ne $m.body) { $req.Content = New-Object System.Net.Http.StringContent ([string]$m.body), $utf8, $type }
    $httpPending[[string]$m.id] = $httpClient.SendAsync($req)
}
function PollHttp {
    foreach ($id in @($httpPending.Keys)) {
        $task = $httpPending[$id]
        if (-not $task.IsCompleted) { continue }
        $httpPending.Remove($id)
        if ($task.IsFaulted -or $task.IsCanceled) {
            $why = if ($task.Exception) { $task.Exception.GetBaseException().Message } else { 'canceled' }
            Emit @{ t = 'http'; id = $id; error = $why }
            continue
        }
        $res = $task.Result
        Emit @{ t = 'http'; id = $id; status = [int]$res.StatusCode; body = $res.Content.ReadAsStringAsync().Result }
    }
}

# ---------------------------------------------------------------- main loop
Emit @{ t = 'ready'; v = 1 }
$cmdTask = $stdin.ReadLineAsync()
$nextMedia = 0
try {
    while ($true) {
        if ($cmdTask.IsCompleted) {
            $line = $cmdTask.Result
            if ($null -eq $line) { break }
            $cmdTask = $stdin.ReadLineAsync()
            try {
                $m = ConvertFrom-Json $line
                switch ($m.c) {
                    'quit' { break }
                    'vol' { StartFade $m.p $m.v $(if ($m.ms) { $m.ms } else { 600 }) }
                    'getvol' { Emit @{ t = 'vol'; p = $m.p; ok = $true; v = [DshMusic.Vol]::Get($m.p) } }
                    'http' { StartHttp $m }
                    'duck' {
                        # f: a fraction of the volume the process had before this bridge first touched it
                        $base = if ($original.ContainsKey($m.p)) { $original[$m.p] } else { [DshMusic.Vol]::Get($m.p) }
                        if ($base -ge 0) { StartFade $m.p ($base * $m.f) $(if ($m.ms) { $m.ms } else { 600 }) }
                    }
                    'restore' { RestoreAll $(if ($m.ms) { $m.ms } else { 600 }) }
                    'beat' { if ($m.on) { [DshMusic.Beat]::Start() } else { [DshMusic.Beat]::Stop() } }
                    'launch' {
                        try { Start-Process -FilePath $m.path -ErrorAction Stop; Emit @{ t = 'launched'; ok = $true } }
                        catch { Emit @{ t = 'launched'; ok = $false; m = $_.Exception.Message } }
                    }
                    'mode' { SetMode $m }
                    'seek' { Seek $m.ms }
                    default { Control $m.c }
                }
                if ($m.c -eq 'quit') { break }
            } catch { EmitError "command: $($_.Exception.Message)" }
        }
        if ($fades.Count) { StepFades }
        if ($httpPending.Count) { try { PollHttp } catch { EmitError "http: $($_.Exception.Message)" } }
        try { PollMic } catch { EmitError "mic: $($_.Exception.Message)" }
        if ($clock.ElapsedMilliseconds -ge $nextMedia) {
            $nextMedia = $clock.ElapsedMilliseconds + 500
            try { PollMedia } catch { EmitError "media: $($_.Exception.Message)" }
        }
        $ev = $null
        while ([DshMusic.Beat]::Events.TryDequeue([ref]$ev)) {
            $f = $ev -split ':'
            switch ($f[0]) {
                'b' { Emit @{ t = 'beat'; s = [double]$f[1] } }
                't' { Emit @{ t = 'tempo'; bpm = [double]$f[1]; activity = [double]$f[2]; rate = [double]$f[3] } }
                'e' { EmitError "beat: $($ev.Substring(2))" }
            }
        }
        Start-Sleep -Milliseconds $(if ($fades.Count -or $httpPending.Count -or [DshMusic.Beat]::Running) { 30 } else { 100 })
    }
} finally {
    [DshMusic.Beat]::Stop()
    foreach ($p in @($original.Keys)) {
        try {
            if (-not $fades.ContainsKey($p) -and $held.ContainsKey($p) -and [Math]::Abs([DshMusic.Vol]::Get($p) - $held[$p]) -gt 0.02) { continue }   # yours
            [void][DshMusic.Vol]::Set($p, $original[$p])
        } catch { }
    }
}
