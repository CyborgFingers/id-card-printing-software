// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Up to 3.0.11 each Windows account had its own database, so another account (or a temporary Windows profile)
// started with an empty one. Now every account on the PC shares one database; this brings an account's own
// database into it the first time that account runs the print service.
using IdCard.Data;

namespace IdCard.Service;

public static class MoveData
{
    /// <summary>What a database holds. Untouched (Total 0) means nothing was ever made in it and its sign-in was never changed.</summary>
    public sealed record Contents(long Templates, long Clients, long People, long Printed, long Other)
    {
        public long Total => Templates + Clients + People + Printed + Other;
        public override string ToString() => $"{Templates:N0} templates, {Clients:N0} clients, {People:N0} people and {Printed:N0} printed cards";
    }

    /// <summary>Brings the account's database (oldDir, encrypted with oldKey) into the shared folder, re-encrypted with
    /// the shared key, when there is no shared database yet, or the shared one is untouched, or both have data and
    /// preferAccount (asked with the account's and the shared contents) says so. A shared database replaced that way is
    /// kept beside it. Either way the account's database is then renamed, so it's looked at only once; nothing is
    /// deleted. Returns what happened (also written to the program's log), or null when the account has no database.</summary>
    public static string? FromAccount(string oldDir, string oldKey, string dataDir, Func<bool, string> sharedKey, Func<Contents, Contents, bool> preferAccount)
    {
        string oldFile = Path.Combine(oldDir, AppService.DbFileName), file = Path.Combine(dataDir, AppService.DbFileName);
        if (!File.Exists(oldFile)) return null;
        var mine = Read(oldFile, oldKey);
        var shared = File.Exists(file) ? Read(file, sharedKey(false)) : null;
        var bring = shared is null || (mine.Total > 0 && (shared.Total == 0 || preferAccount(mine, shared)));
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        if (bring)
        {
            var tmp = file + ".new";
            Db.ExportBackup(tmp, oldFile, oldKey, sharedKey(shared is null), AppService.AppId);
            if (shared is not null) Rename(file, $"{file}.replaced-{stamp}");
            File.Move(tmp, file);
        }
        Rename(oldFile, $"{oldFile}.old-{stamp}");
        var what = bring
            ? $"Data from the Windows account {Environment.UserName} ({mine}) was moved into the shared data folder" + (shared is null ? "" : $"; the shared data it replaced is kept at {file}.replaced-{stamp}")
            : $"The Windows account {Environment.UserName} also had its own older data ({mine}); the shared data was kept, and that copy is at {oldFile}.old-{stamp}";
        using (var db = Db.Open(file, sharedKey(false), AppService.AppId))
            db.Exec("INSERT INTO app_log(ts, level, message) VALUES (?, ?, ?)", Js.Now(), bring ? "info" : "warning", what);
        return what;
    }

    static Contents Read(string file, string key)
    {
        using var db = Db.Open(file, key, AppService.AppId);
        long N(string sql) => db.Count(sql);
        return new(N("SELECT COUNT(*) FROM designs"), N("SELECT COUNT(*) FROM clients"), N("SELECT COUNT(*) FROM people"), N("SELECT COUNT(*) FROM print_history"),
            N("SELECT COUNT(*) FROM batches") + N("SELECT COUNT(*) FROM users WHERE NOT (username = 'admin' COLLATE NOCASE AND is_default_password = 1)"));
    }

    static void Rename(string file, string to)
    {
        foreach (var s in new[] { "", "-wal", "-shm" }) if (File.Exists(file + s)) File.Move(file + s, to + s);
    }
}
