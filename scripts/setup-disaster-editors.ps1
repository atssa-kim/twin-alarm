# disa_app 파트장별 임무 수정 권한 — Supabase Auth 계정 + 매핑 생성 (2026-07-07)
# Node.js가 없는 환경을 위한 scripts/setup-disaster-editors.ts의 PowerShell 버전 (기능 동일).
# 실행: powershell -ExecutionPolicy Bypass -File scripts\setup-disaster-editors.ps1
# 사전 준비:
#   1) disa_app/supabase_auth_setup.sql 을 Supabase SQL Editor에서 먼저 실행
#   2) twin-alarm 루트에 .env 파일 생성 (git에 커밋되지 않음):
#        VITE_SUPABASE_URL=https://xxxxx.supabase.co
#        SUPABASE_SERVICE_ROLE_KEY=...  (Supabase Settings -> API -> service_role secret)

$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envPath)) {
  Write-Error ".env 파일이 없습니다: $envPath"
  exit 1
}

$envVars = @{}
Get-Content $envPath | ForEach-Object {
  if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*?)\s*$') {
    $envVars[$matches[1]] = $matches[2]
  }
}
$SB_URL = $envVars['VITE_SUPABASE_URL']
$SB_KEY = $envVars['SUPABASE_SERVICE_ROLE_KEY']
if (-not $SB_URL -or -not $SB_KEY) {
  Write-Error ".env에 VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다."
  exit 1
}

$headers = @{
  "apikey"        = $SB_KEY
  "Authorization" = "Bearer $SB_KEY"
  "Content-Type"  = "application/json"
}

function New-RandomPassword {
  $chars = (48..57) + (65..90) + (97..122)
  $body = -join ($chars | Get-Random -Count 10 | ForEach-Object { [char]$_ })
  return "$body!1"
}

function Get-OrCreateAuthUser($email) {
  $list = Invoke-RestMethod -Uri "$SB_URL/auth/v1/admin/users?per_page=1000" -Headers $headers -Method Get
  $existing = $list.users | Where-Object { $_.email -eq $email } | Select-Object -First 1
  if ($existing) { return @{ id = $existing.id; password = $null } }

  $password = New-RandomPassword
  $body = @{ email = $email; password = $password; email_confirm = $true } | ConvertTo-Json
  $created = Invoke-RestMethod -Uri "$SB_URL/auth/v1/admin/users" -Headers $headers -Method Post -Body $body
  return @{ id = $created.id; password = $password }
}

function Set-TableRow($table, $onConflict, $row) {
  $h = $headers.Clone()
  $h["Prefer"] = "resolution=merge-duplicates"
  $url = "$SB_URL/rest/v1/$table`?on_conflict=$onConflict"
  Invoke-RestMethod -Uri $url -Headers $h -Method Post -Body ($row | ConvertTo-Json)
}

$masters = @(
  @{ email = "atssa.kim@gmail.com";  note = "atssa.kim (관리자)" },
  @{ email = "kyensu_kim@sni.co.kr"; note = "소방파트장 김견수" }
)
$editors = @(
  @{ email = "kannylord@sni.co.kr"; note = "전기파트장 이길호"; disasters = @("정전", "승강기") },
  @{ email = "k43414268@sni.co.kr"; note = "기계파트장 손남열"; disasters = @("누수", "태풍/홍수", "가스누출") },
  @{ email = "mprokmc@sni.co.kr";   note = "운영파트장 곽우람"; disasters = @("폭설", "테러") }
)

Write-Output "`n[1] 마스터 계정 (전체 재난 수정 가능)`n"
foreach ($m in $masters) {
  $r = Get-OrCreateAuthUser $m.email
  Set-TableRow "app_admins" "user_id" @{ user_id = $r.id; note = $m.note }
  $pwMsg = if ($r.password) { " - 임시 비밀번호: $($r.password)" } else { " - 기존 계정 재사용" }
  Write-Output "  OK $($m.email) ($($m.note))$pwMsg"
}

Write-Output "`n[2] 재난별 담당 파트장 계정`n"
foreach ($e in $editors) {
  $r = Get-OrCreateAuthUser $e.email
  foreach ($d in $e.disasters) {
    Set-TableRow "disaster_editors" "user_id,disaster" @{ user_id = $r.id; disaster = $d }
  }
  $pwMsg = if ($r.password) { " - 임시 비밀번호: $($r.password)" } else { " - 기존 계정 재사용" }
  Write-Output "  OK $($e.email) ($($e.note)) -> $($e.disasters -join ', ')$pwMsg"
}

Write-Output "`n완료! 위 임시 비밀번호를 해당 파트장에게 안전한 채널로 전달하고,"
Write-Output "로그인 후 Supabase 계정 비밀번호를 바꾸도록 안내하세요.`n"
