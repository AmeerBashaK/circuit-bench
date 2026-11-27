// Starter sketches. Each one brings its own circuit (parts: modules wired to the board's default pins;
// demo: also the button/knob/LED circuit), and {{NAME}} placeholders are filled from that wiring.
export const SKETCHES = {
  dashboard: { name: 'All sensors on the OLED', parts: ['pir', 'sonar', 'ir', 'soil', 'ldr', 'led', 'oled'], code: `#include <Wire.h>
#include <Adafruit_SSD1306.h>

#define PIR_PIN   {{PIR}}
#define TRIG_PIN  {{TRIG}}
#define ECHO_PIN  {{ECHO}}
#define SOIL_PIN  {{SOIL}}
#define LDR_PIN   {{LDR}}
#define IR_PIN    {{IR}}
#define LED_PIN   {{LED}}

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  pinMode(IR_PIN, INPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.setTextColor(SSD1306_WHITE);
  Serial.println("Sensor dashboard ready");
}

float readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  return duration * 0.0343 / 2;
}

void loop() {
  bool motion = digitalRead(PIR_PIN);
  bool obstacle = digitalRead(IR_PIN) == LOW;
  float cm = readDistance();
  int soil = constrain(map(analogRead(SOIL_PIN), {{DRY}}, {{WET}}, 0, 100), 0, 100);
  int light = map(analogRead(LDR_PIN), 0, {{ADCMAX}}, 0, 100);

  digitalWrite(LED_PIN, motion ? HIGH : LOW);

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("SENSOR DASHBOARD");
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  display.setCursor(0, 14);
  display.print("Motion : "); display.println(motion ? "YES" : "no");
  display.print("Dist   : "); display.print(cm, 1); display.println(" cm");
  display.print("Soil   : "); display.print(soil); display.println(" %");
  display.print("Light  : "); display.print(light); display.println(" %");
  display.print("IR     : "); display.println(obstacle ? "BLOCKED" : "clear");
  display.display();

  Serial.printf("motion=%d dist=%.1fcm soil=%d%% light=%d%% ir=%d\\n", motion, cm, soil, light, obstacle);
  delay(500);
}
` },
  components: { name: 'Button, knob and LED', parts: [], demo: true, code: `// Hold the button to light the LED; the knob sets how bright.
#define BUTTON_PIN {{BUTTON}}
#define POT_PIN    {{POT}}
#define LED_PIN    {{LEDC}}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // the button pulls the pin to GND
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  bool pressed = digitalRead(BUTTON_PIN) == LOW;
  int knob = analogRead(POT_PIN);
  int brightness = map(knob, 0, {{ADCMAX}}, 0, 255);
  analogWrite(LED_PIN, pressed ? brightness : 0);
  Serial.printf("button=%s  knob=%d  led=%d\\n", pressed ? "DOWN" : "up", knob, pressed ? brightness : 0);
  delay(150);
}
` },
  blink: { name: 'Blink the onboard LED', parts: [], code: `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("LED on");
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("LED off");
  delay(500);
}
` },
  pir: { name: 'PIR motion alarm', parts: ['pir', 'led'], code: `#define PIR_PIN {{PIR}}
#define ALARM_LED {{LED}}

int count = 0;
bool wasMoving = false;

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  pinMode(ALARM_LED, OUTPUT);
  Serial.println("Waiting for motion...");
}

void loop() {
  bool moving = digitalRead(PIR_PIN) == HIGH;
  if (moving && !wasMoving) {
    count++;
    Serial.print("Motion detected! Count: ");
    Serial.println(count);
  }
  if (!moving && wasMoving) Serial.println("Motion ended");
  digitalWrite(ALARM_LED, moving ? HIGH : LOW);
  wasMoving = moving;
  delay(100);
}
` },
  sonar: { name: 'Ultrasonic distance + bar', parts: ['sonar', 'oled'], code: `#include <Adafruit_SSD1306.h>
#define TRIG_PIN {{TRIG}}
#define ECHO_PIN {{ECHO}}

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  float cm = duration * 0.0343 / 2;

  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(0, 8);
  if (duration == 0) {
    display.println("OUT OF");
    display.println("RANGE");
  } else {
    display.print(cm, 1);
    display.println(" cm");
    int w = constrain(map(cm, 0, 200, 0, 124), 0, 124);
    display.drawRect(0, 44, 128, 14, SSD1306_WHITE);
    display.fillRect(2, 46, w, 10, SSD1306_WHITE);
  }
  display.display();
  Serial.print("Distance: ");
  Serial.print(cm, 1);
  Serial.println(" cm");
  delay(200);
}
` },
  soil: { name: 'Soil moisture monitor', parts: ['soil', 'led'], code: `#define SOIL_PIN {{SOIL}}
#define PUMP_LED {{LED}}

const int DRY = {{DRY}};   // reading in dry air
const int WET = {{WET}};   // reading in water

void setup() {
  Serial.begin(115200);
  pinMode(PUMP_LED, OUTPUT);
}

void loop() {
  int raw = analogRead(SOIL_PIN);
  int percent = constrain(map(raw, DRY, WET, 0, 100), 0, 100);
  Serial.print("Raw: ");
  Serial.print(raw);
  Serial.print("  Moisture: ");
  Serial.print(percent);
  Serial.println("%");
  if (percent < 30) {
    Serial.println("Soil is dry - pump ON");
    digitalWrite(PUMP_LED, HIGH);
  } else {
    digitalWrite(PUMP_LED, LOW);
  }
  delay(1000);
}
` },
  light: { name: 'Light meter with night lamp', parts: ['ldr', 'led'], code: `#define LDR_PIN {{LDR}}
#define LAMP_PIN {{LED}}

void setup() {
  Serial.begin(115200);
  pinMode(LAMP_PIN, OUTPUT);
}

void loop() {
  int raw = analogRead(LDR_PIN);
  int level = map(raw, 0, {{ADCMAX}}, 0, 100);
  Serial.printf("Light %3d%%  ", level);
  for (int i = 0; i < level / 5; i++) Serial.print("#");
  Serial.println();
  digitalWrite(LAMP_PIN, level < 25 ? HIGH : LOW);
  delay(400);
}
` },
  ir: { name: 'IR obstacle counter', parts: ['ir'], code: `#define IR_PIN {{IR}}

int objects = 0;
bool blocked = false;

void setup() {
  Serial.begin(115200);
  pinMode(IR_PIN, INPUT);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  bool now = digitalRead(IR_PIN) == LOW;
  if (now && !blocked) {
    objects++;
    Serial.print("Object passed. Total: ");
    Serial.println(objects);
  }
  blocked = now;
  digitalWrite(LED_BUILTIN, blocked);
  delay(50);
}
` },
  servo: { name: 'Servo sweep', parts: ['servo'], code: `#include <Servo.h>

#define SERVO_PIN {{SERVO}}

Servo arm;

void setup() {
  Serial.begin(115200);
  arm.attach(SERVO_PIN);
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 10) {
    arm.write(angle);
    Serial.print("Angle: ");
    Serial.println(angle);
    delay(120);
  }
  for (int angle = 180; angle >= 0; angle -= 10) {
    arm.write(angle);
    delay(120);
  }
}
` },
  dht: { name: 'Temperature and humidity (DHT11)', parts: ['dht'], code: `#include <DHT.h>

#define DHT_PIN {{DHT}}

DHT dht(DHT_PIN, DHT11);

void setup() {
  Serial.begin(115200);
  dht.begin();
  Serial.println("Move the sliders on the DHT11 to change the room.");
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("DHT11 not answering. Check the wiring.");
  } else {
    Serial.print("Temperature: ");
    Serial.print(t, 0);
    Serial.print(" C   Humidity: ");
    Serial.print(h, 0);
    Serial.println(" %");
  }
  delay(2000);
}
` },
  relay: { name: 'Relay switches a lamp', parts: ['relay', 'lamp'], code: `// The relay is a switch the board flips with a magnet.
// The lamp runs on its own 12 V battery: the board never touches that power.
#define RELAY_PIN {{RELAY}}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
}

void loop() {
  digitalWrite(RELAY_PIN, HIGH);
  Serial.println("Relay ON: lamp lit");
  delay(2000);
  digitalWrite(RELAY_PIN, LOW);
  Serial.println("Relay OFF: lamp dark");
  delay(2000);
}
` },
  rgb: { name: 'RGB colour mixer', parts: ['rgb'], code: `#define R_PIN {{RGB_R}}
#define G_PIN {{RGB_G}}
#define B_PIN {{RGB_B}}

void setColor(int r, int g, int b) {
  analogWrite(R_PIN, r);
  analogWrite(G_PIN, g);
  analogWrite(B_PIN, b);
}

void setup() {
  Serial.begin(115200);
  pinMode(R_PIN, OUTPUT);
  pinMode(G_PIN, OUTPUT);
  pinMode(B_PIN, OUTPUT);
}

void loop() {
  setColor(255, 0, 0);   Serial.println("Red");    delay(800);
  setColor(0, 255, 0);   Serial.println("Green");  delay(800);
  setColor(0, 0, 255);   Serial.println("Blue");   delay(800);
  setColor(255, 140, 0); Serial.println("Orange"); delay(800);
  setColor(160, 0, 255); Serial.println("Purple"); delay(800);
  setColor(255, 255, 255); Serial.println("White"); delay(800);
}
` },
  seg7: { name: '7-segment counter 0 to 9', parts: ['seg7'], code: `// Each digit is a pattern of segments a to g (bit 0 = a ... bit 6 = g).
const int SEG[7] = { {{SEG_A}}, {{SEG_B}}, {{SEG_C}}, {{SEG_D}}, {{SEG_E}}, {{SEG_F}}, {{SEG_G}} };
const byte DIGITS[10] = { 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F };

void showDigit(int n) {
  for (int i = 0; i < 7; i++) {
    digitalWrite(SEG[i], (DIGITS[n] >> i) & 1);
  }
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 7; i++) {
    pinMode(SEG[i], OUTPUT);
  }
}

void loop() {
  for (int n = 0; n < 10; n++) {
    showDigit(n);
    Serial.println(n);
    delay(800);
  }
}
` },
  echo: { name: 'Serial echo (type below)', parts: [], code: `void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println("Type on or off and press Send.");
}

void loop() {
  if (Serial.available() > 0) {
    String text = Serial.readStringUntil('\\n');
    Serial.print("You said: ");
    Serial.println(text);
    if (text == "on") digitalWrite(LED_BUILTIN, HIGH);
    if (text == "off") digitalWrite(LED_BUILTIN, LOW);
  }
  delay(20);
}
` },
};

export function fillSketch(code, pins) {
  return code.replace(/\{\{(\w+)\}\}/g, (m, k) => pins[k] ?? m);
}
