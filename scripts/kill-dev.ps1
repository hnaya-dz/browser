# ═══════════════════════════════════════════════════════════════
# Arrêt des processus de développement — DE CE PROJET UNIQUEMENT
# ═══════════════════════════════════════════════════════════════
# Remplace « taskkill /IM node.exe /F », qui tuait TOUS les processus node
# de la machine : les serveurs des autres projets ouverts, ceux de Visual
# Studio Code, et les sessions de travail parallèles. Constaté en usage
# réel — un serveur de développement s'est arrêté sans raison apparente
# pendant qu'une autre session lançait ce script.
#
# Le tri se fait sur la LIGNE DE COMMANDE, qui contient toujours la racine
# du projet : scripts/dev.mjs lance Next avec le chemin résolu de
# node_modules/next/dist/bin/next, et Electron avec public/electron.js.
#
#   -Lister   n'arrête rien, affiche seulement ce qui serait arrêté.
#
# Utilisation :  yarn kill-dev        ou  yarn kill-dev --lister

param([switch]$Lister)

$ErrorActionPreference = "Stop"

# Racine du projet, séparateurs normalisés pour la comparaison : une ligne
# de commande peut mélanger « / » et « \ » selon qui a lancé le processus.
$racine = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$motif = ($racine -replace '/', '\').TrimEnd('\')

# ⚠️ NE PAS SE TUER SOI-MÊME, NI SES PARENTS.
# Ce script tourne dans PowerShell, lancé par yarn, lancé par node. Si l'un
# d'eux portait la racine du projet dans sa ligne de commande, on
# s'arrêterait au milieu du travail — et le reste survivrait.
$epargnes = New-Object 'System.Collections.Generic.HashSet[int]'
$courant = $PID
for ($i = 0; $i -lt 12 -and $courant -gt 0; $i++) {
  [void]$epargnes.Add($courant)
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$courant" -ErrorAction SilentlyContinue
  if (-not $p) { break }
  $courant = [int]$p.ParentProcessId
}

$cibles = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='electron.exe'" |
  Where-Object {
    $_.CommandLine -and
    -not $epargnes.Contains([int]$_.ProcessId) -and
    (($_.CommandLine -replace '/', '\') -like "*$motif*")
  }

if (-not $cibles) {
  Write-Host "Aucun processus de developpement de ce projet n'est en cours."
  exit 0
}

foreach ($c in $cibles) {
  $ligne = $c.CommandLine
  if ($ligne.Length -gt 96) { $ligne = $ligne.Substring(0, 96) + "..." }
  if ($Lister) {
    Write-Host ("  [{0}] {1}  {2}" -f $c.ProcessId, $c.Name, $ligne)
  } else {
    try {
      Stop-Process -Id $c.ProcessId -Force -ErrorAction Stop
      Write-Host ("  arrete  [{0}] {1}" -f $c.ProcessId, $c.Name)
    } catch {
      # Un enfant meurt souvent avec son parent : le PID a pu disparaitre
      # entre l'inventaire et l'arret. Ce n'est pas un echec.
      Write-Host ("  deja arrete  [{0}] {1}" -f $c.ProcessId, $c.Name)
    }
  }
}

if ($Lister) {
  Write-Host ""
  Write-Host ("{0} processus seraient arretes. Rien n'a ete touche." -f @($cibles).Count)
}
