// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The print service: keeps everything (settings, clients, people, photos, card templates, the print
// queue, history, logs and logins) in one encrypted SQLite database and drives the card printer one
// card at a time. The screens talk to it over HTTP on localhost (see Http/).
//
// Threading: like the Node.js service it replaces, all state and the database are used by one
// thread at a time. Every request, timer and printer event takes the gate first, and nothing slow
// (printing, waiting, uploads, downloads) runs while holding it.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using IdCard.Data;
using IdCard.Printing;
using IdCard.Security;

namespace IdCard.Service;

/// <summary>Why the service could not start, in plain English (shown to the person).</summary>
public sealed class StartupException(string title, string details) : Exception(title + "\n\n" + details)
{
    public string Title { get; } = title;
    public string Details { get; } = details;
}

public sealed class ServiceOptions
{
    public required string DataDir { get; init; }
    public required string WebRoot { get; init; }
    /// <summary>Returns the database key; allowCreate is true only when there is no database yet.</summary>
    public required Func<bool, string> GetDbKey { get; init; }
    public required string KeyProtection { get; init; }
    /// <summary>The real printer (Windows).</summary>
    public Func<Func<PrinterSettingsSnapshot>, IPrinter>? RealPrinter { get; init; }
    /// <summary>A simulated printer, development host only: the released program has none, so it has no simulator mode.</summary>
    public Func<Func<PrinterSettingsSnapshot>, IPrinter>? Simulator { get; init; }
    public int? Port { get; init; }
    public string Version { get; init; } = "3.0.0";
    /// <summary>Called after Settings > Stop the print service, or once an update has started (the program should exit).</summary>
    public Action? Stopped { get; init; }
    /// <summary>Where to look for new versions (GitHub's latest-release API); null to never check.</summary>
    public string? UpdateFeed { get; init; }
    /// <summary>Starts a downloaded setup program; returns a plain-English error, or null once it has started. Null where updates can't be installed.</summary>
    public Func<string, string?>? RunInstaller { get; init; }
    /// <summary>Shows a desktop notification (title, message, whether it's a problem): the Windows program's tray icon. Null where there are none.</summary>
    public Action<string, string, bool>? Notify { get; init; }
    /// <summary>True when the program's setup shows the licence and installs only once it's accepted, so the program doesn't ask again.</summary>
    public bool LicenceAcceptedInSetup { get; init; }
}

public sealed partial class AppService : IDisposable
{
    public const string AppName = "ID Card Printing Software Free";
    public const string AppId = "ID Card Printing Software";     // stored inside the database and backups
    public const string Copyright = "Copyright (c) 2026 Josh McNabb. All rights reserved.";
    public const string LicenseVersion = "1.0";                    // raise this whenever the licence terms change

    readonly ServiceOptions _o;
    readonly SemaphoreSlim _gate = new(1, 1);
    readonly List<Timer> _timers = [];
    internal Db Db { get; }
    internal string DbFile { get; }
    internal string DbKey { get; }
    internal string Xfer { get; }
    internal string Version => _o.Version;
    internal string WebRoot => _o.WebRoot;
    internal bool HasRealPrinter => _o.RealPrinter is not null;
    internal bool HasSimulator => _o.Simulator is not null;
    public int Port { get; private set; }
    bool _disposed;

    public AppService(ServiceOptions o)
    {
        _o = o;
        if (o.RealPrinter is null && o.Simulator is null) throw new ArgumentException("A printer is required.", nameof(o));
        Directory.CreateDirectory(o.DataDir);
        DbFile = Path.Combine(o.DataDir, "id-card-printing-software.db");
        Xfer = Path.Combine(o.DataDir, "transfer");   // only ever holds password-encrypted backups, briefly
        Directory.CreateDirectory(Xfer);
        foreach (var f in Directory.GetFiles(Xfer)) { try { File.Delete(f); } catch (IOException) { } catch (UnauthorizedAccessException) { } }

        var exists = File.Exists(DbFile);
        try { DbKey = o.GetDbKey(!exists); }
        catch (Exception e)
        {
            throw new StartupException("The database key could not be loaded", $"{e.Message}\n\nThe database is encrypted with a key that belongs to the Windows account that created it. " +
                $"Sign in to Windows as that user, or move the database file away to start fresh ({DbFile}) and then restore a backup from Settings.");
        }
        try { Db = Db.Open(DbFile, DbKey, AppId); }
        catch (BadKeyException)
        {
            throw new StartupException("The database could not be unlocked", $"This database was encrypted on another PC or Windows account. Move it away ({DbFile}) to start fresh, then restore a backup from Settings.");
        }

        Locked(() =>
        {
            try
            {
                Db.Exec("DELETE FROM app_log WHERE ts < ?", Js.Iso(DateTime.UtcNow.AddDays(-365)));
                Db.Exec("DELETE FROM sessions WHERE expires_at < ?", Js.Now());
                Db.Exec("DELETE FROM supply_log WHERE id NOT IN (SELECT id FROM supply_log ORDER BY id DESC LIMIT 20000)");
            }
            catch (Microsoft.Data.Sqlite.SqliteException) { }
            LoadAll();
            if (o.LicenceAcceptedInSetup && Js.AsString(Config["licenseAccepted"]?["version"]) != LicenseVersion)
            {
                Config["licenseAccepted"] = new JsonObject { ["version"] = LicenseVersion, ["by"] = "Windows setup", ["at"] = Js.Now() }; SaveConfig();
                Log($"Licence version {LicenseVersion} accepted in the setup");
            }
            Port = o.Port ?? (int)Js.NumOr(Config["port"], 5180);
            _printerStatus = PrinterStatus.Derive(null, StatusCfg());
            MakePrinter();
            if (_recoveredOnStart > 0) Notify($"{Cards(_recoveredOnStart)} to check", "The program stopped while printing. Open the print queue, check the cards marked Check output, then choose Resume printing.", true);
        });
        if (HasRealPrinter && Js.ToStr(Config["printerName"]).Length == 0 && !Js.Truthy(Config["simulate"])) _ = AutoSelectPrinter();
        _timers.Add(new Timer(_ => Safe(() => Locked(() => { if (!_disposed && !_worker.Running && !_queuePaused && NextItem() is not null) Kick(); })), null, 3000, 3000));
        _timers.Add(new Timer(_ => Safe(() => AutoBackupTick().GetAwaiter().GetResult()), null, TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(10)));
        _timers.Add(new Timer(_ => Safe(Ping), null, 20000, 20000));
        StartUpdateChecks();
    }

    /// <summary>Called once the web server is listening.</summary>
    public void Started() => Locked(() =>
    {
        Log($"{AppName} {Version} started {(Js.Truthy(Config["simulate"]) ? "[SIMULATOR]" : $"[printer: {(Js.ToStr(Config["printerName"]) is { Length: > 0 } n ? n : "not set")}]")}");
        if (!_queuePaused && NextItem() is not null) Kick();
    });

    /// <summary>A desktop notification, when the program can show them and "Desktop notifications" is on. Called on the gate.</summary>
    void Notify(string title, string message, bool problem = false)
    {
        if (_o.Notify is not { } show || !Js.Truthy(Config["notifications"])) return;
        try { show(title, message, problem); } catch (Exception e) { Log("Notification failed: " + e.Message); }
    }
    static string Cards(int n) => $"{n:N0} card{(n == 1 ? "" : "s")}";

    /// <summary>For timer and background work: an error is logged instead of ending the program.</summary>
    internal void Safe(Action f)
    {
        try { f(); }
        catch (Exception e) when (!_disposed) { try { Locked(() => Log("Background task failed: " + e)); } catch (Exception) { } }
        catch (Exception) { }
    }

    // ---------------- the gate ----------------
    internal void Locked(Action f) { _gate.Wait(); try { f(); } finally { _gate.Release(); } }
    internal T Locked<T>(Func<T> f) { _gate.Wait(); try { return f(); } finally { _gate.Release(); } }
    internal async Task<T> LockedAsync<T>(Func<T> f) { await _gate.WaitAsync(); try { return f(); } finally { _gate.Release(); } }
    internal async Task LockedAsync(Action f) { await _gate.WaitAsync(); try { f(); } finally { _gate.Release(); } }

    // ---------------- logging (to the console and the encrypted database) ----------------
    [GeneratedRegex("error|fail|uncaught|unhandled|locked", RegexOptions.IgnoreCase)] private static partial Regex ErrorWords();
    [GeneratedRegex("alert|recovered|warn", RegexOptions.IgnoreCase)] private static partial Regex WarnWords();

    internal void Log(string msg)
    {
        var level = ErrorWords().IsMatch(msg) ? "error" : WarnWords().IsMatch(msg) ? "warning" : "info";
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {msg}");
        try { Db.Exec("INSERT INTO app_log(ts, level, message) VALUES (?, ?, ?)", Js.Now(), level, msg); } catch (Exception) { }
    }

    // ---------------- config ----------------
    internal JsonObject Config { get; private set; } = new();

    JsonObject DefaultConfig() => new()
    {
        ["printerName"] = "",
        ["simulate"] = HasSimulator && !HasRealPrinter,
        ["simSeconds"] = 6,
        ["defaultSides"] = "both",
        ["cardSides"] = "dual",        // 'single' = front only, 'dual' = front and back
        ["backMethod"] = "auto",       // dual-sided: 'auto' = printer flips the card, 'manual' = fronts first, flip, then backs
        ["backMethodChosen"] = false,
        ["rotateBack"] = false,
        ["printAuto"] = true,          // Settings > Print adjustments: Darkness, Contrast and Colour set for the printer model (PrintTuning.ForPrinter)
        ["printDarkness"] = 0,         // otherwise these (PrintTuning): -50..50, 0 = as designed
        ["printContrast"] = 0,
        ["printColour"] = 0,
        ["printOverprint"] = 0,        // millimetres, 0..2
        ["pauseOnError"] = true,
        ["autoStart"] = true,
        ["delayBetweenCards"] = 0,
        ["jobTimeoutMin"] = 10,
        ["pollMs"] = 1500,
        ["ribbonLowPercent"] = 10,
        ["filmLowPercent"] = 10,
        ["operatorName"] = "",
        ["notifications"] = true,
        ["sound"] = true,
        ["sessionIdleMin"] = 120,
        ["theme"] = new JsonObject { ["preset"] = "classic", ["primary"] = "#00529F", ["heading"] = "", ["sidebar"] = "light" },
        ["companyName"] = "",
        ["logoAsset"] = null,
        ["licenseAccepted"] = null,
        ["port"] = 5180,
        ["openBrowser"] = true,
        ["customFields"] = new JsonArray(),     // changed only through /api/fields
        ["autoBackup"] = new JsonObject { ["enabled"] = false, ["folder"] = "", ["every"] = "daily", ["keep"] = 14 },   // changed only through /api/autobackup
    };
    internal static readonly string[] ConfigKeys = ["printerName", "simulate", "simSeconds", "defaultSides", "cardSides", "backMethod", "backMethodChosen", "rotateBack", "printAuto", "printDarkness", "printContrast", "printColour", "printOverprint", "pauseOnError", "autoStart",
        "delayBetweenCards", "jobTimeoutMin", "pollMs", "ribbonLowPercent", "filmLowPercent", "operatorName", "notifications", "sound", "sessionIdleMin", "theme", "companyName", "logoAsset",
        "licenseAccepted", "port", "openBrowser", "customFields", "autoBackup"];

    void LoadConfig()
    {
        var c = DefaultConfig();
        foreach (var r in Db.Rows("SELECT key, value FROM settings"))
        {
            var key = (string)r["key"]!;
            try { c[key] = JsonNode.Parse((string?)r["value"] ?? "null"); } catch (System.Text.Json.JsonException) { }
        }
        if (c["customFields"] is not JsonArray) c["customFields"] = new JsonArray();
        if (c["autoBackup"] is not JsonObject) c["autoBackup"] = DefaultConfig()["autoBackup"]!.DeepClone();
        if (!HasSimulator) c["simulate"] = false;   // simulator mode only exists in the development host
        Config = c;
    }

    internal void SaveConfig()
    {
        var t = Js.Now();
        Db.Tx(() =>
        {
            foreach (var (k, v) in Config)
                Db.Exec("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", k, Js.Stringify(v), t);
        });
    }

    internal JsonArray CustomFields => (JsonArray)Config["customFields"]!;
    internal JsonObject AutoBackupCfg => (JsonObject)Config["autoBackup"]!;

    void LoadAll()
    {
        LoadConfig(); LoadDesigns(); EnsureDefaultUser(); LoadQueue();
        _supplyLog = Db.Rows("SELECT ts, ribbon_part AS rp, ribbon AS r, film_part AS fp, film AS f FROM (SELECT * FROM supply_log ORDER BY id DESC LIMIT 2000) ORDER BY id")
            .Select(r => new SupplyEntry((string?)r["rp"], ToDouble(r["r"]), (string?)r["fp"], ToDouble(r["f"]))).ToList();
    }

    internal static double? ToDouble(object? v) => v switch { null => null, long l => l, double d => d, string s when double.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, out var d) => d, _ => null };

    // ---------------- sign in ----------------
    internal const string Cookie = "idcard_session";
    internal const int SessionMaxHours = 12;

    void EnsureDefaultUser()
    {
        if (Db.Count("SELECT COUNT(*) FROM users") == 0)
        {
            Db.Exec("INSERT INTO users(username, password_hash, is_default_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", "admin", Passwords.Hash("admin"), 1, Js.Now(), Js.Now());
            Log("Created the default login (admin)");
        }
    }

    internal static string TokenHash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    internal sealed record SessionUser(long Id, string Username, bool IsDefaultPassword, string Role, string TokenHash)
    {
        public bool IsAdmin => Role == "admin";
    }

    internal SessionUser? UserForToken(string? token)
    {
        if (string.IsNullOrEmpty(token)) return null;
        var h = TokenHash(token);
        var s = Db.Row("SELECT * FROM sessions WHERE token_hash = ?", h);
        if (s is null) return null;
        var now = DateTime.UtcNow;
        var seen = Js.ParseIso((string?)s["last_seen_at"]) ?? DateTime.MinValue;
        if ((Js.ParseIso((string?)s["expires_at"]) ?? DateTime.MinValue) < now || now - seen > TimeSpan.FromMinutes(Js.NumOr(Config["sessionIdleMin"], 120)))
        {
            Db.Exec("DELETE FROM sessions WHERE token_hash = ?", h); return null;
        }
        if (now - seen > TimeSpan.FromSeconds(30)) Db.Exec("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", Js.Now(), h);
        var u = Db.Row("SELECT * FROM users WHERE id = ?", s["user_id"]);
        if (u is null) return null;
        var role = (string?)u["role"] ?? "admin";   // accounts from before roles are administrators
        return new SessionUser((long)u["id"]!, (string)u["username"]!, Convert.ToInt64(u["is_default_password"]) != 0, role, h);
    }

    readonly Dictionary<string, (int Count, DateTime Until)> _failures = new();
    internal int LockedFor(string name) => _failures.TryGetValue(name.ToLowerInvariant(), out var f) && f.Until > DateTime.UtcNow ? (int)Math.Ceiling((f.Until - DateTime.UtcNow).TotalSeconds) : 0;
    internal void NoteFailure(string name)
    {
        var k = name.ToLowerInvariant();
        var f = _failures.GetValueOrDefault(k);
        f.Count++;
        if (f.Count >= 5) f.Until = DateTime.UtcNow.AddSeconds(Math.Min(15 * 60, 30 * Math.Pow(2, f.Count - 5)));
        _failures[k] = f;
    }
    internal void ClearFailures(string name) => _failures.Remove(name.ToLowerInvariant());

    // ---------------- printer ----------------
    IPrinter? _printer;
    JsonObject _printerStatus = new();
    string _lastAlertKey = "";
    internal JsonObject PrinterStatusNow => _printerStatus;
    internal IPrinter Printer => _printer!;

    StatusSettings StatusCfg() => new(Js.ToStr(Config["printerName"]), Js.Truthy(Config["simulate"]), LowPercent(Config["ribbonLowPercent"]), LowPercent(Config["filmLowPercent"]));
    static double LowPercent(JsonNode? v) => Js.ToNumber(v) is var n && double.IsFinite(n) ? n : 10;   // 0 = never warn

    PrinterSettingsSnapshot PrinterSettings()
    {
        // Called from printer threads, so it reads a copy of the values it needs.
        var c = Config;
        var tuning = PrintTuning.From(Js.NumOr(c["printDarkness"], 0), Js.NumOr(c["printContrast"], 0), Js.NumOr(c["printColour"], 0), Js.NumOr(c["printOverprint"], 0));
        if (Js.Truthy(c["printAuto"]) && PrintTuning.ForPrinter(Js.ToStr(c["printerName"]), Js.ToStr(_printerStatus["driver"])) is { } auto)
            tuning = auto.Tuning with { OverprintMm = tuning.OverprintMm };
        return new PrinterSettingsSnapshot(Js.ToStr(c["printerName"]), (int)Js.NumOr(c["pollMs"], 1500), (int)Js.NumOr(c["simSeconds"], 6), tuning);
    }

    Action<PrinterRaw?>? _statusHandler;
    internal void MakePrinter()
    {
        if (_printer is not null) { _printer.StatusChanged -= _statusHandler; _printer.Dispose(); }
        var useSimulator = _o.Simulator is not null && (Js.Truthy(Config["simulate"]) || _o.RealPrinter is null);
        var p = useSimulator ? _o.Simulator!(PrinterSettings) : _o.RealPrinter!(PrinterSettings);
        _printer = p;
        _statusHandler = raw => OnPrinterStatus(p, raw);
        p.StatusChanged += _statusHandler;
        p.Restart();
    }

    internal void ResetAlerts() => _lastAlertKey = "";

    // Printer events arrive on other threads, sometimes from inside a locked call; they are applied on the gate, newest first.
    PrinterRaw? _pendingRaw; IPrinter? _pendingFrom; int _statusScheduled;
    void OnPrinterStatus(IPrinter from, PrinterRaw? raw)
    {
        lock (this) { _pendingRaw = raw; _pendingFrom = from; }
        if (Interlocked.Exchange(ref _statusScheduled, 1) == 0)
            _ = Task.Run(() => Safe(() => Locked(() =>
            {
                Volatile.Write(ref _statusScheduled, 0);
                PrinterRaw? r; IPrinter? from;
                lock (this) { r = _pendingRaw; from = _pendingFrom; }
                if (!_disposed && from == _printer) ApplyStatus(r);
            })));
    }

    void ApplyStatus(PrinterRaw? raw)
    {
        _printerStatus = WithEstimates(PrinterStatus.Derive(raw, StatusCfg()));
        var alerts = Js.Arr(_printerStatus["alerts"]).OfType<JsonObject>().ToList();
        var key = string.Join(",", alerts.Select(a => Js.ToStr(a["code"])).Order(StringComparer.Ordinal));
        if (key != _lastAlertKey)
        {
            var prev = _lastAlertKey.Split(',', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
            foreach (var a in alerts.Where(a => !prev.Contains(Js.ToStr(a["code"]))))
            {
                try { Db.Exec("INSERT INTO printer_events(ts, type, code, level, title, detail) VALUES (?, ?, ?, ?, ?, ?)", Js.Now(), "alert", Js.ToStr(a["code"]), Js.ToStr(a["level"]), Js.ToStr(a["title"]), Js.ToStr(a["detail"])); } catch (Exception) { }
                Log("Printer alert: " + Js.ToStr(a["title"]));
                if (_worker.Current is not null || NextItem() is not null) Notify(Js.ToStr(a["title"]), Js.ToStr(a["detail"]), true);   // only while there are cards to print
            }
            foreach (var c in prev.Where(c => !alerts.Any(a => Js.ToStr(a["code"]) == c)))
            {
                try { Db.Exec("INSERT INTO printer_events(ts, type, code, level, title, detail) VALUES (?, ?, ?, ?, ?, ?)", Js.Now(), "cleared", c, "info", PrinterStatus.Alerts.TryGetValue(c, out var al) ? al.Title : c, ""); } catch (Exception) { }
                Log("Printer alert cleared: " + c);
            }
            _lastAlertKey = key;
        }
        // A printer without a flipper can't print both sides in one pass: default to the manual flip method.
        var flipper = _printerStatus["supplies"]?["modules"]?["flipper"];
        if (flipper is JsonValue fv && fv.TryGetValue<bool>(out var hasFlipper) && !hasFlipper && !Js.Truthy(Config["simulate"]) && !Js.Truthy(Config["backMethodChosen"]) && Js.ToStr(Config["backMethod"]) != "manual")
        {
            Config["backMethod"] = "manual"; Config["backMethodChosen"] = true; Config["defaultSides"] = "front";
            SaveConfig(); Broadcast("config", Config); Log("Printer reports no flipper module: dual-sided cards set to print fronts, then backs after flipping");
        }
        Broadcast("printer", _printerStatus);
    }

    /// <summary>First run on Windows: pick a FARGO printer automatically if one is installed.</summary>
    async Task AutoSelectPrinter()
    {
        try
        {
            var list = await Locked(() => _printer!).ListPrintersAsync();
            var f = list.FirstOrDefault(p => Regex.IsMatch($"{p.Name} {p.Driver}", "fargo", RegexOptions.IgnoreCase));
            if (f is null) return;
            await LockedAsync(() =>
            {
                if (Js.ToStr(Config["printerName"]).Length > 0) return;
                Config["printerName"] = f.Name; SaveConfig(); MakePrinter(); Broadcast("config", Config); Log($"Auto-selected printer: {f.Name}");
            });
        }
        catch (Exception e) { Locked(() => { if (!_disposed) Log("Could not list printers: " + e.Message); }); }
    }

    // ---------------- stopping ----------------
    internal void RequestStop(string by)
    {
        Log($"Print service stopped from Settings (by {by})");
        _ = Task.Run(async () => { await Task.Delay(300); Dispose(); _o.Stopped?.Invoke(); });
    }

    public void Dispose()
    {
        if (_disposed) return;
        foreach (var t in _timers) t.Dispose();
        Locked(() =>
        {
            if (_disposed) return;
            _disposed = true;
            Log("Shutting down");
            try { _printer?.Dispose(); SaveQueue(quiet: true); } catch (Exception) { }
            CloseClients();
            Db.Dispose();
        });
    }
}
