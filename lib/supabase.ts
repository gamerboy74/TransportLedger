// lib/supabase.ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://tjvwkcvpqltigwoxmrdt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqdndrY3ZwcWx0aWd3b3htcmR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxODUyNDEsImV4cCI6MjA4OTc2MTI0MX0.4xO3X9BTqjF-_xZuVG4kCzpIF7IR2gA81JQJew0L6I0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
