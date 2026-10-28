// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The print queue and the worker that prints one card at a time, print history and supply estimates.
// The queue is kept in memory for speed and written to the database on every change inside a
// transaction, so a crash or power cut never loses or half-writes it.
using System.Text.Json.Nodes;
using IdCard.Printing;

namespace IdCard.Service;

public sealed partial class AppService
{
    internal List<JsonObject> Batches { get; set; } = [];
    bool _queuePaused;
    string? _recoveredAt;
    int _recoveredOnStart, _printedRun;   // cards to check after a restart; cards printed since the queue last emptied
    bool _pausedForUpdate;   // paused only so an update could install: carry on once the program is back
    internal bool QueuePaused { get => _queuePaused; set { _queuePaused = value; _pausedForUpdate = false; } }   // a person's choice replaces the update's reason
    internal string? RecoveredAt { get => _recoveredAt; set => _recoveredAt = value; }

    static readonly string[] Active = ["sending", "printing", "attention"];
    internal static JsonArray Items(JsonObject b) => b["items"] as JsonArray ?? (JsonArray)(b["items"] = new JsonArray());
    internal static string S(JsonObject o, string k) => Js.ToStr(o[k]);

    void LoadQueue()
    {
        var state = Js.Parse((string?)Db.Row("SELECT value FROM meta WHERE key = ?", "queue")?["value"]) as JsonObject ?? new JsonObject();
        _queuePaused = Js.Truthy(state["paused"]); _recoveredAt = Js.AsString(state["recoveredAt"]);
        Batches = [];
        foreach (var r in Db.Rows("SELECT data FROM batches ORDER BY created_at"))
        {
            if (Js.Parse((string?)r["data"]) is not JsonObject b) continue;
            var items = new JsonArray();
            foreach (var x in Db.Rows("SELECT data FROM queue_items WHERE batch_id = ? ORDER BY seq", S(b, "id"))) if (Js.Parse((string?)x["data"]) is JsonObject it) items.Add(it);
            b["items"] = items;
            Batches.Add(b);
        }
        // Crash recovery: anything mid-print when the service stopped needs a person to check it,
        // so a card is never printed twice without someone confirming.
        var recovered = 0;
        foreach (var b in Batches)
        {
            if (S(b, "status") == "preparing") b["status"] = "incomplete";
            foreach (var it in Items(b).OfType<JsonObject>())
                if (Active.Contains(S(it, "status")))
                {
                    it["status"] = "interrupted"; recovered++;
                    it["error"] = "The app was closed or the PC restarted while this card was printing. Check the printer output, then mark it printed or reprint it.";
                }
        }
        if (recovered > 0) { _queuePaused = true; _recoveredAt = Js.Now(); _recoveredOnStart = recovered; Log($"Recovered queue after restart: {recovered} card(s) need checking"); }
        // Versions up to 3.0.6 didn't save why the queue was paused: the update's download folder, still here on the first start, says so.
        // The same version starting again means the update hasn't installed yet (another Windows account's copy took over): keep waiting.
        var forUpdate = state["pausedForUpdate"] is JsonValue p ? Js.Truthy(p) : (bool?)null;
        var sameVersion = Js.ToStr(state["pausedForUpdateFrom"]) == Version;
        _pausedForUpdate = _queuePaused && recovered == 0 && forUpdate == true && sameVersion;
        if (ResumesAfterUpdate(_queuePaused, forUpdate, recovered, Directory.GetDirectories(OwnDir, "update-*").Length > 0, sameVersion))
        { _queuePaused = false; Log("Print queue resumed after the update"); }
        SaveQueue(quiet: true);
    }

    internal void SaveQueue(bool quiet = false)
    {
        RecomputeBatches();
        Db.Tx(() =>
        {
            var keep = Batches.Select(b => S(b, "id")).ToHashSet();
            foreach (var r in Db.Rows("SELECT id FROM batches")) if (!keep.Contains((string)r["id"]!)) Db.Exec("DELETE FROM batches WHERE id = ?", r["id"]);   // cascades to items and card images
            foreach (var b in Batches)
            {
                var rest = (JsonObject)b.DeepClone(); rest.Remove("items");
                Db.Exec("INSERT INTO batches(id, client_id, name, created_at, status, sides, design, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, sides = excluded.sides, data = excluded.data",
                    S(b, "id"), Js.AsString(b["clientId"]), S(b, "name"), S(b, "createdAt"), S(b, "status"), Js.AsString(b["sides"]) ?? "both", S(b, "designName"), Js.Stringify(rest));
                var i = 0;
                foreach (var it in Items(b).OfType<JsonObject>()) UpsertItem(b, it, i++);
            }
            Db.Exec("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", "queue", Js.Stringify(new JsonObject { ["paused"] = _queuePaused, ["recoveredAt"] = _recoveredAt, ["pausedForUpdate"] = _pausedForUpdate, ["pausedForUpdateFrom"] = _pausedForUpdate ? Version : null }));
        });
        if (!quiet) BroadcastQueue();
    }

    internal void UpsertItem(JsonObject b, JsonObject it, int seq) =>
        Db.Exec("INSERT INTO queue_items(id, batch_id, person_id, seq, first_name, last_name, status, attempts, error, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, status = excluded.status, attempts = excluded.attempts, error = excluded.error, data = excluded.data",
            S(it, "id"), S(b, "id"), Js.AsString(it["personId"]), seq, S(it, "firstName"), S(it, "lastName"), S(it, "status"), (long)Js.NumOr(it["attempts"], 0), Js.AsString(it["error"]), Js.Stringify(it));

    /// <summary>An update pauses the queue while it installs; once the program is back it carries on, unless a card needs checking.
    /// pausedForUpdate is null when an older version saved the queue, and then a just-installed update counts instead.
    /// sameVersion: the version that paused it has started again, so the update hasn't installed yet.</summary>
    internal static bool ResumesAfterUpdate(bool paused, bool? pausedForUpdate, int recovered, bool justUpdated, bool sameVersion = false) =>
        paused && recovered == 0 && !(pausedForUpdate == true && sameVersion) && (pausedForUpdate ?? justUpdated);

    void RecomputeBatches()
    {
        foreach (var b in Batches)
        {
            var status = S(b, "status");
            if (status is "preparing" or "incomplete") continue;
            var c = CountItems(b);
            b["counts"] = c;
            long N(string k) => (long)Js.ToNumber(c[k]);
            b["status"] = N("printing") + N("sending") + N("attention") > 0 ? "printing"
                : _queuePaused && N("interrupted") + N("failed") > 0 ? "needs-review"   // e.g. after a restart: a card to check before resuming
                : N("queued") > 0 ? (N("printed") + N("failed") > 0 ? "printing" : "queued")
                : N("interrupted") + N("failed") > 0 ? "needs-review"
                : N("printed") > 0 ? "done" : "cancelled";
        }
    }

    static JsonObject CountItems(JsonObject b)
    {
        var items = Items(b);
        var c = new JsonObject { ["total"] = items.Count, ["queued"] = 0, ["sending"] = 0, ["printing"] = 0, ["attention"] = 0, ["printed"] = 0, ["failed"] = 0, ["cancelled"] = 0, ["interrupted"] = 0 };
        foreach (var it in items.OfType<JsonObject>()) { var s = S(it, "status"); c[s] = (long)Js.NumOr(c[s], 0) + 1; }
        return c;
    }

    internal (JsonObject B, JsonObject It)? FindItem(string id)
    {
        foreach (var b in Batches) { var it = Items(b).OfType<JsonObject>().FirstOrDefault(i => S(i, "id") == id); if (it is not null) return (b, it); }
        return null;
    }

    internal JsonObject PublicQueue()
    {
        var batches = new JsonArray();
        foreach (var b in Batches)
        {
            var copy = (JsonObject)b.DeepClone();
            foreach (var it in Items(copy).OfType<JsonObject>()) it.Remove("spoolInfo");
            batches.Add(copy);
        }
        return new JsonObject { ["paused"] = _queuePaused, ["recoveredAt"] = _recoveredAt, ["batches"] = batches };
    }

    Timer? _queueTimer;
    internal void BroadcastQueue()
    {
        _queueTimer?.Dispose();
        _queueTimer = new Timer(_ => Safe(() => Locked(() => { if (!_disposed) Broadcast("queue", PublicQueue()); })), null, 80, Timeout.Infinite);
    }

    // ---------------- print history ----------------
    internal void RecordHistory(JsonObject b, JsonObject it, string status, string? note = null)
    {
        var sup = _printerStatus["supplies"];
        try
        {
            var op = S(Config, "operatorName"); var user = S(b, "user");
            Db.Exec("INSERT INTO print_history(ts, client_id, client_name, person_id, first_name, last_name, status, sides, batch, batch_id, design, printer, operator, ribbon, film, note, design_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                Js.Now(), Js.AsString(b["clientId"]), S(b, "clientName"), Js.AsString(it["personId"]), S(it, "firstName"), S(it, "lastName"), status, Js.AsString(b["sides"]) ?? "both", S(b, "name"), S(b, "id"), S(b, "designName"),
                Js.Truthy(Config["simulate"]) ? "Simulator" : S(Config, "printerName"), op.Length > 0 && user.Length > 0 && op != user ? $"{op} ({user})" : op.Length > 0 ? op : user,
                Percent(sup?["ribbon"]), Percent(sup?["film"]), note ?? "", Js.AsString(b["designId"]));
        }
        catch (Exception e) { Log("History write failed: " + e.Message); }
    }

    static object? Percent(JsonNode? s) => s?["percent"] is { } p && double.IsFinite(Js.ToNumber(p)) ? Js.ToNumber(p) : null;

    // ---------------- supply estimates ----------------
    // Every printed card logs the ribbon and film %. From how fast the % falls since the roll was
    // fitted, we estimate how many more cards it will print.
    internal sealed record SupplyEntry(string? Rp, double? R, string? Fp, double? F);
    List<SupplyEntry> _supplyLog = [];

    void LogSupplies()
    {
        var sup = _printerStatus["supplies"]; if (sup is null) return;
        var e = new SupplyEntry(Js.AsString(sup["ribbon"]?["part"]), Percent(sup["ribbon"]) as double?, Js.AsString(sup["film"]?["part"]), Percent(sup["film"]) as double?);
        _supplyLog.Add(e);
        if (_supplyLog.Count > 2000) _supplyLog = _supplyLog[^2000..];
        try { Db.Exec("INSERT INTO supply_log(ts, ribbon_part, ribbon, film_part, film, card_count) VALUES (?, ?, ?, ?, ?, ?)", Js.Now(), e.Rp, e.R, e.Fp, e.F, sup["cardCount"] is { } cc ? Js.ToNumber(cc) : null); } catch (Exception) { }
    }

    JsonObject? Estimate(bool ribbon, JsonNode? current)
    {
        if (current is null) return null;
        var seg = new List<(string? Part, double Pct)>();
        for (int i = _supplyLog.Count - 1; i >= 0; i--)
        {
            var e = _supplyLog[i];
            var (part, pct) = ribbon ? (e.Rp, e.R) : (e.Fp, e.F);
            if (pct is null) break;
            if (seg.Count > 0 && (part != seg[^1].Part || pct < seg[^1].Pct)) break;   // new roll fitted
            seg.Add((part, pct.Value));
        }
        if (seg.Count < 6) return null;
        var drop = seg[^1].Pct - seg[0].Pct;
        if (drop < 2) return null;
        var perPct = (seg.Count - 1) / drop;
        return new JsonObject
        {
            ["cardsLeft"] = (long)Math.Max(0, Math.Round(Js.ToNumber(current) * perPct, MidpointRounding.AwayFromZero)),
            ["cardsPerPercent"] = Js.NumNode(Math.Round(perPct * 10, MidpointRounding.AwayFromZero) / 10), ["basedOn"] = seg.Count,
        };
    }

    JsonObject WithEstimates(JsonObject st)
    {
        if (st["supplies"] is JsonObject sup)
        {
            if (sup["ribbon"] is JsonObject r) r["estimate"] = Estimate(true, r["percent"]);
            if (sup["film"] is JsonObject f) f["estimate"] = Estimate(false, f["percent"]);
        }
        return st;
    }

    // ---------------- print worker ----------------
    internal sealed class WorkerState
    {
        public string Phase = "idle", Message = "Idle";
        public JsonObject? Current;
        public bool CancelCurrent, Running;
        public JsonObject? LastFinished;
    }
    internal readonly WorkerState _worker = new();

    internal void SetWorker(string? phase = null, string? message = null, JsonObject? current = null, bool keepCurrent = false, bool? cancelCurrent = null)
    {
        if (phase is not null) _worker.Phase = phase;
        if (message is not null) _worker.Message = message;
        if (!keepCurrent) _worker.Current = current;
        if (cancelCurrent is { } c) _worker.CancelCurrent = c;
        Broadcast("worker", PublicWorker());
    }

    internal JsonObject PublicWorker() => new()
    {
        ["phase"] = _worker.Phase, ["message"] = _worker.Message, ["current"] = _worker.Current?.DeepClone(), ["lastFinished"] = _worker.LastFinished?.DeepClone(),
    };

    JsonObject? BlockingAlert() => Js.Arr(_printerStatus["alerts"]).OfType<JsonObject>().FirstOrDefault(a => S(a, "level") == "error");

    internal (JsonObject B, JsonObject It)? NextItem()
    {
        foreach (var b in Batches.Where(b => S(b, "status") is not ("preparing" or "incomplete")).OrderBy(b => S(b, "createdAt"), StringComparer.Ordinal))
        {
            var it = Items(b).OfType<JsonObject>().FirstOrDefault(i => S(i, "status") == "queued");
            if (it is not null) return (b, it);
        }
        return null;
    }

    internal void Kick() => _ = Task.Run(WorkerLoop);

    /// <summary>New cards: start printing, or (with "Start printing automatically" off) wait in a paused queue for Resume.</summary>
    internal void HoldOrKick() { if (Js.Truthy(Config["autoStart"])) Kick(); else if (!_worker.Running) { _queuePaused = true; SaveQueue(); } }

    async Task WorkerLoop()
    {
        if (!await LockedAsync(() => { if (_worker.Running || _disposed) return false; _worker.Running = true; return true; })) return;
        try
        {
            for (;;)
            {
                var step = await LockedAsync<(JsonObject B, JsonObject It)?>(() =>
                {
                    if (_disposed) return null;
                    var n = NextItem();
                    if (n is null)
                    {
                        if (_worker.Phase != "idle") SetWorker("idle", "All cards printed");
                        if (_printedRun > 0) { Notify("Printing finished", $"{Cards(_printedRun)} printed. The print queue is empty."); _printedRun = 0; }
                        return null;
                    }
                    if (_queuePaused) { SetWorker("paused", _recoveredAt is not null ? "Paused after restart: check interrupted cards, then press Resume" : "Queue paused"); return null; }
                    var block = BlockingAlert();
                    if (block is not null && Js.Truthy(Config["pauseOnError"])) { SetWorker("waiting", $"Waiting for printer: {S(block, "title")}"); return (null!, null!); }
                    return n;
                });
                if (step is null) break;
                if (step.Value.B is null) { await Task.Delay(2000); continue; }
                await PrintOne(step.Value.B, step.Value.It);
                var delay = await LockedAsync(() => Js.ToNumber(Config["delayBetweenCards"]));
                if (delay > 0) await Task.Delay(TimeSpan.FromSeconds(delay));
            }
        }
        catch (Exception e)
        {
            await LockedAsync(() => { if (_disposed) return; Log("Worker error " + e); SetWorker("error", "Print worker error: " + e.Message, keepCurrent: true); });
        }
        finally { await LockedAsync(() => _worker.Running = false); }
    }

    /// <summary>The card images come straight from the encrypted database and go to the printer in memory.</summary>
    byte[] CardImage(JsonObject it, string side) =>
        Db.Scalar("SELECT png FROM card_images WHERE item_id = ? AND side = ?", S(it, "id"), side) as byte[] ?? throw new InvalidOperationException($"The {side} image for this card is missing from the database.");

    // What to send for a card, by the batch's print mode:
    //   both  = front + back as one dual-sided job (needs a flipper)
    //   front = front only        back = back only (cards fed back in after flipping)
    PrintJob SidesJob(JsonObject b, JsonObject it, string docName)
    {
        var sides = Js.AsString(b["sides"]) ?? "both";
        var size = PrintSize(b["card"]);
        var rotateBack = Js.Truthy(Config["rotateBack"]);
        if (sides == "back") return new PrintJob(CardImage(it, "back"), null, docName, false, false, rotateBack, size);
        if (sides == "front" || !Js.Truthy(b["hasBack"])) return new PrintJob(CardImage(it, "front"), null, docName, false, false, false, size);
        return new PrintJob(CardImage(it, "front"), CardImage(it, "back"), docName, true, rotateBack, false, size);
    }

    static string NowIso() => Js.Now();

    async Task PrintOne(JsonObject b, JsonObject it)
    {
        string label = "", who = "", docName = $"IDCard-{S(it, "id")}";
        JsonObject cur = new();
        PrintJob? job = null; string? prepError = null;
        await LockedAsync(() =>
        {
            var items = Items(b);
            int index = items.IndexOf(it) + 1, total = items.Count;
            who = $"{S(it, "firstName")} {S(it, "lastName")}".Trim();
            var sides = S(b, "sides");
            label = $"{(sides == "back" ? "back of " : sides == "front" && Js.Truthy(b["hasBack"]) ? "front of " : "")}ID card {index} of {total}";
            cur = new JsonObject { ["batchId"] = S(b, "id"), ["batchName"] = S(b, "name"), ["itemId"] = S(it, "id"), ["index"] = index, ["total"] = total, ["name"] = who, ["startedAt"] = NowIso() };
            it["status"] = "sending"; it["attempts"] = (long)Js.NumOr(it["attempts"], 0) + 1; it["startedAt"] = cur["startedAt"]!.DeepClone(); it["error"] = null; SaveQueue();
            SetWorker("printing", $"Sending {label} to printer: {who}", cur, cancelCurrent: false);
            try { job = SidesJob(b, it, docName); } catch (Exception e) { prepError = e.Message; }
        });

        PrintResult res;
        if (job is null) res = new PrintResult(false, Error: prepError);
        else
        {
            var printer = await LockedAsync(() => _printer!);
            try { res = await printer.PrintAsync(job); } catch (Exception e) { res = new PrintResult(false, Error: e.Message); }
        }

        var failed = await LockedAsync(() =>
        {
            if (res.Ok)
            {
                it["status"] = "printing"; it["spoolInfo"] = res.Info; SaveQueue();
                Log($"Spooled {label} ({who}) {res.Info}");
                SetWorker("printing", $"Printing {label}: {who}", cur);
                return false;
            }
            var error = res.MaybeSpooled ? "Sending this card timed out, so it may still print. Check the printer output, then mark it printed or reprint it." : res.Error ?? "Unknown error sending to printer";
            it["status"] = res.MaybeSpooled ? "interrupted" : "failed"; it["error"] = error; it["finishedAt"] = NowIso(); SaveQueue();
            RecordHistory(b, it, res.MaybeSpooled ? "check" : "failed", error); Log($"Failed {label} ({who}): {error}");
            SetWorker("attention", $"Could not send {label}: {error}");
            Notify(res.MaybeSpooled ? "Check a card" : "A card didn't print", $"{who}: {error}", true);
            if (Js.Truthy(Config["pauseOnError"])) { _queuePaused = true; SaveQueue(); }
            return true;
        });
        if (failed) return;

        var t0 = DateTime.UtcNow; bool seen = false, hadError = false, alerted = false; int idlePolls = 0;
        for (;;)
        {
            await Task.Delay(1000);
            if (await LockedAsync(() => _worker.CancelCurrent || _disposed))
            {
                if (_disposed) return;
                var printer = await LockedAsync(() => _printer!);
                try { await printer.CancelJobAsync(docName); } catch (Exception e) { await LockedAsync(() => Log("Could not cancel the print job: " + e.Message)); }
                await LockedAsync(() =>
                {
                    it["status"] = "cancelled"; it["error"] = "Cancelled while printing"; it["finishedAt"] = NowIso(); SaveQueue();
                    RecordHistory(b, it, "cancelled"); SetWorker("idle", $"{label} cancelled", cancelCurrent: false);
                });
                return;
            }
            var done = await LockedAsync(() =>
            {
                var st = _printerStatus;
                var jobSeen = Js.Arr(st["jobs"]).OfType<JsonObject>().Any(j => S(j, "document") == docName);
                if (jobSeen) seen = true;
                var err = Js.Arr(st["alerts"]).OfType<JsonObject>().FirstOrDefault(a => S(a, "level") == "error");
                if (err is not null)
                {
                    hadError = true; alerted = true;
                    if (S(it, "status") != "attention") { it["status"] = "attention"; it["error"] = S(err, "title"); SaveQueue(); }
                    SetWorker("attention", $"{label} needs attention: {S(err, "title")}", cur);
                    return false;
                }
                if (alerted) { alerted = false; it["status"] = "printing"; it["error"] = null; SaveQueue(); SetWorker("printing", $"Printing {label}: {who}", cur); }
                var elapsed = DateTime.UtcNow - t0;
                var timeout = TimeSpan.FromMinutes(Js.NumOr(Config["jobTimeoutMin"], 10));
                if (!jobSeen && (seen || elapsed > TimeSpan.FromSeconds(8)))
                {
                    // Job has left the Windows queue; wait for the printer itself to finish the card.
                    idlePolls = Js.Truthy(st["busy"]) ? 0 : idlePolls + 1;
                    if (idlePolls >= 2 || elapsed > timeout) { FinishCard(b, it, label, who, hadError); return true; }
                    SetWorker("printing", $"Finishing {label}: {who}", cur);
                }
                else if (elapsed > timeout && S(it, "status") != "attention")
                {
                    it["status"] = "attention"; it["error"] = "This card is taking much longer than expected."; SaveQueue();
                    SetWorker("attention", $"{label} is taking longer than expected. Check the printer.", cur);
                }
                return false;
            });
            if (done) return;
        }
    }

    void FinishCard(JsonObject b, JsonObject it, string label, string who, bool hadError)
    {
        if (hadError)
        {
            it["status"] = "interrupted"; it["error"] = "The printer reported a problem while this card was printing. Check the card, then mark it printed or reprint it.";
            it["finishedAt"] = NowIso(); SaveQueue(); RecordHistory(b, it, "check", S(it, "error"));
            SetWorker("attention", $"Check {label} ({who}): printer had a problem during this card");
            if (Js.Truthy(Config["pauseOnError"])) { _queuePaused = true; SaveQueue(); }
            Notify("Check a card", $"{who}: the printer had a problem while this card was printing. Check it in the print queue, then choose Resume printing.", true);
            return;
        }
        var personId = Js.AsString(it["personId"]);
        var backOnly = S(b, "sides") == "back";
        var was = personId is not null && !backOnly ? (string?)PersonRow(personId)?["card_status"] : null;
        it["status"] = "printed"; it["finishedAt"] = NowIso(); SaveQueue(); _printedRun++;
        RecordHistory(b, it, "printed", was == "lost" ? "Replacement for a lost card" : "");
        _ = Task.Delay(3000).ContinueWith(_ => Safe(() => Locked(() => { if (!_disposed) LogSupplies(); })));
        if (personId is not null && !backOnly)
        {
            try { MarkPrinted(personId, S(it, "finishedAt")); BroadcastClients(); } catch (Exception) { }   // people lists show the new print
        }
        Log($"Printed {label} ({who})");
        _worker.LastFinished = new JsonObject { ["name"] = who, ["at"] = S(it, "finishedAt") };
        SetWorker("printing", $"Printed {label}: {who}");
    }

    /// <summary>A new card is an active card.</summary>
    internal void MarkPrinted(string personId, string at) =>
        Db.Exec("UPDATE people SET last_printed_at = ?, print_count = print_count + 1, card_status = NULL WHERE id = ?", at, personId);
}
