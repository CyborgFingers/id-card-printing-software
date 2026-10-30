// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// An update changes only what it's for: starting a newer version keeps every setting and all the data.
using System.Text.Json.Nodes;
using IdCard.Printing;
using IdCard.Service;

namespace IdCard.Tests;

public sealed class UpdateKeepsDataTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "idcard-update-" + Guid.NewGuid().ToString("N"));
    public void Dispose() { try { Directory.Delete(_dir, true); } catch (IOException) { } }

    AppService Start(string version) => new(new ServiceOptions { DataDir = _dir, WebRoot = _dir, GetDbKey = _ => "update-test-key", KeyProtection = "test", Simulator = _ => new NoPrinter(), Version = version });

    static string Settings(AppService a) => a.Locked(() => string.Join("\n", a.Db.Rows("SELECT key, value FROM settings ORDER BY key").Select(r => $"{r["key"]}={r["value"]}")));
    static string Data(AppService a) => a.Locked(() => string.Join("\n", new[] { "clients", "people", "designs", "users", "print_history" }
        .Select(t => $"{t}: " + string.Join(", ", a.Db.Rows($"SELECT * FROM {t} ORDER BY rowid").Select(r => string.Join("|", r.Values.Select(v => v is byte[] b ? Convert.ToBase64String(b) : $"{v}")))))));

    [Fact]
    public void Starting_a_newer_version_keeps_every_setting_and_all_data()
    {
        string settings, data;
        using (var a = Start("3.0.13"))
        {
            a.Locked(() =>
            {
                a.Config["companyName"] = "Example Company"; a.Config["delayBetweenCards"] = 4; a.Config["printAuto"] = false;
                a.SaveConfig();
                a.Db.Exec("DELETE FROM settings WHERE key = 'jobTimeoutMin'");   // one never saved, as on an install that never changed it
                a.Db.Exec("INSERT INTO clients(id, name) VALUES ('c1', 'Example Company')");
                a.Db.Exec("INSERT INTO people(id, client_id, first_name, last_name, position, photo, photo_mime) VALUES ('p1', 'c1', 'Jane', 'Doe', 'Driver', ?, 'image/jpeg')", new byte[] { 1, 2, 3 });
                a.Db.Exec("INSERT INTO designs(id, name, data, position) VALUES ('d1', 'Staff card', ?, 0)", """{"id":"d1","name":"Staff card","card":{"w":638,"h":1013},"elements":[]}""");
                a.Db.Exec("INSERT INTO print_history(ts, client_id, first_name, last_name, status) VALUES ('2026-10-30T00:00:00Z', 'c1', 'Jane', 'Doe', 'printed')");
            });
            data = Data(a);
        }
        using (var b = Start("3.0.14"))
        {
            settings = Settings(b);
            Assert.Contains("jobTimeoutMin=10", settings);   // written down as it was, so a later default can't change it
            Assert.Contains("companyName=\"Example Company\"", settings);
            Assert.Contains("printAuto=false", settings);
            Assert.Equal(data, Data(b));
            Assert.Equal(b.Locked(() => b.Config.Select(kv => kv.Key).Order()), settings.Split('\n').Select(l => l.Split('=')[0]).Order());   // every setting is saved
        }
        using var c = Start("3.0.15");
        Assert.Equal(settings, Settings(c));
        Assert.Equal(data, Data(c));
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
