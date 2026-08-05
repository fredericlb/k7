' hidden.vbs - run the given command with NO console window; used by the studio-*
' logon tasks (scripts/remote.mjs) so a boot does not open three terminals. Waits
' on the child, so Task Scheduler sees the task as running rather than finished.
Set sh = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & """" & WScript.Arguments(i) & """ "
Next
sh.Run Trim(cmd), 0, True
