# Descarga catastro

Este repositorio contiene frontend (public/) y backend (server.js) que ejecuta `run_export.sh` para generar un GeoJSON a partir de una BBOX.

Puerto por defecto: 8000

## Build local con Docker
1. Construir imagen:
   docker build -t descarga-catastro .

2. Ejecutar contenedor:
   docker run --rm -p 8000:8000 descarga-catastro

3. Abrir en el navegador:
   http://localhost:8000

## Notas de seguridad y operativa
- El script se ejecuta con los argumentos que envía el cliente; server.js valida que sean números y comprueba un max delta para evitar peticiones abusivas. Ajusta estos límites según tu caso.
- Ejecuta la app en un entorno con límites de recursos (container) y usa TLS/reverse-proxy en producción.
- Si el servicio WFS al que accede run_export.sh falla o hay problemas de CORS, el script usa curl en servidor por lo que no depende de CORS del navegador.
- Monitoriza y limita concurrencia si esperas múltiples usuarios concurrentes.
