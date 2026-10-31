// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Sign in, user accounts, branding, app state, live updates, settings and printers.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using IdCard.Printing;
using IdCard.Security;
using IdCard.Service;
using Microsoft.AspNetCore.Http;

namespace IdCard.Http;

internal sealed partial class Routes(AppService app, Router router)
{
    static string Now() => Js.Now();
    static string Str(JsonNode? v, int n = 200) => Js.Str(v, n);
    static Reply Ok(JsonNode? v) => Reply.Json(v);
    static Reply Ok() => Reply.Ok();
    static Reply Bad(string msg, int code = 400) => Reply.Bad(msg, code);
    void Log(string msg) => app.Log(msg);
    JsonObject Config => app.Config;

    static string ClearCookie => $"{AppService.Cookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    static readonly Dictionary<string, string> Roles = new() { ["admin"] = "Administrator", ["operator"] = "Operator" };
    [GeneratedRegex(@"^[\w.@-]{3,40}$")] private static partial Regex Username();

    public void Register()
    {
        Auth(); Users(); Branding(); State(); Settings();
        Clients(); People(); PersonFields();
        Designs(); Queue();
        History(); Backups();
        // Existing routes that only administrators may use.
        router.AdminOnly("PUT /api/config", "POST /api/branding/logo", "DELETE /api/branding/logo", "POST /api/printer/preferences",
            "POST /api/designs", "PUT /api/designs/:id", "PUT /api/designs/:id/clients", "DELETE /api/designs/:id", "POST /api/assets",
            "PUT /api/clients/:id/templates", "DELETE /api/clients/:id", "POST /api/backup", "POST /api/restore");
    }

    // ---------------- sign in / out ----------------
    void Auth()
    {
        router.Add("POST", "/api/auth/login", r =>
        {
            var b = r.Json;
            var username = Str(b["username"], 80); var password = Js.ToStr(b["password"]);
            var wait = app.LockedFor(username);
            if (wait > 0) return Bad($"Too many attempts. Try again in {wait} seconds.", 429);
            var u = username.Length > 0 ? app.Db.Row("SELECT * FROM users WHERE username = ?", username) : null;
            if (u is null || !Passwords.Verify(password, (string?)u["password_hash"]))
            {
                app.NoteFailure(username.Length > 0 ? username : "?"); Log($"Failed sign-in attempt for \"{username}\"");
                return Bad("Incorrect username or password.", 401);
            }
            app.ClearFailures(username);
            var token = Base64Url(RandomNumberGenerator.GetBytes(32)); var t = Now();
            app.Db.Exec("INSERT INTO sessions(token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)", AppService.TokenHash(token), u["id"], t, t, Js.Iso(DateTime.UtcNow.AddHours(AppService.SessionMaxHours)));
            app.Db.Exec("UPDATE users SET last_login_at = ? WHERE id = ?", t, u["id"]);
            Log($"Signed in: {u["username"]}");
            return Reply.Json(new JsonObject { ["user"] = UserInfo((string)u["username"]!, Convert.ToInt64(u["is_default_password"]) != 0, (string?)u["role"] ?? "admin") }, 200,
                new() { ["Set-Cookie"] = $"{AppService.Cookie}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={AppService.SessionMaxHours * 3600}" });
        }, isPublic: true, limit: 10000);
        router.Add("GET", "/api/auth/me", r => r.MaybeUser is not { } user ? Bad("Not signed in", 401)
            : Ok(new JsonObject { ["user"] = UserInfo(user.Username, user.IsDefaultPassword, user.Role) }), isPublic: true);
        router.Add("POST", "/api/auth/logout", r =>
        {
            app.Db.Exec("DELETE FROM sessions WHERE token_hash = ?", r.User.TokenHash); Log($"Signed out: {r.User.Username}");
            return Reply.Json(new JsonObject { ["ok"] = true }, 200, new() { ["Set-Cookie"] = ClearCookie });
        }, defaultOk: true);
        router.Add("PUT", "/api/auth/account", r =>
        {
            var b = r.Json; var user = r.User;
            var me = app.Db.Row("SELECT * FROM users WHERE id = ?", user.Id)!;
            var isDefault = Convert.ToInt64(me["is_default_password"]) != 0;
            // The default password is public, so asking for it again proves nothing.
            if (!isDefault && !Passwords.Verify(Js.ToStr(b["currentPassword"]), (string?)me["password_hash"])) return Bad("Your current password is incorrect.");
            var username = b.ContainsKey("username") ? Str(b["username"], 40) : (string)me["username"]!;
            if (!Username().IsMatch(username)) return Bad("Usernames are 3 to 40 characters: letters, numbers, dot, dash, underscore or @.");
            var other = app.Db.Row("SELECT id FROM users WHERE username = ?", username);
            if (other is not null && (long)other["id"]! != user.Id) return Bad("That username is already taken.");
            var hash = (string)me["password_hash"]!;
            var newPassword = Js.Truthy(b["newPassword"]) ? Js.ToStr(b["newPassword"]) : null;
            if (newPassword is not null)
            {
                if (newPassword.Length < 8) return Bad("Use at least 8 characters for the new password.");
                if (string.Equals(newPassword, username, StringComparison.OrdinalIgnoreCase)) return Bad("Choose a password that is different from the username.");
                hash = Passwords.Hash(newPassword); isDefault = false;
            }
            app.Db.Exec("UPDATE users SET username = ?, password_hash = ?, is_default_password = ?, updated_at = ? WHERE id = ?", username, hash, isDefault ? 1 : 0, Now(), user.Id);
            if (newPassword is not null) app.Db.Exec("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", user.Id, user.TokenHash);   // sign out other screens
            var was = (string)me["username"]!;
            Log($"Account updated for {username}{(newPassword is not null ? " (password changed)" : "")}{(username != was ? $" (username was {was})" : "")}");
            return Ok(new JsonObject { ["user"] = UserInfo(username, isDefault, user.Role) });
        }, defaultOk: true, limit: 10000);
    }

    static JsonObject UserInfo(string username, bool isDefault, string role) => new() { ["username"] = username, ["isDefaultPassword"] = isDefault, ["role"] = role };

    static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    // ---------------- user accounts (administrators manage them; new and reset accounts choose their own password) ----------------
    static JsonObject UserRow(Dictionary<string, object?> u) => new()
    {
        ["id"] = Js.Node(u["id"]), ["username"] = (string?)u["username"], ["role"] = (string?)u["role"] ?? "admin", ["mustChangePassword"] = Convert.ToInt64(u["is_default_password"]) != 0,
        ["lastLoginAt"] = (string?)u["last_login_at"], ["createdAt"] = (string?)u["created_at"],
    };
    long AdminCount() => app.Db.Count("SELECT COUNT(*) FROM users WHERE IFNULL(role, 'admin') = 'admin'");

    void Users()
    {
        router.Add("GET", "/api/users", r => Ok(new JsonArray(app.Db.Rows("SELECT * FROM users ORDER BY username COLLATE NOCASE").Select(u => (JsonNode)UserRow(u)).ToArray())), admin: true);
        router.Add("POST", "/api/users", r =>
        {
            var b = r.Json;
            var username = Str(b["username"], 40); var pw = Js.ToStr(b["password"]);
            var role = Js.AsString(b["role"]) is { } rl && Roles.ContainsKey(rl) ? rl : "operator";
            if (!Username().IsMatch(username)) return Bad("Usernames are 3 to 40 characters: letters, numbers, dot, dash, underscore or @.");
            if (app.Db.Row("SELECT id FROM users WHERE username = ?", username) is not null) return Bad("That username is already taken.");
            if (pw.Length < 8) return Bad("Use a temporary password of at least 8 characters.");
            app.Db.Exec("INSERT INTO users(username, password_hash, is_default_password, created_at, updated_at, role) VALUES (?, ?, 1, ?, ?, ?)", username, Passwords.Hash(pw), Now(), Now(), role);
            Log($"User added: {username}, {Roles[role].ToLowerInvariant()} (by {r.User.Username})");
            return Ok(UserRow(app.Db.Row("SELECT * FROM users WHERE username = ?", username)!));
        }, admin: true, limit: 10000);
        router.Add("PUT", "/api/users/:id", r =>
        {
            var t = long.TryParse(r.P["id"], out var id) ? app.Db.Row("SELECT * FROM users WHERE id = ?", id) : null;
            if (t is null) return Bad("User not found", 404);
            var b = r.Json; var tname = (string)t["username"]!;
            var newRole = Js.AsString(b["role"]);
            if (b.ContainsKey("role") && newRole != ((string?)t["role"] ?? "admin"))
            {
                if (newRole is null || !Roles.ContainsKey(newRole)) return Bad("Unknown role.");
                if (newRole != "admin" && AdminCount() <= 1) return Bad("There must always be at least one administrator.");
                app.Db.Exec("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", newRole, Now(), id);
                Log($"User {tname} is now {Roles[newRole].ToLowerInvariant()} (by {r.User.Username})");
            }
            if (b.ContainsKey("password"))
            {
                var pw = Js.ToStr(b["password"]);
                if (pw.Length < 8) return Bad("Use a temporary password of at least 8 characters.");
                app.Db.Tx(() =>
                {
                    app.Db.Exec("UPDATE users SET password_hash = ?, is_default_password = 1, updated_at = ? WHERE id = ?", Passwords.Hash(pw), Now(), id);
                    app.Db.Exec("DELETE FROM sessions WHERE user_id = ?", id);   // signed out everywhere
                });
                app.ClearFailures(tname);
                Log($"Password reset for {tname} (by {r.User.Username})");
            }
            return Ok(UserRow(app.Db.Row("SELECT * FROM users WHERE id = ?", id)!));
        }, admin: true, limit: 10000);
        router.Add("DELETE", "/api/users/:id", r =>
        {
            var t = long.TryParse(r.P["id"], out var id) ? app.Db.Row("SELECT * FROM users WHERE id = ?", id) : null;
            if (t is null) return Bad("User not found", 404);
            if (id == r.User.Id) return Bad("You can't delete the account you are signed in with.");
            if (((string?)t["role"] ?? "admin") == "admin" && AdminCount() <= 1) return Bad("There must always be at least one administrator.");
            app.Db.Exec("DELETE FROM users WHERE id = ?", id);   // their sessions go with it
            Log($"User deleted: {t["username"]} (by {r.User.Username})");
            return Ok();
        }, admin: true);
        // Stops the service and closes the program. Start it again from the desktop icon.
        router.Add("POST", "/api/service/stop", r => { app.RequestStop(r.User.Username); return Ok(); }, admin: true);
    }

    // ---------------- branding (public, so the sign-in page can show it) and the licence ----------------
    static JsonObject CleanTheme(JsonNode? t)
    {
        static bool Hex(JsonNode? v) => Js.AsString(v) is { } s && AppService.Hex().IsMatch(s);
        return new JsonObject
        {
            ["preset"] = Str(t?["preset"], 20) is { Length: > 0 } p ? p : "custom", ["primary"] = Hex(t?["primary"]) ? Js.AsString(t?["primary"]) : "#00529F",
            ["heading"] = Hex(t?["heading"]) ? Js.AsString(t?["heading"]) : "", ["sidebar"] = Js.AsString(t?["sidebar"]) == "brand" ? "brand" : "light",
        };
    }

    JsonObject BrandingJson() => new()
    {
        ["product"] = AppService.AppName, ["version"] = app.Version, ["copyright"] = AppService.Copyright, ["companyName"] = Js.ToStr(Config["companyName"]),
        ["logo"] = Js.AsString(Config["logoAsset"]) is { Length: > 0 } a ? $"/api/branding/logo?v={Uri.EscapeDataString(a)}" : null,
        ["theme"] = CleanTheme(Config["theme"]), ["licenseVersion"] = AppService.LicenseVersion,
    };

    JsonObject LicenseState()
    {
        var la = Config["licenseAccepted"];
        return new JsonObject
        {
            ["version"] = AppService.LicenseVersion, ["accepted"] = Js.AsString(la?["version"]) == AppService.LicenseVersion,
            ["acceptedBy"] = Js.AsString(la?["by"]), ["acceptedAt"] = Js.AsString(la?["at"]),
        };
    }

    static readonly string[] ImageTypes = ["image/png", "image/jpeg", "image/webp"];

    void Branding()
    {
        router.Add("GET", "/api/branding", r => Ok(BrandingJson()), isPublic: true);
        router.Add("GET", "/api/branding/logo", r =>
        {
            var a = Js.AsString(Config["logoAsset"]) is { } name ? app.Db.Row("SELECT mime, data FROM assets WHERE name = ?", name) : null;
            return a is null ? Bad("No logo", 404) : Reply.Bytes((byte[])a["data"]!, (string)a["mime"]!, new() { ["Cache-Control"] = "max-age=31536000, immutable" });
        }, isPublic: true);
        router.Add("POST", "/api/branding/logo", r =>
        {
            var mime = r.Header("Content-Type");
            if (mime is null || !ImageTypes.Contains(mime)) return Bad("Logos must be PNG, JPG or WebP images (up to 3 MB).");
            Config["logoAsset"] = app.PutAsset(r.Body, mime); app.SaveConfig(); Log($"Company logo changed (by {r.User.Username})");
            app.Broadcast("config", Config); return Ok(BrandingJson());
        }, limit: 3 * 1024 * 1024);
        router.Add("DELETE", "/api/branding/logo", r =>
        {
            Config["logoAsset"] = null; app.SaveConfig(); Log($"Company logo removed (by {r.User.Username})"); app.Broadcast("config", Config); return Ok(BrandingJson());
        });
        router.Add("POST", "/api/license/accept", r =>
        {
            Config["licenseAccepted"] = new JsonObject { ["version"] = AppService.LicenseVersion, ["by"] = r.User.Username, ["at"] = Now() }; app.SaveConfig();
            Log($"Licence version {AppService.LicenseVersion} accepted by {r.User.Username}"); return Ok(LicenseState());
        });
    }

    // ---------------- app state and live updates ----------------
    static string Platform => OperatingSystem.IsWindows() ? "win32" : OperatingSystem.IsMacOS() ? "darwin" : "linux";

    void State()
    {
        router.Add("GET", "/api/state", r =>
        {
            var fields = new JsonObject(); foreach (var (k, l) in AppService.FieldList) fields[k] = l;
            return Ok(new JsonObject
            {
                ["app"] = AppService.AppName, ["version"] = app.Version, ["copyright"] = AppService.Copyright, ["license"] = LicenseState(), ["branding"] = BrandingJson(),
                ["platform"] = Platform, ["dbFile"] = app.DbFile, ["simulator"] = app.HasSimulator,
                ["security"] = new JsonObject { ["cipher"] = "AES-256 (SQLCipher 4)", ["keyProtection"] = app.KeyProtection },
                ["user"] = UserInfo(r.User.Username, r.User.IsDefaultPassword, r.User.Role),
                ["fields"] = fields, ["config"] = Config.DeepClone(), ["designs"] = new JsonArray(app.Designs.Select(d => d.DeepClone()).ToArray()), ["clients"] = app.ListClients(),
                ["queue"] = app.PublicQueue(), ["printer"] = app.PrinterStatusNow.DeepClone(), ["worker"] = app.PublicWorker(), ["update"] = app.UpdateInfo(),
            });
        });
        router.Add("GET", "/api/events", async r =>
        {
            var client = new AppService.EventClient(r.User.TokenHash, Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true }));
            var first = await app.LockedAsync(() =>
            {
                app.AddClient(client);
                return AppService.EventText("printer", app.PrinterStatusNow) + AppService.EventText("worker", app.PublicWorker());
            });
            var res = r.Ctx.Response;
            res.StatusCode = 200;
            res.Headers["X-Content-Type-Options"] = "nosniff"; res.Headers["X-Frame-Options"] = "DENY"; res.Headers["Referrer-Policy"] = "no-referrer";
            res.Headers.CacheControl = "no-store"; res.ContentType = "text/event-stream";
            var ct = r.Ctx.RequestAborted;
            try
            {
                await res.WriteAsync("retry: 2000\n\n" + first, ct);
                await res.Body.FlushAsync(ct);
                await foreach (var msg in client.Channel.Reader.ReadAllAsync(ct))
                {
                    await res.WriteAsync(msg, ct);
                    await res.Body.FlushAsync(ct);
                }
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
            finally { await app.LockedAsync(() => app.RemoveClient(client)); }
            return Reply.Ok();
        }, unlocked: true, raw: true);
    }

    // ---------------- settings and printers ----------------
    static readonly string[] Protected = ["logoAsset", "licenseAccepted", "backMethodChosen", "port", "pollMs", "customFields", "autoBackup"];

    void Settings()
    {
        router.Add("PUT", "/api/config", r =>
        {
            var body = r.Json;
            var before = (JsonObject)Config.DeepClone();
            foreach (var k in AppService.ConfigKeys) if (body.ContainsKey(k) && !Protected.Contains(k) && (app.HasSimulator || k is not ("simulate" or "simSeconds"))) Config[k] = body[k]?.DeepClone();
            Config["theme"] = CleanTheme(Config["theme"]);
            Config["companyName"] = Str(Config["companyName"], 80);
            Config["simSeconds"] = Js.NumNode(Math.Max(2, Math.Min(120, Js.NumOr(Config["simSeconds"], 6))));
            Config["delayBetweenCards"] = Js.NumNode(Math.Max(0, Math.Min(600, Js.NumOr(Config["delayBetweenCards"], 0))));
            Config["jobTimeoutMin"] = Js.NumNode(Math.Max(1, Math.Min(120, Js.NumOr(Config["jobTimeoutMin"], 10))));
            Config["sessionIdleMin"] = Js.NumNode(Math.Max(5, Math.Min(1440, Math.Round(Js.NumOr(Config["sessionIdleMin"], 120), MidpointRounding.AwayFromZero))));
            Config["enhancePhotos"] = Js.Truthy(Config["enhancePhotos"]); Config["alignFaces"] = Js.Truthy(Config["alignFaces"]);
            if (Js.AsString(Config["cardSides"]) is not ("single" or "dual")) Config["cardSides"] = "dual";
            if (Js.AsString(Config["backMethod"]) is not ("auto" or "manual")) Config["backMethod"] = "auto";
            if (body.ContainsKey("backMethod")) Config["backMethodChosen"] = true;
            Config["defaultSides"] = Js.AsString(Config["cardSides"]) == "single" ? "front" : Js.AsString(Config["backMethod"]) == "manual" ? "front" : "both";
            Config["ribbonLowPercent"] = Js.NumNode(Math.Max(0, Math.Min(90, Math.Round(Js.NumOr(Config["ribbonLowPercent"], 0), MidpointRounding.AwayFromZero))));
            Config["filmLowPercent"] = Js.NumNode(Math.Max(0, Math.Min(90, Math.Round(Js.NumOr(Config["filmLowPercent"], 0), MidpointRounding.AwayFromZero))));
            app.SaveConfig();
            if (Js.Truthy(before["simulate"]) != Js.Truthy(Config["simulate"]) || Js.ToStr(before["printerName"]) != Js.ToStr(Config["printerName"]) || Js.ToStr(before["pollMs"]) != Js.ToStr(Config["pollMs"]))
            {
                app.ResetAlerts(); app.MakePrinter();
            }
            app.Broadcast("config", Config); return Ok(Config.DeepClone());
        });
        router.Add("GET", "/api/printers", async r =>
        {
            var printer = await app.LockedAsync(() => app.Printer);
            var list = await printer.ListPrintersAsync();
            return Ok(new JsonArray(list.Select(p => (JsonNode)new JsonObject { ["name"] = p.Name, ["driver"] = p.Driver, ["port"] = p.Port, ["isDefault"] = p.IsDefault, ["offline"] = p.Offline }).ToArray()));
        }, unlocked: true);
        router.Add("POST", "/api/printer/preferences", r => { app.Printer.OpenPreferences(); return Ok(); });
        router.Add("POST", "/api/printer/queue", r => { app.Printer.OpenQueue(); return Ok(); });
        if (app.HasSimulator)   // development host only
            router.Add("POST", "/api/printer/simulate", r => { if (app.Printer is ISimulatedPrinter s) s.SetCondition(Js.AsString(r.Json["condition"])); return Ok(); }, admin: true);
        router.Add("GET", "/api/printer/events", r => Ok(Rows("SELECT ts, type, code, level, title FROM printer_events ORDER BY id DESC LIMIT 300")));
    }

    JsonArray Rows(string sql, params object?[] args) => new(app.Db.Rows(sql, args).Select(x => (JsonNode)Js.Row(x)).ToArray());

    static string Utf8(byte[] b) => Encoding.UTF8.GetString(b);
}
