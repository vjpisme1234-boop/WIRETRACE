import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { AppLanguage, isSpanish, loadAppLanguage } from '@/utils/app-language';
import PulsingLogo from '@/components/PulsingLogo';

// ---------------------------------------------------------------------------
// Symbol dictionary data
// ---------------------------------------------------------------------------

export interface SymbolEntry {
  label: string;
  labelEs: string;
  code: string;
  description: string;
  descriptionEs: string;
  wiring?: string;
  wiringEs?: string;
}

export interface SymbolCategory {
  title: string;
  titleEs: string;
  symbols: SymbolEntry[];
}

export const SYMBOL_CATEGORIES: SymbolCategory[] = [
  {
    title: 'Power Sources & Distribution',
    titleEs: 'Fuentes de Alimentación y Distribución',
    symbols: [
      { label: 'Power Supply (AC)', labelEs: 'Fuente de Alimentación (CA)', code: 'PS / L1, L2, L3', description: 'Provides AC voltage to the circuit. Single-phase (L1, N) or three-phase (L1, L2, L3).', descriptionEs: 'Suministra voltaje de CA al circuito. Monofásico (L1, N) o trifásico (L1, L2, L3).', wiring: 'Always verify phase voltage before connecting. Use appropriate PPE.', wiringEs: 'Siempre verifica el voltaje de fase antes de conectar. Usa el equipo de protección personal adecuado.' },
      { label: 'Power Supply (DC)', labelEs: 'Fuente de Alimentación (CD)', code: '+V / 0V', description: 'Provides DC voltage, typically 24VDC for control circuits.', descriptionEs: 'Suministra voltaje de CD, típicamente 24VCD para circuitos de control.', wiring: 'Observe polarity. Blue = negative (0V/common), yellow = positive (+24V) per NFPA 79.', wiringEs: 'Respeta la polaridad. Azul = negativo (0V/común), amarillo = positivo (+24V) según NFPA 79.' },
      { label: 'Battery', labelEs: 'Batería', code: 'BAT', description: 'DC energy storage source. Cell polarity marked with long (+) and short (−) lines.', descriptionEs: 'Fuente de energía de CD. La polaridad de la celda se marca con líneas larga (+) y corta (−).', wiring: 'Verify voltage and polarity before connecting loads.', wiringEs: 'Verifica el voltaje y la polaridad antes de conectar cargas.' },
      { label: 'Transformer (Power)', labelEs: 'Transformador (Potencia)', code: 'T / TR', description: 'Steps voltage up or down between primary and secondary windings.', descriptionEs: 'Eleva o reduce el voltaje entre el devanado primario y el secundario.', wiring: 'Note VA rating. Never swap primary/secondary terminals.', wiringEs: 'Ten en cuenta la capacidad en VA. Nunca intercambies las terminales primarias y secundarias.' },
      { label: 'Auto-Transformer', labelEs: 'Autotransformador', code: 'AT', description: 'Single-winding transformer with tapped output. Common in reduced-voltage starters.', descriptionEs: 'Transformador de un solo devanado con salida derivada. Común en arrancadores a voltaje reducido.', wiring: 'No electrical isolation between primary and secondary.', wiringEs: 'No hay aislamiento eléctrico entre el primario y el secundario.' },
      { label: 'Current Transformer', labelEs: 'Transformador de Corriente', code: 'CT', description: 'Produces a reduced current proportional to measured line current for metering/protection.', descriptionEs: 'Produce una corriente reducida proporcional a la corriente de línea medida, para medición o protección.', wiring: 'NEVER open-circuit a CT secondary — dangerously high voltage will develop.', wiringEs: 'NUNCA dejes abierto el secundario de un TC — se desarrollará un voltaje peligrosamente alto.' },
      { label: 'Potential Transformer', labelEs: 'Transformador de Potencial', code: 'PT / VT', description: 'Steps down high voltage for metering or relay operation.', descriptionEs: 'Reduce el alto voltaje para medición u operación de relés.', wiring: 'Secondary must be grounded. Fuse the primary.', wiringEs: 'El secundario debe estar aterrizado. Protege el primario con fusible.' },
    ],
  },
  {
    title: 'Overcurrent Protection',
    titleEs: 'Protección contra Sobrecorriente',
    symbols: [
      { label: 'Fuse', labelEs: 'Fusible', code: 'F / FU', description: 'Single-use overcurrent protection device. Opens on sustained overcurrent.', descriptionEs: 'Dispositivo de protección de un solo uso contra sobrecorriente. Se abre ante una sobrecorriente sostenida.', wiring: 'Match voltage and interrupting rating to the circuit. Replace like-for-like only.', wiringEs: 'Haz coincidir el voltaje y la capacidad de interrupción con el circuito. Reemplaza solo con uno idéntico.' },
      { label: 'Circuit Breaker', labelEs: 'Interruptor Termomagnético', code: 'CB / BKR', description: 'Resettable overcurrent protection. May also provide short-circuit protection.', descriptionEs: 'Protección contra sobrecorriente reiniciable. También puede ofrecer protección contra cortocircuito.', wiring: 'Check trip curve (B, C, D) matches load type — motors need Type D.', wiringEs: 'Verifica que la curva de disparo (B, C, D) coincida con el tipo de carga — los motores necesitan Tipo D.' },
      { label: 'GFCI', labelEs: 'Interruptor de Falla a Tierra (GFCI)', code: 'GFCI', description: 'Ground Fault Circuit Interrupter. Trips on currents as low as 5mA to ground.', descriptionEs: 'Interruptor de falla a tierra. Se dispara con corrientes tan bajas como 5mA hacia tierra.', wiring: 'Required in wet/damp locations per NEC 210.8.', wiringEs: 'Requerido en ubicaciones húmedas o mojadas según NEC 210.8.' },
      { label: 'Overload Relay', labelEs: 'Relé de Sobrecarga', code: 'OL / OR', description: 'Protects motors from sustained overcurrent/overheating. Bimetallic or electronic.', descriptionEs: 'Protege a los motores de sobrecorriente o sobrecalentamiento sostenido. Bimetálico o electrónico.', wiring: 'Set trip current to motor FLA × service factor. Must be in series with motor.', wiringEs: 'Ajusta la corriente de disparo a FLA del motor × factor de servicio. Debe ir en serie con el motor.' },
    ],
  },
  {
    title: 'Switches & Controls',
    titleEs: 'Interruptores y Controles',
    symbols: [
      { label: 'Pushbutton (Normally Open)', labelEs: 'Pulsador (Normalmente Abierto)', code: 'PB-NO / START', description: 'Contacts open at rest; close when pressed. Used for START commands.', descriptionEs: 'Contactos abiertos en reposo; se cierran al presionar. Se usa para comandos de ARRANQUE.', wiring: 'Symbol: circle with open bracket. Green housing = start, red = stop convention.', wiringEs: 'Símbolo: círculo con corchete abierto. Convención: carcasa verde = arranque, roja = paro.' },
      { label: 'Pushbutton (Normally Closed)', labelEs: 'Pulsador (Normalmente Cerrado)', code: 'PB-NC / STOP', description: 'Contacts closed at rest; open when pressed. Used for STOP/E-STOP commands.', descriptionEs: 'Contactos cerrados en reposo; se abren al presionar. Se usa para comandos de PARO/PARO DE EMERGENCIA.', wiring: 'Symbol: circle with closed bracket. Must be wired NC for safety stops.', wiringEs: 'Símbolo: círculo con corchete cerrado. Debe cablearse NC para paros de seguridad.' },
      { label: 'Selector Switch', labelEs: 'Interruptor Selector', code: 'SS / SCS', description: 'Rotary switch with 2 or more positions. Used for Hand/Off/Auto (HOA) control.', descriptionEs: 'Interruptor rotativo con 2 o más posiciones. Se usa para control Manual/Apagado/Automático (HOA).', wiring: 'Verify detent positions match schematic. Note spring-return vs. maintained.', wiringEs: 'Verifica que las posiciones de retén coincidan con el esquema. Distingue entre retorno por resorte y mantenido.' },
      { label: 'Limit Switch', labelEs: 'Interruptor de Límite', code: 'LS', description: 'Mechanically actuated by a moving part reaching a set position.', descriptionEs: 'Se acciona mecánicamente cuando una pieza móvil alcanza una posición establecida.', wiring: 'Verify actuator travel direction matches wiring (NO or NC) for intended action.', wiringEs: 'Verifica que la dirección de recorrido del actuador coincida con el cableado (NA o NC) para la acción deseada.' },
      { label: 'Pressure Switch', labelEs: 'Interruptor de Presión', code: 'PS / PT', description: 'Contacts change state at a set pressure. Used for pump/compressor control.', descriptionEs: 'Los contactos cambian de estado a una presión establecida. Se usa para control de bombas/compresores.', wiring: 'Note setpoint and differential. Rising vs. falling pressure action.', wiringEs: 'Ten en cuenta el punto de ajuste y el diferencial. Acción por presión ascendente o descendente.' },
      { label: 'Float Switch', labelEs: 'Interruptor de Flotador', code: 'FS / FL', description: 'Actuated by liquid level. Used for pump control and tank monitoring.', descriptionEs: 'Se acciona por el nivel de líquido. Se usa para control de bombas y monitoreo de tanques.', wiring: 'Note make-on-rise vs. make-on-fall wiring convention.', wiringEs: 'Ten en cuenta la convención de cableado: cierra al subir o cierra al bajar.' },
      { label: 'Proximity Sensor', labelEs: 'Sensor de Proximidad', code: 'PROX / SQ', description: 'Detects nearby objects without contact. Inductive (metal), capacitive, or ultrasonic.', descriptionEs: 'Detecta objetos cercanos sin contacto. Inductivo (metal), capacitivo o ultrasónico.', wiring: '3-wire: Brown=+V, Blue=0V, Black=signal. Verify PNP vs NPN output.', wiringEs: '3 hilos: Café=+V, Azul=0V, Negro=señal. Verifica si la salida es PNP o NPN.' },
      { label: 'Photoelectric Sensor', labelEs: 'Sensor Fotoeléctrico', code: 'PE / PT', description: 'Detects objects via light beam interruption or reflection.', descriptionEs: 'Detecta objetos mediante la interrupción o reflexión de un haz de luz.', wiring: 'Through-beam: emitter and receiver aligned. Retroreflective: uses reflector.', wiringEs: 'De barrera: emisor y receptor alineados. Retrorreflectivo: usa un reflector.' },
    ],
  },
  {
    title: 'Relays & Contactors',
    titleEs: 'Relés y Contactores',
    symbols: [
      { label: 'Control Relay', labelEs: 'Relé de Control', code: 'CR / K', description: 'Electrically operated switch. Coil energizes to actuate NO/NC contacts.', descriptionEs: 'Interruptor operado eléctricamente. La bobina se energiza para accionar los contactos NA/NC.', wiring: 'Match coil voltage to control supply. Contacts rated separately from coil.', wiringEs: 'Haz coincidir el voltaje de la bobina con la alimentación de control. Los contactos tienen capacidad nominal separada de la bobina.' },
      { label: 'Latching Relay', labelEs: 'Relé de Enclavamiento', code: 'CR-L', description: 'Maintains state after coil is de-energized. Requires separate SET and RESET coils.', descriptionEs: 'Mantiene su estado después de que la bobina se desenergiza. Requiere bobinas separadas de FIJAR (SET) y REINICIAR (RESET).', wiring: 'Two coil terminals: SET and RESET. Power to SET coil latches; RESET unlatches.', wiringEs: 'Dos terminales de bobina: SET y RESET. Alimentar la bobina SET enclava; RESET desenclava.' },
      { label: 'Time-Delay Relay (On-Delay)', labelEs: 'Relé de Tiempo (Retardo a la Conexión)', code: 'TR / TDR / TON', description: 'Contacts actuate after coil has been energized for a set time period.', descriptionEs: 'Los contactos se accionan después de que la bobina ha estado energizada durante un tiempo establecido.', wiring: 'Symbol: contact with T inside. Adjust setpoint to required delay.', wiringEs: 'Símbolo: contacto con una T dentro. Ajusta el punto de referencia al retardo requerido.' },
      { label: 'Time-Delay Relay (Off-Delay)', labelEs: 'Relé de Tiempo (Retardo a la Desconexión)', code: 'TR / TOF', description: 'Contacts remain actuated for set time after coil is de-energized.', descriptionEs: 'Los contactos permanecen accionados durante un tiempo establecido después de que la bobina se desenergiza.', wiring: 'Used for motor run-down, conveyor purge, and interlock timing.', wiringEs: 'Se usa para desaceleración de motores, purga de transportadores y temporización de enclavamientos.' },
      { label: 'Contactor', labelEs: 'Contactor', code: 'M / C', description: 'Heavy-duty relay for switching motor loads. Higher current capacity than control relays.', descriptionEs: 'Relé de alta capacidad para conmutar cargas de motor. Mayor capacidad de corriente que los relés de control.', wiring: 'Power terminals: L1/L2/L3 → T1/T2/T3. Auxiliary contacts for control logic.', wiringEs: 'Terminales de potencia: L1/L2/L3 → T1/T2/T3. Contactos auxiliares para la lógica de control.' },
      { label: 'Motor Starter', labelEs: 'Arrancador de Motor', code: 'M / MS', description: 'Contactor + overload relay combined. Full-voltage or reduced-voltage starting.', descriptionEs: 'Contactor combinado con relé de sobrecarga. Arranque a voltaje pleno o a voltaje reducido.', wiring: 'Must include properly sized overload relay. Wire OL contacts in E-stop string.', wiringEs: 'Debe incluir un relé de sobrecarga correctamente dimensionado. Cablea los contactos OL en la cadena de paro de emergencia.' },
    ],
  },
  {
    title: 'Motors & Drives',
    titleEs: 'Motores y Variadores',
    symbols: [
      { label: 'AC Motor', labelEs: 'Motor de CA', code: 'M / MOT', description: 'Converts electrical energy to mechanical rotation. Squirrel-cage induction is most common.', descriptionEs: 'Convierte energía eléctrica en rotación mecánica. El de inducción de jaula de ardilla es el más común.', wiring: 'Verify voltage (230/460V), phase (3Ø), and FLA on nameplate before wiring.', wiringEs: 'Verifica el voltaje (230/460V), la fase (3Ø) y el FLA en la placa antes de cablear.' },
      { label: 'DC Motor', labelEs: 'Motor de CD', code: 'M (DC)', description: 'Motor powered by DC supply. Includes shunt, series, and permanent-magnet types.', descriptionEs: 'Motor alimentado por corriente directa. Incluye tipos shunt, serie y de imán permanente.', wiring: 'Observe armature and field terminal polarities. Reversing requires field or armature swap.', wiringEs: 'Respeta la polaridad de las terminales de armadura y campo. Para invertir el giro hay que intercambiar el campo o la armadura.' },
      { label: 'Variable Frequency Drive', labelEs: 'Variador de Frecuencia', code: 'VFD / VVVF / AFD', description: 'Converts AC supply to variable frequency/voltage to control motor speed.', descriptionEs: 'Convierte la alimentación de CA en frecuencia/voltaje variable para controlar la velocidad del motor.', wiring: 'Input: L1/L2/L3. Output: T1/T2/T3. Never switch output side while running — damages drive.', wiringEs: 'Entrada: L1/L2/L3. Salida: T1/T2/T3. Nunca conmutes el lado de salida en funcionamiento — daña el variador.' },
      { label: 'Soft Starter', labelEs: 'Arrancador Suave', code: 'SS / SMC', description: 'Gradually ramps motor voltage during start to reduce inrush current and mechanical stress.', descriptionEs: 'Eleva gradualmente el voltaje del motor durante el arranque para reducir la corriente de irrupción y el esfuerzo mecánico.', wiring: 'In-line: L1/T1, L2/T2, L3/T3. Bypass contactor often wired in parallel.', wiringEs: 'En línea: L1/T1, L2/T2, L3/T3. A menudo se cablea un contactor de derivación en paralelo.' },
    ],
  },
  {
    title: 'Passive Components',
    titleEs: 'Componentes Pasivos',
    symbols: [
      { label: 'Resistor', labelEs: 'Resistor', code: 'R', description: 'Limits current flow in proportion to resistance value (Ohms, Ω).', descriptionEs: 'Limita el flujo de corriente en proporción a su valor de resistencia (Ohms, Ω).', wiring: 'Check wattage rating. Braking resistors on VFDs get very hot — use proper enclosure.', wiringEs: 'Verifica la capacidad en watts. Los resistores de frenado en variadores se calientan mucho — usa el gabinete adecuado.' },
      { label: 'Capacitor', labelEs: 'Capacitor', code: 'C', description: 'Stores electrical charge. Used for power factor correction, filtering, and timing.', descriptionEs: 'Almacena carga eléctrica. Se usa para corrección de factor de potencia, filtrado y temporización.', wiring: 'Electrolytic capacitors are polarized — observe +/−. Discharge before working.', wiringEs: 'Los capacitores electrolíticos están polarizados — respeta +/−. Descárgalos antes de trabajar en ellos.' },
      { label: 'Inductor / Reactor', labelEs: 'Inductor / Reactor', code: 'L / ACL', description: 'Line reactor. Limits harmonic distortion and voltage spikes. Common on VFD inputs.', descriptionEs: 'Reactor de línea. Limita la distorsión armónica y los picos de voltaje. Común en las entradas de variadores.', wiring: 'Install between power supply and VFD. No polarity concern for AC reactors.', wiringEs: 'Instálalo entre la alimentación y el variador. Los reactores de CA no tienen polaridad.' },
      { label: 'Transformer (Control)', labelEs: 'Transformador (Control)', code: 'CPT / T', description: 'Steps 480VAC down to 120VAC for control circuits. Often 500VA–1kVA.', descriptionEs: 'Reduce 480VCA a 120VCA para circuitos de control. A menudo de 500VA a 1kVA.', wiring: 'Fuse both primary and secondary. Ground secondary neutral. Use H1–H4/X1–X4 terminals.', wiringEs: 'Protege con fusible tanto el primario como el secundario. Aterriza el neutro del secundario. Usa las terminales H1–H4/X1–X4.' },
    ],
  },
  {
    title: 'Semiconductors',
    titleEs: 'Semiconductores',
    symbols: [
      { label: 'Diode', labelEs: 'Diodo', code: 'D / CR', description: 'Allows current in one direction only. Used for flyback suppression across relay coils.', descriptionEs: 'Permite el paso de corriente en un solo sentido. Se usa para suprimir el pico inductivo en bobinas de relés.', wiring: 'Cathode band = negative end. Install flyback diode across DC relay coil terminals.', wiringEs: 'La banda del cátodo = extremo negativo. Instala el diodo de protección entre las terminales de la bobina del relé de CD.' },
      { label: 'Zener Diode', labelEs: 'Diodo Zener', code: 'ZD', description: 'Conducts in reverse at a specific breakdown voltage. Used for voltage regulation.', descriptionEs: 'Conduce en reversa a un voltaje de ruptura específico. Se usa para regulación de voltaje.', wiring: 'Reverse-biased in circuit. Observe power rating.', wiringEs: 'Se polariza en reversa dentro del circuito. Respeta su capacidad de potencia.' },
      { label: 'LED', labelEs: 'LED', code: 'LED / DS', description: 'Light-Emitting Diode. Used as panel pilot lights or status indicators.', descriptionEs: 'Diodo emisor de luz. Se usa como luz piloto de panel o indicador de estado.', wiring: 'Current-limit resistor required. Anode (+) to supply through resistor, cathode (−) to common.', wiringEs: 'Requiere un resistor limitador de corriente. Ánodo (+) a la alimentación a través del resistor, cátodo (−) a común.' },
    ],
  },
  {
    title: 'Grounding',
    titleEs: 'Puesta a Tierra',
    symbols: [
      { label: 'Earth Ground', labelEs: 'Tierra Física', code: 'GND / PE', description: 'Connection to earth. Safety ground for equipment bonding per NEC 250.', descriptionEs: 'Conexión a tierra. Tierra de seguridad para la unión de equipos según NEC 250.', wiring: 'Green or green/yellow conductor. Never use as current-carrying conductor.', wiringEs: 'Conductor verde o verde/amarillo. Nunca lo uses como conductor de corriente de trabajo.' },
      { label: 'Chassis Ground', labelEs: 'Tierra de Chasis', code: '⏚', description: 'Connection to metal enclosure or equipment frame. May or may not be earth-bonded.', descriptionEs: 'Conexión al gabinete metálico o al chasis del equipo. Puede o no estar unida a tierra física.', wiring: 'Bond to earth ground at single point to avoid ground loops.', wiringEs: 'Únela a tierra física en un solo punto para evitar bucles de tierra.' },
      { label: 'Signal Ground', labelEs: 'Tierra de Señal', code: 'SGND / AGND', description: 'Reference ground for analog/communication signals. Separate from safety ground.', descriptionEs: 'Tierra de referencia para señales analógicas o de comunicación. Separada de la tierra de seguridad.', wiring: 'Keep isolated from power ground. Use shielded cable, drain wire to signal ground only.', wiringEs: 'Mantenla aislada de la tierra de potencia. Usa cable blindado y conecta el drenaje solo a la tierra de señal.' },
    ],
  },
  {
    title: 'PLC & Automation',
    titleEs: 'PLC y Automatización',
    symbols: [
      { label: 'PLC Input', labelEs: 'Entrada de PLC', code: 'PLC-I / DI', description: 'Digital or analog input to a Programmable Logic Controller. Reads field device status.', descriptionEs: 'Entrada digital o analógica a un Controlador Lógico Programable. Lee el estado de dispositivos de campo.', wiring: 'Verify input voltage type (sink/source, AC/DC). Use I/O module matching field devices.', wiringEs: 'Verifica el tipo de voltaje de entrada (sink/source, CA/CD). Usa un módulo de E/S que coincida con los dispositivos de campo.' },
      { label: 'PLC Output', labelEs: 'Salida de PLC', code: 'PLC-O / DO', description: 'Digital or analog output from PLC. Controls field actuators and devices.', descriptionEs: 'Salida digital o analógica del PLC. Controla actuadores y dispositivos de campo.', wiring: 'Verify output type (relay, transistor, triac). Relay outputs provide isolation; transistor do not.', wiringEs: 'Verifica el tipo de salida (relé, transistor, triac). Las salidas de relé dan aislamiento; las de transistor no.' },
      { label: 'HMI', labelEs: 'IHM', code: 'HMI / MMI', description: 'Human-Machine Interface. Touch panel or display for operator control and monitoring.', descriptionEs: 'Interfaz Humano-Máquina. Panel táctil o pantalla para control y monitoreo del operador.', wiring: 'Typically Ethernet or RS-485/RS-232 to PLC. Power supply separate from I/O.', wiringEs: 'Típicamente Ethernet o RS-485/RS-232 hacia el PLC. Alimentación separada de las E/S.' },
    ],
  },
  {
    title: 'Sensors & Instruments',
    titleEs: 'Sensores e Instrumentos',
    symbols: [
      { label: 'Thermocouple', labelEs: 'Termopar', code: 'TC / J/K/T-Type', description: 'Temperature sensor using voltage generated between two dissimilar metals.', descriptionEs: 'Sensor de temperatura que usa el voltaje generado entre dos metales distintos.', wiring: 'Use matching thermocouple extension wire. Do NOT use copper wire — will create junctions.', wiringEs: 'Usa cable de extensión para termopar del mismo tipo. NO uses cable de cobre — creará uniones parásitas.' },
      { label: 'RTD', labelEs: 'RTD', code: 'RTD / PT100', description: 'Resistance Temperature Detector. More accurate and stable than thermocouples.', descriptionEs: 'Detector de temperatura por resistencia. Más preciso y estable que los termopares.', wiring: '2-wire (basic), 3-wire (common), or 4-wire (highest accuracy). Match transmitter wiring type.', wiringEs: '2 hilos (básico), 3 hilos (común) o 4 hilos (máxima precisión). Haz coincidir con el tipo de cableado del transmisor.' },
      { label: 'Current Sensor / Shunt', labelEs: 'Sensor de Corriente / Shunt', code: 'A / CT', description: 'Measures current flow in a conductor. Shunt: small resistance; CT: inductive.', descriptionEs: 'Mide el flujo de corriente en un conductor. Shunt: resistencia pequeña; TC: inductivo.', wiring: 'Install shunt in series with circuit. CT: clamp around single conductor only.', wiringEs: 'Instala el shunt en serie con el circuito. TC: engánchalo alrededor de un solo conductor.' },
      { label: 'Pilot Light', labelEs: 'Luz Piloto', code: 'PL / L', description: 'Panel-mounted indicator lamp. Red=fault/running, green=ready/stopped by convention.', descriptionEs: 'Lámpara indicadora montada en panel. Por convención: rojo=falla/en marcha, verde=listo/detenido.', wiring: 'Verify voltage rating matches control voltage. LED type preferred for long life.', wiringEs: 'Verifica que el voltaje nominal coincida con el voltaje de control. Se prefiere tipo LED por su mayor vida útil.' },
    ],
  },
  {
    title: 'Terminal & Wiring',
    titleEs: 'Terminales y Cableado',
    symbols: [
      { label: 'Terminal Block', labelEs: 'Bloque de Terminales', code: 'TB / X / XT', description: 'Screw or spring-clamp junction point for connecting field wiring to panel wiring.', descriptionEs: 'Punto de unión de tornillo o resorte para conectar el cableado de campo con el cableado del panel.', wiring: 'Number terminals match wire numbers. Do not overtighten — use calibrated torque driver.', wiringEs: 'La numeración de terminales debe coincidir con la de los cables. No apliques exceso de torque — usa un desatornillador calibrado.' },
      { label: 'Junction', labelEs: 'Unión', code: '●', description: 'Dot on a schematic indicates wires are electrically connected at that node.', descriptionEs: 'Un punto en el esquema indica que los cables están eléctricamente conectados en ese nodo.', wiring: 'No dot = wires cross without connection (bridge). Only dot = connected.', wiringEs: 'Sin punto = los cables se cruzan sin conectarse (puente). Solo con punto = conectados.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function AnimatedPressable({
  onPress,
  style,
  children,
  scaleValue = 0.97,
}: {
  onPress?: () => void;
  style?: object | object[];
  children: React.ReactNode;
  scaleValue?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animIn = () =>
    Animated.spring(scale, { toValue: scaleValue, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const animOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPressIn={animIn} onPressOut={animOut} onPress={onPress} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

function CategorySection({ category, index, es }: { category: SymbolCategory; index: number; es: boolean }) {
  const [expanded, setExpanded] = useState(index === 0);

  return (
    <View style={styles.category}>
      <AnimatedPressable onPress={() => setExpanded((e) => !e)} style={styles.categoryHeader}>
        <Text style={styles.categoryTitle}>{es ? category.titleEs : category.title}</Text>
        <Text style={styles.categoryCount}>{category.symbols.length}</Text>
        <Text style={styles.categoryChevron}>{expanded ? '▲' : '▼'}</Text>
      </AnimatedPressable>

      {expanded && (
        <View style={styles.symbolList}>
          {category.symbols.map((sym, i) => (
            <View key={`${category.title}-${sym.code}-${i}`} style={styles.symbolRow}>
              <View style={styles.symbolHeader}>
                <Text style={styles.symbolLabel}>{es ? sym.labelEs : sym.label}</Text>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeText}>{sym.code}</Text>
                </View>
              </View>
              <Text style={styles.symbolDesc}>{es ? sym.descriptionEs : sym.description}</Text>
              {sym.wiring && (
                <View style={styles.wiringNote}>
                  <Text style={styles.wiringNoteLabel}>{es ? '⚡ Nota de cableado' : '⚡ Wiring note'}</Text>
                  <Text style={styles.wiringNoteText}>{es ? sym.wiringEs : sym.wiring}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function SymbolDictionaryScreen() {
  const insets = useSafeAreaInsets();
  const [language, setLanguage] = useState<AppLanguage>('english');
  const es = isSpanish(language);

  useFocusEffect(
    useCallback(() => {
      loadAppLanguage().then(setLanguage).catch(console.error);
    }, [])
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <AnimatedPressable
          onPress={() => {
            console.log('[SymbolDict] Back pressed');
            router.back();
          }}
          style={styles.backBtn}
          scaleValue={0.9}
        >
          <ArrowLeft size={22} color={WT.blue} />
        </AnimatedPressable>
        <View style={styles.headerCenter}>
          <PulsingLogo size={20} />
          <Text style={styles.headerTitle}>{es ? 'Diccionario de Símbolos' : 'Symbol Dictionary'}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <Text style={styles.subtitle}>
        {es
          ? 'Símbolos eléctricos estándar, códigos y notas de cableado para electricistas de campo'
          : 'Standard electrical symbols, codes, and wiring notes for field electricians'}
      </Text>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {SYMBOL_CATEGORIES.map((cat, i) => (
          <CategorySection key={cat.title} category={cat} index={i} es={es} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WT.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: WT.textTertiary,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 10,
  },
  category: {
    backgroundColor: WT.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: WT.border,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 8,
  },
  categoryTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  categoryCount: {
    fontSize: 12,
    color: WT.textSecondary,
    backgroundColor: WT.bgCardAlt,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  categoryChevron: {
    fontSize: 10,
    color: WT.textTertiary,
  },
  symbolList: {
    borderTopWidth: 1,
    borderTopColor: WT.border,
  },
  symbolRow: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
    gap: 6,
  },
  symbolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  symbolLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  codeBadge: {
    backgroundColor: WT.blueMuted,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: WT.blue,
  },
  codeText: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.blue,
    fontFamily: 'SpaceMono',
  },
  symbolDesc: {
    fontSize: 13,
    color: WT.textSecondary,
    lineHeight: 19,
  },
  wiringNote: {
    backgroundColor: WT.bgCardAlt,
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: WT.yellow,
    gap: 3,
  },
  wiringNoteLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.yellow,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  wiringNoteText: {
    fontSize: 12,
    color: WT.textSecondary,
    lineHeight: 17,
  },
});
