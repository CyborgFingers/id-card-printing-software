// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Live updates to the screens (server-sent events), for signed-in users only.
using System.Text.Json.Nodes;
using System.Threading.Channels;

namespace IdCard.Service;

public sealed partial class AppService
{
    internal sealed record EventClient(string TokenHash, Channel<string> Channel);
    readonly HashSet<EventClient> _clients = [];

    internal void AddClient(EventClient c) => _clients.Add(c);
    internal void RemoveClient(EventClient c) => _clients.Remove(c);

    internal static string EventText(string ev, JsonNode? data) => $"event: {ev}\ndata: {Js.Stringify(data)}\n\n";

    /// <summary>Sends to every open screen; a screen whose sign-in has ended is disconnected instead.</summary>
    internal void Broadcast(string ev, JsonNode? data)
    {
        if (_clients.Count == 0) return;
        var msg = EventText(ev, data);
        foreach (var c in _clients.ToList())
        {
            if (Db.Row("SELECT 1 FROM sessions WHERE token_hash = ?", c.TokenHash) is null) { c.Channel.Writer.TryComplete(); _clients.Remove(c); continue; }
            c.Channel.Writer.TryWrite(msg);
        }
    }

    void Ping() => Locked(() => { foreach (var c in _clients) c.Channel.Writer.TryWrite(": ping\n\n"); });

    internal void CloseClients()
    {
        foreach (var c in _clients) c.Channel.Writer.TryComplete();
        _clients.Clear();
    }
}
