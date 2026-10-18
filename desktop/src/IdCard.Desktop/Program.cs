// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The Windows program: runs the print service, a notification-area icon and the app window. There is
// deliberately no Exit item: closing the window hides it (printing carries on), and the program is
// closed from Settings by an administrator. "--background" starts it without opening the window
// (used at sign-in).
using System.ComponentModel;
using System.Diagnostics;
using System.Reflection;
using IdCard.Desktop.Printing;
using IdCard.Service;

namespace IdCard.Desktop;

static class Program
{
    internal const string Title = AppService.AppName;
    const string MutexName = @"Local\IDCardPrintingSoftwareFree.App";
    const string ShowEventName = @"Local\IDCardPrintingSoftwareFree.Show";
    internal const string ExitEventName = @"Local\IDCardPrintingSoftwareFree.Exit";

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Contains("--reset-admin", StringComparer.OrdinalIgnoreCase)) return ResetAdminSignIn();
        if (args.Contains("--exit", StringComparer.OrdinalIgnoreCase)) return ExitRunningCopy();
        var background = args.Contains("--background", StringComparer.OrdinalIgnoreCase);
        using var mutex = new Mutex(true, MutexName, out var first);
        if (!first)
        {
            // Already running: bring its window forward instead.
            if (!background && EventWaitHandle.TryOpenExisting(ShowEventName, out var show))
                using (show) { AllowSetForegroundWindow(-1); show.Set(); }
            return 0;
        }
        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        using var exitEvent = new EventWaitHandle(false, EventResetMode.ManualReset, ExitEventName);
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => ShowError("Something went wrong.", e.Exception.Message);
        Application.Run(new TrayApp(!background, showEvent, exitEvent));
        return 0;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);

    internal static string Version =>
        (Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "3.0.0").Split('+')[0];

    internal static ServiceOptions Options(Action stopped, Action<string, string, bool> notify) => new()
    {
        DataDir = DataDir,
        WebRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot"),
        GetDbKey = KeyStore.GetKey,
        KeyProtection = "Windows DPAPI, this Windows account only",
        RealPrinter = settings => new WindowsPrinter(settings),
        Port = int.TryParse(Environment.GetEnvironmentVariable("IDCARD_PORT"), out var port) ? port : null,
        Version = Version,
#if DEBUG
        UpdateFeed = Environment.GetEnvironmentVariable("IDCARD_UPDATE_FEED") is { Length: > 0 } feed ? feed : AppService.DefaultUpdateFeed,   // testing only
#else
        UpdateFeed = AppService.DefaultUpdateFeed,
#endif
        RunInstaller = RunInstaller,
        Stopped = stopped,
        Notify = notify,
        LicenceAcceptedInSetup = true,   // the setup's licence page must be accepted to install
    };

    /// <summary>"--exit" (used by the uninstaller): asks a running copy to save and close, waiting up to 10 seconds.</summary>
    static int ExitRunningCopy()
    {
        if (!EventWaitHandle.TryOpenExisting(ExitEventName, out var exit)) return 0;   // not running
        using (exit) exit.Set();
        for (int i = 0; i < 100; i++)
        {
            if (!Mutex.TryOpenExisting(MutexName, out var m)) return 0;
            m.Dispose();
            Thread.Sleep(100);
        }
        return 1;
    }

    internal static string DataDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ID Card Printing Software");

    /// <summary>"--reset-admin": the emergency sign-in reset (Start menu shortcut).</summary>
    static int ResetAdminSignIn()
    {
        Application.EnableVisualStyles();
        if (Message("Reset the admin sign-in to username admin and password admin?\n\nA new password must be chosen at the next sign-in.",
            MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return 1;
        try { ResetAdmin.Run(DataDir, KeyStore.GetKey(false)); }
        catch (Exception e)
        {
            ShowError("The admin sign-in could not be reset.", e.Message + "\n\nRun this as the Windows user who uses ID Card Printing Software.");
            return 1;
        }
        Message("Done. Sign in with username admin and password admin, then choose a new password.\n\nIf sign-in is paused after too many wrong passwords, close and reopen the program.",
            MessageBoxButtons.OK, MessageBoxIcon.Information);
        return 0;
    }

    /// <summary>Starts the downloaded setup silently; Windows asks for permission because it installs for everyone.
    /// /UPDATE makes the setup open the program again when it's done.</summary>
    static string? RunInstaller(string setup)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(setup, "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE") { UseShellExecute = true, Verb = "runas" });
            return null;
        }
        catch (Win32Exception e) when (e.NativeErrorCode == 1223) { return "The update was cancelled."; }
        catch (Win32Exception e) { return "The update could not start: " + e.Message; }
    }

    internal static void ShowError(string what, string details) => Message(what + Environment.NewLine + Environment.NewLine + details, MessageBoxButtons.OK, MessageBoxIcon.Error);

    /// <summary>A message that opens in front of other windows (at sign-in, from the notification area or a
    /// shortcut, Windows may not give this program the foreground).</summary>
    static DialogResult Message(string text, MessageBoxButtons buttons, MessageBoxIcon icon)
    {
        using var owner = new Form { TopMost = true, ShowInTaskbar = false, FormBorderStyle = FormBorderStyle.None, Opacity = 0, Size = new Size(1, 1), StartPosition = FormStartPosition.CenterScreen };
        owner.Show();
        owner.Activate();
        return MessageBox.Show(owner, text, Title, buttons, icon);
    }
}
