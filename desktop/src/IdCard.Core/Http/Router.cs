// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The HTTP side: only this PC, only via localhost, signed-in users only (with per-route rules), and
// the screens' files. Request bodies are read before taking the service gate, and replies are
// written after releasing it, so a slow upload or download never holds up printing.
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using IdCard.Service;
using Microsoft.AspNetCore.Http;

namespace IdCard.Http;

internal sealed record Reply(int Status, byte[] Body, string Type, Dictionary<string, string>? Headers = null)
{
    public static Reply Json(JsonNode? v, int status = 200, Dictionary<string, string>? headers = null) =>
        new(status, Encoding.UTF8.GetBytes(Js.Stringify(v)), "application/json", headers);
    public static Reply Ok() => Json(new JsonObject { ["ok"] = true });
    public static Reply Bad(string msg, int status = 400) => Json(new JsonObject { ["error"] = msg }, status);
    public static Reply Bytes(byte[] body, string type, Dictionary<string, string>? headers = null) => new(200, body, type, headers);
    public static Reply Text(string body, string type, Dictionary<string, string>? headers = null) => new(200, Encoding.UTF8.GetBytes(body), type, headers);
}

internal sealed class Req(HttpContext ctx, Dictionary<string, string> p, AppService.SessionUser? user, byte[] body)
{
    public HttpContext Ctx { get; } = ctx;
    public Dictionary<string, string> P { get; } = p;
    public AppService.SessionUser User { get; } = user!;
    public AppService.SessionUser? MaybeUser { get; } = user;
    public byte[] Body { get; } = body;
    public string? Query(string k) => Ctx.Request.Query.TryGetValue(k, out var v) ? v.ToString() : null;
    public string? Header(string k) => Ctx.Request.Headers.TryGetValue(k, out var v) ? v.ToString() : null;
    JsonObject? _json;
    /// <summary>The JSON body ({} when empty).</summary>
    public JsonObject Json => _json ??= Body.Length == 0 ? new JsonObject()
        : (JsonNode.Parse(Body) is JsonObject o ? o : throw new BadRequestException("The request was not a JSON object."));
}

internal sealed class BadRequestException(string message) : Exception(message);

internal sealed record Route(string Method, string Pattern, Regex Re, Func<Req, Task<Reply>> Fn, bool Public, bool DefaultOk, bool Admin, bool Unlocked, long Limit, bool Raw);

internal sealed partial class Router
{
    internal const long DefaultLimit = 60L * 1024 * 1024;
    /// <summary>A route that reads (streams) the request body itself.</summary>
    internal const long StreamedBody = -1;
    static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".mjs"] = "text/javascript; charset=utf-8", [".css"] = "text/css; charset=utf-8",
        [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".webp"] = "image/webp", [".gif"] = "image/gif", [".svg"] = "image/svg+xml",
        [".ico"] = "image/x-icon", [".woff2"] = "font/woff2", [".json"] = "application/json", [".txt"] = "text/plain; charset=utf-8", [".wasm"] = "application/wasm",
    };
    static readonly (string, string)[] SecurityHeaders = [("X-Content-Type-Options", "nosniff"), ("X-Frame-Options", "DENY"), ("Referrer-Policy", "no-referrer")];

    readonly AppService _app;
    readonly List<Route> _routes = [];
    readonly HashSet<string> _hosts;
    readonly string _webRoot;

    public Router(AppService app)
    {
        _app = app;
        _webRoot = Path.GetFullPath(app.WebRoot);
        _hosts = [$"localhost:{app.Port}", $"127.0.0.1:{app.Port}", $"[::1]:{app.Port}"];
        new Routes(app, this).Register();
    }

    [GeneratedRegex(@":(\w+)")] private static partial Regex Param();

    /// <param name="defaultOk">still usable while the account has the default password (everything else waits until it is changed)</param>
    /// <param name="admin">administrators only (operators manage clients and people and print; not settings or templates)</param>
    /// <param name="unlocked">runs without the service gate (it takes it itself, briefly)</param>
    /// <param name="raw">writes its own response (live updates)</param>
    public void Add(string method, string pattern, Func<Req, Task<Reply>> fn, bool isPublic = false, bool defaultOk = false, bool admin = false, bool unlocked = false, long limit = DefaultLimit, bool raw = false)
    {
        var re = new Regex("^" + Param().Replace(Regex.Escape(pattern), "(?<$1>[^/]+)") + "$");
        _routes.Add(new Route(method, pattern, re, fn, isPublic, defaultOk, admin, unlocked, limit, raw));
    }
    public void Add(string method, string pattern, Func<Req, Reply> fn, bool isPublic = false, bool defaultOk = false, bool admin = false, long limit = DefaultLimit) =>
        Add(method, pattern, r => Task.FromResult(fn(r)), isPublic, defaultOk, admin, false, limit);

    /// <summary>Marks existing routes as administrator-only.</summary>
    public void AdminOnly(params string[] signatures)
    {
        foreach (var sig in signatures)
        {
            var i = _routes.FindIndex(r => $"{r.Method} {r.Pattern}" == sig);
            if (i < 0) throw new InvalidOperationException($"Unknown route in admin list: {sig}");
            _routes[i] = _routes[i] with { Admin = true };
        }
    }

    static void Secure(HttpResponse res) { foreach (var (k, v) in SecurityHeaders) res.Headers[k] = v; }

    static async Task Write(HttpContext ctx, Reply r)
    {
        var res = ctx.Response;
        res.StatusCode = r.Status;
        Secure(res);
        res.Headers.CacheControl = "no-store";
        res.ContentType = r.Type;
        res.ContentLength = r.Body.Length;
        if (r.Headers is not null) foreach (var (k, v) in r.Headers) res.Headers[k] = v;
        await res.Body.WriteAsync(r.Body);
    }

    static async Task<byte[]> ReadBody(HttpRequest req, long limit)
    {
        using var ms = new MemoryStream();
        await CopyBody(req, ms, limit);
        return ms.ToArray();
    }

    internal static async Task CopyBody(HttpRequest req, Stream to, long limit)
    {
        if (req.ContentLength > limit) throw new BadRequestException("Upload too large");
        var buf = new byte[81920];
        long total = 0; int n;
        while ((n = await req.Body.ReadAsync(buf)) > 0)
        {
            total += n;
            if (total > limit) throw new BadRequestException("Upload too large");
            await to.WriteAsync(buf.AsMemory(0, n));
        }
    }

    static string? CookieToken(HttpRequest req) => req.Cookies.TryGetValue(AppService.Cookie, out var t) ? t : null;

    public async Task Handle(HttpContext ctx)
    {
        var req = ctx.Request;
        var path = req.Path.Value ?? "/";
        // Only this PC, and only via localhost (blocks DNS-rebinding and cross-site requests).
        var ip = ctx.Connection.RemoteIpAddress;
        if (ip is null || !IPAddress.IsLoopback(ip) || !_hosts.Contains(req.Host.Value?.ToLowerInvariant() ?? "")) { await Write(ctx, Reply.Bad("Forbidden", 403)); return; }
        if (req.Method != "GET" && req.Headers.Origin.ToString() is { Length: > 0 } origin && !_hosts.Contains(Regex.Replace(origin, "^https?://", "").ToLowerInvariant()))
        {
            await Write(ctx, Reply.Bad("Forbidden", 403)); return;
        }
        try
        {
            foreach (var r in _routes)
            {
                if (r.Method != req.Method) continue;
                var m = r.Re.Match(path);
                if (!m.Success) continue;
                var user = await _app.LockedAsync(() => _app.UserForToken(CookieToken(req)));
                if (!r.Public && user is null) { await Write(ctx, Reply.Bad("Please sign in.", 401)); return; }
                if (!r.Public && !r.DefaultOk && user!.IsDefaultPassword) { await Write(ctx, Reply.Bad("Choose a new password first.", 403)); return; }
                if (r.Admin && !user!.IsAdmin) { await Write(ctx, Reply.Bad("Only an administrator can do that.", 403)); return; }
                var p = r.Re.GetGroupNames().Where(g => !int.TryParse(g, out _)).ToDictionary(g => g, g => m.Groups[g].Value);   // the path is already decoded
                var body = req.Method is "GET" or "HEAD" || r.Limit == StreamedBody ? [] : await ReadBody(req, r.Limit);
                var rq = new Req(ctx, p, user, body);
                if (r.Raw) { await r.Fn(rq); return; }
                var reply = r.Unlocked ? await r.Fn(rq) : await _app.LockedAsync(() => r.Fn(rq).GetAwaiter().GetResult());
                await Write(ctx, reply);
                return;
            }
            if (path.StartsWith("/api/", StringComparison.Ordinal) || req.Method != "GET") { await Write(ctx, Reply.Bad("Not found", 404)); return; }
            await ServeFile(ctx, path == "/" ? "index.html" : path[1..]);
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            if (e is BadRequestException or System.Text.Json.JsonException) { await Write(ctx, Reply.Bad(e is BadRequestException ? e.Message : "The request was not valid JSON.")); return; }
            _app.Locked(() => _app.Log($"Request error {req.Method} {path} {e}"));
            await Write(ctx, Reply.Bad(string.IsNullOrEmpty(e.Message) ? "Server error" : e.Message, 500));
        }
    }

    async Task ServeFile(HttpContext ctx, string rel)
    {
        var file = Path.GetFullPath(Path.Combine(_webRoot, rel));
        if (!file.StartsWith(_webRoot + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(file)) { await Write(ctx, Reply.Bad("Not found", 404)); return; }
        var res = ctx.Response;
        Secure(res);
        res.Headers.CacheControl = "no-cache";
        res.ContentType = Mime.GetValueOrDefault(Path.GetExtension(file), "application/octet-stream");
        await res.SendFileAsync(file);
    }
}
