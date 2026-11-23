// Mando de jueces para OpenMeets por USB: 3 jueces x 4 botones = 12 botones.
// Cada pulsación envía una línea de texto (115200 baudios) y cada 2 s un latido:
//   L1 L2 L3 L4  = juez izquierdo: blanca, roja, azul, amarilla
//   C1..C4       = juez principal (centro)
//   R1..R4       = juez derecho
//   HB:L HB:C HB:R  = latido (la app marca «desconectado» tras 6 s sin latido)
// La app asigna cada señal a su voto de fábrica; también se reprograma con «Aprender».
// Cableado: cada botón entre su pin y GND (se usa la resistencia interna).
// Pines pensados para Arduino Uno/Nano. En ESP32 cambia la lista por pines libres
// (por ejemplo 13,14,15,16,17,18,19,21,22,23,25,26).

struct Boton { byte pin; const char* senal; bool estable; bool lectura; unsigned long cambio; };
Boton botones[] = {
  { 2, "L1", true, true, 0}, { 3, "L2", true, true, 0}, { 4, "L3", true, true, 0}, { 5, "L4", true, true, 0},
  { 6, "C1", true, true, 0}, { 7, "C2", true, true, 0}, { 8, "C3", true, true, 0}, { 9, "C4", true, true, 0},
  {10, "R1", true, true, 0}, {11, "R2", true, true, 0}, {12, "R3", true, true, 0}, {A0, "R4", true, true, 0},
};
const unsigned long ANTIREBOTE = 25;     // ms
const unsigned long CADA_LATIDO = 2000;  // ms
unsigned long ultimoLatido = 0;

void setup() {
  Serial.begin(115200);
  for (auto &b : botones) pinMode(b.pin, INPUT_PULLUP);
}

void loop() {
  unsigned long ahora = millis();
  for (auto &b : botones) {
    bool lee = digitalRead(b.pin);
    if (lee != b.lectura) { b.lectura = lee; b.cambio = ahora; }
    if (ahora - b.cambio > ANTIREBOTE && lee != b.estable) {
      b.estable = lee;
      if (!lee) Serial.println(b.senal);  // pulsado = LOW
    }
  }
  if (ahora - ultimoLatido >= CADA_LATIDO) {
    ultimoLatido = ahora;
    Serial.println("HB:L"); Serial.println("HB:C"); Serial.println("HB:R");
  }
}
