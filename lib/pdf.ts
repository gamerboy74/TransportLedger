// lib/pdf.ts — HTML-to-PDF bill for vehicle owners
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { fmt, fmtDate, monthLabel, round2 } from '../constants/defaults';
import type { Vehicle, TransportOwner, TripEntry, DieselLog, GSTEntry, OtherDeduction, SettlementResult } from '../types';

export async function generateVehicleBillPDF(params: {
  vehicle: Vehicle;
  transporter: TransportOwner;
  month: string;
  trips: TripEntry[];
  diesel: DieselLog[];
  gst: GSTEntry[];
  others: OtherDeduction[];
  settlement: SettlementResult;
  totalPaid: number;
}): Promise<void> {
  const { vehicle, transporter, month, trips, diesel, gst, others, settlement, totalPaid } = params;
  const outstanding = round2(settlement.netPayable - totalPaid);

  const tripRows = trips.map(t =>
    `<tr><td>${t.route_name ?? 'Route'}</td><td class="num">${t.tonnes} T</td><td class="num">₹${t.rate_snapshot}/T</td><td class="num credit">${fmt(t.amount)}</td></tr>`
  ).join('');

  const dieselRows = diesel.filter(d => d.deleted_at === null).map(d =>
    `<tr><td>Diesel — ${fmtDate(d.date)}</td><td class="num">${d.litres} L</td><td class="num">₹${d.sell_rate}/L</td><td class="num debit">− ${fmt(d.amount)}</td></tr>`
  ).join('');

  const gstRows = gst.map(g =>
    `<tr><td>GST — ${monthLabel(g.belongs_to_month)}</td><td></td><td></td><td class="num credit">+ ${fmt(g.net_gst)}</td></tr>`
  ).join('');

  const otherRows = others.map(o =>
    `<tr><td>${o.label}</td><td></td><td></td><td class="num debit">− ${fmt(o.amount)}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 24px; }
  .header { border-bottom: 2px solid #0ea5e9; padding-bottom: 12px; margin-bottom: 16px; }
  .header h1 { font-size: 18px; color: #0ea5e9; }
  .header p { font-size: 11px; color: #64748b; margin-top: 2px; }
  .meta { display: flex; gap: 32px; margin-bottom: 16px; flex-wrap: wrap; }
  .meta-item .label { font-size: 10px; color: #64748b; text-transform: uppercase; }
  .meta-item .value { font-size: 13px; font-weight: bold; margin-top: 2px; }
  .section { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #64748b; margin: 12px 0 4px; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #f1f5f9; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; color: #64748b; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
  .num { text-align: right; }
  .credit { color: #16a34a; font-weight: bold; }
  .debit  { color: #dc2626; }
  .total-row td { font-weight: bold; background: #f8fafc; border-top: 2px solid #e2e8f0; }
  .net-box { background: #0ea5e9; color: white; border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; margin: 12px 0; }
  .net-box .lbl { font-size: 11px; opacity: 0.85; text-transform: uppercase; }
  .net-box .val { font-size: 20px; font-weight: bold; }
  .out-box { border: 2px solid ${outstanding <= 0 ? '#16a34a' : '#f59e0b'}; border-radius: 8px; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; }
  .out-box .val { font-size: 16px; font-weight: bold; color: ${outstanding <= 0 ? '#16a34a' : '#f59e0b'}; }
  .footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 10px; color: #94a3b8; text-align: center; }
</style></head><body>
<div class="header">
  <h1>🚛 Transport Payment Voucher</h1>
  <p>${transporter.name}</p>
</div>
<div class="meta">
  <div class="meta-item"><div class="label">Vehicle No.</div><div class="value">${vehicle.reg_number}</div></div>
  <div class="meta-item"><div class="label">Owner</div><div class="value">${vehicle.owner_name}</div></div>
  <div class="meta-item"><div class="label">Bill Period</div><div class="value">${monthLabel(month)}</div></div>
  <div class="meta-item"><div class="label">Total Tonnes</div><div class="value">${settlement.totalTonnes} MT</div></div>
</div>
<div class="section">① Weight Earnings</div>
<table>
  <tr><th>Route</th><th style="text-align:right">Tonnes</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr>
  ${tripRows || '<tr><td colspan="4" style="color:#94a3b8">No trips this month</td></tr>'}
  <tr class="total-row"><td>GROSS EARNING</td><td></td><td></td><td class="num">${fmt(settlement.gross)}</td></tr>
</table>
<div class="section">② Deductions</div>
<table>
  <tr><th>Description</th><th></th><th></th><th style="text-align:right">Amount</th></tr>
  <tr><td>TDS @ 1%</td><td></td><td></td><td class="num debit">− ${fmt(settlement.tds)}</td></tr>
  <tr><td>Commission (${settlement.totalTonnes}T × ₹${transporter.commission_rate})</td><td></td><td></td><td class="num debit">− ${fmt(settlement.commission)}</td></tr>
  <tr><td>Accidental (${settlement.totalTonnes}T × ₹${transporter.accidental_rate})</td><td></td><td></td><td class="num debit">− ${fmt(settlement.accidental)}</td></tr>
</table>
<div class="section">⛽ Diesel</div>
<table>
  <tr><th>Date</th><th style="text-align:right">Litres</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr>
  ${dieselRows || '<tr><td colspan="4" style="color:#94a3b8">No diesel this month</td></tr>'}
  <tr class="total-row"><td>DIESEL TOTAL</td><td></td><td></td><td class="num debit">− ${fmt(settlement.dieselTotal)}</td></tr>
</table>
${gst.length ? `<div class="section">③ GST Received</div><table><tr><th>Description</th><th></th><th></th><th style="text-align:right">Amount</th></tr>${gstRows}<tr class="total-row"><td>NET GST ADDED</td><td></td><td></td><td class="num credit">+ ${fmt(settlement.netGST)}</td></tr></table>` : ''}
${others.length ? `<div class="section">④ Other Deductions</div><table><tr><th>Description</th><th></th><th></th><th style="text-align:right">Amount</th></tr>${otherRows}</table>` : ''}
<div class="net-box">
  <div><div class="lbl">Net Payable to Vehicle Owner</div><div style="font-size:10px;opacity:0.7;margin-top:2px">${monthLabel(month)}</div></div>
  <div class="val">${fmt(settlement.netPayable)}</div>
</div>
<div class="out-box">
  <div><div style="font-size:11px;color:#64748b;text-transform:uppercase">Outstanding</div><div style="font-size:10px;color:#94a3b8;margin-top:2px">Paid: ${fmt(totalPaid)}</div></div>
  <div class="val">${outstanding <= 0 ? '✓ PAID' : fmt(outstanding)}</div>
</div>
<div class="footer">Generated by TransportLedger · ${new Date().toLocaleDateString('en-IN')} · ${transporter.name}</div>
</body></html>`;

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
