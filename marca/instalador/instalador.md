# Textos del instalador de OpenMeets

Generado desde `ui/textos.js` con `node marca/instalador/textos-md.cjs`; para cambiar un texto, edita `textos.js` y vuelve a generar este archivo. Entre asteriscos va la palabra en Instrument Serif cursiva. El idioma sale de `datos({ idioma })`: lo que no empieza por `en` va en español.

## General

| Clave | Español | English |
| --- | --- | --- |
| `pasosInstalar` | Bienvenida · Licencia · Carpeta · Instalación · Listo | Welcome · License · Location · Install · Done |
| `pasosDesinstalar` | Confirmar · Quitando · Hecho | Confirm · Removing · Done |
| `pasosEtiqueta` | Pasos | Steps |
| `minimizar` | Minimizar | Minimize |
| `cerrar` | Cerrar | Close |
| `continuar` | Continuar | Continue |
| `atras` | Atrás | Back |
| `cancelar` | Cancelar | Cancel |

## Bienvenida

| Clave | Español | English |
| --- | --- | --- |
| `bienvenidaHtml` | Vamos a instalar *OpenMeets*. | Let’s install *OpenMeets*. |
| `bienvenidaTexto` | La app de la mesa para competencias de powerlifting. Funciona en la red del gimnasio, sin internet: los jueces votan con el teléfono y la pantalla del público se actualiza al instante. | The table app for powerlifting meets. It runs on the gym’s own network with no internet: judges vote from their phones and the audience screen updates the moment they do. |
| `rasgos` | Funciona sin internet · Jueces con el teléfono · Pantalla, récords y transmisión | Works without internet · Judges vote from their phones · Screen, records and streaming |

## Licencia

| Clave | Español | English |
| --- | --- | --- |
| `licenciaHtml` | Licencia *MIT*. | *MIT* license. |
| `licenciaTexto` | OpenMeets es libre y gratis. Puedes usarlo, copiarlo y cambiarlo, también en competencias de pago. El texto legal está en inglés: | OpenMeets is free and open source. Use it, copy it and change it, paid meets included. |
| `aceptar` | Aceptar y continuar | Accept and continue |

## Carpeta y opciones

| Clave | Español | English |
| --- | --- | --- |
| `carpetaHtml` | ¿Dónde lo *instalamos*? | Where should it *go*? |
| `carpetaEtiqueta` | Carpeta de instalación | Install location |
| `cambiar` | Cambiar… | Change… |
| `carpetaNota` | Tus meets se guardan aparte, en tu carpeta de usuario. Si reinstalas, no pierdes nada. | Your meets are stored separately, in your user folder, so reinstalling never loses anything. |
| `opcionesEtiqueta` | Opciones | Options |
| `escritorio` | Acceso directo en el escritorio | Desktop shortcut |
| `inicio` | Añadir al menú Inicio | Add to the Start menu |
| `abrir` | Abrir OpenMeets al terminar | Open OpenMeets when done |
| `instalar` | Instalar | Install |

## Instalando

| Clave | Español | English |
| --- | --- | --- |
| `instalandoHtml` | *Instalando*… | *Installing*… |
| `instalandoTexto` | Esto tarda unos segundos. No cierres la ventana. | This takes a few seconds. Keep the window open. |
| `progresoEtiqueta` | Progreso de la instalación | Install progress |
| `preparando` | Preparando… | Getting ready… |

## Listo

| Clave | Español | English |
| --- | --- | --- |
| `listoHtml` | Todo *listo*. | All *set*. |
| `listoTexto` | OpenMeets ya está en este equipo. La primera vez que lo abras, Windows puede preguntar por el Firewall: permite las redes privadas para que los teléfonos de los jueces se conecten. | OpenMeets is on this computer. The first time you open it, Windows may ask about the Firewall: allow private networks so the judges’ phones can connect. |
| `abrirApp` | Abrir OpenMeets | Open OpenMeets |

## Error

| Clave | Español | English |
| --- | --- | --- |
| `errorHtml` | Algo *falló*. | Something *went wrong*. |
| `errorTexto` | No se pudo terminar. No se cambió nada que no puedas volver a instalar. | The install couldn’t finish. Nothing was changed that a new install won’t fix. |
| `reintentar` | Reintentar | Try again |

## Desinstalador

| Clave | Español | English |
| --- | --- | --- |
| `confirmarHtml` | ¿Quitar *OpenMeets*? | Remove *OpenMeets*? |
| `confirmarTexto` | Se borran el programa y sus accesos directos. | This deletes the program and its shortcuts. |
| `borrarDatos` | Borrar también mis meets y récords | Also delete my meets and records |
| `borrarDatosAviso` | Esto no se puede deshacer. Si no lo marcas, tus datos se quedan en tu carpeta de usuario. | This can’t be undone. Leave it unchecked and your data stays in your user folder. |
| `quitar` | Quitar | Remove |
| `quitandoHtml` | *Quitando*… | *Removing*… |
| `quitandoTexto` | Un momento. | One moment. |
| `hechoHtml` | OpenMeets se *quitó*. | OpenMeets is *gone*. |
| `hechoTexto` | Gracias por usarlo. Tus meets siguen guardados por si vuelves. | Thanks for using it. Your meets are still saved in case you come back. |
| `hechoTextoSinDatos` | Gracias por usarlo. También se borraron tus meets y récords. | Thanks for using it. Your meets and records were deleted too. |

## Solo en el modo demo

| Clave | Español | English |
| --- | --- | --- |
| `demoPasos` | Copiando archivos · Instalando el servidor · Creando accesos directos · Registrando el desinstalador · Terminando | Copying files · Installing the server · Creating shortcuts · Registering the uninstaller · Finishing |
| `demoQuitar` | Cerrando OpenMeets · Quitando accesos directos · Borrando archivos · Terminando | Closing OpenMeets · Removing shortcuts · Deleting files · Finishing |
| `demoAbrir` | Demo: aquí se abriría OpenMeets. | Demo: OpenMeets would open here. |
| `demoCerrar` | Demo: aquí se cerraría la ventana. | Demo: the window would close here. |

La licencia se muestra en inglés (es el texto legal del archivo `LICENSE`).
