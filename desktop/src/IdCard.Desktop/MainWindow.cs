// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The app window: the screens, shown with WebView2. Closing it only hides it; printing carries on.
using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace IdCard.Desktop;

sealed class MainWindow : Form
{
    static readonly HashSet<string> EditMenu = ["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "emoji", "spellCheck", "other"];
    readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    readonly string _url, _dataDir;
    readonly Action _exit;
    readonly NotifyIcon _tray;
    bool _exiting, _toldStillRunning;

    public MainWindow(string url, string dataDir, Action exit, NotifyIcon tray)
    {
        _url = url.TrimEnd('/') + "/"; _dataDir = dataDir; _exit = exit; _tray = tray;
        Text = Program.Title;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        var screen = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1920, 1040);
        Size = new Size(Math.Min(LogicalToDeviceUnits(1320), screen.Width), Math.Min(LogicalToDeviceUnits(880), screen.Height));
        MinimumSize = new Size(Math.Min(LogicalToDeviceUnits(960), screen.Width), Math.Min(LogicalToDeviceUnits(640), screen.Height));
        if (Size.Width >= screen.Width || Size.Height >= screen.Height) WindowState = FormWindowState.Maximized;   // small screens
        BackColor = Color.White;
        Controls.Add(_web);
        Load += async (_, _) => await Init();
    }

    async Task Init()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(_dataDir, "WebView2"));
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Program.ShowError("ID Card Printing Software can't show its window.", "The WebView2 Runtime is missing. Run the setup program again to install it.");
            _exit();
            return;
        }
        var core = _web.CoreWebView2;
        var s = core.Settings;
#if !DEBUG
        s.AreDevToolsEnabled = false;
#endif
        s.IsStatusBarEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;   // an app, not a browser: no find bar, page printing or reload keys
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        core.NavigationStarting += (_, e) =>
        {
            if (Ours(e.Uri)) return;
            e.Cancel = true;
            OpenOutside(e.Uri);
        };
        core.NewWindowRequested += (_, e) =>
        {
            // Pages of our own (the proof sheet) open in their own window; web links open in the default browser.
            if (Ours(e.Uri)) return;
            e.Handled = true;
            OpenOutside(e.Uri);
        };
        core.PermissionRequested += (_, e) =>
        {
            if (e.PermissionKind == CoreWebView2PermissionKind.Notifications && Ours(e.Uri)) e.State = CoreWebView2PermissionState.Allow;
        };
        core.ContextMenuRequested += (_, e) =>
        {
            // Only editing commands (cut, copy, paste...), and only where there is something to edit or copy.
            foreach (var item in e.MenuItems.Where(i => !EditMenu.Contains(i.Name)).ToList()) e.MenuItems.Remove(item);
            if (e.MenuItems.Count == 0 || (!e.ContextMenuTarget.IsEditable && !e.ContextMenuTarget.HasSelection)) e.Handled = true;
        };
        core.ProcessFailed += (_, e) =>
        {
            if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.BrowserProcessExited) { CloseForExit(); return; }   // opened again from the notification area
            core.Reload();
        };
        core.Navigate(_url);
    }

    bool Ours(string uri) => uri.StartsWith(_url, StringComparison.OrdinalIgnoreCase) || uri.Equals(_url.TrimEnd('/'), StringComparison.OrdinalIgnoreCase)
        || uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("blob:" + _url.TrimEnd('/'), StringComparison.OrdinalIgnoreCase) || uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase);

    static void OpenOutside(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp)) return;
        try { using var _ = Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch (System.ComponentModel.Win32Exception) { }
    }

    public void ShowAndActivate()
    {
        if (IsDisposed) return;
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
        BringToFront();
    }

    public void CloseForExit() { _exiting = true; if (!IsDisposed) Close(); }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            if (!_toldStillRunning)
            {
                _toldStillRunning = true;
                _tray.ShowBalloonTip(4000, Program.Title, "Still running, so cards keep printing. Open it again from here.", ToolTipIcon.None);
            }
            return;
        }
        base.OnFormClosing(e);
    }
}
