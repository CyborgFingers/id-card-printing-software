// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The screens send and store loosely typed JSON. These helpers read it the way the screens expect
// (the same coercions JavaScript applies), so stored data and API replies keep their exact shape.
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace IdCard.Service;

internal static class Js
{
    public static readonly JsonSerializerOptions Json = new() { WriteIndented = false, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>The time as JavaScript's toISOString() writes it, so stored times sort and compare as text.</summary>
    public static string Now() => Iso(DateTime.UtcNow);
    public static string Iso(DateTime t) => t.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    public static DateTime? ParseIso(string? s) =>
        DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t) ? t : null;

    const string IdChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    public static string Uid(int n = 10) => RandomNumberGenerator.GetString(IdChars, n);

    public static bool IsString(JsonNode? v) => v is JsonValue jv && jv.TryGetValue<string>(out _);
    public static string? AsString(JsonNode? v) => v is JsonValue jv && jv.TryGetValue<string>(out var s) ? s : null;

    /// <summary>String(v ?? '') in JavaScript.</summary>
    public static string ToStr(JsonNode? v) => v switch
    {
        null => "",
        JsonValue jv when jv.TryGetValue<string>(out var s) => s,
        JsonValue jv when jv.TryGetValue<bool>(out var b) => b ? "true" : "false",
        JsonValue jv => NumberText(ToNumber(jv)),
        JsonArray => string.Join(",", ((JsonArray)v).Select(ToStr)),
        _ => "[object Object]",
    };

    /// <summary>String(v ?? '').trim().slice(0, n).</summary>
    public static string Str(JsonNode? v, int n = 200) { var s = ToStr(v).Trim(); return s.Length > n ? s[..n] : s; }

    /// <summary>Number(v): NaN when it isn't a number.</summary>
    public static double ToNumber(JsonNode? v)
    {
        switch (v)
        {
            case null: return double.NaN;
            case JsonValue jv when jv.TryGetValue<bool>(out var b): return b ? 1 : 0;
            case JsonValue jv when jv.TryGetValue<string>(out var s):
                s = s.Trim();
                if (s.Length == 0) return 0;
                return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : double.NaN;
            case JsonValue jv when jv.GetValueKind() == JsonValueKind.Number:
                if (jv.TryGetValue<double>(out var dd)) return dd;
                if (jv.TryGetValue<long>(out var l)) return l;
                if (jv.TryGetValue<int>(out var i)) return i;
                if (jv.TryGetValue<decimal>(out var m)) return (double)m;
                return double.NaN;
            default: return double.NaN;
        }
    }

    public static string NumberText(double d) => double.IsNaN(d) ? "NaN" : d.ToString("R", CultureInfo.InvariantCulture);

    /// <summary>Clamped number, or the default when it isn't one.</summary>
    public static double Num(JsonNode? v, double lo, double hi, double def) { var n = ToNumber(v); return double.IsFinite(n) ? Math.Max(lo, Math.Min(hi, n)) : def; }

    /// <summary>+v || def</summary>
    public static double NumOr(JsonNode? v, double def) { var n = ToNumber(v); return double.IsNaN(n) || n == 0 ? def : n; }

    /// <summary>!!v</summary>
    public static bool Truthy(JsonNode? v) => v switch
    {
        null => false,
        JsonValue jv when jv.TryGetValue<bool>(out var b) => b,
        JsonValue jv when jv.TryGetValue<string>(out var s) => s.Length > 0,
        JsonValue jv => ToNumber(jv) is var d && d != 0 && !double.IsNaN(d),
        _ => true,
    };

    /// <summary>A whole number stays a whole number in JSON (JavaScript has one number type).</summary>
    public static JsonNode NumNode(double d) => d == Math.Floor(d) && Math.Abs(d) < 9e15 ? JsonValue.Create((long)d) : JsonValue.Create(d);

    public static JsonNode? Clone(JsonNode? v) => v?.DeepClone();
    public static JsonObject Obj(JsonNode? v) => v as JsonObject ?? new JsonObject();
    public static JsonArray Arr(JsonNode? v) => v as JsonArray ?? new JsonArray();

    public static JsonNode? Parse(string? s) { try { return string.IsNullOrEmpty(s) ? null : JsonNode.Parse(s); } catch (JsonException) { return null; } }
    public static string Stringify(JsonNode? v) => v is null ? "null" : v.ToJsonString(Json);

    public static JsonNode? Node(object? v) => v switch
    {
        null => null,
        JsonNode n => n,
        string s => JsonValue.Create(s),
        bool b => JsonValue.Create(b),
        long l => JsonValue.Create(l),
        int i => JsonValue.Create(i),
        double d => NumNode(d),
        byte[] => null,
        _ => JsonValue.Create(v.ToString()),
    };

    public static JsonObject Row(Dictionary<string, object?> r)
    {
        var o = new JsonObject();
        foreach (var (k, v) in r) o[k] = Node(v);
        return o;
    }
}
