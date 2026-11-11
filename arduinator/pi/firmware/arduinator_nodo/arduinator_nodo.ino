/* ═══════════════════════════════════════════════════════════════════════════
   ARDUINATOR · nodo Arduino (sentidos y músculos)
   Habla con la Raspberry Pi por USB a 115200 baudios, una línea JSON por mensaje.

   Arduino → Pi   {"nodo":"interior","hola":1,"version":"1.0","efectores":["heat","pump",...]}
                  {"nodo":"interior","Tin":21.3,"RHin":66.2,"theta":34.1,...}     cada 5 s
                  {"nodo":"interior","ok":{"heat":1,"pump":0}}                    al recibir una orden
   Pi → Arduino   {"act":{"heat":1,"pump":0,"vent":0.35},"ttl":180}

   Autonomía local: si la Raspberry Pi calla más de ttl segundos, el nodo no se
   queda quieto. Vuelve a reglas simples de supervivencia (helada, sed, calor) y
   sigue cuidando el invernadero hasta que la placa madre regrese.

   Elige el nodo y los sensores en la sección CONFIGURACIÓN. Bibliotecas, según lo que actives:
     ArduinoJson (Benoit Blanchon) · Adafruit SHT31 · Adafruit BMP280 · OneWire · DallasTemperature
     SparkFun SCD30 · BH1750 (Christopher Laws)
   ═══════════════════════════════════════════════════════════════════════════ */
#include <ArduinoJson.h>
#include <Wire.h>
#include <Servo.h>

// ─────────── CONFIGURACIÓN ───────────
#define NODO_INTERIOR 1          // 1 = nodo interior (aire, suelo, efectores) · 0 = estación exterior
#if NODO_INTERIOR               // sentidos del nodo interior
  #define USA_SHT31   1          // temperatura y humedad del aire (I²C 0x44)
  #define USA_SCD30   0          // CO₂ NDIR (I²C)
  #define USA_DS18B20 1          // temperatura del suelo (OneWire)
  #define USA_BH1750  1          // luz en lux; la Pi la convierte a PAR
  #define USA_SUELO   1          // humedad de suelo capacitiva (analógica)
  #define USA_EC      0          // sonda de conductividad (analógica)
  #define USA_PH      0          // electrodo de pH con su placa (analógica)
  #define USA_NIVEL   0          // nivel del estanque con HC-SR04
  #define USA_BMP280  0
  #define USA_VIENTO  0
  #define USA_LLUVIA  0
#else                            // sentidos de la estación exterior
  #define USA_SHT31   1          // temperatura y humedad exterior, dentro de un abrigo meteorológico
  #define USA_SCD30   0
  #define USA_DS18B20 0
  #define USA_BH1750  1          // luz exterior; la Pi la convierte a radiación (W/m²)
  #define USA_SUELO   0
  #define USA_EC      0
  #define USA_PH      0
  #define USA_NIVEL   0
  #define USA_BMP280  1          // presión
  #define USA_VIENTO  1          // anemómetro de cazoletas (interrupción en D2)
  #define USA_LLUVIA  1          // pluviómetro de balancín (interrupción en D3)
#endif

#define RELE_ACTIVO   LOW        // la mayoría de los módulos de relé se activan en LOW

// pines
const uint8_t P_SUELO = A0, P_EC = A1, P_PH = A2;
const uint8_t P_ONEWIRE = 3;
const uint8_t P_TRIG = A3, P_ECHO = 13;
const uint8_t P_VIENTO = 2, P_LLUVIA = 3;      // en la estación exterior (interrupciones 0 y 1)
const uint8_t P_HEAT = 4, P_PUMP = 5, P_FERT = 6, P_ACID = 7, P_FAN = 8, P_VENT_SERVO = 9, P_MIST = 10, P_LED = 11, P_SHADE = 12;

// calibración del sensor de suelo capacitivo: lectura en aire seco y sumergido en agua
const int SUELO_SECO = 560, SUELO_AGUA = 260;
// calibración del estanque (cm desde el sensor hasta el fondo y hasta el nivel lleno)
const float NIVEL_VACIO_CM = 120.0, NIVEL_LLENO_CM = 15.0;

// ─────────── sentidos ───────────
#if USA_SHT31
  #include <Adafruit_SHT31.h>
  Adafruit_SHT31 sht = Adafruit_SHT31();
#endif
#if USA_SCD30
  #include <SparkFun_SCD30_Arduino_Library.h>
  SCD30 scd;
#endif
#if USA_DS18B20
  #include <OneWire.h>
  #include <DallasTemperature.h>
  OneWire ow(P_ONEWIRE);
  DallasTemperature ds(&ow);
#endif
#if USA_BH1750
  #include <BH1750.h>
  BH1750 luz;
#endif
#if USA_BMP280
  #include <Adafruit_BMP280.h>
  Adafruit_BMP280 bmp;
#endif

volatile unsigned long pulsosViento = 0, pulsosLluvia = 0;
void isrViento() { pulsosViento++; }
void isrLluvia() { pulsosLluvia++; }

// ─────────── músculos ───────────
struct Efector { const char* nombre; uint8_t pin; float valor; };
#if NODO_INTERIOR
Efector ef[] = { {"heat", P_HEAT, 0}, {"pump", P_PUMP, 0}, {"fert", P_FERT, 0}, {"acid", P_ACID, 0},
                 {"fan", P_FAN, 0}, {"mist", P_MIST, 0}, {"led", P_LED, 0}, {"shade", P_SHADE, 0}, {"vent", P_VENT_SERVO, 0} };
const uint8_t N_EF = sizeof(ef) / sizeof(ef[0]);
#else
Efector ef[1] = { {"ninguno", 255, 0} };       // la estación exterior no mueve nada
const uint8_t N_EF = 0;
#endif
Servo ventana;

unsigned long ultimaOrden = 0, ttlMs = 180000UL, ultimoEnvio = 0, inicioRiegoLocal = 0, finRiegoLocal = 0;
bool autonomo = true;
float ultTin = NAN, ultTheta = NAN;

void aplicar(Efector& e, float v) {
  e.valor = v;
  if (strcmp(e.nombre, "vent") == 0) ventana.write(constrain((int)(v * 90), 0, 90));   // 0° cerrada, 90° abierta
  else digitalWrite(e.pin, v > 0.5 ? RELE_ACTIVO : !RELE_ACTIVO);
}
Efector* buscar(const char* n) { for (uint8_t i = 0; i < N_EF; i++) if (strcmp(ef[i].nombre, n) == 0) return &ef[i]; return nullptr; }

void presentarse() {
  StaticJsonDocument<512> d;
  d["nodo"] = NODO_INTERIOR ? "interior" : "exterior";
  d["hola"] = 1; d["version"] = "1.0";
  JsonArray a = d.createNestedArray("efectores");
  for (uint8_t i = 0; i < N_EF; i++) a.add(ef[i].nombre);
  serializeJson(d, Serial); Serial.println();
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  for (uint8_t i = 0; i < N_EF; i++) {
    if (strcmp(ef[i].nombre, "vent") == 0) { ventana.attach(ef[i].pin); ventana.write(0); }
    else { pinMode(ef[i].pin, OUTPUT); digitalWrite(ef[i].pin, !RELE_ACTIVO); }
  }
#if USA_SHT31
  sht.begin(0x44);
#endif
#if USA_SCD30
  scd.begin();
#endif
#if USA_DS18B20
  ds.begin();
#endif
#if USA_BH1750
  luz.begin();
#endif
#if USA_BMP280
  bmp.begin(0x76);
#endif
#if USA_NIVEL
  pinMode(P_TRIG, OUTPUT); pinMode(P_ECHO, INPUT);
#endif
#if USA_VIENTO
  pinMode(P_VIENTO, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(P_VIENTO), isrViento, FALLING);
#endif
#if USA_LLUVIA
  pinMode(P_LLUVIA, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(P_LLUVIA), isrLluvia, FALLING);
#endif
  delay(300);
  presentarse();
}

// ─────────── percibir y contar ───────────
void enviarLecturas() {
  StaticJsonDocument<512> d;
  d["nodo"] = NODO_INTERIOR ? "interior" : "exterior";
  const char* kT = NODO_INTERIOR ? "Tin" : "Tout";
  const char* kH = NODO_INTERIOR ? "RHin" : "RHout";
#if USA_SHT31
  float t = sht.readTemperature(), h = sht.readHumidity();
  if (!isnan(t)) { d[kT] = t; if (NODO_INTERIOR) ultTin = t; }
  if (!isnan(h)) d[kH] = h;
#endif
#if USA_SCD30
  if (scd.dataAvailable()) d["CO2"] = scd.getCO2();
#endif
#if USA_DS18B20
  ds.requestTemperatures();
  float ts = ds.getTempCByIndex(0);
  if (ts > -100) d["Tsoil"] = ts;
#endif
#if USA_BH1750
  float lx = luz.readLightLevel();
  if (lx >= 0) d["lux"] = lx;
#endif
#if USA_SUELO
  int raw = analogRead(P_SUELO);
  float theta = constrain(map(raw, SUELO_SECO, SUELO_AGUA, 0, 1000) / 10.0 * 0.5, 0, 50);   // % volumétrico aproximado
  d["theta"] = theta; ultTheta = theta;
#endif
#if USA_EC
  float vEC = analogRead(P_EC) * 5.0 / 1023.0;
  float tc = isnan(ultTin) ? 25 : ultTin;
  d["EC"] = (133.42 * vEC * vEC * vEC - 255.86 * vEC * vEC + 857.39 * vEC) * 0.5 / 1000.0 / (1.0 + 0.02 * (tc - 25));   // mS/cm
#endif
#if USA_PH
  float vPH = analogRead(P_PH) * 5.0 / 1023.0;
  d["pH"] = 7.0 + (2.5 - vPH) / 0.18;      // calibra con soluciones tampón 4 y 7
#endif
#if USA_NIVEL
  digitalWrite(P_TRIG, LOW); delayMicroseconds(2); digitalWrite(P_TRIG, HIGH); delayMicroseconds(10); digitalWrite(P_TRIG, LOW);
  float cm = pulseIn(P_ECHO, HIGH, 30000) / 58.0;
  if (cm > 0) d["tankW"] = constrain((NIVEL_VACIO_CM - cm) / (NIVEL_VACIO_CM - NIVEL_LLENO_CM) * 100.0, 0, 100);
#endif
#if USA_BMP280
  d["P"] = bmp.readPressure() / 100.0;
#endif
#if USA_VIENTO
  noInterrupts(); unsigned long pv = pulsosViento; pulsosViento = 0; interrupts();
  d["wind"] = pv / 5.0 * 0.667;            // 1 pulso/s ≈ 0,667 m/s (cazoletas comunes); ventana de 5 s
#endif
#if USA_LLUVIA
  noInterrupts(); unsigned long pl = pulsosLluvia; pulsosLluvia = 0; interrupts();
  d["rain"] = pl * 0.2794 * 720.0;         // 0,2794 mm por balanceo, extrapolado a mm/h desde 5 s
#endif
  serializeJson(d, Serial); Serial.println();
}

// ─────────── escuchar a la placa madre ───────────
char linea[256]; uint8_t pos = 0;
void escuchar() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      linea[pos] = 0; pos = 0;
      StaticJsonDocument<384> d;
      if (deserializeJson(d, linea)) continue;
      if (d.containsKey("ttl")) ttlMs = (unsigned long)d["ttl"] * 1000UL;
      JsonObject act = d["act"];
      if (!act.isNull()) {
        StaticJsonDocument<256> ok; ok["nodo"] = NODO_INTERIOR ? "interior" : "exterior";
        JsonObject o = ok.createNestedObject("ok");
        for (JsonPair kv : act) { Efector* e = buscar(kv.key().c_str()); if (e) { aplicar(*e, kv.value().as<float>()); o[e->nombre] = e->valor; } }
        serializeJson(ok, Serial); Serial.println();
        ultimaOrden = millis();
        autonomo = false;
      }
      if (d.containsKey("quien")) presentarse();
    } else if (pos < sizeof(linea) - 1) linea[pos++] = c;
  }
}

// ─────────── autonomía local: cuando la Pi calla ───────────
void sobrevivir() {
#if NODO_INTERIOR
  Efector *heat = buscar("heat"), *pump = buscar("pump"), *vent = buscar("vent"), *fert = buscar("fert"), *mist = buscar("mist");
  if (fert) aplicar(*fert, 0);
  if (mist) aplicar(*mist, 0);
  if (!isnan(ultTin) && heat) { if (ultTin < 5) aplicar(*heat, 1); else if (ultTin > 8) aplicar(*heat, 0); }
  if (!isnan(ultTin) && vent) aplicar(*vent, ultTin > 32 ? 0.5 : (ultTin < 28 ? 0 : vent->valor));
  if (pump) {
    unsigned long ahora = millis();
    bool sed = !isnan(ultTheta) && ultTheta < 20;
    if (pump->valor < 0.5 && sed && ahora - finRiegoLocal > 2UL * 3600000UL) { aplicar(*pump, 1); inicioRiegoLocal = ahora; }
    if (pump->valor > 0.5 && (ahora - inicioRiegoLocal > 15UL * 60000UL || (!isnan(ultTheta) && ultTheta > 32))) { aplicar(*pump, 0); finRiegoLocal = ahora; }
  }
#endif
}

void loop() {
  escuchar();
  unsigned long ahora = millis();
  if (ahora - ultimoEnvio > 5000) { ultimoEnvio = ahora; enviarLecturas(); }
  if (!autonomo && ahora - ultimaOrden > ttlMs) autonomo = true;
  if (autonomo && ahora - ultimoEnvio < 50) sobrevivir();   // una vez por ciclo de lectura
}
