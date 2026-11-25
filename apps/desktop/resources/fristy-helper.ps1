# FRISTY Remote native helper (Windows).
#
# Long-running process started by the FRISTY Remote desktop app with the
# current user's (standard) privileges. It reads one JSON request per line on
# stdin and writes one JSON response per line on stdout.
#
# SECURITY: only the fixed operations in the switch statement below exist.
# There is no way to execute arbitrary commands or scripts through this helper.
# It never stores or transmits keystrokes.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Fristy
{
    public static class Input
    {
        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)]
        struct INPUT { public uint type; public InputUnion u; }

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
        const uint MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040, WHEEL = 0x0800, HWHEEL = 0x1000;
        const uint KEYUP = 0x0002, UNICODE = 0x0004, EXTENDED = 0x0001;

        static void Send(List<INPUT> list)
        {
            if (list.Count == 0) return;
            INPUT[] arr = list.ToArray();
            SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
        }

        static INPUT Mouse(int dx, int dy, uint data, uint flags)
        {
            INPUT i = new INPUT(); i.type = INPUT_MOUSE;
            i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = data; i.u.mi.dwFlags = flags;
            return i;
        }

        static INPUT Key(ushort vk, ushort scan, uint flags)
        {
            INPUT i = new INPUT(); i.type = INPUT_KEYBOARD;
            i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags;
            return i;
        }

        public static void Move(int dx, int dy)
        {
            List<INPUT> l = new List<INPUT>(); l.Add(Mouse(dx, dy, 0, MOVE)); Send(l);
        }

        public static void Button(string button, string action)
        {
            uint down = LEFTDOWN, up = LEFTUP;
            if (button == "right") { down = RIGHTDOWN; up = RIGHTUP; }
            else if (button == "middle") { down = MIDDLEDOWN; up = MIDDLEUP; }
            List<INPUT> l = new List<INPUT>();
            if (action == "down") l.Add(Mouse(0, 0, 0, down));
            else if (action == "up") l.Add(Mouse(0, 0, 0, up));
            else
            {
                int times = action == "double" ? 2 : 1;
                for (int i = 0; i < times; i++) { l.Add(Mouse(0, 0, 0, down)); l.Add(Mouse(0, 0, 0, up)); }
            }
            Send(l);
        }

        public static void Scroll(int dx, int dy)
        {
            List<INPUT> l = new List<INPUT>();
            if (dy != 0) l.Add(Mouse(0, 0, unchecked((uint)(dy * 120)), WHEEL));
            if (dx != 0) l.Add(Mouse(0, 0, unchecked((uint)(dx * 120)), HWHEEL));
            Send(l);
        }

        public static void Text(string text)
        {
            List<INPUT> l = new List<INPUT>();
            foreach (char c in text)
            {
                if (c == '\n' || c == '\r') { l.Add(Key(0x0D, 0, 0)); l.Add(Key(0x0D, 0, KEYUP)); continue; }
                l.Add(Key(0, (ushort)c, UNICODE));
                l.Add(Key(0, (ushort)c, UNICODE | KEYUP));
            }
            Send(l);
        }

        static bool IsExtended(ushort vk)
        {
            return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || (vk >= 0xA6 && vk <= 0xB7);
        }

        public static void Combo(int[] modifiers, int vk)
        {
            List<INPUT> l = new List<INPUT>();
            foreach (int m in modifiers) l.Add(Key((ushort)m, 0, IsExtended((ushort)m) ? EXTENDED : 0));
            uint ext = IsExtended((ushort)vk) ? EXTENDED : 0;
            l.Add(Key((ushort)vk, 0, ext));
            l.Add(Key((ushort)vk, 0, ext | KEYUP));
            for (int i = modifiers.Length - 1; i >= 0; i--)
            {
                ushort m = (ushort)modifiers[i];
                l.Add(Key(m, 0, (IsExtended(m) ? EXTENDED : 0) | KEYUP));
            }
            Send(l);
        }
    }

    public static class Cursor
    {
        [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        /// Coordinates from FRISTY are physical pixels, so this process must be DPI aware.
        public static void InitDpi()
        {
            try { if (SetProcessDpiAwarenessContext((IntPtr)(-4))) return; } catch { }
            try { SetProcessDPIAware(); } catch { }
        }

        public static void MoveTo(int x, int y)
        {
            if (!SetCursorPos(x, y)) throw new Exception("SetCursorPos failed");
        }
    }

    public static class Power
    {
        [DllImport("user32.dll")] static extern bool LockWorkStation();
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("powrprof.dll", SetLastError = true)] static extern bool SetSuspendState(bool hibernate, bool force, bool disableWakeEvent);

        public static void Lock() { if (!LockWorkStation()) throw new Exception("LockWorkStation failed"); }
        public static void MonitorOff() { PostMessage((IntPtr)0xFFFF, 0x0112, (IntPtr)0xF170, (IntPtr)2); }
        public static void Sleep() { if (!SetSuspendState(false, false, false)) throw new Exception("Sleep is not available on this computer"); }
        public static void Hibernate() { if (!SetSuspendState(true, false, false)) throw new Exception("Hibernate is disabled or not supported (enable with 'powercfg /hibernate on' as administrator)"); }
    }

    public static class Processes
    {
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);

        static string ImagePath(int pid)
        {
            IntPtr h = OpenProcess(0x1000, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                StringBuilder sb = new StringBuilder(1024); int size = sb.Capacity;
                return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : null;
            }
            finally { CloseHandle(h); }
        }

        public static List<object> List()
        {
            List<object> result = new List<object>();
            int session = Process.GetCurrentProcess().SessionId;
            foreach (Process p in Process.GetProcesses())
            {
                try
                {
                    if (p.SessionId != session) continue;
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["pid"] = p.Id;
                    d["name"] = p.ProcessName;
                    d["path"] = ImagePath(p.Id);
                    string title = null;
                    try { title = p.MainWindowTitle; } catch { }
                    d["title"] = string.IsNullOrEmpty(title) ? null : title;
                    result.Add(d);
                }
                catch { }
                finally { p.Dispose(); }
            }
            return result;
        }

        /// Asks processes to close gracefully (WM_CLOSE to their main window). Optionally force after a timeout.
        public static int Close(int[] pids, bool force, int timeoutMs)
        {
            int closed = 0;
            List<Process> procs = new List<Process>();
            foreach (int pid in pids)
            {
                try { Process p = Process.GetProcessById(pid); p.CloseMainWindow(); procs.Add(p); } catch { }
            }
            foreach (Process p in procs)
            {
                try
                {
                    if (p.WaitForExit(timeoutMs)) closed++;
                    else if (force) { p.Kill(); closed++; }
                }
                catch { }
            }
            return closed;
        }
    }

    // ---------------- Core Audio COM interop ----------------

    [StructLayout(LayoutKind.Sequential)]
    public struct PROPERTYKEY { public Guid fmtid; public int pid; }

    [StructLayout(LayoutKind.Explicit)]
    public struct PROPVARIANT
    {
        [FieldOffset(0)] public short vt;
        [FieldOffset(8)] public IntPtr pointerValue;
        [FieldOffset(16)] public IntPtr padding;
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        int GetCount(out int count);
        int GetAt(int index, out PROPERTYKEY key);
        int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
        int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
        int Commit();
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        int OpenPropertyStore(int access, out IPropertyStore props);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out int state);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        int GetCount(out int count);
        int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCom { }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr notify);
        int UnregisterControlChangeNotify(IntPtr notify);
        int GetChannelCount(out uint count);
        int SetMasterVolumeLevel(float level, ref Guid ctx);
        int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
        int GetMasterVolumeLevel(out float level);
        int GetMasterVolumeLevelScalar(out float level);
        int SetChannelVolumeLevel(uint channel, float level, ref Guid ctx);
        int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid ctx);
        int GetChannelVolumeLevel(uint channel, out float level);
        int GetChannelVolumeLevelScalar(uint channel, out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        int SetMasterVolume(float level, ref Guid ctx);
        int GetMasterVolume(out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        int GetState(out int state);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
        int GetGroupingParam(out Guid param);
        int SetGroupingParam(ref Guid param, ref Guid ctx);
        int RegisterAudioSessionNotification(IntPtr client);
        int UnregisterAudioSessionNotification(IntPtr client);
        int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        int GetCount(out int count);
        int GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
        int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
        int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    // Undocumented but long-stable interface used by Windows itself to change the default device.
    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        int GetMixFormat(IntPtr a, IntPtr b);
        int GetDeviceFormat(IntPtr a, int b, IntPtr c);
        int ResetDeviceFormat(IntPtr a);
        int SetDeviceFormat(IntPtr a, IntPtr b, IntPtr c);
        int GetProcessingPeriod(IntPtr a, int b, IntPtr c, IntPtr d);
        int SetProcessingPeriod(IntPtr a, IntPtr b);
        int GetShareMode(IntPtr a, IntPtr b);
        int SetShareMode(IntPtr a, IntPtr b);
        int GetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
        int SetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
        int SetEndpointVisibility(IntPtr a, int b);
    }

    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    class PolicyConfigClient { }

    public static class Audio
    {
        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pvar);

        const int eRender = 0, eCapture = 1, eMultimedia = 1, DEVICE_STATE_ACTIVE = 1, CLSCTX_ALL = 23;
        static Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        static Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
        static PROPERTYKEY PKEY_FriendlyName = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };

        static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom()); }

        static IMMDevice DefaultDevice(int flow)
        {
            IMMDevice dev;
            Marshal.ThrowExceptionForHR(Enumerator().GetDefaultAudioEndpoint(flow, eMultimedia, out dev));
            return dev;
        }

        static IAudioEndpointVolume EndpointVolume(int flow)
        {
            object o;
            Marshal.ThrowExceptionForHR(DefaultDevice(flow).Activate(ref IID_IAudioEndpointVolume, CLSCTX_ALL, IntPtr.Zero, out o));
            return (IAudioEndpointVolume)o;
        }

        static string FriendlyName(IMMDevice dev)
        {
            IPropertyStore store;
            if (dev.OpenPropertyStore(0, out store) != 0) return null;
            PROPVARIANT pv;
            PROPERTYKEY key = PKEY_FriendlyName;
            if (store.GetValue(ref key, out pv) != 0) return null;
            string name = pv.vt == 31 ? Marshal.PtrToStringUni(pv.pointerValue) : null;
            PropVariantClear(ref pv);
            return name;
        }

        public static Dictionary<string, object> State()
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            Guid empty = Guid.Empty;
            try
            {
                IAudioEndpointVolume vol = EndpointVolume(eRender);
                float level; bool muted;
                vol.GetMasterVolumeLevelScalar(out level); vol.GetMute(out muted);
                d["volume"] = (int)Math.Round(level * 100); d["muted"] = muted;
            }
            catch { d["volume"] = null; d["muted"] = null; }
            try
            {
                bool micMuted; EndpointVolume(eCapture).GetMute(out micMuted); d["micMuted"] = micMuted;
            }
            catch { d["micMuted"] = null; }
            d["sessions"] = Sessions();
            d["outputs"] = Devices(eRender);
            d["inputs"] = Devices(eCapture);
            return d;
        }

        public static void SetVolume(int level)
        {
            Guid ctx = Guid.Empty;
            Marshal.ThrowExceptionForHR(EndpointVolume(eRender).SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, level)) / 100f, ref ctx));
        }

        public static void SetMute(bool muted)
        {
            Guid ctx = Guid.Empty;
            Marshal.ThrowExceptionForHR(EndpointVolume(eRender).SetMute(muted, ref ctx));
        }

        public static void SetMicMute(bool muted)
        {
            Guid ctx = Guid.Empty;
            Marshal.ThrowExceptionForHR(EndpointVolume(eCapture).SetMute(muted, ref ctx));
        }

        static List<object> Devices(int flow)
        {
            List<object> list = new List<object>();
            try
            {
                string defId = null;
                try { DefaultDevice(flow).GetId(out defId); } catch { }
                IMMDeviceCollection col;
                Marshal.ThrowExceptionForHR(Enumerator().EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, out col));
                int count; col.GetCount(out count);
                for (int i = 0; i < count; i++)
                {
                    IMMDevice dev; col.Item(i, out dev);
                    string id; dev.GetId(out id);
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["id"] = id; d["name"] = FriendlyName(dev) ?? id; d["isDefault"] = id == defId;
                    list.Add(d);
                }
            }
            catch { }
            return list;
        }

        static List<KeyValuePair<uint, ISimpleAudioVolume>> SessionVolumes()
        {
            List<KeyValuePair<uint, ISimpleAudioVolume>> result = new List<KeyValuePair<uint, ISimpleAudioVolume>>();
            object o;
            Marshal.ThrowExceptionForHR(DefaultDevice(eRender).Activate(ref IID_IAudioSessionManager2, CLSCTX_ALL, IntPtr.Zero, out o));
            IAudioSessionEnumerator en;
            Marshal.ThrowExceptionForHR(((IAudioSessionManager2)o).GetSessionEnumerator(out en));
            int count; en.GetCount(out count);
            for (int i = 0; i < count; i++)
            {
                IAudioSessionControl2 ctl; en.GetSession(i, out ctl);
                if (ctl.IsSystemSoundsSession() == 0) continue;
                uint pid; ctl.GetProcessId(out pid);
                if (pid == 0) continue;
                result.Add(new KeyValuePair<uint, ISimpleAudioVolume>(pid, (ISimpleAudioVolume)ctl));
            }
            return result;
        }

        static List<object> Sessions()
        {
            List<object> list = new List<object>();
            try
            {
                foreach (KeyValuePair<uint, ISimpleAudioVolume> kv in SessionVolumes())
                {
                    float level; bool muted;
                    kv.Value.GetMasterVolume(out level); kv.Value.GetMute(out muted);
                    string name = "pid " + kv.Key;
                    try { using (Process p = Process.GetProcessById((int)kv.Key)) name = p.ProcessName; } catch { }
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["pid"] = (int)kv.Key; d["name"] = name; d["volume"] = (int)Math.Round(level * 100); d["muted"] = muted;
                    list.Add(d);
                }
            }
            catch { }
            return list;
        }

        public static void SetAppVolume(int pid, int level, int mute)
        {
            Guid ctx = Guid.Empty;
            bool found = false;
            foreach (KeyValuePair<uint, ISimpleAudioVolume> kv in SessionVolumes())
            {
                if (kv.Key != (uint)pid) continue;
                found = true;
                if (level >= 0) kv.Value.SetMasterVolume(Math.Max(0, Math.Min(100, level)) / 100f, ref ctx);
                if (mute >= 0) kv.Value.SetMute(mute == 1, ref ctx);
            }
            if (!found) throw new Exception("No audio session for that application");
        }

        public static void SetDefaultDevice(string deviceId)
        {
            IPolicyConfig cfg = (IPolicyConfig)(new PolicyConfigClient());
            for (int role = 0; role < 3; role++)
            {
                int hr = cfg.SetDefaultEndpoint(deviceId, role);
                if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            }
        }
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp
[Fristy.Cursor]::InitDpi()

# Text-to-speech for "message to PC" (System.Speech ships with .NET Framework).
$script:speech = $null
function Invoke-Speak([string]$text) {
    if ($null -eq $script:speech) {
        Add-Type -AssemblyName System.Speech
        $script:speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
    }
    $script:speech.SpeakAsyncCancelAll()
    [void]$script:speech.SpeakAsync($text)
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $id = $null
    try {
        $req = $line | ConvertFrom-Json
        $id = $req.id
        $a = $req.args
        $result = $null
        switch ([string]$req.op) {
            'mouseMove'   { [Fristy.Input]::Move([int]$a.dx, [int]$a.dy) }
            'mouseButton' { [Fristy.Input]::Button([string]$a.button, [string]$a.action) }
            'moveTo'      { [Fristy.Cursor]::MoveTo([int]$a.x, [int]$a.y) }
            'speak'       { Invoke-Speak ([string]$a.text) }
            'scroll'      { [Fristy.Input]::Scroll([int]$a.dx, [int]$a.dy) }
            'text'        { [Fristy.Input]::Text([string]$a.text) }
            'combo'       { [Fristy.Input]::Combo([int[]]@($a.modifiers), [int]$a.vk) }
            'lock'        { [Fristy.Power]::Lock() }
            'monitorOff'  { [Fristy.Power]::MonitorOff() }
            'sleep'       { [Fristy.Power]::Sleep() }
            'hibernate'   { [Fristy.Power]::Hibernate() }
            'processes'   { $result = [Fristy.Processes]::List() }
            'close'       { $result = [Fristy.Processes]::Close([int[]]@($a.pids), [bool]$a.force, [int]$a.timeoutMs) }
            'audioState'  { $result = [Fristy.Audio]::State() }
            'setVolume'   { [Fristy.Audio]::SetVolume([int]$a.level) }
            'setMute'     { [Fristy.Audio]::SetMute([bool]$a.muted) }
            'setMicMute'  { [Fristy.Audio]::SetMicMute([bool]$a.muted) }
            'setAppVolume'{ [Fristy.Audio]::SetAppVolume([int]$a.pid, [int]$a.level, [int]$a.mute) }
            'setDefaultDevice' { [Fristy.Audio]::SetDefaultDevice([string]$a.deviceId) }
            'ping'        { $result = 'pong' }
            default       { throw "unknown operation" }
        }
        $out = @{ id = $id; ok = $true; result = $result }
    }
    catch {
        $out = @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $out -Compress -Depth 6))
    [Console]::Out.Flush()
}
