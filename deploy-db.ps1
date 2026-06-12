#Requires -Version 5.1
<#
.SYNOPSIS
    Full local dev database setup in one command.
    Starts the Docker container, deploys the schema, sets service passwords,
    and bcrypt-hashes the seed user passwords.

.DESCRIPTION
    Run from the project root. Requires Docker Desktop and Node.js 20+.

    Steps:
      1. npm install  (ensures bcryptjs is available for step 6)
      2. Start crm-postgres Docker container (creates it if absent)
      3. Wait for Postgres to accept connections
      4. Deploy all schema scripts from databse-model/ in order
      5. Set all service role passwords to 'devpass'
      6. Bcrypt-hash SeedPassword and UPDATE seeded demo users

    After this script completes, create .env.local and run npm run dev.
    See LOCAL_DEV.md for .env.local contents.

.PARAMETER Database
    Target database name. Default: crm

.PARAMETER DbHost
    Postgres host (used only when local psql is on PATH). Default: localhost

.PARAMETER Port
    Host port mapped to Postgres inside the container. Default: 5433

.PARAMETER User
    Postgres superuser. Default: sa

.PARAMETER Password
    Postgres superuser password. Default: Passw0rd

.PARAMETER ContainerName
    Docker container name. Default: crm-postgres

.PARAMETER SeedPassword
    Password to set on all seeded demo users. Default: Admin@12345

.EXAMPLE
    .\deploy-db.ps1
    .\deploy-db.ps1 -SeedPassword "MyPass@99"
#>
param(
    [string]$Database      = "crm",
    [string]$DbHost        = "localhost",
    [string]$Port          = "5433",
    [string]$User          = "sa",
    [string]$Password      = "Passw0rd",
    [string]$ContainerName = "crm-postgres",
    [string]$SeedPassword  = "Admin@12345"
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$Msg) Write-Host "    OK  $Msg" -ForegroundColor Green }
function Write-Skip { param([string]$Msg) Write-Host "    --  $Msg (skipped)" -ForegroundColor Yellow }

# ===========================================================================
# Step 1 - npm install (bcryptjs needed for step 6)
# ===========================================================================
Write-Step "Step 1 - npm install"
npm install
Write-OK "Dependencies installed"

# ===========================================================================
# Step 2 - Docker container
# ===========================================================================
Write-Step "Step 2 - PostgreSQL container ($ContainerName)"

$state = & docker inspect $ContainerName --format '{{.State.Status}}' 2>$null
if ($LASTEXITCODE -eq 0 -and $state -eq 'running') {
    Write-Skip "$ContainerName already running"
} elseif ($LASTEXITCODE -eq 0 -and $state -eq 'exited') {
    docker start $ContainerName | Out-Null
    Write-OK "$ContainerName started (was stopped)"
} else {
    docker run -d `
        --name $ContainerName `
        -e POSTGRES_USER=$User `
        -e POSTGRES_PASSWORD=$Password `
        -e POSTGRES_DB=$Database `
        -p "${Port}:5432" `
        -v "${PWD}:/workspace" `
        postgres:17 | Out-Null
    Write-OK "$ContainerName container created"
}

# ===========================================================================
# Step 3 - Wait for Postgres
# ===========================================================================
Write-Host "    Waiting for Postgres..." -NoNewline
$attempts = 0
do {
    Start-Sleep -Seconds 1
    docker exec $ContainerName pg_isready -U $User 2>$null | Out-Null
    $attempts++
    Write-Host "." -NoNewline
} while ($LASTEXITCODE -ne 0 -and $attempts -lt 30)

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Error "Postgres not ready after $attempts s. Check: docker logs $ContainerName"
}
Write-Host " ready." -ForegroundColor Green

# ===========================================================================
# Step 4 - Deploy schema
# ===========================================================================
Write-Step "Step 4 - Deploy schema (databse-model/*.sql)"

$scriptDir = Join-Path $PSScriptRoot "databse-model"

# Prefer local psql; fall back to docker exec
$useDocker = $false
if (Get-Command psql -ErrorAction SilentlyContinue) {
    $env:PGPASSWORD = $Password
    Write-Host "    Using local psql."
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    $useDocker = $true
    Write-Host "    psql not on PATH, using docker exec."
} else {
    Write-Error "Neither psql nor docker found. Install one and retry."
}

function Invoke-Psql {
    param([string]$Db, [string[]]$ExtraArgs)
    if ($useDocker) {
        & docker exec -e "PGPASSWORD=$Password" $ContainerName psql -U $User -d $Db @ExtraArgs
    } else {
        & psql -h $DbHost -p $Port -U $User -d $Db @ExtraArgs
    }
}

# Create database if absent
$createOut = Invoke-Psql -Db "postgres" -ExtraArgs @("-c", "CREATE DATABASE `"$Database`";") 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "    Created database '$Database'."
} elseif ("$createOut" -match "already exists") {
    Write-Host "    Database '$Database' already exists."
} else {
    Write-Error "Could not create database: $createOut"
}

# Apply scripts in order
$scripts = Get-ChildItem $scriptDir -Filter "*.sql" |
    Where-Object { $_.Name -ne "test.sql" } |
    Sort-Object Name

$total = $scripts.Count
$i = 0
foreach ($script in $scripts) {
    $i++
    Write-Host "    [$i/$total] $($script.Name) ..."
    if ($useDocker) {
        Get-Content $script.FullName -Raw |
            & docker exec -i -e "PGPASSWORD=$Password" $ContainerName `
                psql -U $User -d $Database -v ON_ERROR_STOP=1
    } else {
        Invoke-Psql -Db $Database -ExtraArgs @("-v", "ON_ERROR_STOP=1", "-f", $script.FullName)
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed at $($script.Name). Deployment halted."
    }
}
Write-OK "All $total scripts applied"

# ===========================================================================
# Step 5 - Service role passwords
# ===========================================================================
Write-Step "Step 5 - Service role passwords (devpass)"

$serviceRolesSql = "ALTER ROLE service_role    WITH PASSWORD 'devpass';" + [Environment]::NewLine +
                   "ALTER ROLE lead_svc        WITH PASSWORD 'devpass';" + [Environment]::NewLine +
                   "ALTER ROLE campaign_svc    WITH PASSWORD 'devpass';" + [Environment]::NewLine +
                   "ALTER ROLE user_mgmt_svc   WITH PASSWORD 'devpass';" + [Environment]::NewLine +
                   "ALTER ROLE notif_svc       WITH PASSWORD 'devpass';" + [Environment]::NewLine +
                   "ALTER ROLE intake_svc      WITH PASSWORD 'devpass';" + [Environment]::NewLine +
                   "ALTER ROLE tenant_dash_svc WITH PASSWORD 'devpass';" + [Environment]::NewLine +
                   "ALTER ROLE analytics_svc   WITH PASSWORD 'devpass';"

$serviceRolesSql | docker exec -i -e "PGPASSWORD=$Password" $ContainerName psql -U $User -d $Database | Out-Null
Write-OK "service_role, lead_svc, campaign_svc, user_mgmt_svc, notif_svc, intake_svc, tenant_dash_svc, analytics_svc"

# ===========================================================================
# Step 6 - Seed user passwords
# ===========================================================================
Write-Step "Step 6 - Seed user passwords (bcrypt of '$SeedPassword')"

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

$updateSql | docker exec -i -e "PGPASSWORD=$Password" $ContainerName psql -U $User -d $Database
Write-OK "Seed user passwords set"

# ===========================================================================
# Done
# ===========================================================================
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Database ready. Next steps:" -ForegroundColor Green
Write-Host ""
Write-Host "  1. Create .env.local (see LOCAL_DEV.md for contents)" -ForegroundColor White
Write-Host "  2. npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "  Login: vikram.malhotra@apexcp.in / $SeedPassword" -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Green
