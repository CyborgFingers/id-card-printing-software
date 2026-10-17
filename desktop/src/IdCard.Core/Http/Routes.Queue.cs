// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Card templates (a library; clients are assigned the templates they use), template images and the print queue.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using IdCard.Service;

namespace IdCard.Http;

internal sealed partial class Routes
{
    void Designs()
    {
        router.Add("POST", "/api/designs", r =>
        {
            var b = r.Json;
            var baseD = app.FindDesign(Js.AsString(b["from"]));
            var d = baseD is not null ? (JsonObject)baseD.DeepClone() : new JsonObject
            {
                ["card"] = AppService.CleanCard(b["card"]), ["front"] = new JsonObject { ["background"] = null, ["bgColor"] = "#ffffff" },
                ["back"] = new JsonObject { ["enabled"] = false, ["background"] = null, ["bgColor"] = "#ffffff" }, ["elements"] = new JsonArray(),
            };
            d["id"] = "d" + Js.Uid(9);
            d["name"] = Str(b["name"], 80) is { Length: > 0 } n ? n : baseD is not null ? $"{Js.ToStr(baseD["name"])} (copy)" : "New card template";
            var clean = app.CleanDesign(d);
            app.Db.Tx(() =>
            {
                app.Designs.Add(clean); app.SaveDesigns();
                if (Js.AsString(b["clientId"]) is { } cid && app.ClientRow(cid) is not null)
                {
                    app.Db.Exec("INSERT OR IGNORE INTO client_designs(client_id, design_id) VALUES (?, ?)", cid, clean["id"]!.ToString());
                    if (Js.Truthy(b["makeDefault"])) app.Db.Exec("UPDATE clients SET default_design_id = ?, updated_at = ? WHERE id = ?", clean["id"]!.ToString(), Now(), cid);
                }
            });
            Log($"Card template created: {Js.ToStr(clean["name"])} (by {r.User.Username})");
            app.Broadcast("designs", DesignsJson()); app.BroadcastClients(); return Ok(clean.DeepClone());
        });
        router.Add("PUT", "/api/designs/:id", r =>
        {
            var i = app.Designs.FindIndex(x => Js.ToStr(x["id"]) == r.P["id"]); if (i < 0) return Bad("Template not found", 404);
            var input = (JsonObject)r.Json.DeepClone(); input["id"] = r.P["id"];
            var clean = app.CleanDesign(input);
            app.Designs[i] = clean; app.SaveDesigns();
            Log($"Card template saved: {Js.ToStr(clean["name"])} (by {r.User.Username})");
            app.Broadcast("designs", DesignsJson()); app.BroadcastClients(); return Ok(clean.DeepClone());
        });
        router.Add("PUT", "/api/designs/:id/clients", r =>
        {
            var d = app.FindDesign(r.P["id"]); if (d is null) return Bad("Template not found", 404);
            var did = Js.ToStr(d["id"]);
            var want = Js.Arr(r.Json["clientIds"]).Select(Js.AsString).Where(id => app.ClientRow(id) is not null).Select(id => id!).ToHashSet();
            var map = app.AssignmentsByClient();
            var clients = app.Db.Rows(AppService.ClientsSql);
            List<string> Of(Dictionary<string, object?> c) => map.GetValueOrDefault((string)c["id"]!, []);
            var stranded = clients.Where(c => Of(c).Contains(did) && !want.Contains((string)c["id"]!) && Of(c).Count <= 1).ToList();
            if (stranded.Count > 0) return Bad($"{string.Join(", ", stranded.Select(c => (string)c["name"]!))} would be left without a card template. Assign them another template first.");
            app.Db.Tx(() =>
            {
                foreach (var c in clients)
                {
                    var cid = (string)c["id"]!; var has = Of(c).Contains(did);
                    if (want.Contains(cid) && !has) app.Db.Exec("INSERT OR IGNORE INTO client_designs(client_id, design_id) VALUES (?, ?)", cid, did);
                    if (!want.Contains(cid) && has)
                    {
                        app.Db.Exec("DELETE FROM client_designs WHERE client_id = ? AND design_id = ?", cid, did);
                        if ((string?)c["default_design_id"] == did) app.Db.Exec("UPDATE clients SET default_design_id = ?, updated_at = ? WHERE id = ?", Of(c).FirstOrDefault(x => x != did), Now(), cid);
                    }
                    if (want.Contains(cid) && c["default_design_id"] is null) app.Db.Exec("UPDATE clients SET default_design_id = ?, updated_at = ? WHERE id = ?", did, Now(), cid);
                }
            });
            app.BroadcastClients(); return Ok(new JsonObject { ["clientIds"] = new JsonArray(want.Select(x => (JsonNode)x).ToArray()) });
        });
        router.Add("DELETE", "/api/designs/:id", r =>
        {
            var d = app.FindDesign(r.P["id"]); if (d is null) return Bad("Template not found", 404);
            if (app.Designs.Count <= 1) return Bad("You need at least one card template.");
            var did = Js.ToStr(d["id"]); var map = app.AssignmentsByClient();
            var users = app.Db.Rows(AppService.ClientsSql).Where(c => map.GetValueOrDefault((string)c["id"]!, []).Contains(did)).ToList();
            if (users.Count > 0) return Bad($"This template is used by {string.Join(", ", users.Select(c => (string)c["name"]!))}. Remove it from {(users.Count == 1 ? "that client" : "those clients")} first.");
            app.Designs = app.Designs.Where(x => !ReferenceEquals(x, d)).ToList(); app.SaveDesigns();
            Log($"Card template deleted: {Js.ToStr(d["name"])} (by {r.User.Username})");
            app.Broadcast("designs", DesignsJson()); return Ok();
        });
        router.Add("POST", "/api/assets", r =>
        {
            var mime = r.Header("Content-Type");
            if (mime is null || !ImageTypes.Contains(mime)) return Bad("Templates must be PNG, JPG or WebP images.");
            return Ok(new JsonObject { ["name"] = app.PutAsset(r.Body, mime) });
        }, limit: 20 * 1024 * 1024);
        router.Add("GET", "/assets/:name", r =>
        {
            var a = app.Db.Row("SELECT mime, data FROM assets WHERE name = ?", r.P["name"]);
            return a is null ? Bad("Not found", 404) : Reply.Bytes((byte[])a["data"]!, (string)a["mime"]!, new() { ["Cache-Control"] = "private, max-age=31536000, immutable" });
        });
    }

    static readonly string[] Printing = ["sending", "printing", "attention"];
    static readonly string[] Sides = ["both", "front", "back"];

    JsonObject? Batch(string id) => app.Batches.FirstOrDefault(x => AppService.S(x, "id") == id);

    void Queue()
    {
        router.Add("POST", "/api/queue/batches", r =>
        {
            var b = r.Json;
            var cid = Js.AsString(b["clientId"]);
            string? clientId = null, clientName;
            if (Js.Truthy(b["clientId"])) { var c = app.ClientRow(cid); if (c is null) return Bad("Choose a client first."); clientId = (string)c["id"]!; clientName = (string?)c["name"]; }
            else if (Js.AsString(b["source"]) == "test") clientName = "Test card";
            else return Bad("Choose a client first.");
            var sides = Js.AsString(b["sides"]) is { } sd && Sides.Contains(sd) ? sd : Js.AsString(Config["defaultSides"]) ?? "both";
            var hasBack = Js.Truthy(b["hasBack"]) && Js.AsString(Config["cardSides"]) != "single";   // single-sided cards never print a back
            var design = app.FindDesign(Js.AsString(b["designId"]));
            var batch = new JsonObject
            {
                ["id"] = Js.Uid(8), ["clientId"] = clientId, ["clientName"] = clientName, ["name"] = Str(Js.Truthy(b["name"]) ? b["name"] : "Print batch", 120),
                ["source"] = Js.AsString(b["source"]) == "single" ? "single" : "bulk", ["designId"] = b["designId"]?.DeepClone(), ["designName"] = Str(b["designName"], 120),
                ["card"] = AppService.CleanCard(design?["card"]),
                ["hasBack"] = hasBack, ["sides"] = hasBack ? sides : "front", ["user"] = r.User.Username, ["createdAt"] = Now(), ["status"] = "preparing",
                ["expected"] = Js.NumNode(Js.NumOr(b["expected"], 0)), ["items"] = new JsonArray(),
            };
            app.Batches.Add(batch); app.SaveQueue(); return Ok(new JsonObject { ["id"] = AppService.S(batch, "id") });
        });
        router.Add("POST", "/api/queue/batches/:id/cards", r =>
        {
            var b = Batch(r.P["id"]); if (b is null) return Bad("Batch not found", 404);
            var c = r.Json;
            var front = DataUrl(c["front"]); if (front is null) return Bad("Missing card front image");
            var hasBack = Js.Truthy(b["hasBack"]);
            var back = hasBack ? DataUrl(c["back"]) : null; if (hasBack && back is null) return Bad("Missing card back image");
            var it = new JsonObject
            {
                ["id"] = Js.Uid(10), ["personId"] = Js.Truthy(c["personId"]) ? c["personId"]!.DeepClone() : null, ["firstName"] = Str(c["firstName"], 80), ["lastName"] = Str(c["lastName"], 80),
                ["status"] = "queued", ["attempts"] = 0, ["addedAt"] = Now(),
            };
            var items = AppService.Items(b);
            items.Add(it);
            app.Db.Tx(() =>
            {
                app.UpsertItem(b, it, items.Count - 1);
                app.Db.Exec("INSERT INTO card_images(item_id, side, png) VALUES (?, ?, ?) ON CONFLICT(item_id, side) DO UPDATE SET png = excluded.png", AppService.S(it, "id"), "front", front.Value.Buf);
                if (back is { } bk) app.Db.Exec("INSERT INTO card_images(item_id, side, png) VALUES (?, ?, ?) ON CONFLICT(item_id, side) DO UPDATE SET png = excluded.png", AppService.S(it, "id"), "back", bk.Buf);
            });
            app.BroadcastQueue(); return Ok(new JsonObject { ["id"] = AppService.S(it, "id") });
        });
        router.Add("POST", "/api/queue/batches/:id/ready", r =>
        {
            var b = Batch(r.P["id"]); if (b is null) return Bad("Batch not found", 404);
            b["status"] = "queued"; app.SaveQueue(); Log($"Batch \"{AppService.S(b, "name")}\" for {AppService.S(b, "clientName")} queued with {AppService.Items(b).Count} card(s)");
            app.HoldOrKick();
            return Ok(b.DeepClone());
        });
        router.Add("DELETE", "/api/queue/batches/:id", r =>
        {
            var b = Batch(r.P["id"]); if (b is null) return Bad("Batch not found", 404);
            if (AppService.Items(b).OfType<JsonObject>().Any(i => Printing.Contains(AppService.S(i, "status"))))
                return Bad("This batch has a card printing right now. Cancel the batch first, then remove it once the current card finishes.");
            app.Batches = app.Batches.Where(x => !ReferenceEquals(x, b)).ToList(); app.SaveQueue(); return Ok();
        });
        router.Add("POST", "/api/queue/batches/:id/cancel", r =>
        {
            var b = Batch(r.P["id"]); if (b is null) return Bad("Batch not found", 404);
            foreach (var it in AppService.Items(b).OfType<JsonObject>()) if (AppService.S(it, "status") == "queued") { it["status"] = "cancelled"; app.RecordHistory(b, it, "cancelled"); }
            app.SaveQueue(); return Ok();
        });
        router.Add("POST", "/api/queue/batches/:id/retry", r =>
        {
            var b = Batch(r.P["id"]); if (b is null) return Bad("Batch not found", 404);
            foreach (var it in AppService.Items(b).OfType<JsonObject>()) if (AppService.S(it, "status") is "failed" or "cancelled" or "interrupted") { it["status"] = "queued"; it["error"] = null; }
            if (AppService.S(b, "status") == "incomplete") b["status"] = "queued";
            app.SaveQueue(); app.Kick(); return Ok();
        });
        // Second pass for printers without a flipper: queue the backs of a front-only batch.
        router.Add("POST", "/api/queue/batches/:id/print-backs", r =>
        {
            var src = Batch(r.P["id"]); if (src is null) return Bad("Batch not found", 404);
            if (!Js.Truthy(src["hasBack"])) return Bad("This batch has no back design to print.");
            var items = AppService.Items(src).OfType<JsonObject>().Where(i => AppService.S(i, "status") == "printed").ToList();
            if (Js.Truthy(r.Json["reverse"])) items.Reverse();
            if (items.Count == 0) return Bad("No printed cards in this batch to print backs for.");
            var nb = new JsonObject
            {
                ["id"] = Js.Uid(8), ["clientId"] = src["clientId"]?.DeepClone(), ["clientName"] = src["clientName"]?.DeepClone(), ["name"] = $"{Regex.Replace(AppService.S(src, "name"), @" \(fronts\)$", "")} (backs)",
                ["source"] = src["source"]?.DeepClone(), ["designId"] = src["designId"]?.DeepClone(), ["designName"] = src["designName"]?.DeepClone(), ["card"] = src["card"]?.DeepClone(),
                ["hasBack"] = true, ["sides"] = "back", ["backsOf"] = AppService.S(src, "id"), ["user"] = r.User.Username, ["createdAt"] = Now(), ["status"] = "queued", ["items"] = new JsonArray(),
            };
            var copies = new List<(string From, string To)>();
            foreach (var i in items)
            {
                var it = new JsonObject { ["id"] = Js.Uid(10), ["personId"] = i["personId"]?.DeepClone(), ["firstName"] = i["firstName"]?.DeepClone(), ["lastName"] = i["lastName"]?.DeepClone(), ["status"] = "queued", ["attempts"] = 0, ["addedAt"] = nb["createdAt"]!.DeepClone() };
                AppService.Items(nb).Add(it); copies.Add((AppService.S(i, "id"), AppService.S(it, "id")));
            }
            src["backsBatchId"] = AppService.S(nb, "id");
            app.Batches.Add(nb); app.SaveQueue();
            app.Db.Tx(() => { foreach (var (from, to) in copies) app.Db.Exec("INSERT INTO card_images(item_id, side, png) SELECT ?, side, png FROM card_images WHERE item_id = ?", to, from); });
            Log($"Queued backs for \"{AppService.S(src, "name")}\": {items.Count} card(s){(Js.Truthy(r.Json["reverse"]) ? " (reverse order)" : "")}");
            app.HoldOrKick();
            return Ok(new JsonObject { ["id"] = AppService.S(nb, "id") });
        });
        router.Add("POST", "/api/queue/items/:id/:action", r =>
        {
            var f = app.FindItem(r.P["id"]); if (f is null) return Bad("Card not found", 404);
            var (b, it) = f.Value; var action = r.P["action"]; var status = AppService.S(it, "status");
            if (action is "reprint" or "retry" or "mark-printed" && Printing.Contains(status)) return Bad("This card is printing right now. Cancel it, or wait for it to finish.");
            if (action is "reprint" or "retry") { it["status"] = "queued"; it["error"] = null; }
            else if (action == "mark-printed")
            {
                it["status"] = "printed"; it["error"] = null; it["finishedAt"] = Now(); app.RecordHistory(b, it, "printed", "Marked printed by operator");
                if (Js.AsString(it["personId"]) is { } pid && AppService.S(b, "sides") != "back") app.MarkPrinted(pid, AppService.S(it, "finishedAt"));
            }
            else if (action == "cancel")
            {
                if (Printing.Contains(status)) app._worker.CancelCurrent = true;
                else { it["status"] = "cancelled"; app.RecordHistory(b, it, "cancelled"); }
            }
            else if (action == "move-top")
            {
                var items = AppService.Items(b); items.Remove(it); items.Insert(0, it);
            }
            else return Bad("Unknown action");
            if (!app.Batches.Any(x => AppService.Items(x).OfType<JsonObject>().Any(i => AppService.S(i, "status") == "interrupted"))) app.RecoveredAt = null;
            app.SaveQueue(); app.Kick(); return Ok();
        });
        router.Add("POST", "/api/queue/pause", r =>
        {
            app.QueuePaused = true; app.SaveQueue();
            var w = app._worker;
            app.SetWorker(w.Current is not null ? w.Phase : "paused", w.Current is not null ? w.Message + " (queue will pause after this card)" : "Queue paused", keepCurrent: true);
            return Ok();
        });
        router.Add("POST", "/api/queue/resume", r => { app.QueuePaused = false; app.RecoveredAt = null; app.SaveQueue(); app.Kick(); return Ok(); });
        router.Add("POST", "/api/queue/clear-finished", r => { app.Batches = app.Batches.Where(b => AppService.S(b, "status") is not ("done" or "cancelled")).ToList(); app.SaveQueue(); return Ok(); });
        router.Add("GET", "/api/queue/cards/:batch/:file", r =>
        {
            var m = Regex.Match(r.P["file"], @"^(\w+)-(front|back)\.png$"); if (!m.Success) return Bad("Not found", 404);
            return app.Db.Scalar("SELECT png FROM card_images WHERE item_id = ? AND side = ?", m.Groups[1].Value, m.Groups[2].Value) is byte[] png ? Reply.Bytes(png, "image/png") : Bad("Not found", 404);
        });
    }
}
