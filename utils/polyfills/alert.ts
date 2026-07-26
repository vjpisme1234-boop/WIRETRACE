import { Alert } from 'react-native';

const { polyfillGlobal } = require('react-native/Libraries/Utilities/PolyfillFunctions') as {
  polyfillGlobal: (name: string, getValue: () => unknown) => void;
};

// Add global alert() on iOS/Android — it doesn't exist by default in React Native.
// On web, alert.web.ts is used instead (Metro picks .web.ts automatically).
polyfillGlobal('alert', () => (message?: string) => {
  Alert.alert('', String(message ?? ''));
});
