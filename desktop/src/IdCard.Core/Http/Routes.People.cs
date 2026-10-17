// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Clients, people (with photos and card status) and custom person fields.
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using IdCard.Service;

namespace IdCard.Http;

internal sealed partial class Routes
{
    static readonly string[] Waiting = ["queued", "sending", "printing", "attention"];

    void Clients()
    {
        router.Add("GET", "/api/clients", r => Ok(app.ListClients()));
        router.Add("POST", "/api/clients", r =>
        {
            var b = r.Json;
            var name = Str(b["name"], 120); if (name.Length == 0) return Bad("Enter the client's name.");
            if (app.Db.Rows("SELECT name FROM clients").Any(c => string.Equals((string?)c["name"], name, StringComparison.OrdinalIgnoreCase))) return Bad("A client with that name already exists.");
            var id = "c" + Js.Uid(9); var t = Now();
            // A new install has no templates yet: the client starts without one.
            var baseD = app.FindDesign(Js.AsString(b["templateId"])) ?? app.Designs.FirstOrDefault();
            string? tplId = baseD is null ? null : Js.ToStr(baseD["id"]);
            app.Db.Tx(() =>
            {
                if (baseD is not null && Js.Truthy(b["copyTemplate"]))
                {
                    // A separate copy, so this client's card can change without affecting anyone else.
                    var tpl = (JsonObject)baseD.DeepClone(); tpl["id"] = "d" + Js.Uid(9); tpl["name"] = $"{name} card"; tpl["updatedAt"] = t;
                    app.Designs.Add(tpl); app.SaveDesigns(); tplId = Js.ToStr(tpl["id"]);
                }
                app.Db.Exec("INSERT INTO clients(id, name, contact_name, contact_email, contact_phone, notes, default_design_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    id, name, Str(b["contactName"]), Str(b["contactEmail"]), Str(b["contactPhone"], 60), Str(b["notes"], 2000), tplId, t, t);
                if (tplId is not null) app.Db.Exec("INSERT OR IGNORE INTO client_designs(client_id, design_id) VALUES (?, ?)", id, tplId);
            });
            Log($"Client created: {name} (by {r.User.Username})");
            app.Broadcast("designs", DesignsJson()); app.BroadcastClients(); return Ok(app.ClientJson(id));
        });
        // Which templates a client can print with, and its default.
        router.Add("PUT", "/api/clients/:id/templates", r =>
        {
            var c = app.ClientRow(r.P["id"]); if (c is null) return Bad("Client not found", 404);
            var b = r.Json;
            var ids = Js.Arr(b["designIds"]).Select(Js.AsString).Where(id => app.FindDesign(id) is not null).Distinct().ToList();
            if (ids.Count == 0) return Bad("A client needs at least one card template.");
            var want = Js.AsString(b["defaultDesignId"]); var current = (string?)c["default_design_id"];
            var def = ids.Contains(want) ? want : ids.Contains(current) ? current : ids[0];
            app.Db.Tx(() =>
            {
                app.Db.Exec("DELETE FROM client_designs WHERE client_id = ?", c["id"]);
                foreach (var id in ids) app.Db.Exec("INSERT OR IGNORE INTO client_designs(client_id, design_id) VALUES (?, ?)", c["id"], id);
                app.Db.Exec("UPDATE clients SET default_design_id = ?, updated_at = ? WHERE id = ?", def, Now(), c["id"]);
            });
            app.BroadcastClients(); return Ok(app.ClientJson((string)c["id"]!));
        });
        router.Add("PUT", "/api/clients/:id", r =>
        {
            var c = app.ClientRow(r.P["id"]); if (c is null) return Bad("Client not found", 404);
            var b = r.Json; var cid = (string)c["id"]!;
            string Or(string k, string col, int n = 200) => Str(b.ContainsKey(k) && b[k] is not null ? b[k] : (string?)c[col], n);
            var name = Or("name", "name", 120); if (name.Length == 0) return Bad("Enter the client's name.");
            if (app.Db.Rows("SELECT id, name FROM clients").Any(x => (string?)x["id"] != cid && string.Equals((string?)x["name"], name, StringComparison.OrdinalIgnoreCase))) return Bad("A client with that name already exists.");
            app.Db.Exec("UPDATE clients SET name = ?, contact_name = ?, contact_email = ?, contact_phone = ?, notes = ?, updated_at = ? WHERE id = ?",
                name, Or("contactName", "contact_name"), Or("contactEmail", "contact_email"), Or("contactPhone", "contact_phone", 60), Or("notes", "notes", 2000), Now(), cid);
            if (Js.AsString(b["defaultDesignId"]) is { Length: > 0 } dd && app.AssignmentsByClient().GetValueOrDefault(cid, []).Contains(dd))
                app.Db.Exec("UPDATE clients SET default_design_id = ?, updated_at = ? WHERE id = ?", dd, Now(), cid);
            app.BroadcastClients(); return Ok(app.ClientJson(cid));
        });
        router.Add("DELETE", "/api/clients/:id", r =>
        {
            var c = app.ClientRow(r.P["id"]); if (c is null) return Bad("Client not found", 404);
            var cid = (string)c["id"]!; var cname = (string)c["name"]!;
            if (!string.Equals(Str(r.Json["confirmName"], 120), cname, StringComparison.OrdinalIgnoreCase)) return Bad("Type the client's name exactly to confirm.");
            if (app.Batches.Any(x => Js.AsString(x["clientId"]) == cid && AppService.Items(x).OfType<JsonObject>().Any(i => Waiting.Contains(AppService.S(i, "status")))))
                return Bad("This client has cards waiting or printing. Cancel or finish them first.");
            app.Db.Tx(() => app.Db.Exec("DELETE FROM clients WHERE id = ?", cid));  // people and template assignments go with it; templates and print history are kept
            Log($"Client deleted: {cname} (by {r.User.Username})");
            app.BroadcastClients(); return Ok();
        });
    }

    JsonArray DesignsJson() => new(app.Designs.Select(d => d.DeepClone()).ToArray());

    static (byte[] Buf, string Mime)? DataUrl(JsonNode? v)
    {
        var m = Regex.Match(Js.AsString(v) ?? "", "^data:(image/(?:png|jpeg|webp));base64,(.+)$", RegexOptions.Singleline);
        if (!m.Success) return null;
        try { return (Convert.FromBase64String(m.Groups[2].Value), m.Groups[1].Value); } catch (FormatException) { return null; }
    }

    static readonly Dictionary<string, string> CardStatus = new() { ["active"] = "Active", ["lost"] = "Lost or stolen", ["returned"] = "Returned" };
    const string HistCols = "id, ts, client_id AS clientId, client_name AS clientName, person_id AS personId, first_name AS firstName, last_name AS lastName, status, sides, batch, batch_id AS batchId, design, printer, operator, ribbon, film, note, design_id AS designId";

    /// <summary>Saves custom values and hands out card numbers; the config is saved when a counter moved.</summary>
    string? CustomValues(JsonObject b, JsonObject? current, out JsonObject values)
    {
        var (v, err) = Fields.CleanValues(app.CustomFields, b["extra"] as JsonObject, current);
        values = v ?? new JsonObject();
        if (err is not null) return err;
        if (Fields.AssignNumbers(app.CustomFields, values)) { app.SaveConfig(); app.Broadcast("config", Config); }
        return null;
    }

    void People()
    {
        router.Add("GET", "/api/clients/:id/people", r =>
        {
            if (app.ClientRow(r.P["id"]) is null) return Bad("Client not found", 404);
            return Ok(new JsonArray(PeopleOf(r.P["id"]).Select(p => (JsonNode)AppService.PersonJson(p)).ToArray()));
        });
        router.Add("POST", "/api/clients/:id/people", r =>
        {
            if (app.ClientRow(r.P["id"]) is null) return Bad("Client not found", 404);
            var b = r.Json;
            var first = Str(b["firstName"], 80); var last = Str(b["lastName"], 80);
            if (first.Length == 0 && last.Length == 0) return Bad("Enter a first or last name.");
            var photo = Js.Truthy(b["photo"]) ? DataUrl(b["photo"]) : null;
            if (Js.Truthy(b["photo"]) && photo is null) return Bad("Photos must be JPG, PNG or WebP images.");
            if (CustomValues(b, null, out var values) is { } err) return Bad(err);
            var id = "p" + Js.Uid(11); var t = Now();
            app.Db.Exec("INSERT INTO people(id, client_id, first_name, last_name, staff_id, position, title, address, notes, photo, photo_mime, photo_name, photo_adj, extra, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, r.P["id"], first, last, Str(b["staffId"], 80), Str(b["position"], 120), Str(b["title"], 80), Str(b["address"], 500), Str(b["notes"], 2000),
                photo?.Buf, photo?.Mime, photo is null ? null : Str(b["photoName"], 200), Js.Stringify(Js.Truthy(b["adj"]) ? b["adj"] : new JsonObject { ["zoom"] = 1, ["ox"] = 0, ["oy"] = 0 }), Js.Stringify(values), t, t);
            app.BroadcastClients(); return Ok(AppService.PersonJson(app.PersonRow(id)!));
        }, limit: 25 * 1024 * 1024);
        router.Add("PUT", "/api/people/:id", r =>
        {
            var cur = app.PersonRow(r.P["id"]); if (cur is null) return Bad("Person not found", 404);
            var b = r.Json; var pid = (string)cur["id"]!;
            string Or(string k, string col, int n) => Str(b[k] is not null ? b[k] : (string?)cur[col], n);
            var first = Or("firstName", "first_name", 80); var last = Or("lastName", "last_name", 80);
            if (first.Length == 0 && last.Length == 0) return Bad("Enter a first or last name.");
            if (CustomValues(b, Fields.ParseExtra((string?)cur["extra"]), out var values) is { } err) return Bad(err);
            (byte[] Buf, string Mime)? photo = null;
            if (b.ContainsKey("photo") && b["photo"] is not null && Js.Truthy(b["photo"]))
            {
                photo = DataUrl(b["photo"]);
                if (photo is null) return Bad("Photos must be JPG, PNG or WebP images.");
            }
            var t = Now();
            app.Db.Tx(() =>
            {
                app.Db.Exec("UPDATE people SET first_name = ?, last_name = ?, staff_id = ?, position = ?, title = ?, address = ?, notes = ?, photo_adj = ?, extra = ?, updated_at = ? WHERE id = ?",
                    first, last, Or("staffId", "staff_id", 80), Or("position", "position", 120), Or("title", "title", 80), Or("address", "address", 500), Or("notes", "notes", 2000),
                    Js.Truthy(b["adj"]) ? Js.Stringify(b["adj"]) : Js.Stringify(Js.Parse((string?)cur["photo_adj"]) ?? new JsonObject()), Js.Stringify(values), t, pid);
                if (b.ContainsKey("photo") && b["photo"] is null) app.Db.Exec("UPDATE people SET photo = ?, photo_mime = ?, photo_name = ?, updated_at = ? WHERE id = ?", null, null, null, t, pid);
                else if (photo is { } ph) app.Db.Exec("UPDATE people SET photo = ?, photo_mime = ?, photo_name = ?, updated_at = ? WHERE id = ?", ph.Buf, ph.Mime, Str(b["photoName"], 200), t, pid);
            });
            return Ok(AppService.PersonJson(app.PersonRow(pid)!));
        }, limit: 25 * 1024 * 1024);
        router.Add("POST", "/api/people/delete", r =>
        {
            var ids = Js.Arr(r.Json["ids"]).Take(5000).Select(Js.ToStr).ToList();
            app.Db.Tx(() => { foreach (var id in ids) app.Db.Exec("DELETE FROM people WHERE id = ?", id); });
            Log($"Deleted {ids.Count} person record(s) (by {r.User.Username})");
            app.BroadcastClients(); return Ok(new JsonObject { ["deleted"] = ids.Count });
        });
        router.Add("GET", "/api/people/:id/photo", r =>
        {
            var p = app.Db.Row("SELECT photo, photo_mime FROM people WHERE id = ?", r.P["id"]);
            return p?["photo"] is byte[] ph && ph.Length > 0 ? Reply.Bytes(ph, (string?)p["photo_mime"] ?? "image/jpeg") : Bad("No photo", 404);   // no-store: never in a disk cache
        });
        // Card lifecycle: lost or returned cards. Printing a new card makes it active again.
        router.Add("POST", "/api/people/:id/status", r =>
        {
            var cur = app.PersonRow(r.P["id"]); if (cur is null) return Bad("Person not found", 404);
            var status = Js.AsString(r.Json["status"]);
            if (status is null || !CardStatus.ContainsKey(status)) return Bad("Unknown card status.");
            var c = app.ClientRow((string?)cur["client_id"]);
            var cname = (string?)c?["name"] ?? "";
            var note = Str(r.Json["note"], 300) is { Length: > 0 } n ? n : $"Card marked {CardStatus[status].ToLowerInvariant()}";
            app.Db.Tx(() =>
            {
                app.Db.Exec("UPDATE people SET card_status = ?, updated_at = ? WHERE id = ?", status == "active" ? null : status, Now(), cur["id"]);
                app.Db.Exec("INSERT INTO print_history(ts, client_id, client_name, person_id, first_name, last_name, status, sides, batch, batch_id, design, printer, operator, ribbon, film, note, design_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    Now(), cur["client_id"], cname, cur["id"], cur["first_name"], cur["last_name"], status, null, "", null, "", "", r.User.Username, null, null, note, null);
            });
            Log($"Card for {$"{cur["first_name"]} {cur["last_name"]}".Trim()} ({(cname.Length > 0 ? cname : "no client")}) marked {CardStatus[status].ToLowerInvariant()} (by {r.User.Username})");
            app.BroadcastClients(); return Ok(AppService.PersonJson(app.PersonRow((string)cur["id"]!)!));
        });
        // Everything printed for one person, plus lost/returned notes.
        router.Add("GET", "/api/people/:id/history", r => Ok(Rows($"SELECT {HistCols} FROM print_history WHERE person_id = ? ORDER BY id DESC LIMIT 100", r.P["id"])));
        router.Add("GET", "/api/clients/:id/people.csv", r =>
        {
            var c = app.ClientRow(r.P["id"]); if (c is null) return Bad("Client not found", 404);
            var custom = app.CustomFields.OfType<JsonObject>().ToList();
            var head = new[] { "First Name", "Last Name", "Staff ID Number", "Position", "Title", "Address" }.Concat(custom.Select(f => Js.ToStr(f["label"])))
                .Concat(["Card Status", "Notes", "ID Photo", "Times Printed", "Last Printed"]).ToList();
            var rows = new List<IEnumerable<string>> { head };
            foreach (var p in PeopleOf((string)c["id"]!).Select(AppService.PersonJson))
            {
                var extra = Js.Obj(p["extra"]);
                var status = Js.ToStr(p["cardStatus"]);
                rows.Add(new[] { "firstName", "lastName", "staffId", "position", "title", "address" }.Select(k => Js.ToStr(p[k]))
                    .Concat(custom.Select(f => Js.ToStr(extra[Js.ToStr(f["key"])])))
                    .Concat([CardStatus.GetValueOrDefault(status, status), Js.ToStr(p["notes"]), Js.ToStr(p["photoName"]), Js.ToStr(p["printCount"]),
                        Js.ParseIso(Js.AsString(p["lastPrintedAt"])) is { } lp ? NzDateTime(lp) : ""]));
            }
            return Csv(rows, $"{FileNamePart((string)c["name"]!)} - People.csv");
        });
    }

    List<Dictionary<string, object?>> PeopleOf(string clientId) =>
        app.Db.Rows($"SELECT {AppService.PersonCols} FROM people WHERE client_id = ? ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE", clientId);

    static readonly CultureInfo Nz = CultureInfo.GetCultureInfo("en-NZ");
    static string NzDate(DateTime utc) => utc.ToLocalTime().ToString("d/MM/yyyy", Nz);
    static string NzTime(DateTime utc) => utc.ToLocalTime().ToString("h:mm:ss tt", Nz).ToLowerInvariant();
    static string NzDateTime(DateTime utc) => $"{NzDate(utc)}, {NzTime(utc)}";

    static string CsvCell(string v)
    {
        if (v.Length > 0 && "=+-@\t\r".Contains(v[0])) v = "'" + v;   // Excel would run it as a formula
        return v.IndexOfAny(['"', ',', '\r', '\n']) >= 0 ? $"\"{v.Replace("\"", "\"\"")}\"" : v;
    }

    static Reply Csv(IEnumerable<IEnumerable<string>> rows, string fileName, bool trailingNewline = true)
    {
        var text = "﻿" + string.Join("\r\n", rows.Select(r => string.Join(",", r.Select(CsvCell)))) + (trailingNewline ? "\r\n" : "");
        return Reply.Text(text, "text/csv; charset=utf-8", new() { ["Content-Disposition"] = Attachment(fileName) });
    }

    /// <summary>A download name: the real name (macrons and all) for current programs, plus a plain-letters
    /// fallback, since a header can only hold plain text.</summary>
    static string Attachment(string fileName)
    {
        var plain = new string(fileName.Normalize(System.Text.NormalizationForm.FormD)
            .Where(ch => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) != System.Globalization.UnicodeCategory.NonSpacingMark).ToArray());
        plain = Regex.Replace(plain, "[^A-Za-z0-9_ .()-]+", "");
        return $"attachment; filename=\"{plain}\"; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
    }

    /// <summary>A client's name made safe for a file name (letters, numbers, spaces, - and _).</summary>
    static string FileNamePart(string name) => Regex.Replace(name, @"[^\p{L}\p{N}_ -]+", "").Trim() is { Length: > 0 } n ? n : "Client";

    // ---------------- custom person fields (Settings > Person fields) ----------------
    bool FieldTaken(string label, string? key = null) =>
        AppService.FieldList.Select(f => f.Label).Concat(["Card Status", "Notes", "ID Photo", "ID"]).Any(l => string.Equals(l, label, StringComparison.OrdinalIgnoreCase))
        || app.CustomFields.OfType<JsonObject>().Any(f => Js.ToStr(f["key"]) != key && string.Equals(Js.ToStr(f["label"]), label, StringComparison.OrdinalIgnoreCase));

    void SaveFields(List<JsonObject> list, string user, string what, string? edited)
    {
        var expiry = list.FirstOrDefault(f => Js.ToStr(f["key"]) == edited && Js.Truthy(f["expiry"])) ?? list.LastOrDefault(f => Js.Truthy(f["expiry"]));
        var arr = new JsonArray();
        foreach (var f in list)   // only one expiry date
        {
            var c = (JsonObject)f.DeepClone();
            if (Js.AsString(c["type"]) == "date") c["expiry"] = ReferenceEquals(f, expiry);
            arr.Add(c);
        }
        Config["customFields"] = arr;
        app.SaveConfig(); Log($"Person field {what} (by {user})"); app.Broadcast("config", Config);
    }

    void PersonFields()
    {
        router.Add("POST", "/api/fields", r =>
        {
            if (app.CustomFields.Count >= 30) return Bad("You can have up to 30 extra fields.");
            var input = (JsonObject)r.Json.DeepClone(); input["key"] = "cf_" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(5));
            var d = Fields.CleanDef(input);
            if (d is null) return Bad("Give the field a name.");
            var label = Js.ToStr(d["label"]);
            if (FieldTaken(label)) return Bad($"There is already a field called \"{label}\".");
            SaveFields([.. app.CustomFields.OfType<JsonObject>(), d], r.User.Username, $"added: {label}", Js.ToStr(d["key"]));
            return Ok(Saved(d));
        }, admin: true);
        router.Add("PUT", "/api/fields/:key", r =>
        {
            var cur = app.CustomFields.OfType<JsonObject>().FirstOrDefault(f => Js.ToStr(f["key"]) == r.P["key"]); if (cur is null) return Bad("Field not found", 404);
            var input = (JsonObject)r.Json.DeepClone(); input["key"] = Js.ToStr(cur["key"]);
            var d = Fields.CleanDef(input, cur);
            if (d is null) return Bad("Give the field a name.");
            var label = Js.ToStr(d["label"]);
            if (FieldTaken(label, Js.ToStr(cur["key"]))) return Bad($"There is already a field called \"{label}\".");
            SaveFields(app.CustomFields.OfType<JsonObject>().Select(f => ReferenceEquals(f, cur) ? d : f).ToList(), r.User.Username, $"changed: {label}", Js.ToStr(d["key"]));
            return Ok(Saved(d));
        }, admin: true);
        router.Add("DELETE", "/api/fields/:key", r =>
        {
            var cur = app.CustomFields.OfType<JsonObject>().FirstOrDefault(f => Js.ToStr(f["key"]) == r.P["key"]); if (cur is null) return Bad("Field not found", 404);
            SaveFields(app.CustomFields.OfType<JsonObject>().Where(f => !ReferenceEquals(f, cur)).ToList(), r.User.Username, $"removed: {Js.ToStr(cur["label"])}", null);
            return Ok();
        }, admin: true);
    }

    /// <summary>The field as saved (its expiry flag may have changed when saving).</summary>
    JsonObject Saved(JsonObject d) => (JsonObject)(app.CustomFields.OfType<JsonObject>().FirstOrDefault(f => Js.ToStr(f["key"]) == Js.ToStr(d["key"])) ?? d).DeepClone();
}
