import * as SecureStore from 'expo-secure-store';
import type { Database } from './types';
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = "https://hvtxbihamebxdckmwvct.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2dHhiaWhhbWVieGRja213dmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3NTc0ODksImV4cCI6MjEwMDMzMzQ4OX0.rJlSCXOzkjwxezu9xk43KGSu-ycksgX2U8hu33SQKyA";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
