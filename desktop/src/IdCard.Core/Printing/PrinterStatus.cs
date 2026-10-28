// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Turns raw spooler data into plain-English alerts. Windows only exposes generic printer states;
// card printer drivers map their ribbon / film / card conditions onto them (e.g. "toner" = ribbon,
// "paper" = cards), so they are translated here.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using IdCard.Service;

namespace IdCard.Printing;

public sealed record StatusSettings(string PrinterName, bool Simulate, double RibbonLowPercent, double FilmLowPercent);

public static partial class PrinterStatus
{
    static readonly Dictionary<int, string> Des = new() { [3] = "cards-low", [4] = "cards-out", [5] = "ribbon-low", [6] = "ribbon-out", [7] = "door", [8] = "jam", [9] = "offline", [10] = "attention", [11] = "hopper-full" };

    public sealed record Alert(string Level, string Title, string Detail);
    public static readonly Dictionary<string, Alert> Alerts = new()
    {
        ["not-selected"] = new("error", "No printer selected", "Choose your card printer in Settings."),
        ["not-found"] = new("error", "Printer not found", "The selected printer is not installed on this PC. Check the driver is installed and the name in Settings is correct."),
        ["offline"] = new("error", "Printer offline", "Windows cannot reach the printer. Check the USB cable, that the printer is switched on, and that \"Use Printer Offline\" is not ticked."),
        ["ribbon-out"] = new("error", "Ribbon or film out", "The printer reports the ribbon or film is empty, broken or not detected. Replace or re-seat it, then press Resume."),
        ["ribbon-low"] = new("warning", "Ribbon running low", "Have a replacement ribbon ready."),
        ["cards-out"] = new("error", "Out of cards", "The card hopper is empty or a card failed to feed. Load cards, then press Resume."),
        ["cards-low"] = new("warning", "Cards running low", "Top up the card hopper soon."),
        ["jam"] = new("error", "Card jam", "A card is stuck in the printer. Open the cover, clear the card and close it again."),
        ["door"] = new("error", "Cover open", "Close the printer cover to continue."),
        ["attention"] = new("error", "Printer needs attention", "Check the message on the printer's display."),
        ["hopper-full"] = new("warning", "Output hopper full", "Remove printed cards from the output hopper."),
        ["paused"] = new("warning", "Printer paused in Windows", "The Windows print queue for this printer is paused. Open the printer queue and choose Resume."),
        ["memory"] = new("error", "Printer out of memory", "Restart the printer."),
        ["job-error"] = new("error", "Print job error", ""),
        ["monitor"] = new("warning", "Status monitor unavailable", ""),
        ["ribbon-empty"] = new("error", "Ribbon empty", "The ribbon is at 0%. Fit a new ribbon, then press Resume."),
        ["ribbon-low-pct"] = new("warning", "Ribbon low", ""),
        ["film-empty"] = new("error", "HDP film empty", "The HDP film is at 0%. Fit a new film roll, then press Resume."),
        ["film-low-pct"] = new("warning", "HDP film low", ""),
    };

    static readonly (Regex Re, string Code)[] Keywords =
    [
        (new(@"no ?toner|ribbon (out|error)|film (out|error)", RegexOptions.IgnoreCase), "ribbon-out"),
        (new(@"toner ?low|ribbon low|film low", RegexOptions.IgnoreCase), "ribbon-low"),
        (new(@"paper ?out|out of paper|card(s)? out|no card|hopper empty", RegexOptions.IgnoreCase), "cards-out"),
        (new(@"paper ?jam|jam(med)?", RegexOptions.IgnoreCase), "jam"),
        (new(@"door ?open|cover open|lid open", RegexOptions.IgnoreCase), "door"),
        (new(@"offline", RegexOptions.IgnoreCase), "offline"),
        (new(@"user ?intervention|paper ?problem|service", RegexOptions.IgnoreCase), "attention"),
        (new(@"out ?of ?memory", RegexOptions.IgnoreCase), "memory"),
        (new(@"paused", RegexOptions.IgnoreCase), "paused"),
        (new(@"output ?bin ?full", RegexOptions.IgnoreCase), "hopper-full"),
    ];
    [GeneratedRegex("error|blocked", RegexOptions.IgnoreCase)] private static partial Regex JobError();
    [GeneratedRegex(@"\berror\b", RegexOptions.IgnoreCase)] private static partial Regex WordError();
    [GeneratedRegex("^(printing|spooling)$", RegexOptions.IgnoreCase)] private static partial Regex JobNormal();
    [GeneratedRegex("printing|busy|processing|warming", RegexOptions.IgnoreCase)] private static partial Regex Busy();
    [GeneratedRegex("printing|spooling", RegexOptions.IgnoreCase)] private static partial Regex JobBusy();

    /// <summary>FARGO driver values look like "PartNumber=84051;Grade=0;Type=18;PercentRemaining=69;0;"</summary>
    static Dictionary<string, string> ParseKv(string? s)
    {
        var o = new Dictionary<string, string>();
        foreach (var part in (s ?? "").Split(';')) { var i = part.IndexOf('='); if (i > 0) o[part[..i].Trim()] = part[(i + 1)..].Trim(); }
        return o;
    }

    static JsonObject? Supply(string? s)
    {
        if (string.IsNullOrEmpty(s)) return null;
        var kv = ParseKv(s);
        double? pct = kv.TryGetValue("PercentRemaining", out var p) ? (double.TryParse(p, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : double.NaN) : null;
        if (!kv.ContainsKey("PartNumber") && pct is null) return null;
        return new JsonObject
        {
            ["part"] = kv.GetValueOrDefault("PartNumber", ""),
            ["type"] = kv.GetValueOrDefault("Type", ""),
            ["percent"] = pct is { } v && double.IsFinite(v) && v >= 0 && v <= 100 ? Js.NumNode(v) : null,
        };
    }

    static bool? Flag(Dictionary<string, string> kv, string k) => kv.TryGetValue(k, out var v) ? v == "1" : null;

    static JsonObject? ParseFargo(Dictionary<string, string>? f)
    {
        if (f is null) return null;
        var cfg = ParseKv(f.GetValueOrDefault("ConfigInfo")); var drv = ParseKv(f.GetValueOrDefault("ConfigInfoDriver"));
        JsonNode? Num(string k) => f.TryGetValue(k, out var v) && int.TryParse(LeadingInt().Match(v).Value, out var n) ? n : null;
        return new JsonObject
        {
            ["ribbon"] = Supply(f.GetValueOrDefault("RibbonInfo")),
            ["film"] = Supply(f.GetValueOrDefault("FilmInfo")),
            ["cardCount"] = Num("CardCount"),
            ["codes"] = new JsonObject { ["status"] = Num("PrinterStatus"), ["printerError"] = Num("PrinterError"), ["deviceError"] = Num("DeviceError") },
            // ConfigInfo is what the printer itself reports; ConfigInfoDriver is what the driver supports.
            ["modules"] = new JsonObject { ["flipper"] = Flag(cfg, "FlipperModule"), ["laminator"] = Flag(cfg, "LamModule"), ["magstripe"] = Flag(cfg, "MagModule"), ["dualHopper"] = Flag(cfg, "DualHopper"), ["smartCard"] = Flag(cfg, "SmartCard") },
            ["driverModules"] = new JsonObject { ["flipper"] = Flag(drv, "FlipperModule"), ["laserEngraver"] = Flag(drv, "LaserEngraver") },
        };
    }
    [GeneratedRegex(@"^\s*[-+]?\d+")] private static partial Regex LeadingInt();   // parseInt

    static JsonObject MakeAlert(string code, string? extra = null)
    {
        var a = Alerts.GetValueOrDefault(code) ?? Alerts["attention"];
        return new JsonObject { ["code"] = code, ["level"] = a.Level, ["title"] = a.Title, ["detail"] = string.IsNullOrEmpty(extra) ? a.Detail : extra };
    }

    static string Level(JsonNode? a) => Js.ToStr(a?["level"]);

    public static JsonObject Derive(PrinterRaw? raw, StatusSettings cfg)
    {
        var alerts = new JsonArray();
        var st = new JsonObject
        {
            ["ts"] = Js.Iso((raw?.Ts ?? DateTimeOffset.UtcNow).UtcDateTime), ["printerName"] = cfg.PrinterName, ["simulate"] = cfg.Simulate, ["found"] = false,
            ["state"] = "unknown", ["label"] = "Checking…", ["alerts"] = alerts, ["jobs"] = new JsonArray(), ["busy"] = false, ["port"] = "", ["driver"] = "",
        };
        if (cfg.PrinterName.Length == 0 && !cfg.Simulate) { st["state"] = "error"; st["label"] = "No printer selected"; alerts.Add(MakeAlert("not-selected")); return st; }
        if (raw is null) return st;
        if (raw.MonitorError is not null && !raw.Found) { st["state"] = "warning"; st["label"] = "Status unavailable"; alerts.Add(MakeAlert("monitor", raw.MonitorError)); return st; }
        if (!raw.Found) { st["state"] = "error"; st["label"] = "Printer not found"; alerts.Add(MakeAlert("not-found")); return st; }
        st["found"] = true; st["port"] = raw.PortName; st["driver"] = raw.DriverName;
        if (PrintTuning.ForPrinter(cfg.PrinterName, raw.DriverName) is { } auto)   // Settings > Print adjustments > Automatic
            st["autoTuning"] = new JsonObject { ["model"] = auto.Model, ["darkness"] = auto.Tuning.Darkness, ["contrast"] = auto.Tuning.Contrast, ["colour"] = auto.Tuning.Colour };
        st["dpi"] = raw.Dpi > 0 ? raw.Dpi : null;   // cards are rendered at 600 dpi for printers that print at 600
        var sup = ParseFargo(raw.Fargo);
        st["supplies"] = sup;
        var jobs = new JsonArray(raw.Jobs.Select(j => (JsonNode)new JsonObject { ["id"] = j.Id, ["document"] = j.Document, ["status"] = j.Status ?? "", ["pagesPrinted"] = j.PagesPrinted, ["totalPages"] = j.TotalPages }).ToArray());
        st["jobs"] = jobs;
        var jobStatuses = raw.Jobs.Select(j => j.Status ?? "").ToList();
        var codes = new List<string>();
        void Add(string c) { if (!codes.Contains(c)) codes.Add(c); }
        if (raw.WorkOffline || raw.PrinterStatus == 7) Add("offline");
        if (Des.TryGetValue(raw.DetectedErrorState, out var des)) Add(des);
        var text = string.Join(" | ", new[] { raw.StatusText ?? "" }.Concat(jobStatuses));
        foreach (var (re, code) in Keywords) if (re.IsMatch(text)) Add(code);
        if (codes.Contains("ribbon-out")) codes.Remove("ribbon-low");
        if (codes.Contains("cards-out")) codes.Remove("cards-low");
        // A generic "Error" on a job with no specific cause still needs a person.
        var genericErr = jobStatuses.Any(s => JobError().IsMatch(s)) || WordError().IsMatch(raw.StatusText ?? "") || raw.PrinterStatus == 6;
        var hasSpecificError = codes.Any(c => Alerts.TryGetValue(c, out var a) && a.Level == "error");
        if (genericErr && !hasSpecificError)
        {
            var jobText = string.Join(", ", jobStatuses.Where(s => s.Length > 0 && !JobNormal().IsMatch(s)));
            alerts.Add(MakeAlert("attention", jobText.Length > 0 ? $"Windows reports: {jobText}. Check the message on the printer's display." : null));
        }
        foreach (var c in codes) alerts.Add(MakeAlert(c));
        // Supply levels reported by the FARGO driver, checked against the thresholds in Settings.
        if (sup is not null)
        {
            void Check(JsonNode? s, string name, double low, string emptyCode, string lowCode)
            {
                if (s?["percent"] is not { } p) return;
                var pct = Js.ToNumber(p);
                if (pct <= 0) { if (!codes.Contains("ribbon-out")) alerts.Add(MakeAlert(emptyCode)); }
                else if (pct <= low) alerts.Add(MakeAlert(lowCode, $"{name} is at {Js.NumberText(pct)}%. Have a replacement ready."));
            }
            Check(sup["ribbon"], "The ribbon", cfg.RibbonLowPercent, "ribbon-empty", "ribbon-low-pct");
            Check(sup["film"], "The HDP film", cfg.FilmLowPercent, "film-empty", "film-low-pct");
            // Avoid two "ribbon low" messages when Windows and the percentage both say so.
            if (alerts.Any(a => Js.ToStr(a?["code"]) == "ribbon-low-pct"))
                foreach (var a in alerts.Where(a => Js.ToStr(a?["code"]) == "ribbon-low").ToList()) alerts.Remove(a);
        }
        var busy = raw.PrinterStatus == 4 || Busy().IsMatch(raw.StatusText ?? "") || jobStatuses.Any(s => JobBusy().IsMatch(s));
        st["busy"] = busy;
        var worst = alerts.Any(a => Level(a) == "error") ? "error" : alerts.Any(a => Level(a) == "warning") ? "warning" : "ok";
        st["state"] = worst;
        st["label"] = worst == "error" ? Js.ToStr(alerts.First(a => Level(a) == "error")!["title"])
            : busy ? "Printing" : worst == "warning" ? Js.ToStr(alerts[0]!["title"]) : "Ready";
        return st;
    }
}
