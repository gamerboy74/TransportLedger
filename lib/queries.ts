// lib/queries.ts — All database operations via Supabase
import { supabase } from './supabase';
import { round2, getFortnight, monthKey } from '../constants/defaults';
import { runWriteThroughQueue } from './offlineQueue';
import type { TransportOwner, Vehicle, Route, TripEntry, DieselLog, GSTEntry, OtherDeduction, TransportIncome, Payment, GlobalSettings } from '../types';

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

export async function deleteTransportOwner(id: string): Promise<void> {
  const { error } = await supabase.from('transport_owners').delete().eq('id', id);
  if (error) throw error;
}

// ── Vehicles ─────────────────────────────────────────────────

export async function getVehicles(transportOwnerId: string): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id,transport_owner_id,reg_number,owner_name,owner_contact,commission_rate,accidental_rate,gst_commission_rate,created_at')
    .eq('transport_owner_id', transportOwnerId)
    .order('reg_number');
  if (error) throw error;
  return data ?? [];
}

export async function getVehiclesByOwnerIds(ownerIds: string[]): Promise<Vehicle[]> {
  if (!ownerIds.length) return [];
  const { data, error } = await supabase
    .from('vehicles')
    .select('id,transport_owner_id,reg_number,owner_name,owner_contact,commission_rate,accidental_rate,gst_commission_rate,created_at')
    .in('transport_owner_id', ownerIds)
    .order('reg_number');
  if (error) throw error;
  return data ?? [];
}

export async function getAllVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id,transport_owner_id,reg_number,owner_name,owner_contact,commission_rate,accidental_rate,gst_commission_rate,created_at')
    .order('reg_number');
  if (error) throw error;
  return data ?? [];
}

export async function getVehicle(id: string): Promise<Vehicle | null> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id,transport_owner_id,reg_number,owner_name,owner_contact,commission_rate,accidental_rate,gst_commission_rate,created_at')
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
      commission_rate: Number((data as any).commission_rate ?? 0),
      accidental_rate: Number((data as any).accidental_rate ?? 0),
      gst_commission_rate: Number((data as any).gst_commission_rate ?? 0),
      created_at: new Date().toISOString(),
    } as Vehicle,
  );
}

export async function deleteVehicle(id: string): Promise<void> {
  // Fast path: a single delete is enough when FK constraints are ON DELETE CASCADE.
  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (!error) return;

  // Fallback for older DB schemas where child tables might still block vehicle deletion.
  if ((error as any)?.code !== '23503') throw error;

  const [tripsRes, dieselRes, gstRes, deductionsRes, paymentsRes] = await Promise.all([
    supabase.from('trip_entries').delete().eq('vehicle_id', id),
    supabase.from('diesel_logs').delete().eq('vehicle_id', id),
    supabase.from('gst_entries').delete().eq('vehicle_id', id),
    supabase.from('other_deductions').delete().eq('vehicle_id', id),
    supabase.from('payments').delete().eq('vehicle_id', id),
  ]);

  const childError = tripsRes.error || dieselRes.error || gstRes.error || deductionsRes.error || paymentsRes.error;
  if (childError) throw childError;

  const { error: retryError } = await supabase.from('vehicles').delete().eq('id', id);
  if (retryError) throw retryError;
}

/** Vehicle search result — extends Vehicle with the transport owner's name for display. */
export interface VehicleSearchResult extends Omit<Vehicle, 'created_at'> {
  created_at: string;
  transporter_name: string; // name of the transport_owner that owns this vehicle
}

/**
 * Search all vehicles (across all owners) by reg number substring.
 * Results include the owning transport owner's name for disambiguation.
 * Excludes own-owner vehicles via caller-side filtering if needed.
 */
export async function searchVehiclesByRegNumber(query: string): Promise<VehicleSearchResult[]> {
  if (!query.trim()) return [];
  const { data, error } = await supabase
    .from('vehicles')
    .select('id,transport_owner_id,reg_number,owner_name,owner_contact,commission_rate,accidental_rate,gst_commission_rate,created_at,transport_owners(name)')
    .ilike('reg_number', `%${query.trim()}%`)
    .limit(12);
  if (error) throw error;
  return (data ?? []).map((v: any) => ({
    id: v.id,
    transport_owner_id: v.transport_owner_id,
    reg_number: v.reg_number,
    owner_name: v.owner_name,
    owner_contact: v.owner_contact ?? null,
    commission_rate: Number(v.commission_rate),
    accidental_rate: Number(v.accidental_rate),
    gst_commission_rate: Number(v.gst_commission_rate),
    created_at: v.created_at,
    transporter_name: (v.transport_owners as any)?.name ?? 'Unknown Owner',
  }));
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

export async function getTripEntriesByVehicleIdsDetail(
  vehicleIds: string[],
  month: string,
  opts?: { page?: number; pageSize?: number }
): Promise<TripEntry[]> {
  if (!vehicleIds.length) return [];
  let query = supabase
    .from('trip_entries')
    .select('id,vehicle_id,route_id,month,tonnes,rate_snapshot,amount,created_at,routes(name)')
    .in('vehicle_id', vehicleIds)
    .eq('month', month)
    .order('created_at', { ascending: false });

  if (opts && opts.page !== undefined) {
    const size = opts.pageSize || 50;
    const from = opts.page * size;
    const to = from + size - 1;
    query = query.range(from, to);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((t: any) => ({ ...t, route_name: t.routes?.name }));
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

export async function updateTripEntry(id: string, data: { route_id: string; month: string; tonnes: number; rate_snapshot: number }): Promise<TripEntry> {
  const amount = round2(data.tonnes * data.rate_snapshot);
  return runWriteThroughQueue(
    'updateTripEntry',
    { id, ...data },
    async () => {
      const { data: result, error } = await supabase
        .from('trip_entries')
        .update({ ...data, amount })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    undefined, // Offline queue for updates usually returns what's given or handles it in processAction
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

export async function getAllDieselProfits(month: string): Promise<Array<{ vehicle_id: string; profit: number; deleted_at: string | null }>> {
  const { data, error } = await supabase
    .from('diesel_logs')
    .select('vehicle_id,profit,deleted_at')
    .eq('month', month);
  if (error) throw error;
  return data ?? [];
}

export async function getDieselLogsByVehicleIds(vehicleIds: string[], month: string, opts?: { page?: number; pageSize?: number }): Promise<DieselLog[]> {
  if (!vehicleIds.length) return [];
  let query = supabase
    .from('diesel_logs')
    .select('id,vehicle_id,date,month,fortnight,litres,buy_rate,sell_rate,amount,buy_amount,profit,deleted_at,delete_reason,created_at')
    .in('vehicle_id', vehicleIds)
    .eq('month', month)
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (opts && opts.page !== undefined) {
    const size = opts.pageSize || 50;
    const from = opts.page * size;
    const to = from + size - 1;
    query = query.range(from, to);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function addDieselLog(data: { vehicle_id: string; date: string; litres: number; buy_rate: number; sell_rate: number }): Promise<DieselLog> {
  const month     = data.date.substring(0, 7);
  const fortnight = getFortnight(data.date) as 1 | 2;
  const amount    = round2(data.litres * data.sell_rate);
  const buy_amount = round2(data.litres * data.buy_rate);
  const profit    = round2(amount - buy_amount);
  return runWriteThroughQueue(
    'addDieselLog',
    data,
    async () => {
      const { data: result, error } = await supabase
        .from('diesel_logs')
        .insert({ ...data, month, fortnight, amount, buy_amount, profit })
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
      buy_rate: data.buy_rate,
      sell_rate: data.sell_rate,
      amount,
      buy_amount,
      profit,
      deleted_at: null,
      delete_reason: null,
      created_at: new Date().toISOString(),
    } as DieselLog,
  );
}

export async function updateDieselLog(data: { id: string; date: string; litres: number; buy_rate: number; sell_rate: number }): Promise<void> {
  const month = data.date.substring(0, 7);
  const fortnight = getFortnight(data.date) as 1 | 2;
  const amount = round2(data.litres * data.sell_rate);
  const buy_amount = round2(data.litres * data.buy_rate);
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
          buy_rate: data.buy_rate,
          sell_rate: data.sell_rate,
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

export async function getAllGSTCommissions(month: string): Promise<Array<{ vehicle_id: string; commission_on_gst: number }>> {
  const { data, error } = await supabase
    .from('gst_entries')
    .select('vehicle_id,commission_on_gst')
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

export async function getAllTransportIncome(month: string): Promise<TransportIncome[]> {
  const { data, error } = await supabase
    .from('transport_income')
    .select('id,transport_owner_id,month,transport_payment,diesel_payment,created_at')
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

export async function getAllPaymentAmounts(month: string): Promise<Array<{ transport_owner_id: string; amount: number }>> {
  const { data, error } = await supabase
    .from('payments')
    .select('transport_owner_id,amount')
    .eq('month', month);
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
  return data.reduce((acc, p) => acc + Number(p.amount), 0);
}

// ── Trip Entries ─────────────────────────────────────────────

export async function getAllTripTonnes(month: string): Promise<Array<{ vehicle_id: string; tonnes: number }>> {
  const { data, error } = await supabase
    .from('trip_entries')
    .select('vehicle_id,tonnes')
    .eq('month', month);
  if (error) throw error;
  return data ?? [];
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

// ── Challan Entries ──────────────────────────────────────────
//  Only select the columns the UI actually uses — skips transporter/source/
//  destination which are always null in the current flow.

const CHALLAN_COLS = [
  'id', 'vehicle_id', 'month', 'trip_date',
  'challan_no', 'vehicle_no', 'tr_no',
  'gross_weight_kg', 'tare_weight_kg', 'net_weight_kg',
  'created_at',
].join(',');

export interface ChallanEntry {
  id: string;
  vehicle_id: string;
  month: string;
  trip_date: string;
  tr_no: string | null;
  challan_no: string | null;
  vehicle_no: string | null;
  transporter: string | null;
  destination: string | null;
  source: string | null;
  tare_weight_kg: number | null;
  gross_weight_kg: number | null;
  net_weight_kg: number | null;
  created_at: string;
}

/** Single vehicle, single month — used by ChallanForm in entry screen */
export async function getChallanEntries(vehicleId: string, month: string): Promise<ChallanEntry[]> {
  const { data, error } = await supabase
    .from('challan_entries')
    .select(CHALLAN_COLS)
    .eq('vehicle_id', vehicleId)
    .eq('month', month)
    .order('trip_date')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as unknown as ChallanEntry[];
}

/**
 * BULK fetch — replaces the N+1 Promise.all() pattern in challan-logs.tsx.
 * One single .in() round-trip regardless of how many vehicles are selected.
 */
export async function getChallanEntriesByVehicleIds(
  vehicleIds: string[],
  month: string,
  opts?: { page?: number; pageSize?: number }
): Promise<ChallanEntry[]> {
  if (vehicleIds.length === 0) return [];
  let query = supabase
    .from('challan_entries')
    .select(CHALLAN_COLS)
    .in('vehicle_id', vehicleIds)
    .eq('month', month)
    .order('trip_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (opts && opts.page !== undefined) {
    const size = opts.pageSize || 50;
    const from = opts.page * size;
    const to = from + size - 1;
    query = query.range(from, to);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ChallanEntry[];
}

/** Year-level bulk fetch (for Excel export) — one call, not N calls */
export async function getChallanEntriesForYear(vehicleId: string, year: string): Promise<ChallanEntry[]> {
  const { data, error } = await supabase
    .from('challan_entries')
    .select(CHALLAN_COLS)
    .eq('vehicle_id', vehicleId)
    .like('month', `${year}-%`)
    .order('trip_date')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as unknown as ChallanEntry[];
}

export async function addChallanEntry(data: Omit<ChallanEntry, 'id' | 'created_at'>): Promise<ChallanEntry> {
  const { data: result, error } = await supabase
    .from('challan_entries')
    .insert(data)
    .select(CHALLAN_COLS)
    .single();
  if (error) throw error;
  return result as unknown as ChallanEntry;
}

/**
 * Proper PATCH — replaces the previous delete+insert edit pattern.
 * Atomic: one round-trip, no data loss window between delete and re-insert.
 */
export async function updateChallanEntry(
  id: string,
  patch: Partial<Omit<ChallanEntry, 'id' | 'created_at' | 'vehicle_id'>>,
): Promise<ChallanEntry> {
  const { data, error } = await supabase
    .from('challan_entries')
    .update(patch)
    .eq('id', id)
    .select(CHALLAN_COLS)
    .single();
  if (error) throw error;
  return data as unknown as ChallanEntry;
}

export async function deleteChallanEntry(id: string): Promise<void> {
  const { error } = await supabase.from('challan_entries').delete().eq('id', id);
  if (error) throw error;
}
// ── Global Settings ──────────────────────────────────────────

export async function getGlobalSettings(): Promise<GlobalSettings> {
  const { data, error } = await supabase
    .from('global_settings')
    .select('*')
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .single();
  
  if (error) {
    console.error('Error fetching settings:', error);
    // Fallback to defaults from constants if DB fetch fails
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tds_rate: 0.0100,
      diesel_buy_rate: 92.92,
      diesel_sell_rate: 94.00,
      updated_at: new Date().toISOString()
    };
  }
  return data;
}

export async function updateGlobalSettings(patch: Partial<GlobalSettings>): Promise<GlobalSettings> {
  const { data, error } = await supabase
    .from('global_settings')
    .update(patch)
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .select()
    .single();
  if (error) throw error;
  return data;
}
