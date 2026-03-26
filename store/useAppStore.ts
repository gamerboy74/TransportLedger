import { create } from 'zustand';
import { GlobalSettings } from '../types';
import { getGlobalSettings, updateGlobalSettings as apiUpdateSettings } from '../lib/queries';
import { TDS_RATE, BUY_RATE, SELL_RATE } from '../constants/defaults';

interface AppState {
  globalActiveOwnerId: string | null;
  globalActiveVehicleId: string | null;
  globalSettings: GlobalSettings;
  settingsLoaded: boolean;
  
  setGlobalActiveOwnerId: (id: string | null) => void;
  setGlobalActiveVehicleId: (id: string | null) => void;
  clearGlobalSelections: () => void;
  
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<GlobalSettings>) => Promise<void>;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  id: '00000000-0000-0000-0000-000000000000',
  tds_rate: TDS_RATE,
  diesel_buy_rate: BUY_RATE,
  diesel_sell_rate: SELL_RATE,
  updated_at: new Date().toISOString(),
};

export const useAppStore = create<AppState>((set, get) => ({
  globalActiveOwnerId: null,
  globalActiveVehicleId: null,
  globalSettings: DEFAULT_SETTINGS,
  settingsLoaded: false,

  setGlobalActiveOwnerId: (id) => set({ globalActiveOwnerId: id, globalActiveVehicleId: null }),
  setGlobalActiveVehicleId: (id) => set({ globalActiveVehicleId: id }),
  clearGlobalSelections: () => set({ globalActiveOwnerId: null, globalActiveVehicleId: null }),

  loadSettings: async () => {
    try {
      const settings = await getGlobalSettings();
      set({ globalSettings: settings, settingsLoaded: true });
    } catch (e) {
      console.warn('Failed to load settings, using defaults');
      set({ settingsLoaded: true });
    }
  },

  updateSettings: async (patch) => {
    const updated = await apiUpdateSettings(patch);
    set({ globalSettings: updated });
  },
}));
