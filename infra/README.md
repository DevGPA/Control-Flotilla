# Control Flotilla — Infraestructura AWS (CDK v2)

Infraestructura como código para el backend de `control-flotilla`. Despliega **S3 + DynamoDB + Cognito + Lambda + API Gateway** en una cuenta AWS configurada.

## Arquitectura

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Frontend    │────▶│  API Gateway    │────▶│  Lambdas (7)     │
│  Vite + TS   │     │  + Cognito Auth │     │  units, taller,  │
│              │     └─────────────────┘     │  notas, etc.     │
└──────────────┘                             └────────┬─────────┘
       │                                              │
       │  Presigned URLs                              ▼
       ▼                                     ┌──────────────────┐
┌──────────────┐                             │  DynamoDB        │
│  S3 (KMS)    │                             │  single-table    │
│  images/     │                             │  + GSI1 (UNIT)   │
│  weekly/     │                             │  + GSI2 (BRANCH) │
│  manual/     │                             │  + idempotency   │
└──────────────┘                             └──────────────────┘
```

## Stacks

| Stack     | Recursos                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------- |
| `storage` | S3 bucket (KMS+versioning+lifecycle), DDB AppTable (PITR), DDB IdempotencyTable (TTL 24h), KMS key |
| `auth`    | Cognito User Pool (email, MFA TOTP opcional), App Client, atributos `orgId` + `role`               |
| `api`     | API Gateway REST + Cognito Authorizer, 7 Lambdas Node 20 ARM64                                     |

## Diseño del schema DynamoDB

**Tabla principal — single-table:**

| Atributo            | Valor                              |
| ------------------- | ---------------------------------- |
| `PK`                | `TENANT#{orgId}`                   |
| `SK`                | `{ISO-date}#{type}#{id}`           |
| `GSI1PK` / `GSI1SK` | `UNIT#{placa}` / `{ISO-date}`      |
| `GSI2PK` / `GSI2SK` | `BRANCH#{sucursal}` / `{ISO-date}` |
| `version`           | número, optimistic locking         |
| Cifrado             | CMK KMS, PITR ON                   |

## Política antiduplicados (3 capas)

| Capa | Mecanismo                                                                                  | Previene                            |
| ---- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| 1    | `id` determinístico — SHA-256(`tenantId + naturalKey`)                                     | Mismo dato → mismo id → mismo PK+SK |
| 2    | `PutItem` con `ConditionExpression: attribute_not_exists(PK) AND attribute_not_exists(SK)` | Race condition entre 2 clientes     |
| 3    | Tabla `idempotency` separada con TTL 24h, llave `${userId}:${method}:${path}:${clientKey}` | Retries de red duplicando POST      |

**Updates**: optimistic lock — el cliente envía la `version` que leyó; Lambda usa `ConditionExpression: version = :expected` y la incrementa. Conflicto → `409` y el cliente reobtiene.

**Llaves naturales por entidad**:

| Tipo        | Natural key (input a `deterministicId`) |
| ----------- | --------------------------------------- |
| `UNIT`      | `placa`                                 |
| `CHECKLIST` | `unitUid + fecha + tipo`                |
| `TALLER`    | `unitUid + fechaEntrada + folio`        |
| `NOTA`      | `unitUid + timestamp + autorId`         |
| `PERIODO`   | `tipo + fechaInicio + fechaFin`         |
| `SEMANAL`   | `periodoId + sucursal + unitUid`        |

## Prerrequisitos

- Node 20.x
- AWS CLI configurado (`aws configure --profile gpa-dev`)
- Permisos IAM para crear: CloudFormation, S3, DynamoDB, Lambda, API Gateway, Cognito, KMS, IAM

## Setup

```bash
cd infra
npm install
cd ../backend
npm install
```

## Bootstrap (1 vez por cuenta+región)

```bash
cd infra
export AWS_PROFILE=gpa-dev
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1
npm run bootstrap
```

## Deploy

```bash
# Stage dev (default)
npm run deploy:dev

# Stage prod
npm run deploy:prod
```

Después del deploy, los `CfnOutput` exponen:

- `ApiUrl` — endpoint REST
- `UserPoolId`, `UserPoolClientId` — para login del frontend
- `TableName`, `IdempotencyTableName`, `ImagesBucketName`

Guárdalos en `frontend .env.production`:

```
VITE_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com/dev/
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxx
VITE_AWS_REGION=us-east-1
```

## Diff antes de deploy

```bash
npm run diff
```

## Destruir stage dev

```bash
npm run destroy:dev
```

(`prod` retiene tabla y bucket por seguridad — borrado manual desde consola.)

## Costo estimado (5–20 usuarios oficina)

| Servicio                    | USD/mes  |
| --------------------------- | -------- |
| S3 (≈ 5 GB)                 | 0.12     |
| DynamoDB on-demand          | 2–5      |
| Lambda + API GW             | 1–3      |
| Cognito (free tier 50K MAU) | 0        |
| CloudWatch + KMS + transfer | 3–5      |
| **Total**                   | **< 30** |

## Próximas fases

1. ✅ **Fase 1**: Infra CDK (este PR)
2. **Fase 2**: Auth Cognito en frontend (login, gating)
3. **Fase 3**: Repository pattern — extraer IndexedDB del HTML monolítico
4. **Fase 4**: Image pipeline S3 (presigned uploads)
5. **Fase 5**: Metadata sync — CRUD completo + migración IDB→DDB + Background Sync
6. **Fase 6**: Hardening — CloudWatch alarms, AWS Backup, WAF, runbook
