# Descarga catastro

Esta web permite seleccionar un rectángulo en el mapa, un bounding box, y descargar la información sobre _edificios_, _partes de edificios_ y _otras edificaciones_, que se encuentren en servicio web WFS de https://www.catastro.hacienda.gob.es/webinspire/index.html

## Build local con Docker

Puerto por defecto: `8000` (configurable con variables de entorno)

1. Construir imagen:
   `docker build -t descarga-catastro .`

2. Ejecutar contenedor:
   `docker run --rm --init -p 8000:8000 descarga-catastro`

3. Abrir en el navegador:
   http://localhost:8000
   
