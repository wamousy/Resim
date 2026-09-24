// Windows desktop host. The original simulator remains the computation engine.
// No global service, URL reservation, shell command, or extra runtime is installed.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

public static class ResimHost {
    static readonly string AppRoot = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string Engine = Path.Combine(AppRoot, "Resim.Engine.exe");
    static HttpListener listener;
    static Process engine;
    static IntPtr engineJob;
    static volatile bool stopping;
    static string origin, backend, projects;
    const int MaxBody = 8000000;
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateDirectory(string path, IntPtr attributes);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref JobLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long processTime, jobTime; public uint flags; public UIntPtr minWorking, maxWorking;
        public uint activeProcesses; public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct JobLimits {
        public BasicLimits basic; public IoCounters io;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    static void OwnEngine() {
        engineJob = CreateJobObject(IntPtr.Zero, null);
        var limits = new JobLimits(); limits.basic.flags = 0x2000; // Kill children when the desktop host exits.
        if (engineJob == IntPtr.Zero || !SetInformationJobObject(engineJob, 9, ref limits, (uint)Marshal.SizeOf(limits)) || !AssignProcessToJobObject(engineJob, engine.Handle))
            throw new Exception("无法管理计算引擎进程，请重新启动程序。");
    }

    // CommandLineToArgvW quoting, including paths ending in a backslash.
    static string WindowsArg(string arg) {
        var b = new StringBuilder("\""); int slashes = 0;
        foreach (char c in arg) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { b.Append('\\', slashes * 2 + 1); b.Append(c); }
            else { b.Append('\\', slashes); b.Append(c); }
            slashes = 0;
        }
        b.Append('\\', slashes * 2); b.Append('"'); return b.ToString();
    }
    static Process StartEngine(IEnumerable<string> args) {
        var p = new Process { StartInfo = new ProcessStartInfo(Engine, String.Join(" ", args.Select(WindowsArg))) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        }};
        p.OutputDataReceived += (s, e) => { if (e.Data != null) Console.WriteLine(e.Data); };
        p.ErrorDataReceived += (s, e) => { if (e.Data != null) Console.Error.WriteLine(e.Data); };
        p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine(); return p;
    }
    public static int Main(string[] args) {
        try {
            if (!File.Exists(Engine)) throw new Exception("缺少 Resim.Engine.exe，请保持程序文件完整。");
            if (args.Length == 0 || args[0] != "serve") {
                using (var p = StartEngine(args)) { p.WaitForExit(); return p.ExitCode; }
            }
            int port = 8770; bool open = false;
            projects = Path.GetFullPath(Path.Combine(AppRoot, "..", "ResimProjects"));
            for (int i = 1; i < args.Length; i++) {
                if (args[i] == "--port" && i + 1 < args.Length) port = Int32.Parse(args[++i]);
                else if (args[i] == "--projects-dir" && i + 1 < args.Length) projects = Path.GetFullPath(args[++i]);
                else if (args[i] == "--open-browser") open = true;
                else { using (var p = StartEngine(args)) { p.WaitForExit(); return p.ExitCode; } }
            }
            if (port < 1 || port > 65535) throw new Exception("端口范围为 1–65535。");
            ServicePointManager.DefaultConnectionLimit = 32;
            origin = "http://127.0.0.1:" + port;
            listener = new HttpListener(); listener.Prefixes.Add(origin + "/"); listener.Start();
            var probe = new TcpListener(IPAddress.Loopback, 0); probe.Start();
            int enginePort = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();
            backend = "http://127.0.0.1:" + enginePort;
            engine = StartEngine(new [] { "serve", "--port", enginePort.ToString(), "--projects-dir", projects });
            OwnEngine();
            AppDomain.CurrentDomain.ProcessExit += (s, e) => Stop();
            Console.CancelKeyPress += (s, e) => { e.Cancel = true; Stop(); };
            engine.EnableRaisingEvents = true; engine.Exited += (s, e) => Stop();
            if (engine.HasExited) throw new Exception("模拟器引擎启动失败。");
            WaitForEngine();
            if (open) Process.Start(new ProcessStartInfo(origin + "/") { UseShellExecute = true });
            Console.WriteLine("Resim: " + origin);
            while (!stopping) {
                HttpListenerContext context;
                try { context = listener.GetContext(); }
                catch (HttpListenerException) { if (stopping) break; throw; }
                catch (ObjectDisposedException) { if (stopping) break; throw; }
                ThreadPool.QueueUserWorkItem(_ => Handle(context));
            }
            return 0;
        } catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        finally { Stop(); }
    }
    static void Stop() {
        stopping = true;
        try { if (listener != null) listener.Close(); } catch { }
        try { if (engine != null && !engine.HasExited) engine.Kill(); } catch { }
        IntPtr job = Interlocked.Exchange(ref engineJob, IntPtr.Zero); if (job != IntPtr.Zero) CloseHandle(job);
    }
    static void WaitForEngine() {
        for (int i = 0; i < 100 && !stopping; i++) {
            try {
                var request = (HttpWebRequest)WebRequest.Create(backend + "/api/health");
                request.Proxy = null; request.Timeout = 700;
                using (var response = request.GetResponse()) { return; }
            } catch (WebException) { Thread.Sleep(100); }
        }
        throw new Exception("模拟器引擎未能就绪。");
    }
    static byte[] Body(HttpListenerRequest request, int limit) {
        if (request.ContentLength64 > limit) throw new ArgumentException("请求内容过大。");
        using (var output = new MemoryStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = request.InputStream.Read(buffer, 0, buffer.Length)) > 0) {
                if (output.Length + count > limit) throw new ArgumentException("请求内容过大。");
                output.Write(buffer, 0, count);
            }
            return output.ToArray();
        }
    }
    static void Json(HttpListenerResponse response, object value, int status = 200) {
        byte[] bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(value));
        response.StatusCode = status; response.ContentType = "application/json; charset=utf-8";
        response.Headers["Cache-Control"] = "no-store";
        response.ContentLength64 = bytes.Length; response.OutputStream.Write(bytes, 0, bytes.Length);
    }
    static bool SameOrigin(HttpListenerRequest request) {
        return request.Headers["X-Resim-Local"] == "1" &&
            (String.IsNullOrEmpty(request.Headers["Origin"]) || request.Headers["Origin"] == origin);
    }
    static string DirectoryPath(string value) {
        string raw = String.IsNullOrWhiteSpace(value) ? projects : value.Trim();
        if (!Regex.IsMatch(raw, @"^[A-Za-z]:[\\/]")) throw new ArgumentException("请输入本机绝对路径，例如 C:\\Results。");
        string path = Path.GetFullPath(raw);
        if (!Directory.Exists(path)) throw new DirectoryNotFoundException("文件夹不存在，请选择已有的上级目录后新建。");
        return path.TrimEnd(Path.DirectorySeparatorChar) + (path.Length <= 3 ? "\\" : "");
    }
    static object FolderList(string value) {
        string path = DirectoryPath(value);
        var entries = Directory.EnumerateDirectories(path).Where(p => {
            try { return (File.GetAttributes(p) & (FileAttributes.Hidden | FileAttributes.System)) == 0; }
            catch (IOException) { return false; }
        }).Take(501).ToArray();
        var parent = Directory.GetParent(path);
        return new {
            path, parent = parent == null ? null : parent.FullName,
            root = Path.GetPathRoot(path), default_path = projects, truncated = entries.Length > 500,
            folders = entries.Take(500).OrderBy(p => Path.GetFileName(p), StringComparer.CurrentCultureIgnoreCase)
                .Select(p => new { name = Path.GetFileName(p), path = p }).ToArray()
        };
    }
    static object MakeFolder(string json) {
        var data = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(json);
        if (data == null || !data.ContainsKey("parent") || !data.ContainsKey("name")) throw new ArgumentException("请选择上级目录并填写文件夹名称。");
        string parent = DirectoryPath(data["parent"]), name = data["name"] ?? "";
        if (name.Length == 0 || name.Length > 120 || name != name.Trim() || name.EndsWith(".") || name == "." || name == ".." || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
            Regex.IsMatch(name, @"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(\..*)?$", RegexOptions.IgnoreCase))
            throw new ArgumentException("文件夹名称无效：不能含路径分隔符、保留名称或结尾的空格/句点。");
        string path = Path.GetFullPath(Path.Combine(parent, name));
        string program = Path.GetFullPath(AppRoot).TrimEnd('\\') + "\\";
        if (path.StartsWith(program, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("请选择程序文件夹之外的位置保存项目结果。");
        if (!CreateDirectory(path, IntPtr.Zero)) {
            int code = Marshal.GetLastWin32Error();
            if (code == 183 || code == 80) throw new IOException("同名文件或文件夹已存在，请换个名称或直接选择已有文件夹。");
            if (code == 5) throw new UnauthorizedAccessException("没有权限在此位置新建文件夹，请选择其他目录。");
            throw new IOException(new Win32Exception(code).Message);
        }
        return new { path, created = true };
    }
    static void Handle(HttpListenerContext context) {
        try {
            var request = context.Request; string path = request.Url.AbsolutePath;
            if (path.StartsWith("/api/output-folders", StringComparison.Ordinal)) {
                if (!SameOrigin(request)) { Json(context.Response, new { detail = "只接受本机 Resim 页面发起的目录操作。" }, 403); return; }
                if (path == "/api/output-folders" && request.HttpMethod == "GET") {
                    // HttpListener.QueryString can use the Windows codepage for GET requests.
                    // Browser encodeURIComponent paths must be decoded as UTF-8, including CJK names.
                    string pair = request.Url.Query.TrimStart('?').Split('&').FirstOrDefault(p => p.StartsWith("path=", StringComparison.Ordinal));
                    Json(context.Response, FolderList(pair == null ? null : Uri.UnescapeDataString(pair.Substring(5).Replace("+", " "))));
                }
                else if (path == "/api/output-folders/create" && request.HttpMethod == "POST") Json(context.Response, MakeFolder(Encoding.UTF8.GetString(Body(request, 16000))));
                else Json(context.Response, new { detail = "不支持的目录操作。" }, 405);
            } else Proxy(context);
        } catch (UnauthorizedAccessException e) { TryError(context, e.Message, 403); }
        catch (DirectoryNotFoundException e) { TryError(context, e.Message, 404); }
        catch (ArgumentException e) { TryError(context, e.Message, 400); }
        catch (IOException e) { TryError(context, e.Message, 409); }
        catch (Exception) { TryError(context, "本地操作未完成，请检查目录或程序运行状态。", 500); }
        finally { try { context.Response.Close(); } catch { } }
    }
    static void TryError(HttpListenerContext context, string detail, int status) {
        try { Json(context.Response, new { detail }, status); } catch { }
    }
    static void Proxy(HttpListenerContext context) {
        var incoming = context.Request;
        var request = (HttpWebRequest)WebRequest.Create(backend + incoming.Url.PathAndQuery);
        request.Proxy = null; request.AllowAutoRedirect = false; request.Method = incoming.HttpMethod;
        request.Timeout = 600000; request.ReadWriteTimeout = 600000; request.KeepAlive = false;
        if (!String.IsNullOrEmpty(incoming.ContentType)) request.ContentType = incoming.ContentType;
        foreach (string key in incoming.Headers.AllKeys) {
            if (!WebHeaderCollection.IsRestricted(key) && !new [] { "Connection", "Transfer-Encoding", "Origin", "Accept-Encoding" }.Contains(key, StringComparer.OrdinalIgnoreCase))
                request.Headers[key] = incoming.Headers[key];
        }
        if (incoming.HasEntityBody) {
            byte[] body = Body(incoming, MaxBody); request.ContentLength = body.Length;
            using (var stream = request.GetRequestStream()) stream.Write(body, 0, body.Length);
        }
        HttpWebResponse response;
        try { response = (HttpWebResponse)request.GetResponse(); }
        catch (WebException e) {
            response = e.Response as HttpWebResponse;
            if (response == null) { Json(context.Response, new { detail = "模拟引擎暂不可用，请重启程序后重试。" }, 502); return; }
        }
        using (response) {
            var output = context.Response; output.StatusCode = (int)response.StatusCode;
            foreach (string key in response.Headers.AllKeys) {
                if (!new [] { "Transfer-Encoding", "Connection", "Content-Length", "Content-Type", "Keep-Alive" }.Contains(key, StringComparer.OrdinalIgnoreCase))
                    output.Headers[key] = response.Headers[key];
            }
            output.ContentType = response.ContentType;
            if (response.ContentLength >= 0) output.ContentLength64 = response.ContentLength;
            if (incoming.HttpMethod != "HEAD") using (var stream = response.GetResponseStream()) stream.CopyTo(output.OutputStream);
        }
    }
}
