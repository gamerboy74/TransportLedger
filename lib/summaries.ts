import {
  getDieselProfitsByVehicleIds,
  getGSTCommissionsByVehicleIds,
  getPaymentAmountsByOwnerIds,
  getTransportIncomeByOwnerIds,
  getTransportOwners,
  getTripEntriesByVehicleIds,
  getVehiclesByOwnerIds,
  getActiveRoutes,
} from './queries';
import { round2 } from '../constants/defaults';
import type { TransportOwner } from '../types';

export async function fetchHomeSummary(month: string) {
  const owners = await getTransportOwners();
  const ownerIds = owners.map((o) => o.id);
  const [vehicles, incomes, payments] = await Promise.all([
    getVehiclesByOwnerIds(ownerIds),
    getTransportIncomeByOwnerIds(ownerIds, month),
    getPaymentAmountsByOwnerIds(ownerIds, month),
  ]);

  const vehicleIds = vehicles.map((v) => v.id);
  const [tripRows, dieselRows, gstRows] = await Promise.all([
    getTripEntriesByVehicleIds(vehicleIds, month),
    getDieselProfitsByVehicleIds(vehicleIds, month),
    getGSTCommissionsByVehicleIds(vehicleIds, month),
  ]);

  const vehicleOwnerMap = new Map<string, string>();
  const vehicleCountByOwner = new Map<string, number>();
  for (const v of vehicles) {
    vehicleOwnerMap.set(v.id, v.transport_owner_id);
    vehicleCountByOwner.set(v.transport_owner_id, (vehicleCountByOwner.get(v.transport_owner_id) ?? 0) + 1);
  }

  const tonnesByOwner = new Map<string, number>();
  for (const t of tripRows) {
    const ownerId = vehicleOwnerMap.get(t.vehicle_id);
    if (!ownerId) continue;
    tonnesByOwner.set(ownerId, round2((tonnesByOwner.get(ownerId) ?? 0) + Number(t.tonnes)));
  }

  const dieselProfitByOwner = new Map<string, number>();
  for (const d of dieselRows) {
    if (d.deleted_at) continue;
    const ownerId = vehicleOwnerMap.get(d.vehicle_id);
    if (!ownerId) continue;
    dieselProfitByOwner.set(ownerId, round2((dieselProfitByOwner.get(ownerId) ?? 0) + Number(d.profit)));
  }

  const gstCommissionByOwner = new Map<string, number>();
  for (const g of gstRows) {
    const ownerId = vehicleOwnerMap.get(g.vehicle_id);
    if (!ownerId) continue;
    gstCommissionByOwner.set(ownerId, round2((gstCommissionByOwner.get(ownerId) ?? 0) + Number(g.commission_on_gst)));
  }

  const incomeByOwner = new Map<string, number>();
  for (const i of incomes) {
    incomeByOwner.set(i.transport_owner_id, round2(Number(i.transport_payment) + Number(i.diesel_payment)));
  }

  const paidByOwner = new Map<string, number>();
  for (const p of payments) {
    paidByOwner.set(p.transport_owner_id, round2((paidByOwner.get(p.transport_owner_id) ?? 0) + Number(p.amount)));
  }

  const ownerStats = owners.map((o) => {
    const tonnes = tonnesByOwner.get(o.id) ?? 0;
    const comm = round2(tonnes * Number(o.commission_rate));
    const diesel = dieselProfitByOwner.get(o.id) ?? 0;
    const gstC = gstCommissionByOwner.get(o.id) ?? 0;
    const totalIncome = incomeByOwner.get(o.id) ?? 0;
    const paid = paidByOwner.get(o.id) ?? 0;

    return {
      comm,
      diesel,
      gstC,
      vehicleCount: vehicleCountByOwner.get(o.id) ?? 0,
      balance: round2(totalIncome - paid),
    };
  });

  const totals = ownerStats.reduce((acc, row) => {
    acc.comm += row.comm;
    acc.diesel += row.diesel;
    acc.gstC += row.gstC;
    acc.vCount += row.vehicleCount;
    acc.balance += row.balance;
    return acc;
  }, { comm: 0, diesel: 0, gstC: 0, vCount: 0, balance: 0 });

  return {
    earnings: {
      commissionIncome: round2(totals.comm),
      dieselProfit: round2(totals.diesel),
      gstCommission: round2(totals.gstC),
      totalEarnings: round2(totals.comm + totals.diesel + totals.gstC),
    },
    counts: { owners: owners.length, vehicles: totals.vCount },
    totalBalance: round2(totals.balance),
  };
}

export async function fetchTransportersSummary(month: string) {
  const owners = await getTransportOwners();
  const ownerIds = owners.map((o) => o.id);
  const [vehicles, incomes, payments] = await Promise.all([
    getVehiclesByOwnerIds(ownerIds),
    getTransportIncomeByOwnerIds(ownerIds, month),
    getPaymentAmountsByOwnerIds(ownerIds, month),
  ]);

  const vehicleCountByOwner = new Map<string, number>();
  for (const v of vehicles) {
    vehicleCountByOwner.set(v.transport_owner_id, (vehicleCountByOwner.get(v.transport_owner_id) ?? 0) + 1);
  }

  const incomeByOwner = new Map<string, number>();
  for (const i of incomes) {
    incomeByOwner.set(i.transport_owner_id, round2(Number(i.transport_payment) + Number(i.diesel_payment)));
  }

  const paidByOwner = new Map<string, number>();
  for (const p of payments) {
    paidByOwner.set(p.transport_owner_id, round2((paidByOwner.get(p.transport_owner_id) ?? 0) + Number(p.amount)));
  }

  return owners.map((o: TransportOwner) => {
    const totalIncome = incomeByOwner.get(o.id) ?? 0;
    const paid = paidByOwner.get(o.id) ?? 0;
    return {
      owner: o,
      vehicleCount: vehicleCountByOwner.get(o.id) ?? 0,
      balance: round2(totalIncome - paid),
    };
  });
}

export async function fetchReportsBootstrap() {
  const [owners, routes] = await Promise.all([getTransportOwners(), getActiveRoutes()]);
  return { owners, routes };
}

export async function fetchEntryBootstrap() {
  const [owners, routes] = await Promise.all([getTransportOwners(), getActiveRoutes()]);
  return { owners, routes };
}
