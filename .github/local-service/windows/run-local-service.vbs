Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
installRoot = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\LunaTV Local Service"
binaryPath = installRoot & "\bin\lunatv-server.exe"
configPath = installRoot & "\config.json"
dataDir = installRoot & "\data"
sqlitePath = dataDir & "\moontv-local-service.sqlite3"
If Not fso.FolderExists(dataDir) Then fso.CreateFolder(dataDir)
command = Chr(34) & binaryPath & Chr(34) & " --host 127.0.0.1 --port 8787 --config-path " & Chr(34) & configPath & Chr(34) & " --data-dir " & Chr(34) & dataDir & Chr(34) & " --sqlite-path " & Chr(34) & sqlitePath & Chr(34)
shell.Run command, 0, False
