// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Development host: the print service with the simulated printer, on any OS.
//   IDCARD_DB_KEY=dev-key dotnet run --project desktop/src/IdCard.DevHost
// IDCARD_DATA (default ./data), IDCARD_PORT (default 5180) and IDCARD_WEBROOT (default the built copy of web/;
// point it at web/ to see screen changes without rebuilding) are optional.
using IdCard;
using IdCard.Service;

var key = Environment.GetEnvironmentVariable("IDCARD_DB_KEY");
if (string.IsNullOrEmpty(key)) { Console.Error.WriteLine("Set IDCARD_DB_KEY (any test key) to run the development host."); return 1; }

var stopped = new TaskCompletionSource();
ServiceHost host;
try
{
    host = await ServiceHost.StartAsync(new ServiceOptions
    {
        DataDir = Environment.GetEnvironmentVariable("IDCARD_DATA") ?? Path.Combine(Environment.CurrentDirectory, "data"),
        WebRoot = Environment.GetEnvironmentVariable("IDCARD_WEBROOT") ?? Path.Combine(AppContext.BaseDirectory, "wwwroot"),
        GetDbKey = _ => key,
        KeyProtection = "Test key (not Windows)",
        Port = int.TryParse(Environment.GetEnvironmentVariable("IDCARD_PORT"), out var port) ? port : null,
        UpdateFeed = Environment.GetEnvironmentVariable("IDCARD_UPDATE_FEED"),
        Stopped = () => stopped.TrySetResult(),
    });
}
catch (StartupException e)
{
    Console.Error.WriteLine($"{e.Title}\n{e.Details}");
    return 1;
}
Console.WriteLine($"{AppService.AppName} (development) on {host.Url}");
Console.CancelKeyPress += (_, e) => { e.Cancel = true; stopped.TrySetResult(); };
using var term = System.Runtime.InteropServices.PosixSignalRegistration.Create(System.Runtime.InteropServices.PosixSignal.SIGTERM, ctx => { ctx.Cancel = true; stopped.TrySetResult(); });
await stopped.Task;
await host.DisposeAsync();
return 0;
