// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Automatic backups and restoring a backup.
using System.Text.Json.Nodes;
using IdCard.Data;

namespace IdCard.Service;

public sealed partial class AppService
{
    internal string KeyProtection => _o.KeyProtection;

    internal string AutoPassword() => (string?)Db.Row("SELECT value FROM meta WHERE key = ?", "autobackup_password")?["value"] ?? "";

    internal JsonObject? AutoState() => Js.Parse((string?)Db.Row("SELECT value FROM meta WHERE key = ?", "autobackup_last")?["value"]) as JsonObject;

    void SetAutoState(JsonObject v) => Db.Exec("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", "autobackup_last", Js.Stringify(v));

    bool _autoBackupRunning;

    /// <summary>Writes an automatic backup. The copy runs off the gate (a slow or missing network folder
    /// mustn't hold up printing); its own connection reads a consistent snapshot of the database.</summary>
    internal async Task<JsonObject?> AutoBackupNow(string? by = null)
    {
        var job = await LockedAsync(() =>
        {
            if (_disposed || _autoBackupRunning) return null;
            _autoBackupRunning = true;
            return new { Folder = Js.ToStr(AutoBackupCfg["folder"]), Keep = (int)Js.NumOr(AutoBackupCfg["keep"], 14), Password = AutoPassword(), Prev = Js.AsString(AutoState()?["lastOk"]) };
        });
        if (job is null) return await LockedAsync(AutoState);
        string? file = null, error = null;
        try { file = await Task.Run(() => AutoBackup.Run(job.Folder, job.Keep, Xfer, tmp => Db.ExportBackup(tmp, DbFile, DbKey, job.Password, AppId))); }
        catch (Exception e) { error = e.Message; }
        return await LockedAsync(() =>
        {
            _autoBackupRunning = false;
            if (_disposed) return null;
            var at = Js.Now();
            if (error is null)
            {
                SetAutoState(new JsonObject { ["at"] = at, ["ok"] = true, ["file"] = file, ["lastOk"] = at });
                Log($"Automatic backup saved: {file}{(by is not null ? $" (by {by})" : "")}");
            }
            else
            {
                SetAutoState(new JsonObject { ["at"] = at, ["ok"] = false, ["error"] = error, ["lastOk"] = job.Prev });
                Log($"Automatic backup failed: {error}");
            }
            return AutoState();
        });
    }

    async Task AutoBackupTick()
    {
        var due = await LockedAsync(() =>
        {
            if (_disposed || !Js.Truthy(AutoBackupCfg["enabled"]) || _worker.Current is not null || AutoPassword().Length == 0) return false;
            var s = AutoState();
            var last = s is null ? null : new AutoBackup.Last(Js.ToStr(s["at"]), Js.Truthy(s["ok"]), Js.AsString(s["file"]), Js.AsString(s["error"]), Js.AsString(s["lastOk"]));
            return AutoBackup.Due(true, Js.ToStr(AutoBackupCfg["every"]), last, DateTime.UtcNow);
        });
        if (due) await AutoBackupNow();
    }

    /// <summary>Replaces everything with the backup. Everyone signs in again, as the restored users.</summary>
    internal void Restore(string file, string password)
    {
        var port = Config["port"]?.DeepClone();
        Db.RestoreBackup(file, password, [AppId]);
        Db.Exec("DELETE FROM sessions");
        LoadAll(); Config["port"] = port; SaveConfig();
        ResetAlerts(); MakePrinter();
        CloseClients();
    }
}
