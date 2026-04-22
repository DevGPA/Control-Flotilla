# Etapa 1: Build
# NOTA: para build reproducible, reemplazar tag por digest:
#   FROM node:20.18.0-alpine@sha256:<digest>
# Obtener digest: docker manifest inspect node:20.18.0-alpine
FROM node:20.18.0-alpine AS build

WORKDIR /app

# Instalar dependencias (lockfile estricto)
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Copiar código fuente y assets
COPY . .

# Build de la aplicación (Vite genera la carpeta dist/)
RUN npm run build && \
    test -f dist/index.html && \
    test -d dist/assets || (echo "Build artifacts faltantes" && exit 1)

# Etapa 2: Runtime
# NOTA: pin digest en producción — ver comentario etapa build.
FROM nginx:1.27.3-alpine AS runtime

# Copiar configuración personalizada de Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar los archivos estáticos desde la etapa de build
COPY --from=build /app/dist /usr/share/nginx/html

# Drop privilegios — nginx:alpine corre como root por default.
# Worker procs lo bajan a usuario nginx automáticamente, pero el master corre root.
# Para hardening completo usar nginxinc/nginx-unprivileged.

# Exponer el puerto 80 para el servidor interno
EXPOSE 80

# Salud del contenedor — golpea endpoint dedicado /healthz (no SPA index).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
