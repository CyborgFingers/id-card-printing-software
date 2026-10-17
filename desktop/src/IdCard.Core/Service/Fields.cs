// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Custom person fields (Settings > Person fields), e.g. Department, Expiry date, Card number.
// Definitions live in the config; each person's values live in people.extra as JSON.
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace IdCard.Service;

internal static partial class Fields
{
    static readonly string[] Types = ["text", "date", "auto"];
    [GeneratedRegex("^cf_[a-z0-9]{4,12}$")] public static partial Regex Key();
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}$")] private static partial Regex DateRe();
    [GeneratedRegex(@"^\d+$")] private static partial Regex Digits();

    /// <summary>2027-02-31 is not a date (JavaScript would read it as 3 March).</summary>
    public static bool RealDate(string s) => DateRe().IsMatch(s) && DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    static long Int(JsonNode? v, long lo, long hi, long def) { var n = Js.ToNumber(v); return double.IsFinite(n) ? Math.Max(lo, Math.Min(hi, (long)Math.Round(n, MidpointRounding.AwayFromZero))) : def; }

    /// <summary>One field definition from the settings page, or null when it isn't usable.</summary>
    public static JsonObject? CleanDef(JsonObject? f, JsonObject? current = null)
    {
        current ??= new JsonObject();
        if (f is null || !Key().IsMatch(Js.ToStr(f["key"]))) return null;
        var label = Js.Str(f["label"] ?? current["label"], 40);
        if (label.Length == 0) return null;
        string? curType = Js.AsString(current["type"]), newType = Js.AsString(f["type"]);
        var type = Types.Contains(curType) ? curType! : Types.Contains(newType) ? newType! : "text";   // type is fixed once created
        var d = new JsonObject { ["key"] = Js.ToStr(f["key"]), ["label"] = label, ["type"] = type };
        if (type == "auto")
        {
            d["prefix"] = Js.Str(f["prefix"] ?? current["prefix"], 12);
            d["digits"] = Int(f["digits"] ?? current["digits"], 1, 9, 4);
            var curNext = Js.ToNumber(current["next"]);
            d["next"] = Math.Max(Int(f["next"] ?? current["next"], 1, 999999999, 1), double.IsFinite(curNext) && curNext > 0 ? (long)curNext : 1);   // never backwards: a stale page must not repeat numbers
        }
        if (type == "date") d["expiry"] = Js.Truthy(f["expiry"] ?? current["expiry"]);
        return d;
    }

    /// <summary>A person's custom values: only defined fields, trimmed; dates must be YYYY-MM-DD.
    /// Fields missing from input keep their current value.</summary>
    public static (JsonObject? Values, string? Error) CleanValues(JsonArray defs, JsonObject? input, JsonObject? current = null)
    {
        var values = new JsonObject();
        foreach (var d in defs.OfType<JsonObject>())
        {
            var key = Js.ToStr(d["key"]);
            var v = input is not null && input.ContainsKey(key) ? input[key] : current?[key];
            var s = Js.Str(v, 200);
            if (s.Length == 0) continue;
            if (Js.AsString(d["type"]) == "date" && !RealDate(s)) return (null, $"{Js.ToStr(d["label"])} must be a date.");
            values[key] = s;
        }
        return (values, null);
    }

    /// <summary>Fills empty auto-number fields, and moves each counter past any number typed or imported in the
    /// same format, so numbers are never handed out twice. Returns true when a counter moved.</summary>
    public static bool AssignNumbers(JsonArray defs, JsonObject values)
    {
        var moved = false;
        foreach (var d in defs.OfType<JsonObject>())
        {
            if (Js.AsString(d["type"]) != "auto") continue;
            var key = Js.ToStr(d["key"]); var prefix = Js.ToStr(d["prefix"]);
            var next = (long)Js.ToNumber(d["next"]); var digits = (int)Js.ToNumber(d["digits"]);
            var v = Js.AsString(values[key]);
            if (string.IsNullOrEmpty(v)) { values[key] = prefix + next.ToString(CultureInfo.InvariantCulture).PadLeft(digits, '0'); d["next"] = next + 1; moved = true; continue; }
            var rest = v.StartsWith(prefix, StringComparison.Ordinal) ? v[prefix.Length..] : "";
            var n = rest.Length > 0 && Digits().IsMatch(rest) && double.TryParse(rest, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;
            if (n >= next) { d["next"] = Js.NumNode(n + 1); moved = true; }
        }
        return moved;
    }

    public static JsonObject ParseExtra(string? s) => Js.Parse(s ?? "{}") as JsonObject ?? new JsonObject();
}
