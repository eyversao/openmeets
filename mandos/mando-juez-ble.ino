// Mando Bluetooth de un juez para OpenMeets: un ESP32 por juez.
// Librería: NimBLE-Arduino (Gestor de librerías, autor h2zero). Placa: ESP32 Dev Module.
// Elige el juez con UNA de estas líneas (las otras, comentadas):
#define JUEZ 'L'   // 'L' izquierdo, 'C' principal (centro), 'R' derecho
// El nombre Bluetooth sale solo: OpenMando-L, OpenMando-C o OpenMando-R.
//
// Protocolo (Nordic UART, notificaciones en TX): una línea por evento.
//   <JUEZ>1 blanca, <JUEZ>2 roja, <JUEZ>3 azul, <JUEZ>4 amarilla   (ej.: L3)
//   HB:<JUEZ> cada 2 s (latido)       BAT:<JUEZ>:87 cada 30 s (batería, también en el servicio 0x180F)
//
// Cableado: botones entre el pin y GND (resistencia interna). LED en pin 2 (el de la placa).
// Batería LiPo: divisor 100k + 100k de BAT+ al pin 34 (ADC) y a GND; lee la mitad de la tensión.

#include <NimBLEDevice.h>

const byte PIN_BOTON[4] = {25, 26, 27, 14};  // blanca, roja, azul, amarilla
const byte PIN_LED = 2;
const byte PIN_BAT = 34;
const unsigned long ANTIREBOTE = 25, CADA_LATIDO = 2000, CADA_BAT = 30000;
// #define DORMIR_MS 600000   // Opcional: dormir si pasan 10 min sin pulsar (despierta con cualquier botón).

#define NUS_SERVICIO "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX       "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_TX       "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

NimBLEServer* servidor;
NimBLECharacteristic* tx;
NimBLECharacteristic* nivelBat;
bool conectado = false;
bool estable[4] = {true, true, true, true}, lectura[4] = {true, true, true, true};
unsigned long cambio[4] = {0, 0, 0, 0}, ultimoLatido = 0, ultimaBat = 0, ultimaPulsacion = 0, ledHasta = 0;

class Eventos : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override { conectado = true; }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override { conectado = false; NimBLEDevice::startAdvertising(); }
};

void enviar(const String& linea) {
  if (!conectado) return;
  String s = linea + "\n";
  tx->setValue((const uint8_t*)s.c_str(), s.length());
  tx->notify();
}

uint8_t porcentajeBateria() {
  float v = analogReadMilliVolts(PIN_BAT) * 2.0 / 1000.0;  // divisor 1:2
  int p = (int)((v - 3.3) / (4.2 - 3.3) * 100.0);
  return constrain(p, 0, 100);
}

void publicarBateria() {
  uint8_t p = porcentajeBateria();
  nivelBat->setValue(&p, 1);
  nivelBat->notify();
  enviar(String("BAT:") + (char)JUEZ + ":" + p);
}

void setup() {
  for (byte i = 0; i < 4; i++) pinMode(PIN_BOTON[i], INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  analogReadResolution(12);

  String nombre = String("OpenMando-") + (char)JUEZ;
  NimBLEDevice::init(nombre.c_str());
  servidor = NimBLEDevice::createServer();
  servidor->setCallbacks(new Eventos());

  NimBLEService* nus = servidor->createService(NUS_SERVICIO);
  tx = nus->createCharacteristic(NUS_TX, NIMBLE_PROPERTY::NOTIFY);
  nus->createCharacteristic(NUS_RX, NIMBLE_PROPERTY::WRITE);
  nus->start();

  NimBLEService* bat = servidor->createService("180F");
  nivelBat = bat->createCharacteristic("2A19", NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  bat->start();
  uint8_t p = porcentajeBateria();
  nivelBat->setValue(&p, 1);

  NimBLEAdvertising* anuncio = NimBLEDevice::getAdvertising();
  anuncio->addServiceUUID(NUS_SERVICIO);
  anuncio->setName(nombre.c_str());
  anuncio->start();

#ifdef DORMIR_MS
  esp_sleep_enable_ext1_wakeup((1ULL << PIN_BOTON[0]) | (1ULL << PIN_BOTON[1]) | (1ULL << PIN_BOTON[2]) | (1ULL << PIN_BOTON[3]), ESP_EXT1_WAKEUP_ANY_LOW);
#endif
  ultimaPulsacion = millis();
}

void loop() {
  unsigned long ahora = millis();
  for (byte i = 0; i < 4; i++) {
    bool lee = digitalRead(PIN_BOTON[i]);
    if (lee != lectura[i]) { lectura[i] = lee; cambio[i] = ahora; }
    if (ahora - cambio[i] > ANTIREBOTE && lee != estable[i]) {
      estable[i] = lee;
      if (!lee) {  // pulsado
        enviar(String((char)JUEZ) + (i + 1));
        ledHasta = ahora + 300;
        ultimaPulsacion = ahora;
      }
    }
  }
  digitalWrite(PIN_LED, ahora < ledHasta ? HIGH : LOW);

  if (ahora - ultimoLatido >= CADA_LATIDO) { ultimoLatido = ahora; enviar(String("HB:") + (char)JUEZ); }
  if (conectado && ahora - ultimaBat >= CADA_BAT) { ultimaBat = ahora; publicarBateria(); }

#ifdef DORMIR_MS
  if (ahora - ultimaPulsacion > DORMIR_MS) esp_deep_sleep_start();
#endif
  delay(5);
}
