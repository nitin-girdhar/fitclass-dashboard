#Requires -Version 5.1
<#
.SYNOPSIS
    Deploy schema and seed data to a Supabase (remote) PostgreSQL database.

.DESCRIPTION
    Run from the project root. Requires Node.js 20+ on PATH.
    Requires either psql on PATH or Docker Desktop (uses postgres:17 image as psql client).

    Steps:
      1. npm install  (ensures bcryptjs is available for step 4)
      2. Deploy all schema scripts from databse-model/ in order
      3. Set all service role passwords
      4. Bcrypt-hash SeedPassword and UPDATE seeded demo users

.PARAMETER Database
    Target database name. Default: crm

.PARAMETER DbHost
    Supabase Postgres host. Default: 

.PARAMETER Port
    Postgres port. Default: 5432

.PARAMETER User
    Postgres superuser. Default: postgres

.PARAMETER Password
    Postgres superuser password.

.PARAMETER SeedPassword
    Password to set on all seeded demo users. Default: Admin@12345

.EXAMPLE
    .\deploy-supabase.ps1 -Password ""
    .\deploy-supabase.ps1 -Database "crm" -DbHost "" -Port "5432" -User "postgres" -Password "" -SeedPassword "Admin@12345"
#>
param(
    [string]$Database     = "postgres",
    [string]$DbHost       = "",
    [string]$Port         = "5432",
    [string]$User         = "postgres",
    [Parameter(Mandatory)][string]$Password,
    [string]$SeedPassword = "Admin@12345"
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$Msg) Write-Host "    OK  $Msg" -ForegroundColor Green }

# ===========================================================================
# Resolve psql: prefer local install, fall back to Docker image as client
# ===========================================================================
$useDockerPsql = $false
if (Get-Command psql -ErrorAction SilentlyContinue) {
    $env:PGPASSWORD = $Password
    Write-Host "    Using local psql." -ForegroundColor DarkGray
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    $useDockerPsql = $true
    # Try to resolve to IPv4 so Docker (which cannot route IPv6 on Windows) can connect.
    $ipv4 = [System.Net.Dns]::GetHostAddresses($DbHost) |
        Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
        Select-Object -First 1 -ExpandProperty IPAddressToString
    if (-not $ipv4) {
        Write-Host ""
        Write-Host "  ERROR: '$DbHost' has no IPv4 address (IPv6-only)." -ForegroundColor Red
        Write-Host "  Docker on Windows cannot route IPv6 to the internet." -ForegroundColor Red
        Write-Host ""
        Write-Host "  Fix: install the PostgreSQL client tools (psql) locally:" -ForegroundColor Yellow
        Write-Host "    winget install -e --id PostgreSQL.PostgreSQL" -ForegroundColor Yellow
        Write-Host "  Then re-run this script. psql will be used directly, bypassing Docker." -ForegroundColor Yellow
        Write-Host ""
        Write-Error "Cannot reach Supabase via Docker - IPv6-only host. Install psql locally and retry."
    }
    $DbHost = $ipv4
    Write-Host "    psql not on PATH - using Docker (postgres:17), resolved host to $DbHost" -ForegroundColor DarkGray
} else {
    Write-Error "Neither psql nor docker found on PATH. Install one and retry."
}

function Invoke-Psql {
    param([string]$Db, [string[]]$ExtraArgs)
    if ($useDockerPsql) {
        & docker run --rm --dns 8.8.8.8 -e "PGPASSWORD=$Password" postgres:17 `
            psql -h $DbHost -p $Port -U $User -d $Db @ExtraArgs
    } else {
        & psql -h $DbHost -p $Port -U $User -d $Db @ExtraArgs
    }
}

function Invoke-PsqlStdin {
    param([string]$Db, [string]$Sql)
    if ($useDockerPsql) {
        $Sql | & docker run --rm -i --dns 8.8.8.8 -e "PGPASSWORD=$Password" postgres:17 `
            psql -h $DbHost -p $Port -U $User -d $Db
    } else {
        $Sql | & psql -h $DbHost -p $Port -U $User -d $Db
    }
}

# ===========================================================================
# Step 1 - npm install (bcryptjs needed for step 4)
# ===========================================================================
Write-Step "Step 1 - npm install"
npm install
Write-OK "Dependencies installed"

# ===========================================================================
# Step 2 - Deploy schema
# ===========================================================================
Write-Step "Step 2 - Deploy schema (databse-model/*.sql)"

$scriptDir = Join-Path $PSScriptRoot "databse-model"

# On Supabase the target database already exists; skip CREATE DATABASE.
# Attempting it would fail (insufficient privilege) - just confirm connectivity.
$pingOut = Invoke-Psql -Db $Database -ExtraArgs @("-c", "SELECT 1;") 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Cannot connect to '$Database' on $DbHost`:$Port - $pingOut"
}
Write-Host "    Connected to '$Database' on $DbHost."

# Apply scripts in order
$scripts = Get-ChildItem $scriptDir -Filter "*.sql" |
    Where-Object { $_.Name -ne "test.sql" } |
    Sort-Object Name

$total = $scripts.Count
$i = 0
foreach ($script in $scripts) {
    $i++
    Write-Host "    [$i/$total] $($script.Name) ..."
    if ($useDockerPsql) {
        # Mount the script dir so psql inside Docker can read the file
        $containerPath = "/scripts/$($script.Name)"
        & docker run --rm --dns 8.8.8.8 `
            -e "PGPASSWORD=$Password" `
            -v "$($scriptDir):/scripts:ro" `
            postgres:17 `
            psql -h $DbHost -p $Port -U $User -d $Database -v ON_ERROR_STOP=1 -f $containerPath
    } else {
        Invoke-Psql -Db $Database -ExtraArgs @("-v", "ON_ERROR_STOP=1", "-f", $script.FullName)
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed at $($script.Name). Deployment halted."
    }
}
Write-OK "All $total scripts applied"

# ===========================================================================
# Step 3 - Service role passwords
# ===========================================================================
Write-Step "Step 3 - Service role passwords (devpass)"

$serviceRolesSql = @"
ALTER ROLE service_role    WITH PASSWORD 'devpass';
ALTER ROLE lead_svc        WITH PASSWORD 'devpass';
ALTER ROLE campaign_svc    WITH PASSWORD 'devpass';
ALTER ROLE user_mgmt_svc   WITH PASSWORD 'devpass';
ALTER ROLE notif_svc       WITH PASSWORD 'devpass';
ALTER ROLE intake_svc      WITH PASSWORD 'devpass';
ALTER ROLE tenant_dash_svc WITH PASSWORD 'devpass';
ALTER ROLE analytics_svc   WITH PASSWORD 'devpass';
"@

Invoke-PsqlStdin -Db $Database -Sql $serviceRolesSql | Out-Null
Write-OK "service_role, lead_svc, campaign_svc, user_mgmt_svc, notif_svc, intake_svc, tenant_dash_svc, analytics_svc"

# ===========================================================================
# Step 4 - Seed user passwords
# ===========================================================================
Write-Step "Step 4 - Seed user passwords (bcrypt of '$SeedPassword')"

$hash = node -e "require('bcryptjs').hash('$SeedPassword', 10).then(function(h) { process.stdout.write(h); })"
if (-not $hash -or $hash.Length -lt 55) {
    Write-Error "bcrypt hash generation failed. Ensure bcryptjs is installed (npm install)."
}
Write-OK "bcrypt hash generated"

$updateSql = "UPDATE users SET password_hash = '$hash', password_changed_at = CLOCK_TIMESTAMP() " +
             "WHERE email IN (" +
             "'vikram.malhotra@apexcp.in'," +
             "'priya.kapoor@apexcp.in'," +
             "'rahul.singh@apexcp.in'," +
             "'ananya.verma@apexskt.in'," +
             "'rajan.mehta@velvetkm.in'," +
             "'deepa.nair@velvetln.in');"

Invoke-PsqlStdin -Db $Database -Sql $updateSql
Write-OK "Seed user passwords set"

# ===========================================================================
# Done
# ===========================================================================
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Supabase database ready. Next steps:" -ForegroundColor Green
Write-Host ""
Write-Host "  1. Create .env.local (see LOCAL_DEV.md for contents)" -ForegroundColor White
Write-Host "  2. npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "  Login: vikram.malhotra@apexcp.in / $SeedPassword" -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Green
