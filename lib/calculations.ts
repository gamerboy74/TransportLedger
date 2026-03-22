import { TDS_RATE, round2 } from '../constants/defaults';
import type { SettlementResult, AdminEarnings } from '../types';

export interface SettlementInput {
  trips: { tonnes: number; rate_snapshot: number; amount: number }[];
  diesel: { litres: number; sell_rate: number; amount: number; deleted_at: string | null }[];
  commissionRate: number;
  accidentalRate: number;
  gstEntries: { net_gst: number }[];
  otherDeductions: { amount: number }[];
}

export function calculateSettlement(input: SettlementInput): SettlementResult {
  const activeDiesel = input.diesel.filter(d => d.deleted_at === null);
  const gross        = round2(input.trips.reduce((s, t) => s + Number(t.amount), 0));
  const totalTonnes  = round2(input.trips.reduce((s, t) => s + Number(t.tonnes), 0));
  const tds          = round2(gross * TDS_RATE);
  const commission   = round2(totalTonnes * input.commissionRate);
  const accidental   = round2(totalTonnes * input.accidentalRate);
  const dieselTotal  = round2(activeDiesel.reduce((s, d) => s + Number(d.amount), 0));
  const netGST       = round2(input.gstEntries.reduce((s, g) => s + Number(g.net_gst), 0));
  const otherTotal   = round2(input.otherDeductions.reduce((s, d) => s + Number(d.amount), 0));
  const netPayable   = round2(gross - tds - commission - accidental - dieselTotal + netGST - otherTotal);
  return { gross, totalTonnes, tds, commission, accidental, dieselTotal, netGST, otherTotal, netPayable };
}

export function calculateAdminEarnings(data: {
  totalTonnes: number;
  commissionRate: number;
  diesel: { profit: number; deleted_at: string | null }[];
  gstEntries: { commission_on_gst: number }[];
}): AdminEarnings {
  const activeDiesel     = data.diesel.filter(d => d.deleted_at === null);
  const commissionIncome = round2(data.totalTonnes * data.commissionRate);
  const dieselProfit     = round2(activeDiesel.reduce((s, d) => s + Number(d.profit), 0));
  const gstCommission    = round2(data.gstEntries.reduce((s, g) => s + Number(g.commission_on_gst), 0));
  return { commissionIncome, dieselProfit, gstCommission,
    totalEarnings: round2(commissionIncome + dieselProfit + gstCommission) };
}
