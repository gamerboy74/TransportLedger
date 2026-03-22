// lib/queries.ts — All database operations via Supabase
import { supabase } from './supabase';
import { round2, BUY_RATE, SELL_RATE, getFortnight, monthKey } from '../constants/defaults';
import { runWriteThroughQueue } from './offlineQueue';
import type { TransportOwner, Vehicle, Route, TripEntry, DieselLog, GSTEntry, OtherDeduction, TransportIncome, Payment } from '../types';

function tempId() {
  return `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Transport Owners ─────────────────────────────────────────

export async function getTransportOwners(): Promise<TransportOwner[]> {
  const { data, error } = await supabase
    .from('transport_owners')
    .select('id,name,contact,commission_rate,accidental_rate,created_at')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getTransportOwner(id: string): Promise<TransportOwner | null> {
  const { data, error } = await supabase
    .from('transport_owners')
    .select('id,name,contact,commission_rate,accidental_rate,created_at')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertTransportOwner(data: Partial<TransportOwner> & { name: string }): Promise<TransportOwner> {
  return runWriteThroughQueue(
    'upsertTransportOwner',
    data,
    async () => {
      const { data: result, error } = await supabase.from('transport_owners').upsert(data).select().single();
      if (error) throw error;
      return result;
    },
    {
      id: (data as any).id ?? tempId(),
      name: data.name,
      contact: (data as any).contact ?? null,
      commission_rate: Number((data as any).commission_rate ?? 0),
      accidental_rate: Number((data as any).accidental_rate ?? 0),
      created_at: new Date().toISOString(),
    } as TransportOwner,
  );
}

// ── Vehicles ─────────────────────────────────────────────────

export async function getVehicles(transportOwnerId: string): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id,transport_owner_id,reg_number,owner_name,owner_contact,gst_commission_rate,created_at')
    .eq('transport_owner_id', transportOwnerId)
    .order('reg_number');
  if (error) throw error;
  return data ?? [];
}

export async function getVehiclesByOwnerIds(ownerIds: string[]): Promise<Vehicle[]> {
  if (!ownerIds.length) return [];
  const { data, error } = await supabase
    .from('vehicles')
    .select('id,transport_owner_id,reg_number,owner_name,owner_contact,gst_commission_rate,created_at')
    .in('transport_owner_id', ownerIds)
    .order('reg_number');
  if (error) throw error;
  return data ?? [];
}

export async function getVehicle(id: string): Promise<Vehicle | null> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id,transport_owner_id,reg_number,owner_name,owner_contact,gst_commission_rate,created_at')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertVehicle(data: Partial<Vehicle> & { transport_owner_id: string; reg_number: string; owner_name: string }): Promise<Vehicle> {
  return runWriteThroughQueue(
    'upsertVehicle',
    data,
    async () => {
      const { data: result, error } = await supabase.from('vehicles').upsert(data).select().single();
      if (error) throw error;
      return result;
    },
    {
      id: (data as any).id ?? tempId(),
      transport_owner_id: data.transport_owner_id,
      reg_number: data.reg_number,
      owner_name: data.owner_name,
      owner_contact: (data as any).owner_contact ?? null,
      gst_commission_rate: Number((data as any).gst_commission_rate ?? 0),
      created_at: new Date().toISOString(),
    } as Vehicle,
  );
}

// ── Routes ───────────────────────────────────────────────────

export async function getActiveRoutes(): Promise<Route[]> {
  const { data, error } = await supabase
    .from('routes')
    .select('id,name,rate_per_tonne,effective_from,created_at')
    .order('name')
    .order('effective_from', { ascending: false });
  if (error) throw error;
  // Return only latest rate per route name
  const seen = new Set<string>();
  return (data ?? []).filter(r => { if (seen.has(r.name)) return false; seen.add(r.name); return true; });
}

export async function upsertRoute(data: Partial<Route> & { name: string; rate_per_tonne: number; effective_from: string }): Promise<Route> {
  return runWriteThroughQueue(
    'upsertRoute',
    data,
    async () => {
      const { data: result, error } = await supabase.from('routes').upsert(data).select().single();
      if (error) throw error;
      return result;
    },
    {
      id: (data as any).id ?? tempId(),
      name: data.name,
      rate_per_tonne: data.rate_per_tonne,
      effective_from: data.effective_from,
      created_at: new Date().toISOString(),
    } as Route,
  );
}

// ── Trip Entries ─────────────────────────────────────────────

export async function getTripEntries(vehicleId: string, month: string): Promise<TripEntry[]> {
  const { data, error } = await supabase
    .from('trip_entries')
    .select('id,vehicle_id,route_id,month,tonnes,rate_snapshot,amount,created_at,routes(name)')
    .eq('vehicle_id', vehicleId)
    .eq('month', month)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map((t: any) => ({ ...t, route_name: t.routes?.name }));
}

export async function getTripEntriesByVehicleIds(vehicleIds: string[], month: string): Promise<Array<{ vehicle_id: string; tonnes: number }>> {
  if (!vehicleIds.length) return [];
  const { data, error } = await supabase
    .from('trip_entries')
    .select('vehicle_id,tonnes')
    .in('vehicle_id', vehicleIds)
    .eq('month', month);
  if (error) throw error;
  return data ?? [];
}

export async function addTripEntry(data: { vehicle_id: string; route_id: string; month: string; tonnes: number; rate_snapshot: number }): Promise<TripEntry> {
  const amount = round2(data.tonnes * data.rate_snapshot);
  return runWriteThroughQueue(
    'addTripEntry',
    data,
    async () => {
      const { data: result, error } = await supabase.from('trip_entries').insert({ ...data, amount }).select().single();
      if (error) throw error;
      return result;
    },
    {
      id: tempId(),
      vehicle_id: data.vehicle_id,
      route_id: data.route_id,
      month: data.month,
      tonnes: data.tonnes,
      rate_snapshot: data.rate_snapshot,
      amount,
      created_at: new Date().toISOString(),
    } as TripEntry,
  );
}

export async function deleteTripEntry(id: string): Promise<void> {
  await runWriteThroughQueue(
    'deleteTripEntry',
    { id },
    async () => {
      const { error } = await supabase.from('trip_entries').delete().eq('id', id);
      if (error) throw error;
    },
    undefined,
  );
}

// ── Diesel Logs ──────────────────────────────────────────────

export async function getDieselLogs(vehicleId: string, month: string): Promise<DieselLog[]> {
  const { data, error } = await supabase
    .from('diesel_logs')
    .select('id,vehicle_id,date,month,fortnight,litres,buy_rate,sell_rate,amount,buy_amount,profit,deleted_at,delete_reason,created_at')
    .eq('vehicle_id', vehicleId)
    .eq('month', month)
    .is('deleted_at', null)
    .order('date');
  if (error) throw error;
  return data ?? [];
}

export async function getDieselProfitsByVehicleIds(vehicleIds: string[], month: string): Promise<Array<{ vehicle_id: string; profit: number; deleted_at: string | null }>> {
  if (!vehicleIds.length) return [];
  const { data, error } = await supabase
    .from('diesel_logs')
    .select('vehicle_id,profit,deleted_at')
    .in('vehicle_id', vehicleIds)
    .eq('month', month);
  if (error) throw error;
  return data ?? [];
}

export async function getDieselLogsByVehicleIds(vehicleIds: string[], month: string): Promise<DieselLog[]> {
  if (!vehicleIds.length) return [];
  const { data, error } = await supabase
    .from('diesel_logs')
    .select('id,vehicle_id,date,month,fortnight,litres,buy_rate,sell_rate,amount,buy_amount,profit,deleted_at,delete_reason,created_at')
    .in('vehicle_id', vehicleIds)
    .eq('month', month)
    .is('deleted_at', null)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addDieselLog(data: { vehicle_id: string; date: string; litres: number }): Promise<DieselLog> {
  const month     = data.date.substring(0, 7);
  const fortnight = getFortnight(data.date);
  const amount    = round2(data.litres * SELL_RATE);
  const buy_amount = round2(data.litres * BUY_RATE);
  const profit    = round2(amount - buy_amount);
  return runWriteThroughQueue(
    'addDieselLog',
    data,
    async () => {
      const { data: result, error } = await supabase
        .from('diesel_logs')
        .insert({ ...data, month, fortnight, buy_rate: BUY_RATE, sell_rate: SELL_RATE, amount, buy_amount, profit })
        .select().single();
      if (error) throw error;
      return result;
    },
    {
      id: tempId(),
      vehicle_id: data.vehicle_id,
      date: data.date,
      month,
      fortnight,
      litres: data.litres,
      buy_rate: BUY_RATE,
      sell_rate: SELL_RATE,
      amount,
      buy_amount,
      profit,
      deleted_at: null,
      delete_reason: null,
      created_at: new Date().toISOString(),
    } as DieselLog,
  );
}

export async function updateDieselLog(data: { id: string; date: string; litres: number }): Promise<void> {
  const month = data.date.substring(0, 7);
  const fortnight = getFortnight(data.date);
  const amount = round2(data.litres * SELL_RATE);
  const buy_amount = round2(data.litres * BUY_RATE);
  const profit = round2(amount - buy_amount);

  await runWriteThroughQueue(
    'updateDieselLog',
    data,
    async () => {
      const { error } = await supabase
        .from('diesel_logs')
        .update({
          date: data.date,
          month,
          fortnight,
          litres: data.litres,
          buy_rate: BUY_RATE,
          sell_rate: SELL_RATE,
          amount,
          buy_amount,
          profit,
        })
        .eq('id', data.id);
      if (error) throw error;
    },
    undefined,
  );
}

export async function softDeleteDieselLog(id: string, reason: string): Promise<void> {
  await runWriteThroughQueue(
    'softDeleteDieselLog',
    { id, reason },
    async () => {
      const { error } = await supabase
        .from('diesel_logs')
        .update({ deleted_at: new Date().toISOString(), delete_reason: reason })
        .eq('id', id);
      if (error) throw error;
    },
    undefined,
  );
}

// ── GST Entries ──────────────────────────────────────────────

export async function getGSTEntries(vehicleId: string, month: string): Promise<GSTEntry[]> {
  const { data, error } = await supabase
    .from('gst_entries')
    .select('id,vehicle_id,belongs_to_month,entered_in_month,gross_gst,gst_commission_rate,commission_on_gst,net_gst,created_at')
    .eq('vehicle_id', vehicleId)
    .eq('belongs_to_month', month);
  if (error) throw error;
  return data ?? [];
}

export async function getGSTCommissionsByVehicleIds(vehicleIds: string[], month: string): Promise<Array<{ vehicle_id: string; commission_on_gst: number }>> {
  if (!vehicleIds.length) return [];
  const { data, error } = await supabase
    .from('gst_entries')
    .select('vehicle_id,commission_on_gst')
    .in('vehicle_id', vehicleIds)
    .eq('belongs_to_month', month);
  if (error) throw error;
  return data ?? [];
}

export async function addGSTEntry(data: { vehicle_id: string; belongs_to_month: string; gross_gst: number; gst_commission_rate: number }): Promise<GSTEntry> {
  const commission_on_gst = round2(data.gross_gst * data.gst_commission_rate);
  const net_gst           = round2(data.gross_gst - commission_on_gst);
  const entered_in_month  = monthKey();
  return runWriteThroughQueue(
    'addGSTEntry',
    data,
    async () => {
      const { data: result, error } = await supabase
        .from('gst_entries')
        .insert({ ...data, commission_on_gst, net_gst, entered_in_month })
        .select().single();
      if (error) throw error;
      return result;
    },
    {
      id: tempId(),
      vehicle_id: data.vehicle_id,
      belongs_to_month: data.belongs_to_month,
      entered_in_month,
      gross_gst: data.gross_gst,
      gst_commission_rate: data.gst_commission_rate,
      commission_on_gst,
      net_gst,
      created_at: new Date().toISOString(),
    } as GSTEntry,
  );
}

export async function deleteGSTEntry(id: string): Promise<void> {
  await runWriteThroughQueue(
    'deleteGSTEntry',
    { id },
    async () => {
      const { error } = await supabase.from('gst_entries').delete().eq('id', id);
      if (error) throw error;
    },
    undefined,
  );
}

// ── Other Deductions ─────────────────────────────────────────

export async function getOtherDeductions(vehicleId: string, month: string): Promise<OtherDeduction[]> {
  const { data, error } = await supabase
    .from('other_deductions')
    .select('id,vehicle_id,month,label,amount,created_at')
    .eq('vehicle_id', vehicleId)
    .eq('month', month)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function addOtherDeduction(data: { vehicle_id: string; month: string; label: string; amount: number }): Promise<OtherDeduction> {
  return runWriteThroughQueue(
    'addOtherDeduction',
    data,
    async () => {
      const { data: result, error } = await supabase.from('other_deductions').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    {
      id: tempId(),
      vehicle_id: data.vehicle_id,
      month: data.month,
      label: data.label,
      amount: data.amount,
      created_at: new Date().toISOString(),
    } as OtherDeduction,
  );
}

export async function deleteOtherDeduction(id: string): Promise<void> {
  await runWriteThroughQueue(
    'deleteOtherDeduction',
    { id },
    async () => {
      const { error } = await supabase.from('other_deductions').delete().eq('id', id);
      if (error) throw error;
    },
    undefined,
  );
}

// ── Transport Income ─────────────────────────────────────────

export async function getTransportIncome(transportOwnerId: string, month: string): Promise<TransportIncome | null> {
  const { data, error } = await supabase
    .from('transport_income')
    .select('id,transport_owner_id,month,transport_payment,diesel_payment,created_at')
    .eq('transport_owner_id', transportOwnerId)
    .eq('month', month)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getTransportIncomeByOwnerIds(ownerIds: string[], month: string): Promise<TransportIncome[]> {
  if (!ownerIds.length) return [];
  const { data, error } = await supabase
    .from('transport_income')
    .select('id,transport_owner_id,month,transport_payment,diesel_payment,created_at')
    .in('transport_owner_id', ownerIds)
    .eq('month', month);
  if (error) throw error;
  return data ?? [];
}

export async function upsertTransportIncome(data: { transport_owner_id: string; month: string; transport_payment: number; diesel_payment: number }): Promise<void> {
  await runWriteThroughQueue(
    'upsertTransportIncome',
    data,
    async () => {
      const { error } = await supabase.from('transport_income').upsert(data, { onConflict: 'transport_owner_id,month' });
      if (error) throw error;
    },
    undefined,
  );
}

export async function getAnnualTransportIncome(transportOwnerId: string, year: string): Promise<TransportIncome[]> {
  const { data, error } = await supabase
    .from('transport_income')
    .select('id,transport_owner_id,month,transport_payment,diesel_payment,created_at')
    .eq('transport_owner_id', transportOwnerId)
    .like('month', `${year}-%`).order('month');
  if (error) throw error;
  return data ?? [];
}

// ── Payments ─────────────────────────────────────────────────

export async function getPayments(transportOwnerId: string, month: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('id,transport_owner_id,vehicle_id,paid_to,amount,date,mode,reference,note,month,created_at')
    .eq('transport_owner_id', transportOwnerId)
    .eq('month', month)
    .order('date').order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function addPayment(data: Omit<Payment, 'id' | 'created_at'>): Promise<Payment> {
  return runWriteThroughQueue(
    'addPayment',
    data,
    async () => {
      const { data: result, error } = await supabase.from('payments').insert(data).select().single();
      if (error) throw error;
      return result;
    },
    {
      id: tempId(),
      created_at: new Date().toISOString(),
      ...data,
    } as Payment,
  );
}

export async function deletePayment(id: string): Promise<void> {
  await runWriteThroughQueue(
    'deletePayment',
    { id },
    async () => {
      const { error } = await supabase.from('payments').delete().eq('id', id);
      if (error) throw error;
    },
    undefined,
  );
}

export async function getTotalPayments(transportOwnerId: string, month: string): Promise<number> {
  const { data, error } = await supabase
    .from('payments').select('amount').eq('transport_owner_id', transportOwnerId).eq('month', month);
  if (error) throw error;
  return round2((data ?? []).reduce((s, p) => s + Number(p.amount), 0));
}

export async function getPaymentAmountsByOwnerIds(ownerIds: string[], month: string): Promise<Array<{ transport_owner_id: string; amount: number }>> {
  if (!ownerIds.length) return [];
  const { data, error } = await supabase
    .from('payments')
    .select('transport_owner_id,amount')
    .in('transport_owner_id', ownerIds)
    .eq('month', month);
  if (error) throw error;
  return (data ?? []).filter((p: any) => !!p.transport_owner_id) as Array<{ transport_owner_id: string; amount: number }>;
}

export async function getVehiclePayments(vehicleId: string, month: string): Promise<number> {
  const { data, error } = await supabase
    .from('payments').select('amount').eq('vehicle_id', vehicleId).eq('month', month);
  if (error) throw error;
  return round2((data ?? []).reduce((s, p) => s + Number(p.amount), 0));
}
