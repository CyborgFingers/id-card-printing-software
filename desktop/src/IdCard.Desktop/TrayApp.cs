// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The notification-area icon. It owns the print service and the app window, and keeps running
// (and printing) while the window is closed.
using Microsoft.Win32;

namespace IdCard.Desktop;

sealed class TrayApp : ApplicationContext
{
    readonly SynchronizationContext _ui = new WindowsFormsSynchronizationContext();
    readonly NotifyIcon _tray = new();
    readonly RegisteredWaitHandle _showWait, _exitWait;
    ServiceHost? _host;
    MainWindow? _window;
    bool _openWhenReady, _exiting, _tipOpensQueue;

    public TrayApp(bool openWindow, EventWaitHandle showEvent, EventWaitHandle exitEvent)
    {
        _openWhenReady = openWindow;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open ID Card Printing Software", null, (_, _) => ShowWindow());
        _tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        _tray.Text = Program.Title;
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => ShowWindow();
        _tray.BalloonTipClicked += (_, _) => ShowWindow(_tipOpensQueue ? "#/queue" : null);
        _tray.Visible = true;
        _showWait = ThreadPool.RegisterWaitForSingleObject(showEvent, (_, _) => _ui.Post(_ => ShowWindow(), null), null, Timeout.Infinite, false);
        _exitWait = ThreadPool.RegisterWaitForSingleObject(exitEvent, (_, _) => _ui.Post(_ => Exit(), null), null, Timeout.Infinite, true);   // the uninstaller
        SystemEvents.SessionEnded += (_, _) => { StopService(); _ui.Post(_ => Exit(), null); };   // signing out or shutting down: save first
        // Start once the message loop runs, so a startup failure can end it.
        _ui.Post(_ => _ = Start(), null);
    }

    async Task Start()
    {
        try
        {
            _host = await Task.Run(() => ServiceHost.StartAsync(Program.Options(() => _ui.Post(_ => Exit(), null),
                (title, message, problem) => _ui.Post(_ => ShowTip(title, message, problem ? ToolTipIcon.Warning : ToolTipIcon.Info, true), null))));
        }
        catch (Exception e)
        {
            _tray.Visible = false;
            if (e is Service.StartupException s) Program.ShowError(s.Title, s.Details);
            else Program.ShowError("ID Card Printing Software could not start.", e.Message);
            Exit();
            return;
        }
        if (_openWhenReady) ShowWindow();
    }

    void ShowWindow(string? screen = null)
    {
        if (_exiting) return;
        if (_host is null) { _openWhenReady = true; return; }   // still starting: open once ready
        if (_window is null || _window.IsDisposed) _window = new MainWindow(_host.Url, Program.DataDir, Exit, m => ShowTip(Program.Title, m, ToolTipIcon.None, false));
        if (screen is not null) _window.Go(screen);
        _window.ShowAndActivate();
    }

    /// <summary>A Windows notification from the tray icon. Clicking one about printing opens the print queue.</summary>
    void ShowTip(string title, string message, ToolTipIcon icon, bool opensQueue)
    {
        if (_exiting) return;
        _tipOpensQueue = opensQueue;
        _tray.ShowBalloonTip(10000, title, message, icon);
    }

    void Exit()
    {
        if (_exiting) return;
        _exiting = true;
        _tray.Visible = false;
        _window?.CloseForExit();
        StopService();
        ExitThread();
    }

    /// <summary>Saves and stops the print service (any thread, once).</summary>
    void StopService()
    {
        if (Interlocked.Exchange(ref _host, null) is { } host) Task.Run(async () => await host.DisposeAsync()).Wait(TimeSpan.FromSeconds(10));
    }

    protected override void ExitThreadCore()
    {
        _showWait.Unregister(null);
        _exitWait.Unregister(null);
        _tray.Visible = false;
        _tray.Dispose();
        base.ExitThreadCore();
    }
}
