# 🚀 Guía de Despliegue: Control de Flotilla GPA

Esta guía detalla cómo poner en producción la aplicación en los servidores internos de la empresa utilizando la infraestructura Docker + Nginx que hemos configurado.

## 📦 1. Construcción de la Imagen
Ejecuta este comando en la raíz del proyecto para generar el contenedor industrial:
```bash
docker build -t control-flotilla .
```

## 🧪 2. Verificación de Seguridad (CSP)
Antes de subir al servidor, verifica que la **Política de Seguridad de Contenido** no bloquee funciones críticas:
```bash
docker run -d -p 8080:80 --name test-flotilla control-flotilla
```
*   Accede a `http://localhost:8080`
*   Abre la consola del navegador (F12) y verifica que no haya errores de "Refused to load...".
*   Prueba cargar un ZIP pesado para verificar que el nuevo motor de streaming funciona en el entorno Nginx.

## 🌐 3. Despliegue en Servidor de Intranet (Air-gap)
Si tu servidor interno no tiene acceso a internet para descargar imágenes de Node o Nginx:

**En tu máquina local:**
```powershell
# Exportar la imagen completa a un archivo
docker save control-flotilla | gzip > control-flotilla.tar.gz
```

**En el servidor interno:**
```powershell
# Cargar la imagen desde el archivo .tar.gz
docker load < control-flotilla.tar.gz

# Iniciar la aplicación en el puerto 80 con reinicio automático
docker run -d -p 80:80 --restart always --name gpa-flotilla control-flotilla
```

## 🛠️ 4. Configuración Técnica Incluida
*   **Base URL:** Configurada como `./` para funcionar en cualquier subdirectorio del servidor.
*   **PWA:** Service Worker configurado para actualizarse automáticamente cuando detecte cambios en el servidor interno.
*   **Seguridad:** Nginx bloquea `iframes` externos y ejecuciones de scripts no autorizados para proteger los datos de GPA.

---
> [!IMPORTANT]
> **Mantenimiento:** Al ser una aplicación estática (SPA), no necesitas configurar bases de datos SQL en el servidor. Todo se gestiona vía IndexedDB en el cliente, lo que hace que el servidor sea extremadamente ligero y fácil de escalar.
