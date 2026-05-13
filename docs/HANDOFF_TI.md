# Handoff a TI — Despliegue Backend AWS (Fase 1)

Documento dirigido al **administrador de Sistemas/TI** que ejecutará el despliegue. El desarrollador (Navares) entrega este repositorio en `main`; TI hace el `cdk deploy` y devuelve los IDs/URLs generados.

> **Tiempo estimado**: 30–45 min primera vez (incluye creación de cuenta y bootstrap). Despliegues subsecuentes: 5–10 min.

---

## 1. Resumen ejecutivo (1 minuto)

Esto despliega **3 stacks CloudFormation** vía AWS CDK v2 en una cuenta AWS:

| Stack                                  | Recursos                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `gpa-control-flotilla-{stage}-storage` | S3 bucket (KMS + versioning + lifecycle), DynamoDB AppTable (single-table + 2 GSIs + PITR), DynamoDB IdempotencyTable (TTL 24h), KMS CMK |
| `gpa-control-flotilla-{stage}-auth`    | Cognito User Pool, App Client SRP, atributos `orgId` + `role`                                                                            |
| `gpa-control-flotilla-{stage}-api`     | API Gateway REST + Cognito Authorizer, 7 Lambdas Node 20 ARM64                                                                           |

**Costo proyectado**: < USD 30/mes para 5–20 usuarios. Cubierto por free tier los primeros 12 meses.

**Diseño anti-duplicados**: el código garantiza que registros idénticos no se duplican (ver `infra/README.md §Política antiduplicados`).

---

## 2. Prerrequisitos

### 2.1 Cuenta AWS

- Cuenta AWS activa (corporativa GPA o nueva en https://aws.amazon.com/free).
- **Billing Alerts habilitados** antes del primer deploy (Console → Billing → Budgets → crear budget $10 USD/mes con email alert).

### 2.2 IAM user para CDK

Crear un IAM user **dedicado al despliegue** (no usar root):

1. Console → IAM → Users → Create user
2. Nombre sugerido: `cdk-deploy-flotilla`
3. **Acceso programático** (Access Key + Secret)
4. Política temporal: `AdministratorAccess` (sólo Fase 1; restringir después a permisos mínimos listados en §6)
5. Guardar **Access Key ID** + **Secret Access Key** en gestor de contraseñas

### 2.3 Herramientas locales

En la máquina desde donde se hará deploy:

- **Node.js 20.x LTS** — https://nodejs.org/
- **AWS CLI v2** — `msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi /quiet` (Windows) o https://aws.amazon.com/cli/
- **Git** — https://git-scm.com/

Verificar:

```bash
node --version    # debe ser v20.x
npm --version
aws --version     # debe ser 2.x
git --version
```

### 2.4 Configurar perfil AWS local

```bash
aws configure --profile gpa-deploy
# AWS Access Key ID: <pegar>
# AWS Secret Access Key: <pegar>
# Default region: us-east-1
# Default output format: json
```

Verificar:

```bash
aws sts get-caller-identity --profile gpa-deploy
```

Debe responder con `Account` y `Arn` del usuario IAM. Si falla → revisar credenciales.

---

## 3. Clonar y preparar repo

```bash
git clone https://github.com/Eminav-117/control-flotilla.git
cd control-flotilla

# Instalar dependencias en ambos módulos
cd infra && npm install
cd ../backend && npm install
cd ..
```

---

## 4. Bootstrap CDK (1 sola vez por cuenta+región)

CDK necesita un stack base con bucket de assets y roles. Ejecutar **una vez**:

```bash
cd infra
export AWS_PROFILE=gpa-deploy        # PowerShell: $env:AWS_PROFILE = "gpa-deploy"
export CDK_DEFAULT_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --profile gpa-deploy --query Account --output text)

npm run bootstrap
```

Crea stack `CDKToolkit` con assets bucket. Costo ~ $0.01/mes.

---

## 5. Deploy

### 5.1 Stage `dev` (validación)

```bash
cd infra
npm run deploy:dev
```

Tarda 5–10 min. Al final imprime los **CfnOutput**:

```
gpa-control-flotilla-dev-storage.TableName = gpa-control-flotilla-dev-app
gpa-control-flotilla-dev-storage.IdempotencyTableName = gpa-control-flotilla-dev-idempotency
gpa-control-flotilla-dev-storage.ImagesBucketName = gpa-control-flotilla-dev-images-123456789012
gpa-control-flotilla-dev-storage.KmsKeyArn = arn:aws:kms:us-east-1:...
gpa-control-flotilla-dev-auth.UserPoolId = us-east-1_XXXXXXXXX
gpa-control-flotilla-dev-auth.UserPoolClientId = abc123def456...
gpa-control-flotilla-dev-api.ApiUrl = https://xxxxxxxx.execute-api.us-east-1.amazonaws.com/dev/
```

**↪ Enviar estos 7 valores al desarrollador** (Navares) — los configura en el frontend.

### 5.2 Stage `prod` (cuando dev validado)

```bash
npm run deploy:prod
```

Mismos outputs pero stack `prod`. Diferencias automáticas:

- `RemovalPolicy: RETAIN` (no destruye recursos al borrar stack)
- `deletionProtection: true` (DynamoDB y Cognito User Pool)
- `autoDeleteObjects: false` (S3 bucket no se vacía solo)

---

## 6. Verificación post-deploy

### 6.0 Smoke test automatizado (recomendado)

El repo incluye un script que valida los 12 checks principales en ~30 segundos. Correr primero:

```bash
# Bash / Git Bash / Linux / Mac
cd infra/scripts
./smoke-test.sh dev gpa-deploy
```

```powershell
# PowerShell (Windows)
cd infra\scripts
.\smoke-test.ps1 -Stage dev -Profile gpa-deploy
```

**Checks que ejecuta**:

1. Credenciales AWS válidas
2. Stack `storage` en `CREATE_COMPLETE`
3. Stack `auth` en `CREATE_COMPLETE`
4. Stack `api` en `CREATE_COMPLETE`
5. DynamoDB AppTable existe
6. GSI1 + GSI2 presentes
7. DDB encryption KMS activa
8. PITR habilitado
9. Idempotency table TTL activo
10. S3 bucket alcanzable
11. S3 KMS encryption + versioning + public-access-block
12. Cognito User Pool alcanzable
13. API Gateway responde 401/403 sin token (authorizer wired)
14. KMS key habilitada

**Si todo verde → deploy validado.** Si algo en rojo, las secciones 6.1–6.4 abajo dan el detalle manual.

### 6.1 Recursos creados

```bash
aws cloudformation list-stacks --profile gpa-deploy --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE
```

Deben aparecer:

- `gpa-control-flotilla-dev-storage`
- `gpa-control-flotilla-dev-auth`
- `gpa-control-flotilla-dev-api`

### 6.2 DynamoDB tabla con GSIs

```bash
aws dynamodb describe-table --table-name gpa-control-flotilla-dev-app --profile gpa-deploy
```

Debe mostrar `GlobalSecondaryIndexes: [GSI1, GSI2]` y `PointInTimeRecoveryDescription.PointInTimeRecoveryStatus: ENABLED`.

### 6.3 Cognito User Pool

```bash
aws cognito-idp describe-user-pool --user-pool-id <UserPoolId> --profile gpa-deploy
```

### 6.4 Crear primer usuario admin (manual, único)

```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username navares.oro@gmail.com \
  --user-attributes Name=email,Value=navares.oro@gmail.com Name=email_verified,Value=true Name=custom:orgId,Value=gpa Name=custom:role,Value=admin \
  --temporary-password "TempPass123!@" \
  --message-action SUPPRESS \
  --profile gpa-deploy
```

El usuario recibe el password temporal por canal seguro (no email).

---

## 7. Backup / Disaster Recovery

- **DynamoDB PITR** automático: restore a cualquier punto en últimos 35 días desde Console.
- **S3 versioning ON**: cualquier delete crea versión, restaurable.
- **CloudFormation stack** completo se redespliega desde este repo en cualquier momento.

---

## 8. Rollback / Destrucción

### 8.1 Destruir stage dev (sin datos reales)

```bash
cd infra
npm run destroy:dev
```

Borra todos los recursos `dev`. Tarda 5 min.

### 8.2 Destruir stage prod

**NO usar `destroy:prod` directo** — la `deletionProtection` lo bloqueará. Si realmente se debe destruir prod:

1. Console → DynamoDB → modificar tabla → desactivar deletion protection
2. Console → Cognito → desactivar deletion protection
3. Console → S3 → vaciar bucket manualmente
4. Entonces `cdk destroy --all --context stage=prod`

Este flujo es intencional — previene borrado accidental de producción.

---

## 9. Permisos IAM mínimos (post-Fase 1)

Después de validar Fase 1 con `AdministratorAccess`, **reemplazar** la policy del usuario `cdk-deploy-flotilla` por estos permisos mínimos:

- `cloudformation:*` sobre stacks `gpa-control-flotilla-*`
- `s3:*` sobre buckets `cdk-*` (assets) y `gpa-control-flotilla-*`
- `dynamodb:*` sobre tablas `gpa-control-flotilla-*`
- `cognito-idp:*` sobre user pools `gpa-control-flotilla-*`
- `lambda:*`, `apigateway:*`, `kms:*`, `logs:*`, `iam:*` (CDK necesita crear roles)
- `sts:AssumeRole` sobre roles `cdk-*-cfn-exec-role-*`, `cdk-*-deploy-role-*`

Política JSON exacta disponible bajo solicitud — generar con `cdk deploy --bootstrap-customer-key` flag.

---

## 10. Soporte y contactos

- **Desarrollador**: Navares (`navares.oro@gmail.com`)
- **Doc técnico arquitectura**: `infra/README.md` en este repo
- **Doc original propuesta**: `Backend_AWS_Control_Flotilla_Resumen.pdf` (mayo 2026)
- **Issues**: https://github.com/Eminav-117/control-flotilla/issues

Para preguntas sobre el código → desarrollador. Para temas de cuenta AWS, billing, IAM corporativo → TI.

---

## Checklist final TI

Antes de marcar Fase 1 como completada:

- [ ] Cuenta AWS verificada y Billing Alerts configurados
- [ ] IAM user `cdk-deploy-flotilla` creado con perfil local `gpa-deploy`
- [ ] `cdk bootstrap` ejecutado exitosamente
- [ ] `npm run deploy:dev` completado sin errores
- [ ] `infra/scripts/smoke-test.sh dev` o `.ps1 -Stage dev` retorna `0 failed`
- [ ] 3 stacks `dev` en estado `CREATE_COMPLETE`
- [ ] Outputs (UserPoolId, ApiUrl, etc.) enviados al desarrollador
- [ ] Primer usuario admin creado en Cognito
- [ ] `npm run deploy:prod` completado (cuando dev validado por desarrollador)
- [ ] `infra/scripts/smoke-test.sh prod` retorna `0 failed`
- [ ] IAM policy del deployer restringida a permisos mínimos
- [ ] AWS Backup configurado sobre DynamoDB AppTable (recomendado para prod)
