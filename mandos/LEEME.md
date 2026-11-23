# Mandos de jueces / Judge remotes

Español primero, English below.

## Español

Un mando es un botón físico por juez. Es opcional: los jueces también pueden votar desde el teléfono con el enlace de la pestaña Jueces.

| Situación | Opción |
|---|---|
| Quieres un botón físico por juez, sin cables | **Mando Bluetooth** (`mando-juez-ble.ino`, un ESP32 por juez). |
| Quieres un solo aparato con cable | **Mando USB** (`mando-jueces.ino`, 12 botones). |
| Ya tienes un teclado, mando de consola o presentador Bluetooth | Conéctalo al PC de la mesa y usa **Aprender** en la pestaña Jueces: pulsas el botón y eliges a qué voto corresponde. |

### Navegador

- Web Bluetooth y Web Serial solo funcionan en **Chrome o Edge de escritorio** (Web Bluetooth también en Chrome para Android). No funcionan en iPhone/Safari ni en Firefox.
- Los mandos se conectan **al PC de la mesa**, abierto en `http://localhost:5050/`. Desde una dirección `http://192.168...` el navegador no ofrece Bluetooth ni USB.
- Un teléfono no puede hacerse pasar por un mando Bluetooth. Si no tiene mando, el juez vota con el enlace.

### Teclas de fábrica

| Juez | Blanca | Roja | Azul | Amarilla |
|---|---|---|---|---|
| Izquierdo | Q | A | 1 | 2 |
| Principal | W | Z | 3 | 4 |
| Derecho | E | C | 5 | 6 |

Blanca es válido; roja, azul y amarilla son nulo con esa tarjeta (con federación «otra», todas cuentan como nulo sin tarjeta).

### Protocolo de texto (USB y Bluetooth)

Una línea por evento:

- `L1 L2 L3 L4`: juez izquierdo, blanca, roja, azul, amarilla. `C1..C4`: principal. `R1..R4`: derecho.
- `BAT:L:87`: batería al 87 % del juez izquierdo.
- `HB:L`: latido cada 2 s. Si la app no lo recibe en 6 s, marca el mando como desconectado.

### Mando USB (`mando-jueces.ino`)

1. Arduino Uno o Nano (o un ESP32 con otros pines libres). Cada botón entre su pin y GND; no hace falta resistencia.
2. Pines: L1-L4 en 2-5, C1-C4 en 6-9, R1-R4 en 10, 11, 12 y A0.
3. En el Arduino IDE abre el sketch, elige placa y puerto y pulsa Subir.
4. En la pestaña Jueces pulsa **Conectar placa USB** y elige el puerto. Ya viene mapeado, no hace falta Aprender.

### Mando Bluetooth (`mando-juez-ble.ino`)

Un ESP32 por juez. En el sketch cambia `#define JUEZ 'L'` a `'C'` o `'R'`: el nombre Bluetooth será `OpenMando-L`, `OpenMando-C` o `OpenMando-R`. La app busca ese prefijo (`OpenMando`), así que no lo cambies.

1. Arduino IDE con soporte de ESP32 (placa «ESP32 Dev Module») y la librería **NimBLE-Arduino** (h2zero) 2.x. Con la 1.x, `onConnect` y `onDisconnect` llevan otra firma (sin `NimBLEConnInfo`).
2. Cableado: botones blanca, roja, azul y amarilla en los pines 25, 26, 27 y 14, cada uno a GND. El LED del pin 2 (el de la placa) se enciende 0,3 s al votar. Batería LiPo: BAT+ a un divisor de dos resistencias de 100 kΩ, el punto medio al pin 34 y el otro extremo a GND.
3. Sube el sketch. Para ahorrar batería activa `DORMIR_MS` (sueño profundo tras 10 min sin pulsar; despierta con cualquier botón).
4. En la pestaña Jueces pulsa **Conectar mando Bluetooth** y elige `OpenMando-…`. Repite por cada juez. Si el mando se aleja o se apaga, la app reintenta sola con esperas crecientes (1, 2, 4, 8, 15 y 30 s).

### Materiales aproximados

- Mando USB: Arduino Nano o similar, 12 pulsadores, caja y cable USB (15-25 USD).
- Por cada mando Bluetooth: ESP32, 4 pulsadores grandes (blanco, rojo, azul, amarillo), LED, batería LiPo 3,7 V con cargador TP4056, 2 resistencias de 100 kΩ, interruptor y caja (12-20 USD).

## English

A remote is one physical button set per judge. It is optional: judges can also vote from their phones with the link in the Judges tab.

- **Bluetooth remote:** `mando-juez-ble.ino`, one ESP32 per judge. Set `#define JUEZ` to `'L'`, `'C'` or `'R'`; the device is named `OpenMando-L/C/R` and the app looks for the `OpenMando` prefix. Needs the NimBLE-Arduino 2.x library. Buttons on pins 25, 26, 27, 14 (white, red, blue, yellow) to GND.
- **USB remote:** `mando-jueces.ino`, 12 buttons on an Arduino Uno/Nano: L1-L4 on pins 2-5, C1-C4 on 6-9, R1-R4 on 10, 11, 12 and A0.
- **Any keyboard, gamepad or Bluetooth presenter:** plug it into the table PC and use **Learn** in the Judges tab.
- **Browser:** desktop Chrome or Edge, on the table PC at `http://localhost:5050/`. Web Bluetooth and Web Serial do not work on iPhone/Safari, Firefox, or from a `http://192.168...` address.
- **Protocol:** one text line per event (`L1`-`L4`, `C1`-`C4`, `R1`-`R4`: white, red, blue, yellow; `BAT:L:87`; `HB:L` every 2 s). The app marks a remote as disconnected after 6 s without a heartbeat.
- **Default keys:** left judge Q/A/1/2, head judge W/Z/3/4, right judge E/C/5/6.
