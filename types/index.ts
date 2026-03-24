export interface TransportOwner {
  id: string;
  name: string;
  contact: string | null;
  commission_rate: number;
  accidental_rate: number;
  created_at: string;
}

export interface Vehicle {
  id: string;
  transport_owner_id: string;
  reg_number: string;
  owner_name: string;
  owner_contact: string | null;
  commission_rate: number;
  accidental_rate: number;
  gst_commission_rate: number;
  created_at: string;
}

export interface Route {
  id: string;
  name: string;
  rate_per_tonne: number;
  effective_from: string;
  created_at: string;
}

export interface TripEntry {
  id: string;
  vehicle_id: string;
  route_id: string;
  route_name?: string;
  month: string;
  tonnes: number;
  rate_snapshot: number;
  amount: number;
  created_at: string;
}

export interface DieselLog {
  id: string;
  vehicle_id: string;
  date: string;
  month: string;
  fortnight: 1 | 2;
  litres: number;
  buy_rate: number;
  sell_rate: number;
  amount: number;
  buy_amount: number;
  profit: number;
  deleted_at: string | null;
  delete_reason: string | null;
  created_at: string;
}

export interface GSTEntry {
  id: string;
  vehicle_id: string;
  belongs_to_month: string;
  entered_in_month: string;
  gross_gst: number;
  gst_commission_rate: number;
  commission_on_gst: number;
  net_gst: number;
  created_at: string;
}

export interface OtherDeduction {
  id: string;
  vehicle_id: string;
  month: string;
  label: string;
  amount: number;
  created_at: string;
}

export interface TransportIncome {
  id: string;
  transport_owner_id: string;
  month: string;
  transport_payment: number;
  diesel_payment: number;
  created_at: string;
}

export interface Payment {
  id: string;
  transport_owner_id: string | null;
  vehicle_id: string | null;
  paid_to: string;
  amount: number;
  date: string;
  mode: 'cheque' | 'upi' | 'other';
  reference: string | null;
  note: string | null;
  month: string;
  created_at: string;
}

export interface SettlementResult {
  gross: number;
  totalTonnes: number;
  tds: number;
  commission: number;
  accidental: number;
  dieselTotal: number;
  netGST: number;
  otherTotal: number;
  netPayable: number;
}

export interface AdminEarnings {
  commissionIncome: number;
  dieselProfit: number;
  gstCommission: number;
  totalEarnings: number;
}
