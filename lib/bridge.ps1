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
    [string]$Players = 'Spotify|cloudmusic|NetEase|QQMusic|AppleMusic|Apple\.Music|foobar|Kugou|KuGou',
    [string]$MicApps = 'Typeless',
    [string]$CoverDir = (Join-Path $env:TEMP 'dsh-music'),
    [switch]$AnyApp
)
$ErrorActionPreference = 'Stop'
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
        static System.Threading.Thread thread;
        static volatile bool run;
        public static bool Running { get { return thread != null; } }
        public static void Start() {
            if (thread != null) return;
            run = true;
            thread = new System.Threading.Thread(Loop); thread.IsBackground = true; thread.Start();
        }
        public static void Stop() { run = false; thread = null; }

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

        static void Loop() {
            while (run) {
                try { Capture(); } catch (Exception e) { Events.Enqueue("e:" + e.Message); }
                for (int i = 0; i < 20 && run; i++) System.Threading.Thread.Sleep(100);
            }
        }
        static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }

        static void Capture() {
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
                while (run) {
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
    if (-not $exeCache.ContainsKey($app)) {
        $name = [IO.Path]::GetFileNameWithoutExtension(($app -split '!')[0])
        $exeCache[$app] = (Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1).Path
    }
    $exeCache[$app]
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
    $status = [string]$s.GetPlaybackInfo().PlaybackStatus
    $track = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)|$($p.AlbumTitle)"
    $key = "$track|$status|$($tl.LastUpdatedTime.Ticks)|$($tl.EndTime.Ticks)"
    if ($track -ne $script:trackKey) { $script:trackKey = $track; $script:coverTries = 4; $script:coverHash = '' }
    if ($key -ne $script:mediaKey) {
        $script:mediaKey = $key
        Emit @{
            t = 'media'; app = $s.SourceAppUserModelId; exe = ExeOf $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
            status = $status; dur = [long]$tl.EndTime.TotalMilliseconds; pos = [long]$tl.Position.TotalMilliseconds
            at = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        }
    }
    # Players often publish the artwork a moment after the title, so look a few times after a track change.
    if ($script:coverTries -gt 0 -and $p.Thumbnail) {
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
