# ═══════════════════════════════════════════════════════════════
# Installation du salon permanent Hnaya en tâche de démarrage Windows
# ═══════════════════════════════════════════════════════════════
# Exécuter en tant qu'administrateur :
#   powershell -ExecutionPolicy Bypass -File install-windows.ps1 `
#     -Name "Salon RH" -Pin 123456 -DataDir "C:\HnayaChat\rh"
#
# Crée une tâche planifiée "HnayaChatServer" lancée au démarrage de la
# machine (compte SYSTEM, redémarrage automatique en cas d'échec).
# Zéro dépendance : utilise le Planificateur de tâches intégré à Windows.
#
# Prérequis : Node.js 22+ dans le PATH, OU passer -NodeExe vers le
# binaire Electron du navigateur Hnaya installé (mode nœud) :
#   -NodeExe "C:\...\Hnaya DZ Browser\Hnaya DZ Browser.exe"
#   (la variable ELECTRON_RUN_AS_NODE=1 est alors ajoutée automatiquement)
#
# Désinstallation : Unregister-ScheduledTask -TaskName HnayaChatServer

param(
  [string]$Name = "Salon Hnaya",
  [string]$Pin = "",
  [string]$DataDir = "$env:ProgramData\HnayaChat",
  [string]$NodeExe = "node",
  [string]$TaskName = "HnayaChatServer"
)

$ErrorActionPreference = "Stop"

# ⚠️ CONTRÔLE DE VERSION, PAS SEULEMENT DE PRÉSENCE.
# Le stockage repose sur node:sqlite (DatabaseSync), apparu en Node 22.5 et
# SANS repli dans le code. Sans ce contrôle, l'installation réussissait sur
# un Node plus ancien et la tâche planifiée s'arrêtait au démarrage sur une
# erreur de module introuvable — invisible, puisqu'elle se produit après
# l'installation et sous le compte SYSTEM.
# On teste la VALEUR RENVOYÉE, pas une exception : un exécutable natif qui
# échoue ne lève pas en PowerShell, même avec ErrorActionPreference = Stop.
$aide = "Telechargement officiel : https://nodejs.org/en/download"
$nodeVer = & $NodeExe -p "process.versions.node" 2>$null
if (-not $nodeVer) { throw "Node.js introuvable ($NodeExe). $aide" }
$nodeOk = & $NodeExe -p "const [a,b]=process.versions.node.split('.').map(Number); (a>22||(a===22&&b>=5))?'1':'0'" 2>$null
if ($nodeOk -ne '1') {
  throw "Node.js $nodeVer detecte - la version 22.5 ou plus est requise (base interne node:sqlite). $aide"
}

# serve.js est à côté de ce script (../src/serve.js)
$serveJs = Join-Path (Split-Path $PSScriptRoot -Parent) "src\serve.js"
if (-not (Test-Path $serveJs)) { throw "src\serve.js introuvable ($serveJs)" }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$serveArgs = "`"$serveJs`" --name `"$Name`" --data `"$DataDir`""
if ($Pin -match '^\d{6}$') { $serveArgs += " --pin $Pin" }

$action = New-ScheduledTaskAction -Execute $NodeExe -Argument $serveArgs
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# ELECTRON_RUN_AS_NODE pour le mode « binaire Electron comme Node »
if ($NodeExe -ne "node") {
  [Environment]::SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", "1", "Machine")
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "✔ Tâche '$TaskName' installée et démarrée."
Write-Host "  Données : $DataDir"
Write-Host "  PIN : voir le premier journal (Get-ScheduledTaskInfo $TaskName) ou la console :"
Write-Host "  $NodeExe $serveArgs"
