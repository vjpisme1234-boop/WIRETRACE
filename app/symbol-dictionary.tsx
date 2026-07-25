import React, { useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, BookOpen } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';

// ---------------------------------------------------------------------------
// Symbol dictionary data
// ---------------------------------------------------------------------------

interface SymbolEntry {
  label: string;
  code: string;
  description: string;
  wiring?: string;
}

interface SymbolCategory {
  title: string;
  symbols: SymbolEntry[];
}

const SYMBOL_CATEGORIES: SymbolCategory[] = [
  {
    title: 'Power Sources & Distribution',
    symbols: [
      { label: 'Power Supply (AC)', code: 'PS / L1, L2, L3', description: 'Provides AC voltage to the circuit. Single-phase (L1, N) or three-phase (L1, L2, L3).', wiring: 'Always verify phase voltage before connecting. Use appropriate PPE.' },
      { label: 'Power Supply (DC)', code: '+V / 0V', description: 'Provides DC voltage, typically 24VDC for control circuits.', wiring: 'Observe polarity. Blue = negative (0V/common), yellow = positive (+24V) per NFPA 79.' },
      { label: 'Battery', code: 'BAT', description: 'DC energy storage source. Cell polarity marked with long (+) and short (−) lines.', wiring: 'Verify voltage and polarity before connecting loads.' },
      { label: 'Transformer (Power)', code: 'T / TR', description: 'Steps voltage up or down between primary and secondary windings.', wiring: 'Note VA rating. Never swap primary/secondary terminals.' },
      { label: 'Auto-Transformer', code: 'AT', description: 'Single-winding transformer with tapped output. Common in reduced-voltage starters.', wiring: 'No electrical isolation between primary and secondary.' },
      { label: 'Current Transformer', code: 'CT', description: 'Produces a reduced current proportional to measured line current for metering/protection.', wiring: 'NEVER open-circuit a CT secondary — dangerously high voltage will develop.' },
      { label: 'Potential Transformer', code: 'PT / VT', description: 'Steps down high voltage for metering or relay operation.', wiring: 'Secondary must be grounded. Fuse the primary.' },
    ],
  },
  {
    title: 'Overcurrent Protection',
    symbols: [
      { label: 'Fuse', code: 'F / FU', description: 'Single-use overcurrent protection device. Opens on sustained overcurrent.', wiring: 'Match voltage and interrupting rating to the circuit. Replace like-for-like only.' },
      { label: 'Circuit Breaker', code: 'CB / BKR', description: 'Resettable overcurrent protection. May also provide short-circuit protection.', wiring: 'Check trip curve (B, C, D) matches load type — motors need Type D.' },
      { label: 'GFCI', code: 'GFCI', description: 'Ground Fault Circuit Interrupter. Trips on currents as low as 5mA to ground.', wiring: 'Required in wet/damp locations per NEC 210.8.' },
      { label: 'Overload Relay', code: 'OL / OR', description: 'Protects motors from sustained overcurrent/overheating. Bimetallic or electronic.', wiring: 'Set trip current to motor FLA × service factor. Must be in series with motor.' },
    ],
  },
  {
    title: 'Switches & Controls',
    symbols: [
      { label: 'Pushbutton (Normally Open)', code: 'PB-NO / START', description: 'Contacts open at rest; close when pressed. Used for START commands.', wiring: 'Symbol: circle with open bracket. Green housing = start, red = stop convention.' },
      { label: 'Pushbutton (Normally Closed)', code: 'PB-NC / STOP', description: 'Contacts closed at rest; open when pressed. Used for STOP/E-STOP commands.', wiring: 'Symbol: circle with closed bracket. Must be wired NC for safety stops.' },
      { label: 'Selector Switch', code: 'SS / SCS', description: 'Rotary switch with 2 or more positions. Used for Hand/Off/Auto (HOA) control.', wiring: 'Verify detent positions match schematic. Note spring-return vs. maintained.' },
      { label: 'Limit Switch', code: 'LS', description: 'Mechanically actuated by a moving part reaching a set position.', wiring: 'Verify actuator travel direction matches wiring (NO or NC) for intended action.' },
      { label: 'Pressure Switch', code: 'PS / PT', description: 'Contacts change state at a set pressure. Used for pump/compressor control.', wiring: 'Note setpoint and differential. Rising vs. falling pressure action.' },
      { label: 'Float Switch', code: 'FS / FL', description: 'Actuated by liquid level. Used for pump control and tank monitoring.', wiring: 'Note make-on-rise vs. make-on-fall wiring convention.' },
      { label: 'Proximity Sensor', code: 'PROX / SQ', description: 'Detects nearby objects without contact. Inductive (metal), capacitive, or ultrasonic.', wiring: '3-wire: Brown=+V, Blue=0V, Black=signal. Verify PNP vs NPN output.' },
      { label: 'Photoelectric Sensor', code: 'PE / PT', description: 'Detects objects via light beam interruption or reflection.', wiring: 'Through-beam: emitter and receiver aligned. Retroreflective: uses reflector.' },
    ],
  },
  {
    title: 'Relays & Contactors',
    symbols: [
      { label: 'Control Relay', code: 'CR / K', description: 'Electrically operated switch. Coil energizes to actuate NO/NC contacts.', wiring: 'Match coil voltage to control supply. Contacts rated separately from coil.' },
      { label: 'Latching Relay', code: 'CR-L', description: 'Maintains state after coil is de-energized. Requires separate SET and RESET coils.', wiring: 'Two coil terminals: SET and RESET. Power to SET coil latches; RESET unlatches.' },
      { label: 'Time-Delay Relay (On-Delay)', code: 'TR / TDR / TON', description: 'Contacts actuate after coil has been energized for a set time period.', wiring: 'Symbol: contact with T inside. Adjust setpoint to required delay.' },
      { label: 'Time-Delay Relay (Off-Delay)', code: 'TR / TOF', description: 'Contacts remain actuated for set time after coil is de-energized.', wiring: 'Used for motor run-down, conveyor purge, and interlock timing.' },
      { label: 'Contactor', code: 'M / C', description: 'Heavy-duty relay for switching motor loads. Higher current capacity than control relays.', wiring: 'Power terminals: L1/L2/L3 → T1/T2/T3. Auxiliary contacts for control logic.' },
      { label: 'Motor Starter', code: 'M / MS', description: 'Contactor + overload relay combined. Full-voltage or reduced-voltage starting.', wiring: 'Must include properly sized overload relay. Wire OL contacts in E-stop string.' },
    ],
  },
  {
    title: 'Motors & Drives',
    symbols: [
      { label: 'AC Motor', code: 'M / MOT', description: 'Converts electrical energy to mechanical rotation. Squirrel-cage induction is most common.', wiring: 'Verify voltage (230/460V), phase (3Ø), and FLA on nameplate before wiring.' },
      { label: 'DC Motor', code: 'M (DC)', description: 'Motor powered by DC supply. Includes shunt, series, and permanent-magnet types.', wiring: 'Observe armature and field terminal polarities. Reversing requires field or armature swap.' },
      { label: 'Variable Frequency Drive', code: 'VFD / VVVF / AFD', description: 'Converts AC supply to variable frequency/voltage to control motor speed.', wiring: 'Input: L1/L2/L3. Output: T1/T2/T3. Never switch output side while running — damages drive.' },
      { label: 'Soft Starter', code: 'SS / SMC', description: 'Gradually ramps motor voltage during start to reduce inrush current and mechanical stress.', wiring: 'In-line: L1/T1, L2/T2, L3/T3. Bypass contactor often wired in parallel.' },
    ],
  },
  {
    title: 'Passive Components',
    symbols: [
      { label: 'Resistor', code: 'R', description: 'Limits current flow in proportion to resistance value (Ohms, Ω).', wiring: 'Check wattage rating. Braking resistors on VFDs get very hot — use proper enclosure.' },
      { label: 'Capacitor', code: 'C', description: 'Stores electrical charge. Used for power factor correction, filtering, and timing.', wiring: 'Electrolytic capacitors are polarized — observe +/−. Discharge before working.' },
      { label: 'Inductor / Reactor', code: 'L / ACL', description: 'Line reactor. Limits harmonic distortion and voltage spikes. Common on VFD inputs.', wiring: 'Install between power supply and VFD. No polarity concern for AC reactors.' },
      { label: 'Transformer (Control)', code: 'CPT / T', description: 'Steps 480VAC down to 120VAC for control circuits. Often 500VA–1kVA.', wiring: 'Fuse both primary and secondary. Ground secondary neutral. Use H1–H4/X1–X4 terminals.' },
    ],
  },
  {
    title: 'Semiconductors',
    symbols: [
      { label: 'Diode', code: 'D / CR', description: 'Allows current in one direction only. Used for flyback suppression across relay coils.', wiring: 'Cathode band = negative end. Install flyback diode across DC relay coil terminals.' },
      { label: 'Zener Diode', code: 'ZD', description: 'Conducts in reverse at a specific breakdown voltage. Used for voltage regulation.', wiring: 'Reverse-biased in circuit. Observe power rating.' },
      { label: 'LED', code: 'LED / DS', description: 'Light-Emitting Diode. Used as panel pilot lights or status indicators.', wiring: 'Current-limit resistor required. Anode (+) to supply through resistor, cathode (−) to common.' },
    ],
  },
  {
    title: 'Grounding',
    symbols: [
      { label: 'Earth Ground', code: 'GND / PE', description: 'Connection to earth. Safety ground for equipment bonding per NEC 250.', wiring: 'Green or green/yellow conductor. Never use as current-carrying conductor.' },
      { label: 'Chassis Ground', code: '⏚', description: 'Connection to metal enclosure or equipment frame. May or may not be earth-bonded.', wiring: 'Bond to earth ground at single point to avoid ground loops.' },
      { label: 'Signal Ground', code: 'SGND / AGND', description: 'Reference ground for analog/communication signals. Separate from safety ground.', wiring: 'Keep isolated from power ground. Use shielded cable, drain wire to signal ground only.' },
    ],
  },
  {
    title: 'PLC & Automation',
    symbols: [
      { label: 'PLC Input', code: 'PLC-I / DI', description: 'Digital or analog input to a Programmable Logic Controller. Reads field device status.', wiring: 'Verify input voltage type (sink/source, AC/DC). Use I/O module matching field devices.' },
      { label: 'PLC Output', code: 'PLC-O / DO', description: 'Digital or analog output from PLC. Controls field actuators and devices.', wiring: 'Verify output type (relay, transistor, triac). Relay outputs provide isolation; transistor do not.' },
      { label: 'HMI', code: 'HMI / MMI', description: 'Human-Machine Interface. Touch panel or display for operator control and monitoring.', wiring: 'Typically Ethernet or RS-485/RS-232 to PLC. Power supply separate from I/O.' },
    ],
  },
  {
    title: 'Sensors & Instruments',
    symbols: [
      { label: 'Thermocouple', code: 'TC / J/K/T-Type', description: 'Temperature sensor using voltage generated between two dissimilar metals.', wiring: 'Use matching thermocouple extension wire. Do NOT use copper wire — will create junctions.' },
      { label: 'RTD', code: 'RTD / PT100', description: 'Resistance Temperature Detector. More accurate and stable than thermocouples.', wiring: '2-wire (basic), 3-wire (common), or 4-wire (highest accuracy). Match transmitter wiring type.' },
      { label: 'Current Sensor / Shunt', code: 'A / CT', description: 'Measures current flow in a conductor. Shunt: small resistance; CT: inductive.', wiring: 'Install shunt in series with circuit. CT: clamp around single conductor only.' },
      { label: 'Pilot Light', code: 'PL / L', description: 'Panel-mounted indicator lamp. Red=fault/running, green=ready/stopped by convention.', wiring: 'Verify voltage rating matches control voltage. LED type preferred for long life.' },
    ],
  },
  {
    title: 'Terminal & Wiring',
    symbols: [
      { label: 'Terminal Block', code: 'TB / X / XT', description: 'Screw or spring-clamp junction point for connecting field wiring to panel wiring.', wiring: 'Number terminals match wire numbers. Do not overtighten — use calibrated torque driver.' },
      { label: 'Junction', code: '●', description: 'Dot on a schematic indicates wires are electrically connected at that node.', wiring: 'No dot = wires cross without connection (bridge). Only dot = connected.' },
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

function CategorySection({ category, index }: { category: SymbolCategory; index: number }) {
  const [expanded, setExpanded] = useState(index === 0);

  return (
    <View style={styles.category}>
      <AnimatedPressable onPress={() => setExpanded((e) => !e)} style={styles.categoryHeader}>
        <Text style={styles.categoryTitle}>{category.title}</Text>
        <Text style={styles.categoryCount}>{category.symbols.length}</Text>
        <Text style={styles.categoryChevron}>{expanded ? '▲' : '▼'}</Text>
      </AnimatedPressable>

      {expanded && (
        <View style={styles.symbolList}>
          {category.symbols.map((sym, i) => (
            <View key={`${cat.title}-${sym.code}-${i}`} style={styles.symbolRow}>
              <View style={styles.symbolHeader}>
                <Text style={styles.symbolLabel}>{sym.label}</Text>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeText}>{sym.code}</Text>
                </View>
              </View>
              <Text style={styles.symbolDesc}>{sym.description}</Text>
              {sym.wiring && (
                <View style={styles.wiringNote}>
                  <Text style={styles.wiringNoteLabel}>⚡ Wiring note</Text>
                  <Text style={styles.wiringNoteText}>{sym.wiring}</Text>
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
          <BookOpen size={18} color={WT.blue} />
          <Text style={styles.headerTitle}>Symbol Dictionary</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <Text style={styles.subtitle}>
        Standard electrical symbols, codes, and wiring notes for field electricians
      </Text>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {SYMBOL_CATEGORIES.map((cat, i) => (
          <CategorySection key={cat.title} category={cat} index={i} />
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
