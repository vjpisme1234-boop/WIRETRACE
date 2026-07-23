import { createAuthClient } from 'better-auth/client';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';

const secureStorage = {
  getItem: (key: string): string | null => SecureStore.getItem(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
};

export const authClient = createAuthClient({
  plugins: [
    expoClient({
      storage: secureStorage,
    }),
  ],
});
