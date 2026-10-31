// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Updates: new versions are published as GitHub releases with the setup program attached. The app
// checks now and then, shows administrators when one is available, and "Update now" downloads the
// setup, checks it against the SHA-256 GitHub records for it, runs it and closes so it can be replaced.
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace IdCard.Service;

public sealed partial class AppService
{
    public const string UpdateRepo = "CyborgFingers/id-card-printing-software";
    public const string DefaultUpdateFeed = $"https://api.github.com/repos/{UpdateRepo}/releases/latest";
    const long MaxSetupBytes = 500L * 1024 * 1024;
    static readonly TimeSpan UpdateInterval = TimeSpan.FromHours(12);
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(10) };

    [GeneratedRegex(@"^ID-Card-Printing-Software-Free-Setup-[\d.]+\.exe$", RegexOptions.IgnoreCase)] private static partial Regex SetupName();

    sealed record SetupAsset(string Name, string Url, long Size, string? Sha256);
    SetupAsset? _setup;
    bool _installing;
    JsonObject _update = new();
    DateTime _updateCheckedAt = DateTime.MinValue;

    internal JsonObject UpdateInfo() => (JsonObject)_update.DeepClone();

    static bool FromGitHub(string url) => Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps
        && (u.Host == "github.com" || u.Host.EndsWith(".githubusercontent.com", StringComparison.OrdinalIgnoreCase));

    // Where updates are downloaded: this account's own folder, except when the program runs as the SYSTEM account, whose own
    // folder is inside C:\Windows\System32. The setup is a 32-bit program and Windows shows those a different System32, so it
    // couldn't open itself there and stopped without installing. SYSTEM's temporary folder isn't in System32.
    string UpdatesDir => UpdatesFolder(OwnDir, Environment.SystemDirectory, Path.GetTempPath());

    internal static string UpdatesFolder(string own, string system, string temp) =>
        system.Length > 0 && own.StartsWith(system.TrimEnd('\\') + '\\', StringComparison.OrdinalIgnoreCase) ? Path.Combine(temp, "ID Card Printing Software") : own;

    void StartUpdateChecks()
    {
        // Setup programs from earlier updates (one may still have been running when it was last cleaned), including any a
        // SYSTEM copy left in its own folder before UpdatesDir.
        foreach (var d in new[] { OwnDir, UpdatesDir }.Distinct().Where(Directory.Exists).SelectMany(p => Directory.GetDirectories(p, "update-*")))
            try { Directory.Delete(d, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        _update = new JsonObject { ["current"] = Version, ["available"] = false, ["latest"] = null, ["installing"] = false };
        if (_o.UpdateFeed is null) return;
        _timers.Add(new Timer(_ => Safe(() => CheckForUpdate(force: false).GetAwaiter().GetResult()), null, TimeSpan.FromMinutes(1), TimeSpan.FromHours(1)));
    }

    internal async Task<JsonObject> CheckForUpdate(bool force)
    {
        if (_o.UpdateFeed is null) return UpdateInfo();
        if (!force && DateTime.UtcNow - _updateCheckedAt < UpdateInterval) return await LockedAsync(UpdateInfo);
        _updateCheckedAt = DateTime.UtcNow;
        JsonObject info;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, _o.UpdateFeed);
            req.Headers.UserAgent.Add(new ProductInfoHeaderValue("ID-Card-Printing-Software", Version));
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
            using var res = await Http.SendAsync(req);
            if (res.StatusCode == System.Net.HttpStatusCode.NotFound) info = UpdateResult(null, null, null);   // no releases yet
            else
            {
                res.EnsureSuccessStatusCode();
                var rel = Js.Obj(JsonNode.Parse(await res.Content.ReadAsStringAsync()));
                var tag = Js.ToStr(rel["tag_name"]).TrimStart('v', 'V');
                var asset = Js.Arr(rel["assets"]).OfType<JsonObject>().FirstOrDefault(a => SetupName().IsMatch(Js.ToStr(a["name"])));
                var digest = Js.AsString(asset?["digest"]);
                var setup = asset is null ? null : new SetupAsset(Js.ToStr(asset["name"]), Js.ToStr(asset["browser_download_url"]), (long)Js.NumOr(asset["size"], 0),
                    digest is not null && digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase) ? digest[7..].ToLowerInvariant() : null);
                info = UpdateResult(System.Version.TryParse(tag, out var v) ? v : null, setup, rel);
            }
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            info = await LockedAsync(() => { var o = UpdateInfo(); o["error"] = "Could not check for updates: " + e.Message; o["checkedAt"] = Js.Now(); return o; });
        }
        return await LockedAsync(() =>
        {
            if (_disposed) return info;
            var was = Js.Truthy(_update["available"]);
            _update = info;
            if (Js.Truthy(info["available"]) && !was) Log($"Update available: version {Js.ToStr(info["latest"])}");
            Broadcast("update", _update);
            return UpdateInfo();
        });
    }

    JsonObject UpdateResult(Version? latest, SetupAsset? setup, JsonObject? rel)
    {
        var available = latest is not null && setup is not null && System.Version.TryParse(Version, out var cur) && latest > cur;
        _setup = available ? setup : null;
        return new JsonObject
        {
            ["current"] = Version, ["available"] = available, ["latest"] = latest?.ToString(), ["checkedAt"] = Js.Now(), ["installing"] = _installing,
            ["notes"] = Js.Str(rel?["body"], 4000), ["page"] = Js.AsString(rel?["html_url"]),
        };
    }

    /// <summary>Downloads, checks and starts the new setup. Returns a plain-English error, or null when the setup has started.</summary>
    internal async Task<string?> InstallUpdate(string by)
    {
        var start = await LockedAsync<(SetupAsset? Setup, string? Error)>(() =>
        {
            if (_o.RunInstaller is null) return (null, "Updates are installed by the Windows program.");
            if (_installing) return (null, "The update is already being installed.");
            if (_setup is null) return (null, "There is no update to install.");
            if (_setup.Sha256 is null) return (null, "This update can't be checked, so it was not installed. Download it from the project's website instead.");
            if (_worker.Current is not null) return (null, "A card is printing. Wait for it to finish, then update.");
            _installing = true; _update["installing"] = true; Broadcast("update", _update);
            Log($"Downloading update {_setup.Name} (by {by})");
            return (_setup, null);
        });
        if (start.Error is not null) return start.Error;
        var setup = start.Setup!;
        // A new folder each time, in this account's UpdatesDir.
        var dir = Path.Combine(UpdatesDir, "update-" + Js.Uid(12));
        var file = Path.Combine(dir, setup.Name);
        string? error = null;
        try
        {
            if (_o.UpdateFeed == DefaultUpdateFeed && !FromGitHub(setup.Url)) throw new InvalidOperationException("The update isn't on GitHub, so it was not installed.");
            Directory.CreateDirectory(dir);
            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(20));
            using (var res = await Http.GetAsync(setup.Url, HttpCompletionOption.ResponseHeadersRead, timeout.Token))
            {
                res.EnsureSuccessStatusCode();
                await using var src = await res.Content.ReadAsStreamAsync(timeout.Token);
                await using var dst = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                var buf = new byte[81920]; long total = 0; int n;
                while ((n = await src.ReadAsync(buf, timeout.Token)) > 0)
                {
                    total += n;
                    if (total > MaxSetupBytes) throw new InvalidOperationException("The download is larger than expected.");
                    await dst.WriteAsync(buf.AsMemory(0, n), timeout.Token);
                }
            }
            // Held open (others may only read it) from the check until the setup has started, so it can't be swapped.
            await using var hold = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (Convert.ToHexStringLower(await SHA256.HashDataAsync(hold)) != setup.Sha256) throw new InvalidOperationException("The download didn't match the published update, so it was not installed.");
            error = await LockedAsync(() =>
            {
                // A card may have started while it downloaded: never close the program mid-card.
                if (_worker.Current is not null) return "A card started printing. Wait for it to finish, then update.";
                if (!_queuePaused) { _queuePaused = true; _pausedForUpdate = true; SaveQueue(); }   // saved, so the program resumes it when it's back
                return null;
            });
            error ??= _o.RunInstaller!(file);
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            error = e is InvalidOperationException ? e.Message : e is OperationCanceledException ? "The download took too long, so the update was not installed." : "The update could not be downloaded: " + e.Message;
        }
        await LockedAsync(() =>
        {
            if (error is null) { Log($"Installing update {setup.Name}: the program closes while it installs"); return; }
            if (_pausedForUpdate && !_disposed) { _queuePaused = false; _pausedForUpdate = false; SaveQueue(); Kick(); }
            _installing = false; _update["installing"] = false; Broadcast("update", _update);
            Log("Update failed: " + error);
        });
        if (error is null) _ = Task.Run(async () => { await Task.Delay(1500); Dispose(); _o.Stopped?.Invoke(); });
        else { try { Directory.Delete(dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
        return error;
    }
}
