import { SchematicAnalysis } from '@/utils/schematic-storage';

// A small, clearly-fake sample schematic shown when no real scan exists yet
// — keeps the Schematic View page from looking broken/empty, and doubles
// as a reference for checking the diagram renders correctly (both for
// testing and for a user checking the format before scanning their own).
export const DEMO_SCHEMATIC: SchematicAnalysis = {
  id: 'demo',
  imageUri: '',
  analyzedAt: new Date().toISOString(),
  name: 'Example — Motor Start Circuit',
  summary: 'Example 120VAC motor control circuit: a start/stop pushbutton station controls control relay CR1, which energizes motor starter M1.',
  wireCount: 5,
  componentCount: 4,
  wires: [
    { id: 'dw1', label: '1', color: 'black', fromPoint: 'L1', toPoint: 'PB-STOP', voltage: '120VAC', confidence: 1 },
    { id: 'dw2', label: '2', color: 'black', fromPoint: 'PB-STOP', toPoint: 'PB-START', voltage: '120VAC', confidence: 1 },
    { id: 'dw3', label: '3', color: 'black', fromPoint: 'PB-START', toPoint: 'CR1-A1', voltage: '120VAC', confidence: 1 },
    { id: 'dw4', label: '4', color: 'blue', fromPoint: 'CR1-A2', toPoint: 'L2', voltage: '120VAC', confidence: 1 },
    { id: 'dw5', label: '5', color: 'red', fromPoint: 'CR1-13', toPoint: 'M1-COIL', voltage: '120VAC', confidence: 1 },
  ],
  components: [
    { id: 'dc1', type: 'pushbutton-NC', label: 'PB-STOP', description: 'Stop pushbutton, normally closed', isUnknown: false, confidence: 1 },
    { id: 'dc2', type: 'pushbutton-NO', label: 'PB-START', description: 'Start pushbutton, normally open', isUnknown: false, confidence: 1 },
    { id: 'dc3', type: 'relay', label: 'CR1', description: 'Control relay, 120VAC coil', isUnknown: false, confidence: 1 },
    { id: 'dc4', type: 'motor-starter', label: 'M1', description: 'Motor starter coil', isUnknown: false, confidence: 1 },
  ],
  connections: [
    { id: 'dcon1', from: 'L1', to: 'PB-STOP', wireLabel: '1', description: 'L1 to stop pushbutton' },
    { id: 'dcon2', from: 'PB-STOP', to: 'PB-START', wireLabel: '2', description: 'Stop to start pushbutton' },
    { id: 'dcon3', from: 'PB-START', to: 'CR1-A1', wireLabel: '3', description: 'Start pushbutton to CR1 coil' },
    { id: 'dcon4', from: 'CR1-A2', to: 'L2', wireLabel: '4', description: 'CR1 coil to L2' },
    { id: 'dcon5', from: 'CR1-13', to: 'M1-COIL', wireLabel: '5', description: 'CR1 auxiliary contact to M1 starter coil' },
  ],
  unknownSymbols: [],
  readingSteps: [],
};
