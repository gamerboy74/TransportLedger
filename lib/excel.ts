// lib/excel.ts — xlsx-js-style exports matching exact file formats
import * as XLSX from 'xlsx-js-style';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';
import { round2, BUY_RATE, fmtDate, monthLabel } from '../constants/defaults';
import type { TransportOwner, Vehicle } from '../types';

type ProgressCallback = (message: string) => void;

// ─── Style helpers ────────────────────────────────────────────

type S = {
  bold?: boolean;
  bg?: string;      // RRGGBB (no alpha prefix)
  fg?: string;      // RRGGBB
  sz?: number;
  align?: 'center' | 'left' | 'right';
  wrap?: boolean;
  fmt?: string;
  italic?: boolean;
};

function s(v: any, style: S = {}, t?: string): any {
  const cell: any = {};
  if (v === null || v === undefined || v === '') {
    cell.t = 's'; cell.v = '';
  } else if (typeof v === 'number') {
    cell.t = 'n'; cell.v = v;
  } else {
    cell.t = 's'; cell.v = String(v);
  }
  if (t) cell.t = t;

  const st: any = {};

  // Font
  const font: any = { name: 'Arial', sz: style.sz ?? 10 };
  if (style.bold)   font.bold = true;
  if (style.italic) font.italic = true;
  if (style.fg)     font.color = { rgb: style.fg };
  st.font = font;

  // Fill
  if (style.bg) st.fill = { patternType: 'solid', fgColor: { rgb: style.bg } };

  // Alignment
  const align: any = { vertical: 'center' };
  if (style.align) align.horizontal = style.align;
  if (style.wrap)  align.wrapText = true;
  st.alignment = align;

  // Number format
  if (style.fmt) st.numFmt = style.fmt;

  // Thin border on all cells
  const thin = { style: 'thin', color: { rgb: 'D0D0D0' } };
  st.border = { top: thin, bottom: thin, left: thin, right: thin };

  cell.s = st;
  return cell;
}

function empty(bg?: string): any {
  return s('', { bg });
}

// Set a cell by 1-based row/col
function sc(ws: XLSX.WorkSheet, row: number, col: number, cell: any) {
  const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  ws[ref] = cell;
  // Expand !ref
  if (!ws['!ref']) {
    ws['!ref'] = `A1:${ref}`;
  } else {
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (row - 1 > range.e.r) range.e.r = row - 1;
    if (col - 1 > range.e.c) range.e.c = col - 1;
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
}

function merge(ws: XLSX.WorkSheet, r1: number, c1: number, r2: number, c2: number) {
  if (!ws['!merges']) ws['!merges'] = [];
  ws['!merges'].push({ s: { r: r1 - 1, c: c1 - 1 }, e: { r: r2 - 1, c: c2 - 1 } });
}

// ─── Share helper ─────────────────────────────────────────────

async function shareWb(wb: XLSX.WorkBook, fileName: string) {
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const path = FileSystem.documentDirectory + fileName;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(path, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: `Share ${fileName}`,
  });
}

function emitProgress(cb: ProgressCallback | undefined, msg: string) { if (cb) cb(msg); }

function assertMonth(m: string) {
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('Invalid month format. Use YYYY-MM.');
  const n = Number(m.split('-')[1]);
  if (n < 1 || n > 12) throw new Error('Invalid month value.');
}

function resolvePeriod(yom: string) {
  if (/^\d{4}-\d{2}$/.test(yom)) {
    assertMonth(yom);
    const [year, mp] = yom.split('-');
    return { year, monthIndexes: [Number(mp) - 1], periodLabel: monthLabel(yom), suffix: yom };
  }
  if (!/^\d{4}$/.test(yom)) throw new Error('Invalid period. Use YYYY or YYYY-MM.');
  return { year: yom, monthIndexes: Array.from({ length: 12 }, (_, i) => i), periodLabel: yom, suffix: yom };
}

// ─── EXPORT A: Diesel Tracking Sheet ──────────────────────────
// Exact match: SUSHIL_BHAGAT_DIESEL.xlsx

export async function exportDieselSheet(
  transporter: TransportOwner,
  vehicles: Vehicle[],
  month: string,
  fortnight?: 1 | 2,
  onProgress?: ProgressCallback,
): Promise<void> {
  assertMonth(month);
  emitProgress(onProgress, '15% Fetching diesel logs...');

  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const dayStart    = fortnight === 2 ? 16 : 1;
  const dayEnd      = fortnight === 1 ? 15 : daysInMonth;
  const monLabel    = monthLabel(month).replace(' ', '-').toUpperCase(); // e.g. MAR-2026

  const vehicleIds  = vehicles.map(v => v.id);
  const dieselMap: Record<string, Record<string, number>> = {};
  for (const id of vehicleIds) dieselMap[id] = {};

  if (vehicleIds.length) {
    const { data } = await supabase
      .from('diesel_logs').select('vehicle_id,date,litres,fortnight')
      .in('vehicle_id', vehicleIds).eq('month', month).is('deleted_at', null);
    for (const log of (data ?? []).filter((l: any) => !fortnight || Number(l.fortnight) === fortnight)) {
      dieselMap[log.vehicle_id][log.date.toString().split('T')[0]] = Number(log.litres);
    }
  }

  emitProgress(onProgress, '70% Building sheet...');

  const ws: XLSX.WorkSheet = { '!ref': 'A1:A1' };
  const nv   = vehicles.length;
  const totalCols = nv + 8; // A=date, B..nv+1=vehicles, +TOTAL HSD, RATE, AMOUNT, DEP DATE, MODE, DEPOSIT, NET BAL

  // Col indices (1-based)
  const cHSD  = nv + 2;  // TOTAL HSD
  const cRATE = nv + 3;
  const cAMT  = nv + 4;
  const cDDATE= nv + 5;
  const cMODE = nv + 6;
  const cDEP  = nv + 7;
  const cBAL  = nv + 8;

  // Row 1: MONTH label at last two cols (dynamic based on vehicle count)
  for (let c = 1; c <= totalCols; c++) sc(ws, 1, c, empty());
  sc(ws, 1, cBAL - 1, s(`MONTH:- ${monLabel}`, { bold: true, bg: 'FFC000', fg: '000000', sz: 11, align: 'center' }));
  merge(ws, 1, cBAL - 1, 1, cBAL);

  // Row 2: Title (merged full width)
  sc(ws, 2, 1, s(`(DUMKA) ${transporter.name.toUpperCase()} TRANSPORT`, { bold: true, bg: '92D050', fg: '000000', sz: 16, align: 'center' }));
  for (let c = 2; c <= totalCols; c++) sc(ws, 2, c, empty('92D050'));
  merge(ws, 2, 1, 2, totalCols);

  // Row 3: empty green bar
  for (let c = 1; c <= totalCols; c++) sc(ws, 3, c, empty('92D050'));
  merge(ws, 3, 1, 3, totalCols);

  // Row 4: Headers — dark green bg, white bold text
  const hStyle: S = { bold: true, bg: '1F6B1F', fg: 'FFFFFF', align: 'center', wrap: true, sz: 10 };
  sc(ws, 4, 1,     s('VEHICAL NO.', { ...hStyle, sz: 14 }));
  vehicles.forEach((v, i) => sc(ws, 4, 2 + i, s(v.reg_number, { ...hStyle, sz: 8 })));
  sc(ws, 4, cHSD,   s('TOTAL\n(H.S.D)', { ...hStyle, sz: 9 }));
  sc(ws, 4, cRATE,  s('RATE',           { ...hStyle, sz: 7 }));
  sc(ws, 4, cAMT,   s('AMOUNT',         { ...hStyle, sz: 10 }));
  sc(ws, 4, cDDATE, s('DEPOSIT DATE',   { ...hStyle, sz: 12 }));
  sc(ws, 4, cMODE,  s('PAYMENT\nMODE',  { ...hStyle, sz: 9 }));
  sc(ws, 4, cDEP,   s('DEPOSIT',        { ...hStyle, sz: 12 }));
  sc(ws, 4, cBAL,   s('NET BALANCE',    { ...hStyle, sz: 12 }));

  // Row 5: DATE label + yellow merged cell for deposit area
  sc(ws, 5, 1, s('DATE', { bold: true, bg: '1F6B1F', fg: 'FFFFFF', align: 'center', sz: 10 }));
  for (let c = 2; c <= totalCols; c++) sc(ws, 5, c, empty());
  // Yellow merged area (J5:L5) — the deposit date/mode/deposit columns
  sc(ws, 5, cDDATE, s('', { bg: 'FFFF00' }));
  merge(ws, 5, cDDATE, 5, cDEP);

  // Data rows
  const colTotals = new Array(nv).fill(0);
  let runningBalance = 0;
  let totalAmount    = 0;
  const dataStyle:  S = { fg: '000000', sz: 10, align: 'center', fmt: '0.00' };
  const amtStyle:   S = { fg: '000000', sz: 10, align: 'center', fmt: '#,##0.00' };
  const balStyle:   S = { fg: '000000', sz: 10, align: 'center', fmt: '"₹ "#,##0.00' };
  const hsdStyle:   S = { bold: true, fg: 'FF0000', sz: 10, align: 'center', fmt: '0.00' };
  const dateStyle:  S = { bold: true, fg: '000000', sz: 10, align: 'center' };

  let dataRow = 6;
  for (let day = dayStart; day <= dayEnd; day++) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    sc(ws, dataRow, 1, s(fmtDate(dateStr), dateStyle));
    let totalHSD = 0;
    vehicles.forEach((v, i) => {
      const litres = dieselMap[v.id]?.[dateStr] ?? 0;
      colTotals[i] = round2(colTotals[i] + litres);
      totalHSD += litres;
      sc(ws, dataRow, 2 + i, s(litres, dataStyle));
    });
    totalHSD = round2(totalHSD);
    const amount = round2(totalHSD * BUY_RATE);
    totalAmount    = round2(totalAmount + amount);
    runningBalance = round2(runningBalance + amount);

    sc(ws, dataRow, cHSD,   s(totalHSD,        hsdStyle));
    sc(ws, dataRow, cRATE,  s(BUY_RATE,        dataStyle));
    sc(ws, dataRow, cAMT,   s(amount,          amtStyle));
    sc(ws, dataRow, cDDATE, empty());
    sc(ws, dataRow, cMODE,  empty());
    sc(ws, dataRow, cDEP,   empty());
    sc(ws, dataRow, cBAL,   s(runningBalance,  balStyle));
    dataRow++;
  }

  // TOTAL row — magenta label, amber cells
  const lastData = dataRow - 1;
  const totStyle: S = { bold: true, bg: 'FFC000', fg: '000000', sz: 10, align: 'center', fmt: '#,##0.00' };
  sc(ws, dataRow, 1, s('TOTAL-', { bold: true, bg: 'FF00FF', fg: '000000', sz: 10, align: 'center' }));
  vehicles.forEach((_, i) => sc(ws, dataRow, 2 + i, s(round2(colTotals[i]), totStyle)));
  sc(ws, dataRow, cHSD,   s(round2(colTotals.reduce((a, b) => a + b, 0)), totStyle));
  sc(ws, dataRow, cRATE,  empty('FFC000'));
  sc(ws, dataRow, cAMT,   s(totalAmount, totStyle));
  sc(ws, dataRow, cDDATE, empty('FFC000'));
  sc(ws, dataRow, cMODE,  empty('FFC000'));
  sc(ws, dataRow, cDEP,   s(0, { ...totStyle, fmt: '"₹ "0.00' }));
  sc(ws, dataRow, cBAL,   s(runningBalance, { ...totStyle, fmt: '"₹ "#,##0.00' }));

  // Column widths
  ws['!cols'] = [
    { wch: 14 },
    ...new Array(nv).fill(null).map(() => ({ wch: 9 })),
    { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 16 },
  ];

  // Row heights
  ws['!rows'] = [
    { hpt: 15 }, { hpt: 19.5 }, { hpt: 15 }, { hpt: 30 }, { hpt: 19.5 },
    ...new Array(dayEnd - dayStart + 2).fill({ hpt: 15 }),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, monLabel);

  const periodLabel = fortnight ? (fortnight === 1 ? '1-15' : `16-${daysInMonth}`) : `1-${daysInMonth}`;
  emitProgress(onProgress, '95% Opening share dialog...');
  await shareWb(wb, `${transporter.name.replace(/\s+/g, '_')}_DIESEL_${monLabel}_${periodLabel}.xlsx`);
}

// ─── EXPORT B: Transporter Payment Ledger ─────────────────────
// Exact match: Sushil_Kumar_Bhagat.xlsx

export async function exportTransporterLedger(
  transporter: TransportOwner,
  vehicles: Vehicle[],
  yearOrMonth: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const { year, monthIndexes, suffix } = resolvePeriod(yearOrMonth);
  const wb = XLSX.utils.book_new();

  emitProgress(onProgress, '10% Fetching ledger data...');

  const monthlyData: any[] = [];
  for (let idx = 0; idx < monthIndexes.length; idx++) {
    const mi = monthIndexes[idx];
    const monthStr = `${year}-${String(mi + 1).padStart(2, '0')}`;
    const progress = Math.round(10 + ((idx + 1) / monthIndexes.length) * 55);
    emitProgress(onProgress, `${progress}% Loading ${MONTHS[mi]} data...`);
    const [{ data: incData }, { data: pmtData }] = await Promise.all([
      supabase.from('transport_income').select('transport_payment,diesel_payment')
        .eq('transport_owner_id', transporter.id).eq('month', monthStr).maybeSingle(),
      supabase.from('payments').select('date,paid_to,vehicle_id,note,amount,mode,reference')
        .eq('transport_owner_id', transporter.id).eq('month', monthStr).order('date'),
    ]);
    const tp   = Number(incData?.transport_payment ?? 0);
    const dp   = Number(incData?.diesel_payment ?? 0);
    const paid = round2((pmtData ?? []).reduce((a: number, p: any) => a + Number(p.amount), 0));
    monthlyData.push({ mi, monthStr, monthName: `${MONTHS[mi]} ${year}`, tp, dp, total: round2(tp + dp), paid, bal: round2(tp + dp - paid), pmtData: pmtData ?? [] });
  }
  const regById = new Map(vehicles.map(v => [v.id, v.reg_number]));

  // ── Annual Summary sheet ──
  emitProgress(onProgress, '70% Building summary sheet...');
  const sumWs: XLSX.WorkSheet = { '!ref': 'A1:A1' };

  const NAVY   = '1F3864';
  const DKGRN  = '1E6B3C';
  const LBLUE  = 'D9E1F2';
  const EBBLUE = 'EBF3FF';
  const LTGRN  = 'E2EFDA';
  const SALMON = 'FCE4D6';
  const STRIPE = 'F5F7FF';

  // A1: name header
  sc(sumWs, 1, 1, s(transporter.name, { bold: true, bg: NAVY, fg: 'FFFFFF', sz: 13, align: 'center' }));
  for (let c = 2; c <= 8; c++) sc(sumWs, 1, c, empty(NAVY));
  merge(sumWs, 1, 1, 1, 8);

  // A2: subtitle
  sc(sumWs, 2, 1, s(`Annual Summary — Jan ${year} to Dec ${year}`, { bold: true, bg: 'F0F0F0', fg: '333333', align: 'center' }));
  for (let c = 2; c <= 8; c++) sc(sumWs, 2, c, empty('F0F0F0'));
  merge(sumWs, 2, 1, 2, 8);

  // Row 4: section header
  sc(sumWs, 4, 1, s('  📊  MONTH-BY-MONTH SUMMARY', { bold: true, bg: NAVY, fg: 'FFFFFF' }));
  for (let c = 2; c <= 8; c++) sc(sumWs, 4, c, empty(NAVY));
  merge(sumWs, 4, 1, 4, 8);

  // Row 5: column headers
  ['Month', 'Transport Pay (₹)', 'Diesel Pay (₹)', 'Total Income (₹)', 'Total Paid Out (₹)', 'Balance (₹)']
    .forEach((h, i) => sc(sumWs, 5, i + 1, s(h, { bold: true, bg: LBLUE, align: 'center' })));

  // Month rows
  let gTP = 0, gDP = 0, gTotal = 0, gPaid = 0, gBal = 0;
  for (let mi = 0; mi < 12; mi++) {
    const md   = monthlyData.find(m => m.mi === mi);
    const tp   = md?.tp    ?? 0;
    const dp   = md?.dp    ?? 0;
    const tot  = md?.total ?? 0;
    const paid = md?.paid  ?? 0;
    const bal  = md?.bal   ?? 0;
    gTP += tp; gDP += dp; gTotal += tot; gPaid += paid; gBal += bal;
    const row = 6 + mi;
    const bg  = mi % 2 === 0 ? 'FFFFFF' : STRIPE;
    sc(sumWs, row, 1, s(`${MONTHS[mi]} ${year}`, { bold: true, bg, align: 'left' }));
    sc(sumWs, row, 2, s(tp,   { bold: true, bg: EBBLUE, fg: '006400', align: 'right', fmt: '#,##0.00' }));
    sc(sumWs, row, 3, s(dp,   { bold: true, bg: EBBLUE, fg: '0000CD', align: 'right', fmt: '#,##0.00' }));
    sc(sumWs, row, 4, s(tot,  { bold: true, bg: LTGRN,  align: 'right', fmt: '#,##0.00' }));
    sc(sumWs, row, 5, s(paid, { bold: true, bg: SALMON, fg: 'C00000', align: 'right', fmt: '#,##0.00' }));
    sc(sumWs, row, 6, s(bal,  { bold: true, bg: NAVY, fg: 'FFFFFF', align: 'right', fmt: '#,##0.00' }));
  }

  // Grand total row 18
  sc(sumWs, 18, 1, s('GRAND TOTAL', { bold: true, bg: NAVY, fg: 'FFFFFF' }));
  sc(sumWs, 18, 2, s(round2(gTP),    { bold: true, bg: NAVY, fg: 'FFFFFF', fmt: '#,##0.00' }));
  sc(sumWs, 18, 3, s(round2(gDP),    { bold: true, bg: NAVY, fg: 'FFFFFF', fmt: '#,##0.00' }));
  sc(sumWs, 18, 4, s(round2(gTotal), { bold: true, bg: NAVY, fg: 'FFFFFF', fmt: '#,##0.00' }));
  sc(sumWs, 18, 5, s(round2(gPaid),  { bold: true, bg: NAVY, fg: 'FFFFFF', fmt: '#,##0.00' }));
  sc(sumWs, 18, 6, s(round2(gBal),   { bold: true, bg: DKGRN, fg: 'FFFFFF', fmt: '#,##0.00' }));

  // Vehicles section row 20
  sc(sumWs, 20, 1, s('  🚗  REGISTERED VEHICLES', { bold: true, bg: NAVY, fg: 'FFFFFF' }));
  for (let c = 2; c <= 8; c++) sc(sumWs, 20, c, empty(NAVY));
  merge(sumWs, 20, 1, 20, 8);
  ['#', 'Vehicle Number', 'Driver / Owner Name', 'Notes'].forEach((h, i) =>
    sc(sumWs, 21, i + 1, s(h, { bold: true, bg: LBLUE }))
  );
  vehicles.forEach((v, i) => {
    const row = 22 + i;
    const bg  = i % 2 === 0 ? 'FFFFFF' : STRIPE;
    sc(sumWs, row, 1, s(i + 1,        { bold: true, bg }));
    sc(sumWs, row, 2, s(v.reg_number, { bold: true, bg: EBBLUE, fg: NAVY }));
    sc(sumWs, row, 3, s(v.owner_name, { bg: EBBLUE }));
    merge(sumWs, row, 2, row, 3);
  });

  sumWs['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 5 }, { wch: 5 }];
  XLSX.utils.book_append_sheet(wb, sumWs, 'Annual Summary');

  // ── Monthly sheets ──
  emitProgress(onProgress, '80% Building monthly sheets...');

  for (const md of monthlyData) {
    const ws: XLSX.WorkSheet = { '!ref': 'A1:A1' };
    const YELLOW = 'FFFF99';

    // A1 header
    sc(ws, 1, 1, s(transporter.name, { bold: true, bg: NAVY, fg: 'FFFFFF', sz: 13, align: 'center' }));
    for (let c = 2; c <= 8; c++) sc(ws, 1, c, empty(NAVY));
    merge(ws, 1, 1, 1, 8);

    // Row 2
    sc(ws, 2, 1, s('Month:', { bold: true, bg: LBLUE }));
    sc(ws, 2, 2, empty(LBLUE));
    sc(ws, 2, 3, empty(LBLUE));
    sc(ws, 2, 4, empty(LBLUE));
    sc(ws, 2, 5, s(md.monthName, { bold: true, bg: YELLOW, fg: 'C00000', align: 'center' }));
    sc(ws, 2, 6, empty(YELLOW));
    sc(ws, 2, 7, empty(YELLOW));
    sc(ws, 2, 8, empty(YELLOW));

    // Row 3: income section
    sc(ws, 3, 1, s('  💰  INCOME RECEIVED', { bold: true, bg: DKGRN, fg: 'FFFFFF' }));
    for (let c = 2; c <= 8; c++) sc(ws, 3, c, empty(DKGRN));
    merge(ws, 3, 1, 3, 8);

    // Row 4: income column headers
    sc(ws, 4, 1, s('Transport Payment (₹)', { bold: true, bg: LBLUE })); merge(ws, 4, 1, 4, 2);
    sc(ws, 4, 3, s('Diesel Payment (₹)',    { bold: true, bg: LBLUE })); merge(ws, 4, 3, 4, 4);
    sc(ws, 4, 5, s('Total Income (₹)',      { bold: true, bg: LBLUE })); merge(ws, 4, 5, 4, 6);
    sc(ws, 4, 7, s('Balance Remaining (₹)', { bold: true, bg: LBLUE })); merge(ws, 4, 7, 4, 8);

    // Row 5: income values
    sc(ws, 5, 1, s(md.tp,    { bold: true, fmt: '#,##0.00' })); merge(ws, 5, 1, 5, 2);
    sc(ws, 5, 3, s(md.dp,    { bold: true, fmt: '#,##0.00' })); merge(ws, 5, 3, 5, 4);
    sc(ws, 5, 5, s(md.total, { bold: true, bg: DKGRN, fg: 'FFFFFF', fmt: '#,##0.00' })); merge(ws, 5, 5, 5, 6);
    sc(ws, 5, 7, s(md.bal,   { bold: true, bg: NAVY,  fg: 'FFFFFF', fmt: '#,##0.00' })); merge(ws, 5, 7, 5, 8);

    // Row 6: hints
    sc(ws, 6, 1, s('← Transport payment', { bg: 'F9F9F9', fg: '888888' })); merge(ws, 6, 1, 6, 2);
    sc(ws, 6, 3, s('← Diesel payment',    { bg: 'F9F9F9', fg: '888888' })); merge(ws, 6, 3, 6, 4);
    sc(ws, 6, 5, s('Auto calculated',     { bg: 'F9F9F9', fg: '888888' })); merge(ws, 6, 5, 6, 6);
    sc(ws, 6, 7, s('Reduces with each payment', { bg: 'F9F9F9', fg: '888888' })); merge(ws, 6, 7, 6, 8);

    // Row 7: vehicles section
    sc(ws, 7, 1, s('  🚗  VEHICLES', { bold: true, bg: NAVY, fg: 'FFFFFF' }));
    for (let c = 2; c <= 8; c++) sc(ws, 7, c, empty(NAVY));
    merge(ws, 7, 1, 7, 8);
    vehicles.forEach((v, i) => {
      const vr = 8 + i;
      const bg = i % 2 === 0 ? 'FFFFFF' : STRIPE;
      sc(ws, vr, 1, s(i + 1,        { bold: true, bg }));
      sc(ws, vr, 2, s(v.reg_number, { bold: true, bg: EBBLUE, fg: NAVY }));
      merge(ws, vr, 2, vr, 3);
      for (let c = 4; c <= 8; c++) sc(ws, vr, c, empty());
    });

    // Transaction log header (row 13)
    sc(ws, 13, 1, s('  📋  TRANSACTION LOG — Each payment deducts from Balance automatically', { bold: true, bg: NAVY, fg: 'FFFFFF' }));
    for (let c = 2; c <= 8; c++) sc(ws, 13, c, empty(NAVY));
    merge(ws, 13, 1, 13, 8);

    // Row 14: column headers
    ['#', 'Date', 'Pay To (Name)', 'Vehicle No.', 'Description / Note', 'Amount Paid (₹)', 'Payment Mode', 'Reference No.']
      .forEach((h, i) => sc(ws, 14, i + 1, s(h, { bold: true, bg: LBLUE, align: 'center' })));

    // Payment rows
    const maxRows = Math.max(md.pmtData.length, 20);
    for (let pi = 0; pi < maxRows; pi++) {
      const pr  = 15 + pi;
      const bg  = pi % 2 === 0 ? STRIPE : 'FFFFFF';
      sc(ws, pr, 1, s(pi + 1, { bg, fg: 'BBBBBB' }));
      if (pi < md.pmtData.length) {
        const p   = md.pmtData[pi];
        const veh = p.vehicle_id ? regById.get(p.vehicle_id) ?? '' : '';
        sc(ws, pr, 2, s(fmtDate(p.date)));
        sc(ws, pr, 3, s(p.paid_to));
        sc(ws, pr, 4, s(veh));
        sc(ws, pr, 5, s(p.note ?? ''));
        sc(ws, pr, 6, s(Number(p.amount), { fmt: '#,##0.00', align: 'right' }));
        sc(ws, pr, 7, s(p.mode.toUpperCase()));
        sc(ws, pr, 8, s(p.reference ?? ''));
      } else {
        for (let c = 2; c <= 8; c++) sc(ws, pr, c, empty(bg));
      }
    }

    ws['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 22 }, { wch: 13 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, md.monthName.substring(0, 31));
  }

  emitProgress(onProgress, '95% Opening share dialog...');
  await shareWb(wb, `${transporter.name.replace(/\s+/g, '_')}_${suffix}.xlsx`);
}

// ─── EXPORT C: Vehicle Settlement Voucher ─────────────────────
// Exact match: JH04AB3444_Sushil_Bhagat.xlsx

export async function exportVehicleSettlement(
  vehicle: Vehicle,
  transporter: TransportOwner,
  yearOrMonth: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const { year, monthIndexes, suffix } = resolvePeriod(yearOrMonth);
  const { calculateSettlement } = require('./calculations');
  const wb = XLSX.utils.book_new();

  // Colors
  const NAVY   = '1B2A4A';
  const TEAL   = '1A6B6B';
  const BLUE2  = '2E5F8A';
  const DKGRN  = '375623';
  const LTBLUE = 'BDD7EE';
  const LTYEL  = 'FFFACD';
  const LTRED  = 'FAEAEA';
  const LTGRN  = 'EAF5F0';
  const EBBLUE = 'EBF2FA';
  const GREY   = 'E8E8E8';
  const ORANGE = 'FFEAC0';
  const PEACH  = 'FFF4E6';
  const STRIPE = 'EBF2FA';

  emitProgress(onProgress, '10% Fetching settlement data...');

  const allData: any[] = [];
  for (let idx = 0; idx < monthIndexes.length; idx++) {
    const mi       = monthIndexes[idx];
    const monthStr = `${year}-${String(mi + 1).padStart(2, '0')}`;
    const monthName = `${MONTHS_FULL[mi]} ${year}`;
    const progress  = Math.round(10 + ((idx + 1) / monthIndexes.length) * 65);
    emitProgress(onProgress, `${progress}% Loading ${monthName}...`);

    const [{ data: trips }, { data: diesel }, { data: gst }, { data: others }, { data: pmts }] = await Promise.all([
      supabase.from('trip_entries').select('tonnes,rate_snapshot,amount,routes(name)').eq('vehicle_id', vehicle.id).eq('month', monthStr),
      supabase.from('diesel_logs').select('litres,sell_rate,amount,date,deleted_at').eq('vehicle_id', vehicle.id).eq('month', monthStr),
      supabase.from('gst_entries').select('belongs_to_month,gross_gst,commission_on_gst,net_gst').eq('vehicle_id', vehicle.id).eq('belongs_to_month', monthStr),
      supabase.from('other_deductions').select('label,amount').eq('vehicle_id', vehicle.id).eq('month', monthStr),
      supabase.from('payments').select('amount,mode,reference,date').eq('vehicle_id', vehicle.id).eq('month', monthStr).order('date'),
    ]);
    const s2   = calculateSettlement({ trips: trips ?? [], diesel: diesel ?? [], commissionRate: transporter.commission_rate, accidentalRate: transporter.accidental_rate, gstEntries: gst ?? [], otherDeductions: others ?? [] });
    const paid = round2((pmts ?? []).reduce((a: number, p: any) => a + Number(p.amount), 0));
    allData.push({ mi, monthStr, monthName, s: s2, paid, trips: trips ?? [], diesel: diesel ?? [], gst: gst ?? [], others: others ?? [], pmts: pmts ?? [] });
  }

  // ── Summary sheet ──
  emitProgress(onProgress, '80% Building summary...');
  const sumWs: XLSX.WorkSheet = { '!ref': 'A1:A1' };

  sc(sumWs, 1, 1, s(`ANNUAL PAYMENT SUMMARY — ${year}`, { bold: true, bg: NAVY, fg: 'FFFFFF', sz: 13, align: 'center' }));
  for (let c = 2; c <= 8; c++) sc(sumWs, 1, c, empty(NAVY));
  merge(sumWs, 1, 1, 1, 8);

  sc(sumWs, 2, 1, s(`${vehicle.reg_number}  ·  ${transporter.name}`, { bg: NAVY, fg: LTBLUE, align: 'center' }));
  for (let c = 2; c <= 8; c++) sc(sumWs, 2, c, empty(NAVY));
  merge(sumWs, 2, 1, 2, 8);

  // Header row 4
  ['', 'Month', 'Net Payable (₹)', 'Advance Given (₹)', 'Advance Recovered (₹)', 'Final Payable (₹)', 'Status', 'Adv Outstanding (₹)'].forEach((h, i) => {
    sc(sumWs, 4, i + 1, s(h, { bold: true, bg: NAVY, fg: 'FFFFFF', align: 'center' }));
  });

  let annualTotal = 0;
  for (let mi = 0; mi < 12; mi++) {
    const md     = allData.find(m => m.mi === mi);
    const net    = md ? round2(md.s.netPayable) : 0;
    const status = md ? (md.paid >= md.s.netPayable ? 'PAID' : 'PENDING') : '-';
    annualTotal += net;
    const row = 5 + mi;
    const bg  = mi % 2 === 0 ? 'FFFFFF' : STRIPE;
    sc(sumWs, row, 1, empty());
    sc(sumWs, row, 2, s(`${MONTHS_FULL[mi]} ${year}`, { bg, fg: '2C2C2C' }));
    sc(sumWs, row, 3, s(net,    { bg, fmt: '#,##0.00', align: 'right' }));
    sc(sumWs, row, 4, s(0,      { bg: PEACH,  fg: '5C3317', fmt: '#,##0.00' }));
    sc(sumWs, row, 5, s(0,      { bg: LTGRN,  fg: '375623', fmt: '#,##0.00' }));
    sc(sumWs, row, 6, s(net,    { bold: true, bg: LTBLUE, fg: NAVY, fmt: '#,##0.00' }));
    sc(sumWs, row, 7, s(status, { bold: true, bg: LTYEL }));
    sc(sumWs, row, 8, s(0,      { bold: true, bg: ORANGE, fg: '5C3317', fmt: '#,##0.00' }));
  }

  sc(sumWs, 18, 1, s('TOTAL ANNUAL FINAL PAYABLE', { bold: true, bg: NAVY, fg: 'FFFFFF' }));
  for (let c = 2; c <= 5; c++) sc(sumWs, 18, c, empty(NAVY));
  merge(sumWs, 18, 1, 18, 5);
  sc(sumWs, 18, 6, s(round2(annualTotal), { bold: true, bg: LTBLUE, fg: NAVY, fmt: '#,##0.00' }));
  sc(sumWs, 18, 7, empty(NAVY));
  sc(sumWs, 18, 8, s(0, { bold: true, bg: ORANGE, fg: '5C3317', fmt: '#,##0.00' }));

  sumWs['!cols'] = [{ wch: 3 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, sumWs, 'Summary');

  // ── Monthly voucher sheets ──
  for (const md of allData) {
    const ws: XLSX.WorkSheet = { '!ref': 'A1:A1' };
    const { s: st } = md;
    const activeDiesel = md.diesel.filter((d: any) => !d.deleted_at);

    const hdrFull = (row: number, text: string, bg: string, fg = 'FFFFFF') => {
      sc(ws, row, 1, s(text, { bold: true, bg, fg, align: 'center' }));
      for (let c = 2; c <= 8; c++) sc(ws, row, c, empty(bg));
      merge(ws, row, 1, row, 8);
    };

    // Rows 1-2: header
    hdrFull(1, 'TRANSPORT PAYMENT VOUCHER', NAVY);
    sc(ws, 2, 1, s('Payment Release Statement — Company to Transport Owner', { bg: NAVY, fg: LTBLUE }));
    for (let c = 2; c <= 8; c++) sc(ws, 2, c, empty(NAVY));
    merge(ws, 2, 1, 2, 8);

    // Rows 4-8: meta
    const cheque = md.pmts?.find((p: any) => p.mode === 'cheque');
    const chequeNo   = cheque?.reference ? cheque.reference : (md.paid > 0 ? 'See payments' : '—');
    const chequeDate = cheque?.date ? fmtDate(cheque.date) : (md.paid > 0 ? 'PAID' : 'Pending');
    const meta = [['Transport Owner', transporter.name], ['Vehicle No.', vehicle.reg_number], ['Bill Period', md.monthName], ['Cheque No.', chequeNo], ['Cheque Date', chequeDate]];
    meta.forEach(([lbl, val], i) => {
      const r = 4 + i;
      sc(ws, r, 1, s(lbl, { bold: true, bg: GREY })); merge(ws, r, 1, r, 3);
      sc(ws, r, 4, s(val, { bg: 'FFFFFF' }));         merge(ws, r, 4, r, 8);
    });

    // Row 10: table header
    ['Sr.', 'Description', 'Tonnage (MT)', 'Rate (₹/MT)', 'Debit (–)', 'Credit (+)', 'Balance (₹)'].forEach((h, i) =>
      sc(ws, 10, i + 1, s(h, { bold: true, bg: NAVY, fg: 'FFFFFF', align: 'center' }))
    );

    // Row 11: ① Weight earnings
    hdrFull(11, '① WEIGHT EARNINGS', TEAL);
    let runBal = 0;
    md.trips.forEach((t: any, ti: number) => {
      const r   = 12 + ti;
      const amt = round2(Number(t.amount));
      runBal    = round2(runBal + amt);
      const bg  = ti % 2 === 0 ? 'F7F7F7' : 'FFFFFF';
      sc(ws, r, 1, s(ti + 1,                          { bold: true, bg }));
      sc(ws, r, 2, s(`${t.routes?.name ?? 'Route'} Route`, { bg: 'FFFFFF' }));
      sc(ws, r, 3, s(Number(t.tonnes),                { bold: true, bg: LTYEL, fg: NAVY, fmt: '0.00' }));
      sc(ws, r, 4, s(Number(t.rate_snapshot),         { bold: true, bg: LTYEL, fg: NAVY, fmt: '0.00' }));
      sc(ws, r, 5, empty());
      sc(ws, r, 6, s(amt,    { bg: LTGRN, fmt: '#,##0.00' }));
      sc(ws, r, 7, s(runBal, { bold: true, bg: EBBLUE, fmt: '#,##0.00' }));
    });
    const grossRow = 12 + Math.max(md.trips.length, 1);
    sc(ws, grossRow, 1, empty(GREY));
    sc(ws, grossRow, 2, s('Gross Weight (Total)', { bold: true, bg: GREY }));
    sc(ws, grossRow, 3, s(st.totalTonnes,         { bold: true, bg: GREY, fmt: '0.00' }));
    sc(ws, grossRow, 4, s('← Total MT',           { bg: GREY, fg: '808080' }));
    sc(ws, grossRow, 5, empty(GREY));
    sc(ws, grossRow, 6, s(st.gross, { bold: true, bg: LTGRN, fg: DKGRN, fmt: '#,##0.00' }));
    sc(ws, grossRow, 7, s(st.gross, { bold: true, bg: EBBLUE, fg: NAVY,  fmt: '#,##0.00' }));

    // ② Deductions
    const dedRow = grossRow + 2;
    hdrFull(dedRow, '② DEDUCTIONS', BLUE2);
    sc(ws, dedRow + 1, 1, s('TDS: AUTO (1% of Gross Weight).  Kamishna & Accidental: ₹/MT.  Diesel: total amount.', { bg: EBBLUE, fg: '5C3317' }));
    merge(ws, dedRow + 1, 1, dedRow + 1, 8);

    const deductions = [
      [1, 'TDS @ 1% of Gross Weight  (AUTO)',       '',                          '',                         st.tds,        round2(st.gross - st.tds)],
      [2, 'Kamishna (Commission)  —  ₹ per MT →',   st.totalTonnes,             transporter.commission_rate, st.commission, round2(st.gross - st.tds - st.commission)],
      [3, 'Accidental  —  ₹ per MT →',              st.totalTonnes,             transporter.accidental_rate, st.accidental, round2(st.gross - st.tds - st.commission - st.accidental)],
      [4, 'Diesel Deduction  —  total amount →',     '',                          '',                         st.dieselTotal,round2(st.gross - st.tds - st.commission - st.accidental - st.dieselTotal)],
    ];
    deductions.forEach(([sr, desc, tonnes, rate, debit, bal], i) => {
      const r = dedRow + 2 + i;
      sc(ws, r, 1, s(sr,    { bold: true, bg: 'F7F7F7' }));
      sc(ws, r, 2, s(desc,  { bg: LTRED }));
      sc(ws, r, 3, tonnes ? s(tonnes, { bold: true, bg: LTYEL, fg: NAVY, fmt: '0.00' }) : empty(LTRED));
      sc(ws, r, 4, rate   ? s(rate,   { bold: true, bg: LTYEL, fg: NAVY, fmt: '0.00' }) : empty(LTRED));
      sc(ws, r, 5, s(debit, { bg: LTRED, fg: 'C00000', fmt: '#,##0.00' }));
      sc(ws, r, 6, empty());
      sc(ws, r, 7, s(bal,   { bold: true, bg: EBBLUE, fmt: '#,##0.00' }));
    });
    sc(ws, dedRow + 6, 1, empty(GREY));
    sc(ws, dedRow + 6, 2, s('Total Deductions', { bold: true, bg: GREY }));
    for (let c = 3; c <= 4; c++) sc(ws, dedRow + 6, c, empty(GREY));
    sc(ws, dedRow + 6, 5, s(round2(st.tds + st.commission + st.accidental + st.dieselTotal), { bold: true, bg: GREY, fg: 'C00000', fmt: '#,##0.00' }));
    sc(ws, dedRow + 6, 6, empty(GREY));
    sc(ws, dedRow + 6, 7, s(round2(st.gross - st.tds - st.commission - st.accidental - st.dieselTotal), { bold: true, bg: EBBLUE, fg: NAVY, fmt: '#,##0.00' }));

    // ③ GST
    const gstRow = dedRow + 8;
    hdrFull(gstRow, '③ GST RECEIVED', DKGRN);
    ['Sr.', 'Description', 'GST For Month', '', 'Kamishna (–)', 'GST Received (+)', 'Balance (₹)'].forEach((h, i) =>
      sc(ws, gstRow + 1, i + 1, s(h, { bold: true, bg: TEAL, fg: 'FFFFFF' }))
    );
    let gstBal = round2(st.gross - st.tds - st.commission - st.accidental - st.dieselTotal);
    const gst1 = md.gst[0]; const gst2 = md.gst[1];
    [[gst1, 'GST Received  (you get 10% out of 18%)'], [gst2, 'GST Received  (additional / different month)']].forEach(([g, desc]: any, i) => {
      const r    = gstRow + 2 + i;
      const comm = g ? round2(Number(g.commission_on_gst)) : 0;
      const net  = g ? round2(Number(g.net_gst)) : 0;
      gstBal     = round2(gstBal - comm + net);
      sc(ws, r, 1, s(i + 1, { bold: true, bg: LTGRN }));
      sc(ws, r, 2, s(desc,  { bg: LTGRN }));
      sc(ws, r, 3, empty(LTGRN));
      sc(ws, r, 4, empty(LTGRN));
      sc(ws, r, 5, s(comm,  { bold: true, bg: LTYEL, fg: NAVY, fmt: '#,##0.00' }));
      sc(ws, r, 6, s(net,   { bold: true, bg: LTYEL, fg: NAVY, fmt: '#,##0.00' }));
      sc(ws, r, 7, s(gstBal,{ bold: true, bg: EBBLUE, fmt: '#,##0.00' }));
    });
    sc(ws, gstRow + 4, 2, s('ℹ  18% GST on this month\'s weight (reference)', { bg: GREY, fg: '808080' }));
    merge(ws, gstRow + 4, 2, gstRow + 4, 5);
    sc(ws, gstRow + 4, 6, s(round2(st.gross * 0.18), { bg: GREY, fg: '808080', fmt: '#,##0.00' }));
    sc(ws, gstRow + 5, 1, empty(GREY));
    sc(ws, gstRow + 5, 2, s('Net GST Added to Owner', { bold: true, bg: GREY }));
    merge(ws, gstRow + 5, 2, gstRow + 5, 4);
    sc(ws, gstRow + 5, 5, s(round2(md.gst.reduce((a: number, g: any) => a + Number(g.commission_on_gst), 0)), { bold: true, bg: GREY, fg: 'C00000', fmt: '#,##0.00' }));
    sc(ws, gstRow + 5, 6, s(st.netGST,  { bold: true, bg: LTGRN, fg: DKGRN, fmt: '#,##0.00' }));
    sc(ws, gstRow + 5, 7, s(gstBal,     { bold: true, bg: EBBLUE, fg: NAVY,  fmt: '#,##0.00' }));

    // ④ Other deductions
    const othRow = gstRow + 7;
    hdrFull(othRow, '④ OTHER DEDUCTIONS  —  Enter description & amount as applicable', NAVY);
    ['Sr.', 'Description', '', '', 'Amount (₹)', '', 'Balance (₹)'].forEach((h, i) =>
      sc(ws, othRow + 1, i + 1, s(h, { bold: true, bg: TEAL, fg: 'FFFFFF' }))
    );
    let othBal = round2(st.gross - st.tds - st.commission - st.accidental - st.dieselTotal + st.netGST);
    for (let oi = 0; oi < 10; oi++) {
      const r = othRow + 2 + oi;
      const o = md.others[oi];
      if (o) othBal = round2(othBal - Number(o.amount));
      sc(ws, r, 1, s(oi + 1, { bold: true, bg: 'F7F7F7' }));
      sc(ws, r, 2, o ? s(o.label, {}) : empty());
      sc(ws, r, 3, empty()); sc(ws, r, 4, empty());
      sc(ws, r, 5, s(o ? round2(Number(o.amount)) : 0, { bold: true, bg: LTYEL, fg: NAVY, fmt: '#,##0.00' }));
      sc(ws, r, 6, empty());
      sc(ws, r, 7, s(othBal, { bold: true, bg: EBBLUE, fmt: '#,##0.00' }));
    }
    sc(ws, othRow + 12, 1, empty(GREY));
    sc(ws, othRow + 12, 2, s('Total Deductions', { bold: true, bg: GREY }));
    merge(ws, othRow + 12, 2, othRow + 12, 4);
    sc(ws, othRow + 12, 5, s(st.otherTotal, { bold: true, bg: GREY, fmt: '#,##0.00' }));
    sc(ws, othRow + 12, 6, empty(GREY));
    sc(ws, othRow + 12, 7, s(othBal, { bold: true, bg: EBBLUE, fg: NAVY, fmt: '#,##0.00' }));

    // NET PAYABLE
    const netRow = othRow + 14;
    hdrFull(netRow, `NET PAYABLE — ${md.monthName}`, NAVY);
    sc(ws, netRow + 1, 1, s('← Net Amount Payable to Transport Owner', { bg: LTBLUE, fg: '5C3317' }));
    merge(ws, netRow + 1, 1, netRow + 1, 6);
    sc(ws, netRow + 1, 7, s(st.netPayable, { bold: true, bg: LTBLUE, fg: NAVY, sz: 12, fmt: '#,##0.00' }));

    // ⑥ Advance ledger
    const advRow = netRow + 3;
    hdrFull(advRow, '⑥ ADVANCE PAYMENT LEDGER', NAVY);
    ['Sr.', 'Description', '', '', 'Advance Given (₹)', 'Advance Recovered (₹)', 'Advance Outstanding (₹)'].forEach((h, i) =>
      sc(ws, advRow + 1, i + 1, s(h, { bold: true, bg: NAVY, fg: 'FFFFFF' }))
    );
    sc(ws, advRow + 2, 1, s(1, { bold: true, bg: 'F7F7F7' }));
    sc(ws, advRow + 2, 2, s('Advance Given this month', { bg: PEACH })); merge(ws, advRow + 2, 2, advRow + 2, 4);
    sc(ws, advRow + 2, 5, s(0, { bold: true, bg: LTYEL, fg: NAVY, fmt: '#,##0.00' }));
    sc(ws, advRow + 2, 6, empty());
    sc(ws, advRow + 2, 7, s(0, { bold: true, bg: ORANGE, fg: '5C3317', fmt: '#,##0.00' }));

    sc(ws, advRow + 3, 1, s(2, { bold: true, bg: 'F7F7F7' }));
    sc(ws, advRow + 3, 2, s('Advance Recovered this month  (deducted from Net Payable)', { bg: LTGRN })); merge(ws, advRow + 3, 2, advRow + 3, 5);
    sc(ws, advRow + 3, 6, s(0, { bold: true, bg: LTYEL, fg: NAVY, fmt: '#,##0.00' }));
    sc(ws, advRow + 3, 7, s(0, { bold: true, bg: ORANGE, fg: '5C3317', fmt: '#,##0.00' }));

    sc(ws, advRow + 4, 2, s('FINAL PAYABLE  (Net Payable − Advance Recovery + Advance Given)', { bold: true, bg: LTBLUE }));
    merge(ws, advRow + 4, 2, advRow + 4, 6);
    sc(ws, advRow + 4, 7, s(st.netPayable, { bold: true, bg: LTBLUE, fg: NAVY, sz: 12, fmt: '#,##0.00' }));

    // Quick stats
    const statsRow = advRow + 6;
    hdrFull(statsRow, 'QUICK STATS', NAVY);
    const stats = [
      ['Gross Weight Earned', st.gross],
      ['Total Deductions',    round2(st.tds + st.commission + st.accidental + st.dieselTotal)],
      ['Net GST Added',       st.netGST],
      ['Other Deductions',    st.otherTotal],
      ['Net Payable',         st.netPayable],
    ];
    stats.forEach(([lbl, val], i) => {
      const r  = statsRow + 1 + i;
      const fg = i === 4 ? 'FFFFFF' : '2C2C2C';
      const bg = i === 4 ? NAVY : GREY;
      sc(ws, r, 1, s(lbl, { bg, fg, bold: i === 4 })); merge(ws, r, 1, r, 5);
      sc(ws, r, 6, s(val as number, { bold: i === 4, bg: i === 4 ? LTBLUE : EBBLUE, fg: i === 4 ? NAVY : '2C2C2C', fmt: '#,##0.00' }));
      merge(ws, r, 6, r, 8);
    });

    // Payment status
    const statusRow = statsRow + 7;
    sc(ws, statusRow, 1, s('PAYMENT STATUS  →  Type PAID or PENDING in yellow cell', { bg: LTBLUE, fg: '5C3317' }));
    merge(ws, statusRow, 1, statusRow, 4);
    sc(ws, statusRow, 5, s(md.paid >= st.netPayable ? 'PAID' : 'PENDING', { bold: true, bg: LTYEL }));
    merge(ws, statusRow, 5, statusRow, 8);

    // Legend
    sc(ws, statusRow + 2, 1, s('ℹ  Yellow = editable inputs  |  Blue = auto-calculated  |  Green = credits  |  Orange = deductions', { bg: LTBLUE, fg: '808080' }));
    merge(ws, statusRow + 2, 1, statusRow + 2, 8);

    ws['!cols'] = [{ wch: 5 }, { wch: 38 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 5 }];
    XLSX.utils.book_append_sheet(wb, ws, MONTHS_SHORT[md.mi]);
  }

  emitProgress(onProgress, '95% Opening share dialog...');
  await shareWb(wb, `${vehicle.reg_number}_${transporter.name.replace(/\s+/g, '_')}_${suffix}.xlsx`);
}