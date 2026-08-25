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
  [string]$TaskName = "HnayaChatServer",
  # Chemin du fichier .hnaya-lic. Facultatif si un seul est déposé à côté
  # du module.
  [string]$Licence = ""
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
# ⚠️ DEUX PARCOURS D'INSTALLATION EXISTENT — ON N'EN VEUT QU'UN.
# Le navigateur Hnaya sait installer ce même serveur depuis sa section
# « Serveur permanent » : il emploie son propre exécutable comme moteur
# (ELECTRON_RUN_AS_NODE), sans exiger Node. Mais il crée une AUTRE tâche
# (« Hnaya Chat Serveur ») et un AUTRE répertoire de données
# (« C:\ProgramData\Hnaya Chat Server »).
#
# Les deux services écouteraient les mêmes ports 4802/4803 avec deux bases
# distinctes : le second démarrage échoue, et l'historique se retrouve
# coupé en deux sans que personne ne comprenne pourquoi. On refuse donc,
# en laissant le choix à l'administrateur.
$tacheNavigateur = Get-ScheduledTask -TaskName "Hnaya Chat Serveur" -ErrorAction SilentlyContinue
if ($tacheNavigateur) {
  throw ("Un serveur Hnaya est deja installe depuis le NAVIGATEUR (tache " +
         "'Hnaya Chat Serveur', donnees dans C:\ProgramData\Hnaya Chat Server). " +
         "Les deux services se disputeraient les ports 4802 et 4803. " +
         "Choisissez UN parcours : soit desinstallez celui du navigateur " +
         "depuis sa section 'Serveur permanent', soit conservez-le et " +
         "n'executez pas ce script.")
}

# ⚠️ LA LICENCE EST TROUVÉE AVANT DE TOUCHER AU SYSTÈME.
# Même lacune que du côté Linux : la tâche planifiee était créée, le service
# démarrait, et refusait de servir faute de licence. On refuse ici plutôt
# que de laisser une installation à moitié faite.
$moduleDir = Split-Path $PSScriptRoot -Parent
if (-not $Licence) {
  $trouvees = @(Get-ChildItem -Path $moduleDir -Filter *.hnaya-lic -File -ErrorAction SilentlyContinue)
  if ($trouvees.Count -eq 1) { $Licence = $trouvees[0].FullName }
  elseif ($trouvees.Count -gt 1) {
    throw "Plusieurs fichiers .hnaya-lic dans $moduleDir. Indiquez lequel avec -Licence <chemin>."
  }
}
if (-not $Licence -or -not (Test-Path $Licence)) {
  throw ("Licence introuvable. Deposez le fichier .hnaya-lic remis par Hnaya DZ dans {0}, " +
         "ou indiquez son chemin avec -Licence <chemin>. Sans licence, le serveur permanent " +
         "refuse de demarrer. Contact : +213 558 303 030 - contact@hnaya.dz") -f $moduleDir
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# Copiee, non deplacee : l'original reste a l'administrateur pour une
# reinstallation.
Copy-Item -Path $Licence -Destination (Join-Path $DataDir "licence.hnaya-lic") -Force

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
