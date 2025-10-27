# Descarga catastro

Esta web permite seleccionar un rectángulo en el mapa, un bounding box, y descargar la información sobre edificios, partes de edificios y otras edificaciones, que se encuentren en servicio web WFS de https://www.catastro.hacienda.gob.es/webinspire/index.html

Puerto por defecto: 8000

## Build local con Docker
1. Construir imagen:
   docker build -t descarga-catastro .

2. Ejecutar contenedor:
   docker run --rm -p 8000:8000 descarga-catastro

3. Abrir en el navegador:
   http://localhost:8000
   
