// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Card templates (a background per side plus placed elements), template images, clients and people.
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using IdCard.Printing;

namespace IdCard.Service;

public sealed partial class AppService
{
    internal static readonly (string Key, string Label)[] FieldList =
        [("photo", "Photo"), ("firstName", "First name"), ("lastName", "Last name"), ("staffId", "Staff ID number"), ("position", "Position"), ("title", "Title"), ("address", "Address"), ("text", "Text")];
    internal static readonly string[] PersonFields = ["firstName", "lastName", "staffId", "position", "title", "address"];
    internal static readonly Dictionary<string, string> CsvHeaders = new() { ["firstName"] = "First Name", ["lastName"] = "Last Name", ["staffId"] = "Staff ID Number", ["position"] = "Position", ["title"] = "Title", ["address"] = "Address", ["photo"] = "ID Photo" };
    static readonly string[] Kinds = ["image", "box", "barcode"];                         // design elements that are not person details
    static readonly string[] Symbols = ["qrcode", "code128", "pdf417", "datamatrix", "code39"];
    static readonly string[] DateFormats = ["DD/MM/YYYY", "D MMM YYYY", "MMM YYYY", "MM/YY", "YYYY-MM-DD"];
    static readonly string[] Rotations = ["0", "90", "180", "270"];

    // ---------------- card sizes ----------------
    // Templates are drawn in 300 dpi pixels. CR80 keeps the 638 x 1013 px that every template so far uses.
    internal sealed record SizeDef(string Name, double ShortMm, double LongMm, int ShortPx, int LongPx);
    internal static readonly SizeDef[] CardSizes =
    [
        new("CR80", 53.98, 85.6, 638, 1013),
        new("CR79", 52.1, 83.9, Px(52.1), Px(83.9)),
        new("CR100", 67, 98.5, Px(67), Px(98.5)),
    ];
    internal const double CustomMinMm = 20, CustomMaxMm = 150;
    static int Px(double mm) => (int)Math.Round(mm / 25.4 * 300, MidpointRounding.AwayFromZero);

    /// <summary>The card a template prints on: {w, h} in 300 dpi pixels (landscape when w &gt; h), its size name and millimetres.</summary>
    internal static JsonObject CleanCard(JsonNode? c)
    {
        var landscape = Js.ToNumber(c?["w"]) > Js.ToNumber(c?["h"]);
        var name = Js.ToStr(c?["size"]);
        var def = CardSizes.FirstOrDefault(s => s.Name == name);
        if (def is null && name == "custom")
        {
            double a = Js.ToNumber(c?["mmW"]), b = Js.ToNumber(c?["mmH"]);
            if (double.IsFinite(a) && double.IsFinite(b))
            {
                double s = Math.Round(Math.Clamp(Math.Min(a, b), CustomMinMm, CustomMaxMm), 1), l = Math.Round(Math.Clamp(Math.Max(a, b), CustomMinMm, CustomMaxMm), 1);
                def = new SizeDef("custom", s, l, Px(s), Px(l));
            }
        }
        def ??= CardSizes[0];
        return landscape
            ? new JsonObject { ["w"] = def.LongPx, ["h"] = def.ShortPx, ["size"] = def.Name, ["mmW"] = Js.NumNode(def.LongMm), ["mmH"] = Js.NumNode(def.ShortMm) }
            : new JsonObject { ["w"] = def.ShortPx, ["h"] = def.LongPx, ["size"] = def.Name, ["mmW"] = Js.NumNode(def.ShortMm), ["mmH"] = Js.NumNode(def.LongMm) };
    }

    /// <summary>What the printer is told: the portrait size in millimetres. A custom size gets a name no driver paper matches.</summary>
    internal static CardSize PrintSize(JsonNode? card)
    {
        var c = CleanCard(card);
        double a = Js.ToNumber(c["mmW"]), b = Js.ToNumber(c["mmH"]);
        var name = Js.ToStr(c["size"]);
        return new CardSize(name == "custom" ? string.Create(CultureInfo.InvariantCulture, $"{Math.Min(a, b)}x{Math.Max(a, b)}mm") : name, Math.Min(a, b), Math.Max(a, b));
    }

    // ---------------- template images ----------------
    internal string PutAsset(byte[] buf, string mime, string? name = null)
    {
        name ??= Convert.ToHexStringLower(SHA1.HashData(buf))[..16] + mime switch { "image/png" => ".png", "image/jpeg" => ".jpg", "image/webp" => ".webp", _ => "" };
        Db.Exec("INSERT INTO assets(name, mime, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING", name, mime, buf, Js.Now());
        return name;
    }

    // ---------------- card templates ----------------
    internal List<JsonObject> Designs { get; set; } = [];

    static JsonObject TextEl(string field, double x, double y, double w, double h, JsonObject? extra = null)
    {
        var o = new JsonObject
        {
            ["id"] = "e" + Js.Uid(8), ["field"] = field, ["side"] = "front", ["x"] = Js.NumNode(x), ["y"] = Js.NumNode(y), ["w"] = Js.NumNode(w), ["h"] = Js.NumNode(h),
            ["font"] = "Fira Sans", ["weight"] = 500, ["size"] = 67, ["minSize"] = 20, ["color"] = "#111111", ["align"] = "center", ["valign"] = "middle", ["uppercase"] = true, ["letterSpacing"] = 0, ["lineHeight"] = 1.15,
        };
        if (extra is not null) foreach (var (k, v) in extra) o[k] = v?.DeepClone();
        return o;
    }

    static JsonObject PhotoEl(double x, double y, double w, double h, JsonObject? extra = null)
    {
        var o = new JsonObject { ["id"] = "e" + Js.Uid(8), ["field"] = "photo", ["side"] = "front", ["x"] = Js.NumNode(x), ["y"] = Js.NumNode(y), ["w"] = Js.NumNode(w), ["h"] = Js.NumNode(h), ["radius"] = 0, ["borderWidth"] = 0, ["borderColor"] = "#00529F", ["bgColor"] = "#e9eef4" };
        if (extra is not null) foreach (var (k, v) in extra) o[k] = v?.DeepClone();
        return o;
    }

    /// <summary>Older templates (one name block + one photo box) become field elements.</summary>
    static JsonObject UpgradeDesign(JsonObject d)
    {
        if (d["elements"] is JsonArray) return d;
        var t = Js.Obj(d["nameText"]); var ph = Js.Obj(d["photo"]);
        double Or(JsonNode? v, double def) { var n = Js.ToNumber(v); return double.IsNaN(n) ? def : n; }
        double size = Js.NumOr(t["size"], 67), h = Math.Round(size), cap = size * 0.69;
        double Box(double baseline) => Math.Round(baseline - cap / 2 - h / 2);
        double w = Or(t["maxWidth"], 560), x = Math.Round(Or(t["x"], 319) - w / 2);
        var common = new JsonObject
        {
            ["font"] = Js.Str(t["font"], 40) is { Length: > 0 } f ? f : "Fira Sans", ["weight"] = Js.NumNode(Js.NumOr(t["weight"], 500)), ["size"] = Js.NumNode(size), ["minSize"] = Js.NumNode(Js.NumOr(t["minSize"], 20)),
            ["color"] = Js.AsString(t["color"]) is { Length: > 0 } col ? col : "#111111", ["uppercase"] = !(t["uppercase"] is JsonValue u && u.TryGetValue<bool>(out var ub) && !ub), ["letterSpacing"] = Js.NumNode(Js.NumOr(t["letterSpacing"], 0)),
        };
        var baseline = Or(t["baseline"], 156);
        var els = new JsonArray(TextEl("firstName", x, Box(baseline), w, h, common));
        if ((Js.AsString(t["layout"]) ?? "two-lines") != "first-only") els.Add(TextEl("lastName", x, Box(baseline + Or(t["lineGap"], 65)), w, h, common));
        els.Add(PhotoEl(Or(ph["x"], 120), Or(ph["y"], 275), Or(ph["w"], 398), Or(ph["h"], 571), new JsonObject
        {
            ["radius"] = Js.NumNode(Js.NumOr(ph["radius"], 0)), ["borderWidth"] = Js.NumNode(Js.NumOr(ph["borderWidth"], 0)),
            ["borderColor"] = Js.AsString(ph["borderColor"]) is { Length: > 0 } bc ? bc : "#00529F", ["bgColor"] = Js.AsString(ph["bgColor"]) is { Length: > 0 } bg ? bg : "#e9eef4",
        }));
        var rest = (JsonObject)d.DeepClone();
        rest.Remove("nameText"); rest.Remove("photo"); rest.Remove("clientId");
        rest["version"] = 3; rest["elements"] = els;
        return rest;
    }

    /// <summary>Person details: the built-in ones and any custom fields.</summary>
    internal bool IsPersonField(string? k) => k is not null && (PersonFields.Contains(k) || CustomFields.Any(f => Js.ToStr(f?["key"]) == k));

    /// <summary>Person details a template uses: its ticked fields, placed fields and barcode data sources.</summary>
    internal List<string> DesignFields(JsonObject d)
    {
        var all = Js.Arr(d["fields"]).Select(Js.ToStr)
            .Concat(Js.Arr(d["elements"]).OfType<JsonObject>().Select(e => Js.ToStr(e["field"]) == "barcode" ? Js.ToStr(e["source"]) : Js.ToStr(e["field"])));
        return all.Where(f => f == "photo" || IsPersonField(f)).Distinct().ToList();
    }

    void LoadDesigns()
    {
        var changed = false;
        Designs = [];
        foreach (var r in Db.Rows("SELECT data FROM designs ORDER BY position, rowid"))
        {
            if (Js.Parse((string?)r["data"]) is not JsonObject d) continue;
            var u = UpgradeDesign(d);
            if (u != d) changed = true;
            if (u["card"] is not JsonObject c || Js.ToNumber(c["w"]) is not > 0) { u["card"] = new JsonObject { ["w"] = 638, ["h"] = 1013 }; changed = true; }   // older templates were always portrait
            Designs.Add(u);
        }
        if (changed) SaveDesigns();
    }

    internal void SaveDesigns()
    {
        Db.Tx(() =>
        {
            var keep = Designs.Select(d => Js.ToStr(d["id"])).ToHashSet();
            foreach (var r in Db.Rows("SELECT id FROM designs")) if (!keep.Contains((string)r["id"]!)) Db.Exec("DELETE FROM designs WHERE id = ?", r["id"]);
            for (int i = 0; i < Designs.Count; i++)
            {
                var d = Designs[i];
                Db.Exec("INSERT INTO designs(id, client_id, name, data, updated_at, position) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, name = excluded.name, data = excluded.data, updated_at = excluded.updated_at, position = excluded.position",
                    Js.ToStr(d["id"]), null, Js.ToStr(d["name"]), Js.Stringify(d), Js.AsString(d["updatedAt"]) ?? Js.Now(), i);
            }
        });
    }

    [GeneratedRegex("^#[0-9a-f]{6}$", RegexOptions.IgnoreCase)] internal static partial Regex Hex();
    [GeneratedRegex(@"^\w{1,20}$")] private static partial Regex ElementId();

    internal JsonObject CleanDesign(JsonObject d)
    {
        static string Colour(JsonNode? v, string def) => Js.AsString(v) is { } s && Hex().IsMatch(s) ? s : def;
        static JsonNode Rotate(JsonNode? v) { var n = Js.ToNumber(v); return Rotations.Contains(Js.NumberText(n)) ? (int)n : 0; }
        static JsonNode Num(JsonNode? v, double lo, double hi, double def) => Js.NumNode(Js.Num(v, lo, hi, def));
        // Opacity (faded backgrounds and elements) is kept only when it isn't fully solid, so older templates read the same.
        static JsonObject Faded(JsonObject o, string key, JsonNode? v, double lo) { var a = Js.Num(v, lo, 1, 1); if (a < 1) o[key] = Js.NumNode(Math.Round(a, 2)); return o; }
        // A picture's Darkness, Contrast and Colour (-50..50), kept only when not 0: the background (bgDarkness...) or a logo or photo.
        static JsonObject Toned(JsonObject o, JsonObject from, string prefix = "")
        {
            foreach (var k in (string[])["Darkness", "Contrast", "Colour"])
            {
                var key = prefix.Length > 0 ? prefix + k : k.ToLowerInvariant();
                var v = (int)Math.Round(Js.Num(from[key], -50, 50, 0));
                if (v != 0) o[key] = v;
            }
            return o;
        }
        static JsonObject Side(JsonObject from, JsonObject side) => Toned(Faded(side, "bgOpacity", from["bgOpacity"], 0), from, "bg");
        var card = CleanCard(d["card"]);
        double max = Math.Max(Js.ToNumber(card["w"]), Js.ToNumber(card["h"])), maxSize = Math.Max(2000, 2 * max);
        var front = Js.Obj(d["front"]); var back = Js.Obj(d["back"]);
        var fields = new JsonArray();
        foreach (var f in Js.Arr(d["fields"]).Select(Js.AsString).Where(f => f == "photo" || IsPersonField(f)).Distinct()) fields.Add(f);
        var outD = new JsonObject
        {
            ["id"] = d["id"]?.DeepClone(), ["name"] = Js.Str(d["name"], 80) is { Length: > 0 } n ? n : "Card template", ["version"] = 3, ["updatedAt"] = Js.Now(), ["card"] = card,
            ["front"] = Side(front, new JsonObject { ["background"] = Js.Truthy(front["background"]) ? front["background"]!.DeepClone() : null, ["bgColor"] = Colour(front["bgColor"], "#ffffff") }),
            ["back"] = Side(back, new JsonObject { ["enabled"] = Js.Truthy(back["enabled"]), ["background"] = Js.Truthy(back["background"]) ? back["background"]!.DeepClone() : null, ["bgColor"] = Colour(back["bgColor"], "#ffffff") }),
            ["fields"] = fields,
        };
        var elements = new JsonArray();
        foreach (var e in Js.Arr(d["elements"]).Take(80).OfType<JsonObject>())
        {
            var field = Js.AsString(e["field"]);
            if (field is null || (!FieldList.Any(f => f.Key == field) && !Kinds.Contains(field) && !IsPersonField(field))) continue;
            var id = Js.AsString(e["id"]);
            var o = new JsonObject
            {
                ["id"] = id is not null && ElementId().IsMatch(id) ? id : "e" + Js.Uid(8), ["field"] = field, ["side"] = Js.AsString(e["side"]) == "back" ? "back" : "front",
                ["x"] = Num(e["x"], -max, 2 * max, 0), ["y"] = Num(e["y"], -max, 2 * max, 0), ["w"] = Num(e["w"], 10, maxSize, 200), ["h"] = Num(e["h"], 10, maxSize, 60),
            };
            Faded(o, "opacity", e["opacity"], 0.05);   // elements are drawn in list order: later ones on top
            if (field == "photo")
            {
                o["radius"] = Num(e["radius"], 0, 500, 0); o["borderWidth"] = Num(e["borderWidth"], 0, 60, 0); o["borderColor"] = Colour(e["borderColor"], "#00529F"); o["bgColor"] = Colour(e["bgColor"], "#e9eef4");
                o["fit"] = Js.AsString(e["fit"]) == "contain" ? "contain" : "cover";   // fill the frame (trim the edges) or show the whole photo
                Toned(o, e);
            }
            else if (field == "image")
            {
                o["asset"] = Js.Str(e["asset"], 80) is { Length: > 0 } a ? a : null; o["fit"] = Js.AsString(e["fit"]) == "cover" ? "cover" : "contain";
                Toned(o, e);
            }
            else if (field == "box")
            {
                o["fill"] = Colour(e["fill"], "#00529F"); o["noFill"] = Js.Truthy(e["noFill"]); o["radius"] = Num(e["radius"], 0, 500, 0); o["borderWidth"] = Num(e["borderWidth"], 0, 60, 0); o["borderColor"] = Colour(e["borderColor"], "#00529F");
            }
            else if (field == "barcode")
            {
                var symbol = Js.AsString(e["symbol"]); var source = Js.AsString(e["source"]);
                o["symbol"] = symbol is not null && Symbols.Contains(symbol) ? symbol : "qrcode";
                o["source"] = source == "text" || IsPersonField(source) ? source : "text";
                o["text"] = Js.Str(e["text"], 200); o["color"] = Colour(e["color"], "#000000"); o["showText"] = Js.Truthy(e["showText"]); o["rotate"] = Rotate(e["rotate"]);
            }
            else
            {
                var align = Js.AsString(e["align"]); var valign = Js.AsString(e["valign"]); var df = Js.AsString(e["dateFormat"]);
                o["font"] = Js.Str(e["font"], 40) is { Length: > 0 } font ? font : "Fira Sans"; o["weight"] = Num(e["weight"], 100, 900, 500);
                o["size"] = Num(e["size"], 4, 300, 40); o["minSize"] = Num(e["minSize"], 4, 300, 12); o["color"] = Colour(e["color"], "#111111");
                o["align"] = align is "left" or "center" or "right" ? align : "center"; o["valign"] = valign is "top" or "middle" or "bottom" ? valign : "middle";
                o["uppercase"] = Js.Truthy(e["uppercase"]); o["letterSpacing"] = Num(e["letterSpacing"], -10, 50, 0); o["lineHeight"] = Num(e["lineHeight"], 0.8, 3, 1.15); o["rotate"] = Rotate(e["rotate"]);
                if (field == "text") o["text"] = Js.Str(e["text"], 200);
                if (df is not null && DateFormats.Contains(df)) o["dateFormat"] = df;
            }
            elements.Add(o);
        }
        outD["elements"] = elements;
        return outD;
    }

    internal JsonObject? FindDesign(string? id) => Designs.FirstOrDefault(d => Js.ToStr(d["id"]) == id);

    // ---------------- clients & people ----------------
    internal Dictionary<string, List<string>> AssignmentsByClient()
    {
        var m = new Dictionary<string, List<string>>();
        foreach (var r in Db.Rows("SELECT client_id, design_id FROM client_designs"))
        {
            var c = (string)r["client_id"]!;
            if (!m.TryGetValue(c, out var l)) m[c] = l = [];
            l.Add((string)r["design_id"]!);
        }
        return m;
    }

    internal const string ClientsSql = """
        SELECT c.*, (SELECT COUNT(*) FROM people p WHERE p.client_id = c.id) AS people,
        (SELECT COUNT(*) FROM client_designs cd WHERE cd.client_id = c.id) AS templates,
        (SELECT COUNT(*) FROM print_history h WHERE h.client_id = c.id AND h.status = 'printed' AND IFNULL(h.sides, 'both') != 'back') AS printed,
        (SELECT MAX(ts) FROM print_history h WHERE h.client_id = c.id AND h.status = 'printed') AS last_printed
        FROM clients c ORDER BY c.name COLLATE NOCASE
        """;

    internal JsonArray ListClients()
    {
        var map = AssignmentsByClient();
        var list = new JsonArray();
        foreach (var c in Db.Rows(ClientsSql))
        {
            var ids = new JsonArray(map.GetValueOrDefault((string)c["id"]!, []).Select(x => (JsonNode)x).ToArray());
            list.Add(new JsonObject
            {
                ["templateIds"] = ids, ["id"] = (string)c["id"]!, ["name"] = (string?)c["name"], ["contactName"] = (string?)c["contact_name"] ?? "", ["contactEmail"] = (string?)c["contact_email"] ?? "",
                ["contactPhone"] = (string?)c["contact_phone"] ?? "", ["notes"] = (string?)c["notes"] ?? "", ["defaultDesignId"] = (string?)c["default_design_id"], ["createdAt"] = (string?)c["created_at"], ["updatedAt"] = (string?)c["updated_at"],
                ["people"] = Js.Node(c["people"] ?? 0L), ["templates"] = Js.Node(c["templates"] ?? 0L), ["printed"] = Js.Node(c["printed"] ?? 0L), ["lastPrinted"] = (string?)c["last_printed"],
            });
        }
        return list;
    }

    internal JsonObject? ClientJson(string id) => ListClients().OfType<JsonObject>().FirstOrDefault(c => Js.ToStr(c["id"]) == id);

    internal Dictionary<string, object?>? ClientRow(string? id) => id is null ? null : Db.Row("SELECT * FROM clients WHERE id = ?", id);

    internal const string PersonCols = "id, client_id, first_name, last_name, staff_id, position, title, address, notes, photo_mime, photo_name, photo_adj, length(photo) AS photo_bytes, created_at, updated_at, last_printed_at, print_count, extra, card_status";

    internal static JsonObject PersonJson(Dictionary<string, object?> p)
    {
        var adj = Js.Parse((string?)p["photo_adj"]) as JsonObject ?? new JsonObject { ["zoom"] = 1, ["ox"] = 0, ["oy"] = 0 };
        string S(string k) => (string?)p[k] ?? "";
        return new JsonObject
        {
            ["id"] = S("id"), ["clientId"] = S("client_id"), ["firstName"] = S("first_name"), ["lastName"] = S("last_name"), ["staffId"] = S("staff_id"), ["position"] = S("position"), ["title"] = S("title"),
            ["address"] = S("address"), ["notes"] = S("notes"), ["hasPhoto"] = p["photo_bytes"] is long n && n > 0, ["photoName"] = S("photo_name"), ["adj"] = adj,
            ["createdAt"] = (string?)p["created_at"], ["updatedAt"] = (string?)p["updated_at"], ["lastPrintedAt"] = (string?)p["last_printed_at"], ["printCount"] = Js.Node(p["print_count"] ?? 0L),
            ["extra"] = Fields.ParseExtra((string?)p["extra"]), ["cardStatus"] = (string?)p["card_status"] is { Length: > 0 } cs ? cs : "active",
        };
    }

    internal Dictionary<string, object?>? PersonRow(string id) => Db.Row($"SELECT {PersonCols} FROM people WHERE id = ?", id);

    internal void BroadcastClients() => Broadcast("clients", ListClients());
}
