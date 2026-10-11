# Persistent, on-demand worker: no polling while idle. Run with Windows PowerShell -STA.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SelectionNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [StructLayout(LayoutKind.Sequential)] private struct LASTINPUTINFO { public uint size; public uint tick; }
  [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LASTINPUTINFO value);
  public static uint LastInputTick() {
    var value = new LASTINPUTINFO { size = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
    GetLastInputInfo(ref value); return value.tick;
  }
}
'@
function Frontmost {
  $handle = [SelectionNative]::GetForegroundWindow()
  [uint32]$processId = 0
  [void][SelectionNative]::GetWindowThreadProcessId($handle, [ref]$processId)
  $name = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
  return @{ pid = $processId; name = $name; handle = $handle.ToInt64() }
}
function Capture($request) {
  $front = Frontmost
  if ($front.handle -ne $request.handle) { return @{ text = '' } }
  $element = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $element -or $element.Current.IsPassword) { return @{ text = '' } }
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    $text = (($pattern.GetSelection() | ForEach-Object { $_.GetText(20001) }) -join "`n").Trim()
    if ($text) { return @{ text = $text; method = 'accessibility' } }
  }
  # Explorer copy means files. Avoid issuing Copy for shell/file drags.
  if ($front.name -eq 'explorer') { return @{ text = '' } }
  $saved = New-Object System.Windows.Forms.DataObject
  $original = [System.Windows.Forms.Clipboard]::GetDataObject()
  if ($null -ne $original) {
    foreach ($format in $original.GetFormats($false)) {
      # Materialize all formats before Copy. Abort on any unsupported format.
      $data = $original.GetData($format, $false)
      if ($null -eq $data) { return @{ text = '' } }
      $saved.SetData($format, $false, $data)
    }
  }
  if ((Frontmost).handle -ne $request.handle) { return @{ text = '' } }
  $before = [SelectionNative]::GetClipboardSequenceNumber()
  [System.Windows.Forms.SendKeys]::SendWait('^c')
  $copyInput = [SelectionNative]::LastInputTick()
  for ($attempt = 0; $attempt -lt 8; $attempt++) {
    Start-Sleep -Milliseconds 40
    if ((Frontmost).handle -ne $request.handle -or [SelectionNative]::LastInputTick() -ne $copyInput) { return @{ text = '' } }
    $count = [SelectionNative]::GetClipboardSequenceNumber()
    if ($count -ne $before) {
      $text = [System.Windows.Forms.Clipboard]::GetText()
      if ([SelectionNative]::GetClipboardSequenceNumber() -eq $count) {
        if ($null -eq $original) { [System.Windows.Forms.Clipboard]::Clear() }
        else { [System.Windows.Forms.Clipboard]::SetDataObject($saved, $true) }
      }
      return @{ text = $text; method = 'copy' }
    }
  }
  return @{ text = '' }
}
while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    if ($request.command -eq 'quit') { break }
    $result = switch ($request.command) {
      'frontmost' { Frontmost }
      'capture' { Capture $request }
      default { @{} }
    }
    $result.id = $request.id
    [Console]::WriteLine(($result | ConvertTo-Json -Compress -Depth 5))
  } catch {
    [Console]::WriteLine((@{ id = $request.id; text = ''; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
