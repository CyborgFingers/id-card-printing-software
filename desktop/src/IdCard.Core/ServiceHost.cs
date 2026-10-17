// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Runs the print service and its local web server (localhost only).
using IdCard.Http;
using IdCard.Service;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;

namespace IdCard;

public sealed class ServiceHost : IAsyncDisposable
{
    readonly WebApplication _web;
    public AppService App { get; }
    public string Url => $"http://localhost:{App.Port}";

    ServiceHost(AppService app, WebApplication web) { App = app; _web = web; }

    /// <summary>Opens the database and starts listening. Throws StartupException with a plain-English reason.</summary>
    public static async Task<ServiceHost> StartAsync(ServiceOptions options)
    {
        var app = new AppService(options);
        try
        {
            var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { ContentRootPath = AppContext.BaseDirectory });
            builder.Logging.ClearProviders();
            builder.WebHost.ConfigureKestrel(k =>
            {
                k.ListenLocalhost(app.Port);   // 127.0.0.1 and ::1
                k.AddServerHeader = false;
                k.Limits.MaxRequestBodySize = null;   // each route sets its own limit
            });
            var web = builder.Build();
            var router = new Router(app);
            web.Run(router.Handle);
            try { await web.StartAsync(); }
            catch (IOException)
            {
                await web.DisposeAsync();
                throw new StartupException($"Port {app.Port} is already in use",
                    $"Another program is using port {app.Port}, possibly an older version of {AppService.AppName}. Close it or restart Windows, then open the program again.");
            }
            app.Started();
            return new ServiceHost(app, web);
        }
        catch
        {
            app.Dispose();
            throw;
        }
    }

    public async ValueTask DisposeAsync()
    {
        App.Dispose();
        using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3))) { try { await _web.StopAsync(cts.Token); } catch (OperationCanceledException) { } }
        await _web.DisposeAsync();
    }
}
