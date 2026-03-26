import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { fmt, fmtDate, monthLabel, round2 } from '../constants/defaults';
import { supabase } from './supabase';
import { calculateSettlement } from './calculations';
import type { Vehicle, TransportOwner, TripEntry, DieselLog, GSTEntry, OtherDeduction, SettlementResult, GlobalSettings } from '../types';

// ─── SHARED CSS ────────────────────────────────────────────────────────────────
const BASE_CSS = `
  @page { size: A4; margin: 5mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 11.5px;
    color: #1a1a1a;
    background: #fff;
    padding: 10px 14px;
  }

  /* ── PAGE HEADER ── */
  .page-title {
    font-size: 22px;
    font-weight: 800;
    color: #db2777;
    margin-bottom: 2px;
  }
  .page-subtitle {
    font-size: 10px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 10px;
  }
  .page-meta-right {
    position: absolute;
    top: 32px;
    right: 36px;
    text-align: right;
  }
  .page-meta-right .label {
    font-size: 10px;
    font-weight: 700;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .page-meta-right .value {
    font-size: 11px;
    color: #555;
  }
  .pink-rule {
    border: none;
    border-top: 2px solid #db2777;
    margin: 8px 0 12px;
  }

  /* ── SUMMARY STRIP ── */
  .summary-strip {
    display: flex;
    background: #fdf2f8;
    border: 1px solid #f9c8e0;
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .summary-cell {
    flex: 1;
    padding: 8px 14px;
    border-right: 1px solid #f9c8e0;
  }
  .summary-cell:last-child { border-right: none; }
  .summary-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #db2777;
    margin-bottom: 4px;
  }
  .summary-value {
    font-size: 15px;
    font-weight: 800;
    color: #1a1a1a;
  }

  /* ── SECTION HEADER ── */
  .section-hdr {
    font-size: 10px;
    font-weight: 800;
    color: #db2777;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin: 14px 0 5px;
  }

  /* ── TABLES ── */
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: #fff; }
  th {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #999;
    padding: 7px 10px;
    border-bottom: 1.5px solid #e5e7eb;
    text-align: left;
  }
  th.right { text-align: right; }
  .td-left {
    padding: 5px 8px;
    border-bottom: 1px solid #f3f4f6;
    color: #333;
    font-size: 11px;
  }
  .td-right {
    padding: 5px 8px;
    border-bottom: 1px solid #f3f4f6;
    text-align: right;
    color: #333;
    font-size: 11px;
  }
  .td-dash {
    padding: 5px 8px;
    border-bottom: 1px solid #f3f4f6;
    text-align: right;
    color: #bbb;
    font-size: 11px;
  }
  .amount { font-weight: 700; }
  .debit { color: #e11d48; font-weight: 600; }
  .credit { color: #059669; font-weight: 700; }
  tr.total-row td {
    font-weight: 800;
    font-size: 11px;
    padding: 6px 8px;
    border-top: 1.5px solid #e5e7eb;
    border-bottom: none;
    background: #fff;
  }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }

  /* ── NET PAYABLE BOX ── */
  .net-payable-box {
    background: #db2777;
    border-radius: 8px;
    padding: 18px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 22px;
    page-break-inside: avoid;
  }
  .net-payable-box .lbl {
    font-size: 11px;
    font-weight: 800;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .net-payable-box .sub {
    font-size: 10px;
    color: rgba(255,255,255,0.7);
    margin-top: 3px;
  }
  .net-payable-box .val {
    font-size: 28px;
    font-weight: 900;
    color: #fff;
  }

  /* ── SETTLEMENT BOX ── */
  .settlement-box {
    border: 1.5px solid #fbbf24;
    border-radius: 8px;
    padding: 14px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 12px;
    page-break-inside: avoid;
  }
  .settlement-box .lbl {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #92400e;
  }
  .settlement-box .sub {
    font-size: 10px;
    color: #888;
    margin-top: 3px;
  }
  .settlement-box .val {
    font-size: 17px;
    font-weight: 800;
    color: #b45309;
  }
  .settlement-box .val.cleared {
    color: #059669;
    font-size: 14px;
  }

  /* ── FOOTER ── */
  .doc-footer {
    margin-top: 24px;
    text-align: center;
    font-size: 10px;
    color: #bbb;
    font-style: italic;
    border-top: 1px solid #f3f4f6;
    padding-top: 8px;
  }
`;

const DIESEL_EXTRA_CSS = `
  table { font-size: 10px; }
  .td-left, .td-right, .td-dash, tr.total-row td { font-size: 10px; padding: 4px 6px; }
  .summary-value { font-size: 13px; }
  .section-hdr { margin: 8px 0 3px; }
  .pink-rule { margin: 6px 0 10px; }
  .summary-strip { margin-bottom: 12px; }
  .doc-footer { margin-top: 16px; }
`;

const VOUCHER_EXTRA_CSS = `
  table { font-size: 10.5px; }
  .td-left, .td-right, .td-dash, tr.total-row td { font-size: 10.5px; padding: 4px 8px; }
  .net-payable-box { padding: 12px 16px; margin-top: 14px; }
  .net-payable-box .val { font-size: 22px; }
  .settlement-box { padding: 10px 16px; margin-top: 8px; }
  .section-hdr { margin: 12px 0 4px; }
  .pink-rule { margin: 6px 0 10px; }
  .summary-strip { margin-bottom: 12px; }
  .doc-footer { margin-top: 16px; }
`;

// ─── SHARED HELPERS ────────────────────────────────────────────────────────────
function wrapHtml(styleExtra: string, body: string): string {
  return `<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
    <style>${BASE_CSS}${styleExtra}</style>
  </head><body style="position:relative;">${body}</body></html>`;
}

function docFooter(extra?: string): string {
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'numeric', year: 'numeric' });
  return `<div class="doc-footer">
    This is a system-generated document and does not require a physical signature.<br/>
    TransportLedger Management System${extra ? ' · ' + extra : ''}
  </div>`;
}

async function sharePdf(html: string, fileName: string): Promise<void> {
  const fileUri = FileSystem.cacheDirectory + fileName;
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await FileSystem.moveAsync({ from: uri, to: fileUri });
  await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}

// ─── VOUCHER PDF ───────────────────────────────────────────────────────────────
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
  settings: GlobalSettings;
  commission_rate: number;
  accidental_rate: number;
}): Promise<void> {
  const { vehicle, transporter, month, trips, diesel, gst, others, settlement, totalPaid, settings, commission_rate, accidental_rate } = params;
  const outstanding = round2(settlement.netPayable - totalPaid);

  const tripRows = trips.map(t =>
    `<tr>
      <td class="td-left">${t.route_name ?? 'Route'}</td>
      <td class="td-right">${t.tonnes} T</td>
      <td class="td-right">₹${t.rate_snapshot}/T</td>
      <td class="td-right amount credit">${fmt(t.amount)}</td>
    </tr>`
  ).join('');

  const dieselRows = diesel.map(d =>
    `<tr>
      <td class="td-left">Diesel — ${fmtDate(d.date)}</td>
      <td class="td-right">${d.litres} L</td>
      <td class="td-right">₹${d.sell_rate}/L</td>
      <td class="td-right debit">− ${fmt(d.amount)}</td>
    </tr>`
  ).join('');

  const gstRows = gst.map(g =>
    `<tr>
      <td class="td-left">GST — ${monthLabel(g.belongs_to_month)}</td>
      <td class="td-right">${fmt(g.gross_gst)}</td>
      <td class="td-right debit">− ${fmt(g.commission_on_gst)}</td>
      <td class="td-right credit">+ ${fmt(g.net_gst)}</td>
    </tr>`
  ).join('');

  const otherRows = others.map(o =>
    `<tr>
      <td colspan="3" class="td-left">${o.label}</td>
      <td class="td-right debit">− ${fmt(o.amount)}</td>
    </tr>`
  ).join('');

  const body = `
    <!-- PAGE HEADER -->
    <div class="page-title">Transport Payment Voucher</div>
    <div class="page-subtitle">${transporter.name}</div>
    <div class="page-meta-right">
      <div class="label">Official Copy</div>
      <div class="value">Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'numeric', year: 'numeric' })}</div>
    </div>
    <hr class="pink-rule"/>

    <!-- META STRIP -->
    <div class="summary-strip">
      <div class="summary-cell">
        <div class="summary-label">Vehicle No.</div>
        <div class="summary-value">${vehicle.reg_number}</div>
      </div>
      <div class="summary-cell">
        <div class="summary-label">Owner Name</div>
        <div class="summary-value">${vehicle.owner_name}</div>
      </div>
      <div class="summary-cell">
        <div class="summary-label">Month</div>
        <div class="summary-value">${monthLabel(month)}</div>
      </div>
      <div class="summary-cell">
        <div class="summary-label">Tonnage</div>
        <div class="summary-value">${settlement.totalTonnes} MT</div>
      </div>
    </div>

    <!-- WEIGHT EARNINGS -->
    <div class="section-hdr">Weight Earnings</div>
    <table>
      <thead>
        <tr>
          <th>Route Details</th>
          <th class="right">Weight</th>
          <th class="right">Rate</th>
          <th class="right">Credit Amount</th>
        </tr>
      </thead>
      <tbody>
        ${tripRows || '<tr><td colspan="4" style="padding:16px 10px;text-align:center;color:#bbb;">No trip entries found</td></tr>'}
        <tr class="total-row">
          <td colspan="3"><strong>Gross Earnings</strong></td>
          <td style="text-align:right;"><strong>${fmt(settlement.gross)}</strong></td>
        </tr>
      </tbody>
    </table>

    <!-- FIXED & STATUTORY DEDUCTIONS -->
    <div class="section-hdr">Fixed &amp; Statutory Deductions</div>
    <table>
      <thead>
        <tr>
          <th>Deduction Head</th>
          <th class="right" colspan="3">Debit Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="td-left">TDS @ ${(settings.tds_rate * 100).toFixed(1)}% (Applies to Gross)</td>
          <td class="td-right debit" colspan="3">− ${fmt(settlement.tds)}</td>
        </tr>
        <tr>
          <td class="td-left">Commission Charge (₹${commission_rate}/MT)</td>
          <td class="td-right debit" colspan="3">− ${fmt(settlement.commission)}</td>
        </tr>
        <tr>
          <td class="td-left">Accidental Insurance (₹${accidental_rate}/MT)</td>
          <td class="td-right debit" colspan="3">− ${fmt(settlement.accidental)}</td>
        </tr>
      </tbody>
    </table>

    <!-- DIESEL DEDUCTIONS -->
    <div class="section-hdr">Diesel Deductions</div>
    <table>
      <thead>
        <tr>
          <th>Date / Description</th>
          <th class="right">Quantity</th>
          <th class="right">Rate</th>
          <th class="right">Debit Amount</th>
        </tr>
      </thead>
      <tbody>
        ${dieselRows || '<tr><td colspan="4" style="padding:16px 10px;text-align:center;color:#bbb;">No diesel records found</td></tr>'}
        <tr class="total-row">
          <td colspan="3"><strong>Diesel Total Deduction</strong></td>
          <td style="text-align:right;color:#e11d48;"><strong>− ${fmt(settlement.dieselTotal)}</strong></td>
        </tr>
      </tbody>
    </table>

    ${gst.length > 0 ? `
      <div class="section-hdr">GST Integration</div>
      <table>
        <thead>
          <tr>
            <th>GST Period</th>
            <th class="right">Gross Recv.</th>
            <th class="right">Commission</th>
            <th class="right">Net Credit</th>
          </tr>
        </thead>
        <tbody>
          ${gstRows}
          <tr class="total-row">
            <td colspan="3"><strong>Net GST Credit</strong></td>
            <td style="text-align:right;color:#059669;"><strong>+ ${fmt(settlement.netGST)}</strong></td>
          </tr>
        </tbody>
      </table>
    ` : ''}

    ${others.length > 0 ? `
      <div class="section-hdr">Other Deductions</div>
      <table>
        <thead><tr><th colspan="3">Description</th><th class="right">Debit Amount</th></tr></thead>
        <tbody>${otherRows}</tbody>
      </table>
    ` : ''}

    <!-- NET PAYABLE -->
    <div class="net-payable-box">
      <div>
        <div class="lbl">Total Net Payable for ${monthLabel(month)}</div>
        <div class="sub">Auto-calculated based on verified entries</div>
      </div>
      <div class="val">${fmt(settlement.netPayable)}</div>
    </div>

    <!-- SETTLEMENT STATUS -->
    <div class="settlement-box">
      <div>
        <div class="lbl">Settlement Status</div>
        <div class="sub">Total Cleared: ${fmt(totalPaid)}</div>
      </div>
      <div class="${outstanding <= 0 ? 'val cleared' : 'val'}">
        ${outstanding <= 0 ? '✓ SETTLED' : `PENDING: ${fmt(outstanding)}`}
      </div>
    </div>

    ${docFooter()}
  `;

  const html = wrapHtml(VOUCHER_EXTRA_CSS, body);
  const fileName = `Owner_${vehicle.reg_number.replace(/\s+/g, '')}_Voucher_${month}.pdf`;
  await sharePdf(html, fileName);
}

// ─── FETCH + GENERATE VOUCHER ──────────────────────────────────────────────────
export async function fetchAndGenerateVehiclePDF(
  vehicle: Vehicle,
  transporter: TransportOwner,
  month: string,
  settings: GlobalSettings,
  onProgress?: (msg: string) => void
): Promise<void> {
  if (onProgress) onProgress('15% Fetching records...');
  const [{ data: trips }, { data: diesel }, { data: gst }, { data: others }, { data: pmts }] = await Promise.all([
    supabase.from('trip_entries').select('tonnes,rate_snapshot,amount,routes(name)').eq('vehicle_id', vehicle.id).eq('month', month),
    supabase.from('diesel_logs').select('id,date,litres,sell_rate,amount,deleted_at').eq('vehicle_id', vehicle.id).eq('month', month),
    supabase.from('gst_entries').select('belongs_to_month,gross_gst,commission_on_gst,net_gst').eq('vehicle_id', vehicle.id).eq('belongs_to_month', month),
    supabase.from('other_deductions').select('label,amount').eq('vehicle_id', vehicle.id).eq('month', month),
    supabase.from('payments').select('amount').eq('vehicle_id', vehicle.id).eq('month', month),
  ]);

  if (onProgress) onProgress('60% Calculating settlement...');
  const activeDiesel = (diesel ?? []).filter(d => d.deleted_at === null);
  const effectiveCommissionRate = Number(vehicle.commission_rate ?? transporter.commission_rate ?? 0);
  const effectiveAccidentalRate = Number(vehicle.accidental_rate ?? transporter.accidental_rate ?? 0);

  const settlement = calculateSettlement({
    trips: trips ?? [],
    diesel: activeDiesel as any,
    commissionRate: effectiveCommissionRate,
    accidentalRate: effectiveAccidentalRate,
    tdsRate: settings.tds_rate,
    gstEntries: gst ?? [],
    otherDeductions: others ?? []
  });

  const totalPaid = round2((pmts ?? []).reduce((a, p) => a + Number(p.amount), 0));

  if (onProgress) onProgress('85% Generating PDF...');
  const mappedTrips = (trips ?? []).map((t: any) => ({ ...t, route_name: t.routes?.name })) as TripEntry[];

  await generateVehicleBillPDF({
    vehicle, transporter, month,
    trips: mappedTrips,
    diesel: activeDiesel as any,
    gst: gst ?? [] as any,
    others: others ?? [] as any,
    settlement, totalPaid, settings,
    commission_rate: effectiveCommissionRate,
    accidental_rate: effectiveAccidentalRate
  });
}

// ─── DIESEL PDF ────────────────────────────────────────────────────────────────
export async function fetchAndGenerateDieselPDF(
  transporter: TransportOwner,
  vehicles: Vehicle[],
  month: string,
  period?: 1 | 2,
  onProgress?: (msg: string) => void
): Promise<void> {
  if (onProgress) onProgress('20% Fetching diesel logs...');

  let query = supabase.from('diesel_logs')
    .select('*, vehicle:vehicles(reg_number)')
    .eq('month', month)
    .is('deleted_at', null);

  if (period) query = query.eq('fortnight', period);
  if (vehicles.length === 1) query = query.eq('vehicle_id', vehicles[0].id);
  else query = query.in('vehicle_id', vehicles.map(v => v.id));

  const { data: logs, error } = await query;
  if (error) throw error;

  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const dayStart = period === 2 ? 16 : 1;
  const dayEnd = period === 1 ? 15 : daysInMonth;

  if (onProgress) onProgress('50% Organizing data...');

  // Index logs by reg → date for O(1) lookup
  const logLookup: Record<string, Record<string, any>> = {};
  logs?.forEach(l => {
    const reg = (l as any).vehicle?.reg_number || 'Unknown';
    if (!logLookup[reg]) logLookup[reg] = {};
    logLookup[reg][l.date.split('T')[0]] = l;
  });

  let grandTotalLitres = 0;
  let grandTotalAmount = 0;

  // Multi-vehicle: one table per vehicle with its own header row
  // Single vehicle: flat date table matching screenshot exactly
  const isSingle = vehicles.length === 1;

  // Build all vehicle reg columns for the header (multi-vehicle mode)
  const vehicleRegs = vehicles.map(v => v.reg_number);

  let tableBody = '';

  if (isSingle) {
    // Single vehicle — DATE | VEHICLE_REG | TOTAL LTR | AMOUNT (matches screenshot)
    const v = vehicles[0];
    const vLogs = logLookup[v.reg_number] || {};
    const rowParts: string[] = [];

    for (let day = dayStart; day <= dayEnd; day++) {
      const dateStr = `${month}-${String(day).padStart(2, '0')}`;
      const log = vLogs[dateStr];
      const amt = log ? Number(log.amount) : 0;
      const ltr = log ? Number(log.litres) : 0;
      grandTotalLitres += ltr;
      grandTotalAmount += amt;

      rowParts.push(`<tr>
        <td class="td-left">${fmtDate(dateStr)}</td>
        <td class="${log ? 'td-right' : 'td-dash'}">${log ? log.litres : '-'}</td>
        <td class="${log ? 'td-right amount' : 'td-dash'}">${ltr ? ltr.toFixed(1) : '-'}</td>
        <td class="${log ? 'td-right amount' : 'td-dash'}">${amt ? fmt(amt) : '₹0.00'}</td>
      </tr>`);
    }

    tableBody = `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th class="right">${v.reg_number}</th>
            <th class="right">Total Ltr</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowParts.join('')}
          <tr class="total-row">
            <td><strong>TOTAL</strong></td>
            <td style="text-align:right;"><strong>${grandTotalLitres.toFixed(1)}</strong></td>
            <td style="text-align:right;"><strong>${grandTotalLitres.toFixed(1)}</strong></td>
            <td style="text-align:right;"><strong>${fmt(grandTotalAmount)}</strong></td>
          </tr>
        </tbody>
      </table>
    `;
  } else {
    // Multi-vehicle — DATE | V1 | V2 | ... | TOTAL LTR | AMOUNT
    const rowParts: string[] = [];
    const vehicleTotals: Record<string, number> = {};
    vehicleRegs.forEach(r => { vehicleTotals[r] = 0; });

    for (let day = dayStart; day <= dayEnd; day++) {
      const dateStr = `${month}-${String(day).padStart(2, '0')}`;
      let rowLitres = 0;
      let rowAmount = 0;

      const vCells = vehicleRegs.map(reg => {
        const log = logLookup[reg]?.[dateStr];
        const ltr = log ? Number(log.litres) : 0;
        vehicleTotals[reg] += ltr;
        rowLitres += ltr;
        return `<td class="${log ? 'td-right' : 'td-dash'}">${ltr ? ltr.toFixed(1) : '-'}</td>`;
      }).join('');

      // amount is sum of all vehicle amounts on this day
      vehicles.forEach(v => {
        const log = logLookup[v.reg_number]?.[dateStr];
        if (log) rowAmount += Number(log.amount);
      });

      grandTotalLitres += rowLitres;
      grandTotalAmount += rowAmount;

      rowParts.push(`<tr>
        <td class="td-left">${fmtDate(dateStr)}</td>
        ${vCells}
        <td class="${rowLitres ? 'td-right amount' : 'td-dash'}">${rowLitres ? rowLitres.toFixed(1) : '-'}</td>
        <td class="${rowAmount ? 'td-right amount' : 'td-dash'}">${rowAmount ? fmt(rowAmount) : '₹0.00'}</td>
      </tr>`);
    }

    const vHeaders = vehicleRegs.map(r => `<th class="right">${r}</th>`).join('');
    const vTotalCells = vehicleRegs.map(r => `<td style="text-align:right;"><strong>${vehicleTotals[r].toFixed(1)}</strong></td>`).join('');

    tableBody = `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            ${vHeaders}
            <th class="right">Total Ltr</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowParts.join('')}
          <tr class="total-row">
            <td><strong>TOTAL</strong></td>
            ${vTotalCells}
            <td style="text-align:right;"><strong>${grandTotalLitres.toFixed(1)}</strong></td>
            <td style="text-align:right;"><strong>${fmt(grandTotalAmount)}</strong></td>
          </tr>
        </tbody>
      </table>
    `;
  }

  const periodLabel = period ? ` (Fortnight ${period})` : '';
  const rateNote = logs && logs.length > 0 ? `Rate applied: ₹${(logs[0] as any).sell_rate}/L` : '';
  const genDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'numeric', year: 'numeric' });

  const body = `
    <!-- PAGE HEADER -->
    <div class="page-title">Diesel Tracking Report — ${monthLabel(month).toUpperCase()}</div>
    <div class="page-subtitle">${transporter.name}</div>
    <hr class="pink-rule"/>

    <!-- SUMMARY STRIP -->
    <div class="summary-strip">
      <div class="summary-cell">
        <div class="summary-label">Period</div>
        <div class="summary-value">${period ? `Fortnight ${period}` : 'Full Month'}</div>
      </div>
      <div class="summary-cell">
        <div class="summary-label">Total Consumption</div>
        <div class="summary-value">${grandTotalLitres.toFixed(1)} Litres</div>
      </div>
      <div class="summary-cell">
        <div class="summary-label">Total Amount</div>
        <div class="summary-value">${fmt(grandTotalAmount)}</div>
      </div>
    </div>

    <!-- DATA TABLE -->
    ${tableBody}

    <!-- FOOTER -->
    <div class="doc-footer">
      Generated by TransportLedger · ${genDate}${rateNote ? ' · (' + rateNote + ')' : ''}
    </div>
  `;

  if (onProgress) onProgress('90% Sharing PDF...');
  const label = vehicles.length === 1 ? vehicles[0].reg_number.replace(/\s+/g, '') : 'ALL';
  const fileName = `Owner_${label}_DIESEL_${month}_${period ? `F${period}` : 'FULL'}.pdf`;
  const html = wrapHtml(DIESEL_EXTRA_CSS, body);
  await sharePdf(html, fileName);
}