param(
  [ValidateSet('status','preview','sync','ready','unready','pause','channels','organizations','activate','adopt','refresh','retry-confirmed-absent','complete-manual')]
  [string]$Action='status',
  [string]$ProjectId,
  [string]$Fingerprint,
  [string]$Platform,
  [string]$BufferId,
  [string]$ExternalUrl,
  [string]$SelectionJson='{}',
  [string]$BaseUrl='https://archi-create.com.ua'
)
$ErrorActionPreference='Stop'
if ($BaseUrl -ne 'https://archi-create.com.ua' -and $BaseUrl -notmatch '^http://(localhost|127\.0\.0\.1):\d+$') { throw 'Use the real site or a localhost test server.' }
$credential=Get-Credential -UserName 'admin' -Message 'Введіть пароль адміністратора сайту. Не надсилайте його в чат.'
$password=$credential.GetNetworkCredential().Password
$auth=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('admin:'+$password))
$headers=@{Authorization='Basic '+$auth;Origin=$BaseUrl}
$uri=$BaseUrl+'/api/admin/social/'+$Action
$body=@{}
if ($ProjectId) { $body.id=$ProjectId }
if ($Fingerprint) { $body.fingerprint=$Fingerprint }
if ($Platform) { $body.platform=$Platform }
if ($BufferId) { $body.bufferId=$BufferId }
if ($ExternalUrl) { $body.externalUrl=$ExternalUrl }
if ($Action -eq 'ready') { $body.selection=ConvertFrom-Json $SelectionJson -AsHashtable }
if ($Action -eq 'activate') {
  Write-Host 'Це ввімкне реальне планування готових проєктів у Buffer. Дописи можуть вийти через 15 хвилин після Cron.'
  $body.confirm=Read-Host 'Лише після явного погодження першої публікації введіть APPROVE_FIRST_PUBLICATION'
}
if ($Action -eq 'retry-confirmed-absent') {
  Write-Host 'Перевірте чергу, чернетки, історію успішних та помилкових дописів у Buffer. Повтор може створити дублікат.'
  $body.confirm=Read-Host 'Якщо попереднього допису точно немає, введіть CHECKED_BUFFER_NO_POST_EXISTS'
}
try {
  if ($Action -in @('status','preview','channels','organizations')) {
    if ($Action -eq 'preview') {$uri+='?id='+[Uri]::EscapeDataString($ProjectId)}
    Invoke-RestMethod -Uri $uri -Headers $headers | ConvertTo-Json -Depth 30
  } else {
    Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($body|ConvertTo-Json -Depth 10))) | ConvertTo-Json -Depth 30
  }
} finally { $password=$null; $auth=$null; $headers.Clear() }
