# Cursor AI Translator

Extension de navegador que detecta texto seleccionado y muestra una traduccion junto al cursor. Incluye un backend local para usar OpenAI, Z.AI o traduccion offline con Argos Translate.

![Cursor AI Translator preview](assets/preview1.png)

## Que incluye

- Burbuja flotante cerca del cursor cuando seleccionas texto.
- Traduccion automatica configurable desde la pagina de opciones.
- Configuracion de proveedor, modelo y API key desde la pagina de opciones.
- Backend local en Node.js.
- Endpoint de salud para verificar que el servidor este corriendo.

## Estructura

```text
cursor-ai-translator/
├── assets/
│   ├── logo.png
│   ├── preview1.png
│   ├── preview2.png
│   └── preview3.png
├── extension/
│   ├── background.js
│   ├── content.css
│   ├── content.js
│   ├── icons/
│   │   ├── icon-16.png
│   │   ├── icon-32.png
│   │   ├── icon-48.png
│   │   └── icon-128.png
│   ├── manifest.json
│   ├── options.css
│   ├── options.html
│   └── options.js
├── .env.example
├── LICENSE
├── local-translator/
│   ├── install_model.py
│   ├── requirements.txt
│   └── worker.py
├── package.json
├── README.md
└── server.mjs
```

## Capturas

### Burbuja de traduccion

![Translation bubble](assets/preview1.png)

### Configuracion principal

![Settings overview](assets/preview2.png)

### Guardado y controles visuales

![Settings saved](assets/preview3.png)

## Arranque local

1. Instala dependencias:

```bash
npm install
```

2. Elige proveedor e inicia el servidor.

### OpenAI

```bash
export AI_PROVIDER="openai"
export OPENAI_API_KEY="tu_api_key"
npm start
```

### Z.AI

```bash
export AI_PROVIDER="zai"
export ZAI_API_KEY="tu_api_key"
export ZAI_MODEL="glm-4.6"
export ZAI_ENDPOINT="general"
npm start
```

Si tu cuenta usa `GLM Coding Plan`, inicia con:

```bash
export AI_PROVIDER="zai"
export ZAI_API_KEY="tu_api_key"
export ZAI_MODEL="glm-4.7"
export ZAI_ENDPOINT="coding"
npm start
```

Despues del primer arranque, tambien puedes abrir la pagina de opciones de la extension y guardar manualmente:

- proveedor activo
- API key
- modelo
- endpoint de Z.AI

La llave se conserva en `server-config.json` dentro del proyecto y no se guarda en `chrome.storage`.

3. Carga la extension sin empaquetar:

```text
chrome://extensions
```

Activa el modo desarrollador, pulsa `Load unpacked` y selecciona:

```text
cursor-ai-translator/extension
```

4. Abre la pagina de opciones de la extension y confirma:

- `Idioma destino`: por defecto `Spanish`
- `Servidor local`: `http://127.0.0.1:8787`
- `Traducir automaticamente`: activo

## Alcance actual

Esta primera version funciona dentro del navegador. No captura seleccion de texto a nivel de todo el sistema operativo. Para cubrir aplicaciones de escritorio, IDEs y PDFs fuera del navegador haria falta una segunda etapa con una app nativa o basada en Electron/Tauri y APIs de accesibilidad del sistema.

## Proveedores soportados

- `openai`: usa `Responses API`.
- `zai`: usa la API compatible con OpenAI de Z.AI mediante `chat/completions`.
- `argos`: usa traduccion local offline con modelos descargados en tu maquina.
- `ollama`: usa un modelo local servido por Ollama.

Para Z.AI:

- `ZAI_ENDPOINT="general"` usa `https://api.z.ai/api/paas/v4/`
- `ZAI_ENDPOINT="coding"` usa `https://api.z.ai/api/coding/paas/v4/`

El endpoint `coding` es el que Z.AI indica para cuentas con `GLM Coding Plan`.

Si cambias de proveedor o de API key desde la pagina de opciones, no hace falta reiniciar el servidor.

El backend mantiene una cache corta de traducciones recientes para responder al instante cuando vuelves a seleccionar el mismo texto.

## Modo local offline

Para eliminar la latencia de red y no depender de cuotas de API, instala Argos Translate en un entorno local del proyecto:

```bash
npm run setup:argos
npm run model:argos:en-es
```

Despues abre las opciones de la extension y selecciona:

- `Proveedor activo`: `Argos local`
- `Idioma origen opcional`: `English` o `en`
- `Idioma destino`: `Spanish` o `es`

Para traduccion en sentido contrario, instala tambien:

```bash
npm run model:argos:es-en
```

## Ollama local

Ollama expone su API local por defecto en:

```text
http://127.0.0.1:11434/api
```

Con Ollama instalado y corriendo, descarga un modelo:

```bash
ollama pull gemma3
```

Luego, en la configuracion de la extension:

- `Proveedor`: `Ollama local`
- `Modelo Ollama`: `gemma3`
- `URL local`: `http://127.0.0.1:11434/api`

## Preparar repo para GitHub

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin <tu-repo>
git push -u origin main
```

Antes de publicar, confirma que nunca entren al repositorio:

- `server-config.json`
- `.env`
- `.venv-local/`
- `node_modules/`

## Idea de evolucion

- Atajo de teclado para traducir solo cuando el usuario lo pida.
- Historial local de traducciones.
- Deteccion inteligente de idioma origen.
- Version de escritorio con lectura de seleccion global.
- Soporte opcional para reemplazar el texto seleccionado en campos editables.
