// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Print history, logs, import templates, backups (manual and automatic), restore and updates.
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using IdCard.Data;
using IdCard.Service;

namespace IdCard.Http;

internal sealed partial class Routes
{
    /// <summary>Filters: q, status, from, to (yyyy-mm-dd, local time), clientId.</summary>
    static (string Sql, List<object?> Args, string? ClientId) HistoryWhere(Req r)
    {
        var w = new List<string>(); var a = new List<object?>();
        var q = (r.Query("q") ?? "").Trim();
        if (q.Length > 0) { w.Add("(IFNULL(first_name, '') || ' ' || IFNULL(last_name, '') || ' ' || IFNULL(batch, '') || ' ' || IFNULL(operator, '') || ' ' || IFNULL(client_name, '')) LIKE ?"); a.Add($"%{q}%"); }
        var st = r.Query("status"); if (!string.IsNullOrEmpty(st) && st != "all") { w.Add("status = ?"); a.Add(st); }
        var cl = r.Query("clientId"); if (!string.IsNullOrEmpty(cl)) { w.Add("client_id = ?"); a.Add(cl); }
        if (LocalDay(r.Query("from")) is { } from) { w.Add("ts >= ?"); a.Add(Js.Iso(from)); }
        if (LocalDay(r.Query("to")) is { } to) { w.Add("ts < ?"); a.Add(Js.Iso(to.AddDays(1))); }   // local midnight after that day
        return (w.Count > 0 ? "WHERE " + string.Join(" AND ", w) : "", a, string.IsNullOrEmpty(cl) ? null : cl);
    }

    /// <summary>Local midnight at the start of a yyyy-mm-dd day (Js.Iso converts it to UTC).</summary>
    static DateTime? LocalDay(string? s) =>
        DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var d) ? DateTime.SpecifyKind(d, DateTimeKind.Local) : null;

    static int Limit(Req r) => int.TryParse(r.Query("limit"), out var n) && n > 0 ? Math.Min(5000, n) : 1000;

    void History()
    {
        router.Add("GET", "/api/history", r =>
        {
            var (sql, args, clientId) = HistoryWhere(r);
            var rows = Rows($"SELECT {HistCols} FROM print_history {sql} ORDER BY id DESC LIMIT {Limit(r)}", [.. args]);
            var total = app.Db.Count($"SELECT COUNT(*) FROM print_history {sql}", [.. args]);
            // Cards, not passes: the backs pass of a flipped card is the same card as its front.
            var scope = clientId is not null ? " AND client_id = ?" : "";
            long Since(DateTime local) => app.Db.Count($"SELECT COUNT(*) FROM print_history WHERE status = 'printed' AND IFNULL(sides, 'both') != 'back' AND ts >= ?{scope}",
                clientId is not null ? [Js.Iso(local.ToUniversalTime()), clientId] : [Js.Iso(local.ToUniversalTime())]);
            var today = DateTime.Today;
            var week = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
            var month = new DateTime(today.Year, today.Month, 1, 0, 0, 0, DateTimeKind.Local);
            var matched = new JsonObject();
            foreach (var m in app.Db.Rows($"SELECT status, COUNT(*) AS n FROM print_history {sql} GROUP BY status", [.. args])) matched[(string?)m["status"] ?? "null"] = Js.Node(m["n"]);
            return Ok(new JsonObject
            {
                ["rows"] = rows, ["total"] = total,
                ["summary"] = new JsonObject { ["today"] = Since(today), ["week"] = Since(week), ["month"] = Since(month), ["all"] = Since(DateTime.UnixEpoch.ToLocalTime()), ["matched"] = matched },
            });
        });
        router.Add("GET", "/api/history.csv", r =>
        {
            var (sql, args, _) = HistoryWhere(r);
            var head = new[] { "Date", "Time", "Client", "First Name", "Last Name", "Result", "Sides", "Batch", "Template", "Printer", "Operator", "Ribbon %", "Film %", "Note" };
            var lines = new List<IEnumerable<string>> { head };
            foreach (var h in app.Db.Rows($"SELECT {HistCols} FROM print_history {sql} ORDER BY id DESC", [.. args]))
            {
                var ts = Js.ParseIso((string?)h["ts"]) ?? DateTime.UnixEpoch;
                string S(string k) => h[k] switch { null => "", var v => Convert.ToString(v, CultureInfo.InvariantCulture) ?? "" };
                var sides = (string?)h["sides"] switch { "both" => "Dual-sided", "front" => "Front", "back" => "Back", _ => "" };
                lines.Add([NzDate(ts), NzTime(ts), S("clientName"), S("firstName"), S("lastName"), S("status"), sides, S("batch"), S("design"), S("printer"), S("operator"), S("ribbon"), S("film"), S("note")]);
            }
            return Csv(lines, $"ID-Card-Print-History-{DateTime.UtcNow:yyyy-MM-dd}.csv", trailingNewline: false);
        });
        router.Add("GET", "/api/logs", r =>
        {
            var printer = r.Query("kind") == "printer";
            if (!printer && !r.User.IsAdmin) return Bad("Only an administrator can do that.", 403);   // includes sign-in attempts
            var level = r.Query("level"); var limit = Limit(r);
            if (printer) return Ok(Rows($"SELECT ts, type, code, level, title, detail FROM printer_events ORDER BY id DESC LIMIT {limit}"));
            return Ok(!string.IsNullOrEmpty(level) && level != "all"
                ? Rows($"SELECT ts, level, message FROM app_log WHERE level = ? ORDER BY id DESC LIMIT {limit}", level)
                : Rows($"SELECT ts, level, message FROM app_log ORDER BY id DESC LIMIT {limit}"));
        });
        // Blank CSV for importing people. For a client, its columns match the fields its templates use.
        router.Add("GET", "/api/bulk-template.csv", r =>
        {
            var c = app.ClientRow(r.Query("clientId") ?? "");
            var used = new HashSet<string> { "firstName", "lastName", "photo" };
            var custom = app.CustomFields.OfType<JsonObject>().ToList();
            var designs = c is null ? [] : app.AssignmentsByClient().GetValueOrDefault((string)c["id"]!, []).Select(app.FindDesign).OfType<JsonObject>().ToList();
            if (designs.Count > 0) foreach (var d in designs) used.UnionWith(app.DesignFields(d));
            else { used.UnionWith(AppService.PersonFields); used.UnionWith(custom.Select(f => Js.ToStr(f["key"]))); }   // no template yet: every detail
            var cols = AppService.PersonFields.Where(used.Contains).Select(f => AppService.CsvHeaders[f])
                .Concat(custom.Where(f => used.Contains(Js.ToStr(f["key"]))).Select(f => Js.ToStr(f["label"])));   // photos match by name: no ID Photo column
            var fname = c is not null ? $"{FileNamePart((string)c["name"]!)} - Import Template.csv" : "ID-Card-Import-Template.csv";
            return Csv([cols], fname);
        });
    }

    // ---------------- backups (encrypted with a backup password so they can move to another PC) ----------------
    void Backups()
    {
        router.Add("POST", "/api/backup", r =>
        {
            var pw = Js.ToStr(r.Json["password"]);
            if (pw.Length < 8) return Bad("Use a backup password of at least 8 characters.");
            var tmp = Path.Combine(app.Xfer, $"backup-{Js.Uid(8)}.db");
            try
            {
                Db.ExportBackup(tmp, app.DbFile, app.DbKey, pw, AppService.AppId);
                var buf = File.ReadAllBytes(tmp);
                Log($"Backup downloaded by {r.User.Username}");
                return Reply.Bytes(buf, "application/octet-stream", new() { ["Content-Disposition"] = $"attachment; filename=\"ID-Card-Printing-Software-Backup-{DateTime.UtcNow:yyyy-MM-dd}.idcbak\"" });
            }
            finally { Db.DeleteWithJournals(tmp); }
        }, limit: 10000);

        // Automatic backups to a folder (the password is kept in the encrypted database, never sent to the screens).
        router.Add("GET", "/api/autobackup", r => Ok(AutoBackupJson()), admin: true);
        router.Add("PUT", "/api/autobackup", r =>
        {
            var b = r.Json;
            var every = Js.AsString(b["every"]) is { } e && AutoBackup.Periods.ContainsKey(e) ? e : "daily";
            var next = new JsonObject
            {
                ["enabled"] = Js.Truthy(b["enabled"]), ["folder"] = Str(b["folder"], 260), ["every"] = every,
                ["keep"] = (long)Math.Max(1, Math.Min(365, Math.Round(Js.NumOr(b["keep"], 14), MidpointRounding.AwayFromZero))),
            };
            var pw = b.ContainsKey("password") ? Js.ToStr(b["password"]) : null;
            if (pw is not null && pw.Length < 8) return Bad("Use a backup password of at least 8 characters.");
            if (Js.Truthy(next["enabled"]))
            {
                if (app.AutoPassword().Length == 0 && string.IsNullOrEmpty(pw)) return Bad("Choose a password for the automatic backups.");
                try { AutoBackup.CheckFolder(Js.ToStr(next["folder"])); } catch (InvalidOperationException ex) { return Bad(ex.Message); }
            }
            if (!string.IsNullOrEmpty(pw)) app.Db.Exec("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", "autobackup_password", pw);
            Config["autoBackup"] = next; app.SaveConfig();
            Log($"Automatic backups {(Js.Truthy(next["enabled"]) ? $"on: {every} to {Js.ToStr(next["folder"])}, keeping {Js.ToStr(next["keep"])}" : "off")} (by {r.User.Username})");
            return Ok(AutoBackupJson());
        }, admin: true, limit: 10000);
        router.Add("POST", "/api/autobackup/run", async r =>
        {
            if (await app.LockedAsync(() => app.AutoPassword().Length == 0 || Js.ToStr(app.AutoBackupCfg["folder"]).Length == 0)) return Bad("Set up automatic backups first.");
            return Ok(await app.AutoBackupNow(r.User.Username));
        }, admin: true, unlocked: true);

        router.Add("POST", "/api/restore", async r =>
        {
            string pw;
            try { pw = Encoding.UTF8.GetString(Convert.FromBase64String(r.Header("X-Backup-Password") ?? "")); } catch (FormatException) { pw = ""; }
            if (pw.Length == 0) return Bad("Enter the backup password.");
            var tmp = Path.Combine(app.Xfer, $"restore-{Js.Uid(8)}.db");
            try
            {
                await using var file = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write);
                await Router.CopyBody(r.Ctx.Request, file, RestoreLimit);
            }
            catch { Db.DeleteWithJournals(tmp); throw; }
            try
            {
                return await app.LockedAsync(() =>
                {
                    if (app._worker.Current is not null) return Bad("A card is printing. Wait for it to finish, then restore.");   // checked after the upload, which can take a while
                    Db.BackupInfo info;
                    try { info = Db.InspectBackup(tmp, pw, [AppService.AppId]); } catch (InvalidOperationException ex) { return Bad(ex.Message); }
                    app.Restore(tmp, pw);
                    Log($"Backup restored by {r.User.Username}: {info.Clients} client(s), {info.People} people, {info.History} history record(s)");
                    return Reply.Json(new JsonObject { ["clients"] = info.Clients, ["people"] = info.People, ["history"] = info.History, ["queued"] = info.Queued }, 200, new() { ["Set-Cookie"] = ClearCookie });
                });
            }
            finally { Db.DeleteWithJournals(tmp); }
        }, unlocked: true, limit: Router.StreamedBody);

        // Updates (from the project's releases on GitHub)
        router.Add("POST", "/api/update/check", async r => Ok(await app.CheckForUpdate(force: true)), unlocked: true, admin: true);
        router.Add("POST", "/api/update/install", async r =>
        {
            var error = await app.InstallUpdate(r.User.Username);
            return error is null ? Ok() : Bad(error);
        }, unlocked: true, admin: true);
    }

    const long RestoreLimit = 4L * 1024 * 1024 * 1024;

    JsonObject AutoBackupJson()
    {
        var o = (JsonObject)app.AutoBackupCfg.DeepClone();
        o["hasPassword"] = app.AutoPassword().Length > 0; o["last"] = app.AutoState();
        return o;
    }
}
