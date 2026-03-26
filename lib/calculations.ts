import { round2 } from '../constants/defaults';
import type { AdminEarnings, SettlementResult, DieselLog, GSTEntry } from '../types';

export interface SettlementInput {
  trips: { tonnes: number; rate_snapshot: number; amount: number }[];
  diesel: { litres: number; sell_rate: number; amount: number; deleted_at: string | null }[];
  commissionRate: number;
  accidentalRate: number;
  tdsRate: number;
  gstEntries: { net_gst: number }[];
  otherDeductions: { amount: number }[];
}

export function calculateSettlement(input: SettlementInput): SettlementResult {
  const activeDiesel = input.diesel.filter(d => d.deleted_at === null);
  const gross        = round2(input.trips.reduce((s: number, t: any) => s + Number(t.amount), 0));
  const totalTonnes  = round2(input.trips.reduce((s: number, t: any) => s + Number(t.tonnes), 0));
  const tds          = round2(gross * input.tdsRate);
  const commission   = round2(totalTonnes * input.commissionRate);
  const accidental   = round2(totalTonnes * input.accidentalRate);
  const dieselTotal  = round2(activeDiesel.reduce((s: number, d: any) => s + Number(d.amount), 0));
  const netGST       = round2(input.gstEntries.reduce((s: number, g: any) => s + Number(g.net_gst), 0));
  const otherTotal   = round2(input.otherDeductions.reduce((s: number, d: any) => s + Number(d.amount), 0));
  const netPayable   = round2(gross - tds - commission - accidental - dieselTotal + netGST - otherTotal);
  return { gross, totalTonnes, tds, commission, accidental, dieselTotal, netGST, otherTotal, netPayable };
}

export function calculateAdminEarnings(data: {
  totalTonnes: number;
  commissionRate: number;
  diesel: DieselLog[];
  gstEntries: GSTEntry[];
  buyRate: number;
  sellRate: number;
}): AdminEarnings {
  const { totalTonnes, commissionRate, diesel, gstEntries, buyRate, sellRate } = data;
  const commissionIncome = round2(totalTonnes * commissionRate);
  
  // Profit on diesel: (sellRate - buyRate) per litre
  const dieselProfit = round2((diesel || []).reduce((sum: number, d: DieselLog) => sum + (d.litres * (sellRate - buyRate)), 0));
  const gstCommission    = round2(gstEntries.reduce((s: number, g: GSTEntry) => s + Number(g.commission_on_gst), 0));
  return { commissionIncome, dieselProfit, gstCommission,
    totalEarnings: round2(commissionIncome + dieselProfit + gstCommission) };
}
