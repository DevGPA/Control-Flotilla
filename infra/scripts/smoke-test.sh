#!/usr/bin/env bash
# Smoke test post-deploy. Run by TI after `cdk deploy` to verify
# that all stacks created the expected resources and security
# settings (PITR, KMS, GSIs, Cognito Authorizer) are active.
#
# Usage:
#   ./smoke-test.sh [stage] [profile]
#   stage   = dev (default) | prod
#   profile = AWS CLI profile (default: $AWS_PROFILE or 'default')
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed (details in stderr)

set -u
STAGE="${1:-dev}"
PROFILE="${2:-${AWS_PROFILE:-default}}"
PREFIX="gpa-control-flotilla-${STAGE}"
PASS=0
FAIL=0

AWS_OPTS="--profile ${PROFILE} --output json"

green()  { printf '\033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
red()    { printf '\033[31m✗\033[0m %s\n' "$1" >&2; FAIL=$((FAIL+1)); }
yellow() { printf '\033[33m·\033[0m %s\n' "$1"; }

echo "=== Smoke test: stage=${STAGE}, profile=${PROFILE} ==="

# 1. Account reachable
ACCOUNT=$(aws sts get-caller-identity ${AWS_OPTS} --query Account --output text 2>/dev/null) \
  && green "AWS account reachable: ${ACCOUNT}" \
  || { red "Cannot reach AWS (check credentials/profile)"; exit 1; }

# 2. CloudFormation stacks
for stack in storage auth api; do
  name="${PREFIX}-${stack}"
  status=$(aws cloudformation describe-stacks ${AWS_OPTS} \
    --stack-name "${name}" --query 'Stacks[0].StackStatus' --output text 2>/dev/null) || status="MISSING"
  case "${status}" in
    CREATE_COMPLETE|UPDATE_COMPLETE) green "Stack ${name}: ${status}" ;;
    *)                                red "Stack ${name}: ${status}" ;;
  esac
done

# 3. DynamoDB AppTable: GSIs + PITR + encryption
TABLE="${PREFIX}-app"
desc=$(aws dynamodb describe-table ${AWS_OPTS} --table-name "${TABLE}" 2>/dev/null) \
  && green "DynamoDB table exists: ${TABLE}" \
  || red "DynamoDB table missing: ${TABLE}"

if [ -n "${desc:-}" ]; then
  gsi_count=$(echo "${desc}" | grep -c '"IndexName"' || true)
  [ "${gsi_count}" -eq 2 ] && green "GSIs present (count=${gsi_count})" || red "Expected 2 GSIs, got ${gsi_count}"

  echo "${desc}" | grep -q '"SSEDescription"' && green "DDB encryption configured" || red "DDB encryption missing"

  pitr=$(aws dynamodb describe-continuous-backups ${AWS_OPTS} --table-name "${TABLE}" \
    --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
    --output text 2>/dev/null)
  [ "${pitr}" = "ENABLED" ] && green "PITR enabled" || red "PITR not enabled (got: ${pitr})"
fi

# 4. Idempotency table with TTL
IDEM="${PREFIX}-idempotency"
ttl=$(aws dynamodb describe-time-to-live ${AWS_OPTS} --table-name "${IDEM}" \
  --query 'TimeToLiveDescription.TimeToLiveStatus' --output text 2>/dev/null)
[ "${ttl}" = "ENABLED" ] && green "Idempotency TTL enabled" \
  || red "Idempotency TTL not enabled (got: ${ttl})"

# 5. S3 bucket: encryption + versioning + public-access-block
BUCKET="${PREFIX}-images-${ACCOUNT}"
aws s3api head-bucket ${AWS_OPTS} --bucket "${BUCKET}" 2>/dev/null \
  && green "S3 bucket reachable: ${BUCKET}" \
  || red "S3 bucket missing: ${BUCKET}"

enc=$(aws s3api get-bucket-encryption ${AWS_OPTS} --bucket "${BUCKET}" \
  --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
  --output text 2>/dev/null)
[ "${enc}" = "aws:kms" ] && green "S3 KMS encryption active" || red "S3 encryption: ${enc}"

ver=$(aws s3api get-bucket-versioning ${AWS_OPTS} --bucket "${BUCKET}" \
  --query 'Status' --output text 2>/dev/null)
[ "${ver}" = "Enabled" ] && green "S3 versioning enabled" || red "S3 versioning: ${ver}"

pab=$(aws s3api get-public-access-block ${AWS_OPTS} --bucket "${BUCKET}" \
  --query 'PublicAccessBlockConfiguration.BlockPublicAcls' --output text 2>/dev/null)
[ "${pab}" = "True" ] && green "S3 public access blocked" || red "S3 public access block: ${pab}"

# 6. Cognito User Pool
POOL_ID=$(aws cloudformation describe-stacks ${AWS_OPTS} \
  --stack-name "${PREFIX}-auth" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text 2>/dev/null)
if [ -n "${POOL_ID}" ] && [ "${POOL_ID}" != "None" ]; then
  aws cognito-idp describe-user-pool ${AWS_OPTS} --user-pool-id "${POOL_ID}" >/dev/null 2>&1 \
    && green "Cognito User Pool reachable: ${POOL_ID}" \
    || red "Cognito User Pool unreachable: ${POOL_ID}"
else
  red "Cannot read UserPoolId from auth stack outputs"
fi

# 7. API Gateway returns 401 without auth (proves Cognito Authorizer wired)
API_URL=$(aws cloudformation describe-stacks ${AWS_OPTS} \
  --stack-name "${PREFIX}-api" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text 2>/dev/null)
if [ -n "${API_URL}" ] && [ "${API_URL}" != "None" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}units" 2>/dev/null || echo "000")
  case "${code}" in
    401|403) green "API Gateway authorizer active (got HTTP ${code} without token)" ;;
    *)       red "API Gateway returned HTTP ${code} (expected 401/403)" ;;
  esac
else
  red "Cannot read ApiUrl from api stack outputs"
fi

# 8. KMS key enabled
KMS_ARN=$(aws cloudformation describe-stacks ${AWS_OPTS} \
  --stack-name "${PREFIX}-storage" \
  --query "Stacks[0].Outputs[?OutputKey=='KmsKeyArn'].OutputValue" --output text 2>/dev/null)
if [ -n "${KMS_ARN}" ] && [ "${KMS_ARN}" != "None" ]; then
  state=$(aws kms describe-key ${AWS_OPTS} --key-id "${KMS_ARN}" \
    --query 'KeyMetadata.KeyState' --output text 2>/dev/null)
  [ "${state}" = "Enabled" ] && green "KMS key enabled" || red "KMS key state: ${state}"
fi

echo ""
echo "=== Result: ${PASS} passed, ${FAIL} failed ==="
[ "${FAIL}" -eq 0 ] && exit 0 || exit 1
