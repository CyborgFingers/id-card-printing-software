// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// A simulated card printer, so the app can be tried (and tested) without one.
using System.Globalization;

namespace IdCard.Printing;

public sealed class SimPrinter(Func<PrinterSettingsSnapshot> settings) : IPrinter
{
    sealed class Job { public int Id; public string Document = ""; public DateTime Created; public int Pages; public string Status = "Spooling"; public double PausedForMs; public bool Done; }

    static readonly string[] ErrorConditions = ["ribbon-out", "cards-out", "jam", "door", "offline", "attention"];
    readonly Lock _lock = new();
    List<Job> _jobs = [];
    int _nextId = 100;
    string? _condition;
    Timer? _timer;
    double _ribbon = 69.4, _film = 90.2;
    int _cards = 542;

    public event Action<PrinterRaw?>? StatusChanged;
    public PrinterRaw? Latest { get; private set; }

    public void Restart() { _timer?.Dispose(); _timer = new Timer(_ => Tick(), null, 0, 1000); }
    public void Stop() { _timer?.Dispose(); _timer = null; }
    public void Dispose() => Stop();

    public void SetCondition(string? c) { _condition = string.IsNullOrEmpty(c) ? null : c; Tick(); }

    void Tick()
    {
        PrinterRaw raw;
        lock (_lock)
        {
            var now = DateTime.UtcNow; var secs = Math.Max(1, settings().SimSeconds) * 1000.0;
            var errorCond = _condition is not null && ErrorConditions.Contains(_condition);
            foreach (var j in _jobs)
            {
                if (errorCond) { j.Status = "Error | Printing"; j.PausedForMs += 1000; continue; }
                var age = (now - j.Created).TotalMilliseconds - j.PausedForMs;
                j.Status = age < 800 ? "Spooling" : "Printing";
                if (age > secs) { j.Done = true; _ribbon = Math.Max(0, _ribbon - 0.2); _film = Math.Max(0, _film - 0.07); _cards++; }
            }
            _jobs = _jobs.Where(j => !j.Done).ToList();
            var des = _condition switch { "ribbon-out" => 6, "ribbon-low" => 5, "cards-out" => 4, "cards-low" => 3, "jam" => 8, "door" => 7, "attention" => 10, _ => 2 };
            var ribbon = _condition == "ribbon-out" ? 0 : _condition == "ribbon-low" ? 6 : (int)Math.Floor(_ribbon);
            raw = new PrinterRaw
            {
                Ts = DateTimeOffset.UtcNow, Found = true, PrinterStatus = _condition == "offline" ? 7 : _jobs.Count > 0 ? 4 : 3,
                DetectedErrorState = des, WorkOffline = _condition == "offline", PortName = "USB001 (simulated)", DriverName = "Simulated HID FARGO HDP5000", Dpi = 300,
                StatusText = _condition == "offline" ? "Offline" : _jobs.Count > 0 ? "Printing" : "Normal",
                Jobs = _jobs.Select(j => new RawJob(j.Id, j.Document, j.Status, 0, 0, j.Pages)).ToList(),
                Fargo = new()
                {
                    ["RibbonInfo"] = $"PartNumber=84051;OEMPartNumber=84051;Grade=0;Type=18;Material=0;PercentRemaining={ribbon};0;",
                    ["FilmInfo"] = $"PartNumber=84053;OEMPartNumber=84053;Grade=0;Type=1;Material=2;PercentRemaining={(int)Math.Floor(_film)};0;",
                    ["CardCount"] = _cards.ToString(CultureInfo.InvariantCulture), ["PrinterStatus"] = "-1", ["PrinterError"] = "20", ["DeviceError"] = "14",
                    ["ConfigInfo"] = "DualHopper=0;LamModule=0;FlipperModule=0;MagModule=0;SecureMark=0;SmartCard=0;",
                    ["ConfigInfoDriver"] = "FlipperModule=0;LamModule=0;MagModule=0;DualHopper=0;IOHopper=1;LaserEngraver=1;",
                },
            };
            Latest = raw;
        }
        StatusChanged?.Invoke(raw);
    }

    public async Task<PrintResult> PrintAsync(PrintJob job, CancellationToken ct = default)
    {
        await Task.Delay(400, ct);
        if (_condition == "offline") return new PrintResult(false, Error: "The printer is offline (simulated).");
        lock (_lock) _jobs.Add(new Job { Id = _nextId++, Document = job.DocName, Created = DateTime.UtcNow, Pages = job.Back is null ? 1 : 2 });
        Tick();
        return new PrintResult(true, Info: $"simulated;paper={job.Size.Name};duplex=on");
    }

    public Task CancelJobAsync(string docName) { lock (_lock) _jobs.RemoveAll(j => j.Document == docName); Tick(); return Task.CompletedTask; }

    public Task<IReadOnlyList<PrinterInfo>> ListPrintersAsync() =>
        Task.FromResult<IReadOnlyList<PrinterInfo>>([new PrinterInfo("HID FARGO HDP5000 Card Printer", "Simulated", "USB001", false, false)]);

    public void OpenPreferences() { }
    public void OpenQueue() { }
}
