param(
  [string]$Server = 'root@178.104.235.228',
  [string]$SshKey = "$env:USERPROFILE/.ssh/hetzner_deploy_key",
  [string]$SalonId = '27c1ebbf-332b-4d9b-9921-5e754c92b684',
  [string]$OrganizationId = 'd8598896-5164-44c0-8ffa-482e72e69b8a',
  [string]$TaxpayerId = '01a121b1-c72b-74a8-a53f-0b2de9463be7',
  [string]$LocationId = '01a121b1-c72b-74a8-a53f-0b2de9463be7'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw 'Deployment command failed' } }
$branch = git branch --show-current
Check-Exit
if ($branch -ne 'main') { throw 'Deploy the committed main branch only' }
$changes = git status --porcelain --untracked-files=no
Check-Exit
if ($changes) { throw 'Commit all tracked changes before deployment' }
$sha = git rev-parse HEAD
Check-Exit
if ($sha -notmatch '^[0-9a-f]{40}$') { throw 'Invalid commit' }
$deployFolder = Join-Path (Get-Location) '.superpowers/deploy'
New-Item -ItemType Directory -Path $deployFolder -Force | Out-Null
$archive = Join-Path $deployFolder "release-$sha.tar.gz"
$settings = Join-Path $deployFolder 'fiscal-settings.json'
git archive --format=tar.gz --output=$archive HEAD
Check-Exit
try {
  node --env-file=.env.local scripts/export-fiscal-test-config.mjs $settings $SalonId $OrganizationId $TaxpayerId $LocationId
  Check-Exit
  scp -i $SshKey $archive "${Server}:/tmp/localvista-$sha.tar.gz"
  Check-Exit
  scp -i $SshKey $settings "${Server}:/tmp/localvista-fiscal-settings.json"
  Check-Exit
  scp -i $SshKey scripts/deploy-test-remote.py "${Server}:/tmp/localvista-deploy.py"
  Check-Exit
  ssh -i $SshKey -o BatchMode=yes $Server "chmod 600 /tmp/localvista-fiscal-settings.json && python3 /tmp/localvista-deploy.py $sha"
  Check-Exit
} finally {
  if (Test-Path -LiteralPath $settings) { Remove-Item -LiteralPath $settings }
}
Write-Output "Deployed TEST commit $sha"
