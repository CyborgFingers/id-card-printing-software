// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// Backups: a password is optional. Without one the file still isn't an ordinary database anything can open, and
// restores without being asked; with one, only that password opens it.
using IdCard.Data;
using IdCard.Printing;
using IdCard.Service;

namespace IdCard.Tests;

public sealed class BackupTests : IDisposable
{
    readonly string _dir = Directory.CreateTempSubdirectory("idcard-backup-").FullName;
    public void Dispose() { try { Directory.Delete(_dir, true); } catch (IOException) { } }

    AppService Start() => new(new ServiceOptions { DataDir = _dir, WebRoot = _dir, GetDbKey = _ => "backup-test-key", KeyProtection = "test", Simulator = _ => new NoPrinter(), Version = "3.0.17" });

    [Fact]
    public void A_backup_without_a_password_restores_without_one_and_a_backup_with_one_needs_it()
    {
        using var a = Start();
        a.Locked(() => a.Db.Exec("INSERT INTO clients(id, name) VALUES ('c1', 'Example Company')"));
        string open = Path.Combine(_dir, "open.bak"), locked = Path.Combine(_dir, "locked.bak");
        a.Locked(() => { Db.ExportBackup(open, a.DbFile, a.DbKey, "", AppService.AppId); Db.ExportBackup(locked, a.DbFile, a.DbKey, "backup-password", AppService.AppId); });

        Assert.Equal(1, Db.InspectBackup(open, "", [AppService.AppId]).Clients);
        Assert.Equal(1, Db.InspectBackup(locked, "backup-password", [AppService.AppId]).Clients);
        Assert.Throws<InvalidOperationException>(() => Db.InspectBackup(locked, "", [AppService.AppId]));             // asks for the password
        Assert.Throws<InvalidOperationException>(() => Db.InspectBackup(locked, "wrong-password", [AppService.AppId]));
        foreach (var f in new[] { open, locked })
        {
            var bytes = File.ReadAllBytes(f);
            Assert.False(bytes.AsSpan().StartsWith("SQLite format 3\0"u8));   // not readable as a plain database
            Assert.Equal(-1, bytes.AsSpan().IndexOf("Example Company"u8));
        }
    }

    sealed class NoPrinter : IPrinter
    {
        public event Action<PrinterRaw?>? StatusChanged { add { } remove { } }
        public PrinterRaw? Latest => null;
        public void Restart() { }
        public void Stop() { }
        public Task<PrintResult> PrintAsync(PrintJob job, CancellationToken ct = default) => Task.FromResult(new PrintResult(false, Error: "No printer in tests"));
        public Task CancelJobAsync(string docName) => Task.CompletedTask;
        public Task<IReadOnlyList<PrinterInfo>> ListPrintersAsync() => Task.FromResult<IReadOnlyList<PrinterInfo>>([]);
        public void OpenPreferences() { }
        public void OpenQueue() { }
        public void Dispose() { }
    }
}
