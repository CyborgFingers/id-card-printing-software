// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Automatic backups to a folder (USB drive, NAS share or a synced folder). Each file is the whole
// database encrypted with the automatic-backup password, the same format as a manual backup.
using System.Text.RegularExpressions;

namespace IdCard.Service;

internal static class AutoBackup
{
    /// <summary>Named per PC, so pruning never touches manual backups or another PC's backups in a shared folder.</summary>
    public static readonly string Prefix = "ID-Card-Printing-Software-Auto-Backup-" + PcName() + "-";
    public static readonly Dictionary<string, TimeSpan> Periods = new() { ["daily"] = TimeSpan.FromDays(1), ["weekly"] = TimeSpan.FromDays(7) };

    static string PcName() { var n = Regex.Replace(Environment.MachineName, @"[^\w-]+", ""); return n.Length > 0 ? n : "PC"; }

    /// <summary>Throws a plain-English error unless folder is an existing folder this account can write to.</summary>
    public static void CheckFolder(string folder)
    {
        if (string.IsNullOrEmpty(folder) || !Path.IsPathFullyQualified(folder)) throw new InvalidOperationException(@"Enter the full path of a folder, for example D:\Backups or \\server\share\Backups.");
        if (!Directory.Exists(folder)) throw new InvalidOperationException("That folder does not exist or can't be reached.");
        var probe = Path.Combine(folder, $".id-card-write-test-{Environment.ProcessId}");
        try { File.WriteAllBytes(probe, []); File.Delete(probe); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { throw new InvalidOperationException("This PC can't save files in that folder."); }
    }

    public sealed record Last(string At, bool Ok, string? File, string? Error, string? LastOk);

    public static bool Due(bool enabled, string every, Last? last, DateTime now)
    {
        if (!enabled) return false;
        if (last is { Ok: false } && Js.ParseIso(last.At) is { } at && now - at < TimeSpan.FromHours(1)) return false;   // after a failure, try again in an hour
        var ok = last?.LastOk is { } lo && Js.ParseIso(lo) is { } t ? t : DateTime.MinValue;
        return now - ok >= (Periods.TryGetValue(every, out var p) ? p : Periods["daily"]);
    }

    /// <summary>Writes one backup (via the private xfer folder) and keeps only the newest keep files.</summary>
    public static string Run(string folder, int keep, string xfer, Action<string> write)
    {
        CheckFolder(folder);
        var name = $"{Prefix}{DateTime.UtcNow:yyyy-MM-dd-HH-mm-ss}.bak";
        var tmp = Path.Combine(xfer, $"auto-{Environment.ProcessId}.db");
        try { write(tmp); File.Copy(tmp, Path.Combine(folder, name), overwrite: true); }
        finally { Data.Db.DeleteWithJournals(tmp); }
        var mine = new Regex($@"^{Regex.Escape(Prefix)}\d{{4}}(-\d\d){{5}}\.(bak|idcbak)$");   // .idcbak: made before 3.0.17
        var old = Directory.GetFiles(folder).Select(Path.GetFileName).Where(f => f is not null && mine.IsMatch(f)).Order(StringComparer.Ordinal).ToList();
        foreach (var f in old.Take(Math.Max(0, old.Count - keep))) { try { File.Delete(Path.Combine(folder, f!)); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
        return name;
    }
}
