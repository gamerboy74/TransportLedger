import AsyncStorage from '@react-native-async-storage/async-storage';

type TotalsRow = {
  name: string;
  amount: number;
  litres: number;
};

type VehicleTotalsRow = {
  reg: string;
  owner: string;
  amount: number;
  litres: number;
};

export type DieselInsightsCache = {
  monthTotal: number;
  half1Total: number;
  half2Total: number;
  currentTotal: number;
  displayCount: number;
  transportTotals: TotalsRow[];
  vehicleTotals: VehicleTotalsRow[];
  updatedAt: string;
};

const KEY_PREFIX = 'transportledger.diesel.insights.v1';

function makeKey(cacheKey: string) {
  return `${KEY_PREFIX}:${cacheKey}`;
}

export async function readDieselInsights(cacheKey: string): Promise<DieselInsightsCache | null> {
  try {
    const raw = await AsyncStorage.getItem(makeKey(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as DieselInsightsCache;
  } catch {
    return null;
  }
}

export async function writeDieselInsights(cacheKey: string, insights: DieselInsightsCache): Promise<void> {
  try {
    await AsyncStorage.setItem(makeKey(cacheKey), JSON.stringify(insights));
  } catch {
    // Ignore cache write failures.
  }
}

export async function invalidateDieselInsights(cacheKey: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(makeKey(cacheKey));
  } catch {
    // Ignore cache remove failures.
  }
}

export async function invalidateDieselInsightsForMonth(month: string): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const monthPrefix = `${KEY_PREFIX}:${month}|`;
    const keysToRemove = allKeys.filter((k) => k.startsWith(monthPrefix));
    if (!keysToRemove.length) return;
    await AsyncStorage.multiRemove(keysToRemove);
  } catch {
    // Ignore cache remove failures.
  }
}
