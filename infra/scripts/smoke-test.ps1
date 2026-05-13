#Requires -Version 5.1
<#
.SYNOPSIS
  Smoke test post-deploy. Verifies all stacks + security settings.

.PARAMETER Stage
  Deployment stage (dev | prod). Default: dev.

.PARAMETER Profile
  AWS CLI profile. Default: $env:AWS_PROFILE or 'default'.

.EXAMPLE
  .\smoke-test.ps1 -Stage dev -Profile gpa-deploy

.NOTES
  Exit 0 = all checks passed.
  Exit 1 = one or more failed.
#>
param(
    [string]$Stage = "dev",
    [string]$Profile = $(if ($env:AWS_PROFILE) { $env:AWS_PROFILE } else { "default" })
)

$Prefix = "gpa-control-flotilla-$Stage"
$Pass = 0
$Fail = 0

function Write-Pass($msg) { Write-Host "✓ $msg" -ForegroundColor Green; $script:Pass++ }
function Write-Fail($msg) { Write-Host "✗ $msg" -ForegroundColor Red; $script:Fail++ }

Write-Host "=== Smoke test: stage=$Stage, profile=$Profile ===" -ForegroundColor Cyan

# 1. Account reachable
try {
    $account = (aws sts get-caller-identity --profile $Profile --query Account --output text 2>$null)
    if ($account) { Write-Pass "AWS account reachable: $account" }
    else { Write-Fail "Cannot reach AWS (check credentials/profile)"; exit 1 }
} catch { Write-Fail "AWS CLI error: $_"; exit 1 }

# 2. CloudFormation stacks
foreach ($s in @("storage", "auth", "api")) {
    $name = "$Prefix-$s"
    $status = (aws cloudformation describe-stacks --profile $Profile --stack-name $name `
        --query 'Stacks[0].StackStatus' --output text 2>$null)
    if ($status -in @("CREATE_COMPLETE", "UPDATE_COMPLETE")) {
        Write-Pass "Stack ${name}: $status"
    } else {
        Write-Fail "Stack ${name}: $(if ($status) { $status } else { 'MISSING' })"
    }
}

# 3. DynamoDB AppTable: GSIs + PITR + encryption
$table = "$Prefix-app"
$desc = aws dynamodb describe-table --profile $Profile --table-name $table 2>$null | ConvertFrom-Json
if ($desc) {
    Write-Pass "DynamoDB table exists: $table"
    $gsiCount = $desc.Table.GlobalSecondaryIndexes.Count
    if ($gsiCount -eq 2) { Write-Pass "GSIs present (count=$gsiCount)" }
    else { Write-Fail "Expected 2 GSIs, got $gsiCount" }

    if ($desc.Table.SSEDescription) { Write-Pass "DDB encryption configured" }
    else { Write-Fail "DDB encryption missing" }

    $pitr = (aws dynamodb describe-continuous-backups --profile $Profile --table-name $table `
        --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' --output text 2>$null)
    if ($pitr -eq "ENABLED") { Write-Pass "PITR enabled" }
    else { Write-Fail "PITR not enabled (got: $pitr)" }
} else { Write-Fail "DynamoDB table missing: $table" }

# 4. Idempotency table with TTL
$idem = "$Prefix-idempotency"
$ttl = (aws dynamodb describe-time-to-live --profile $Profile --table-name $idem `
    --query 'TimeToLiveDescription.TimeToLiveStatus' --output text 2>$null)
if ($ttl -eq "ENABLED") { Write-Pass "Idempotency TTL enabled" }
else { Write-Fail "Idempotency TTL not enabled (got: $ttl)" }

# 5. S3 bucket: encryption + versioning + public-access-block
$bucket = "$Prefix-images-$account"
$null = aws s3api head-bucket --profile $Profile --bucket $bucket 2>$null
if ($?) { Write-Pass "S3 bucket reachable: $bucket" }
else { Write-Fail "S3 bucket missing: $bucket" }

$enc = (aws s3api get-bucket-encryption --profile $Profile --bucket $bucket `
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text 2>$null)
if ($enc -eq "aws:kms") { Write-Pass "S3 KMS encryption active" }
else { Write-Fail "S3 encryption: $enc" }

$ver = (aws s3api get-bucket-versioning --profile $Profile --bucket $bucket `
    --query 'Status' --output text 2>$null)
if ($ver -eq "Enabled") { Write-Pass "S3 versioning enabled" }
else { Write-Fail "S3 versioning: $ver" }

$pab = (aws s3api get-public-access-block --profile $Profile --bucket $bucket `
    --query 'PublicAccessBlockConfiguration.BlockPublicAcls' --output text 2>$null)
if ($pab -eq "True") { Write-Pass "S3 public access blocked" }
else { Write-Fail "S3 public access block: $pab" }

# 6. Cognito User Pool
$poolId = (aws cloudformation describe-stacks --profile $Profile --stack-name "$Prefix-auth" `
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text 2>$null)
if ($poolId -and $poolId -ne "None") {
    $null = aws cognito-idp describe-user-pool --profile $Profile --user-pool-id $poolId 2>$null
    if ($?) { Write-Pass "Cognito User Pool reachable: $poolId" }
    else { Write-Fail "Cognito User Pool unreachable: $poolId" }
} else { Write-Fail "Cannot read UserPoolId from auth stack outputs" }

# 7. API Gateway returns 401 without auth
$apiUrl = (aws cloudformation describe-stacks --profile $Profile --stack-name "$Prefix-api" `
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text 2>$null)
if ($apiUrl -and $apiUrl -ne "None") {
    try {
        $resp = Invoke-WebRequest -Uri "${apiUrl}units" -UseBasicParsing -SkipHttpErrorCheck 2>$null
        $code = $resp.StatusCode
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
    }
    if ($code -in @(401, 403)) { Write-Pass "API Gateway authorizer active (got HTTP $code without token)" }
    else { Write-Fail "API Gateway returned HTTP $code (expected 401/403)" }
} else { Write-Fail "Cannot read ApiUrl from api stack outputs" }

# 8. KMS key enabled
$kmsArn = (aws cloudformation describe-stacks --profile $Profile --stack-name "$Prefix-storage" `
    --query "Stacks[0].Outputs[?OutputKey=='KmsKeyArn'].OutputValue" --output text 2>$null)
if ($kmsArn -and $kmsArn -ne "None") {
    $state = (aws kms describe-key --profile $Profile --key-id $kmsArn `
        --query 'KeyMetadata.KeyState' --output text 2>$null)
    if ($state -eq "Enabled") { Write-Pass "KMS key enabled" }
    else { Write-Fail "KMS key state: $state" }
}

Write-Host ""
Write-Host "=== Result: $Pass passed, $Fail failed ===" -ForegroundColor Cyan
if ($Fail -eq 0) { exit 0 } else { exit 1 }
