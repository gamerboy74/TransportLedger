import { calculateSettlement, calculateAdminEarnings } from '../lib/calculations';

describe('Settlement — Real Data Verification', () => {

  test('Example 1 — Jan 2026, Vehicle 7769/51, Kurwa', () => {
    const result = calculateSettlement({
      trips: [{ tonnes: 1609.24, rate_snapshot: 312.79, amount: 503354.00 }],
      diesel: [{ litres: 2995.36, sell_rate: 94, amount: 281563.84, deleted_at: null }],
      commissionRate: 15, accidentalRate: 5,
      gstEntries: [{ net_gst: 80239.50 }],
      otherDeductions: [{ amount: 3300 }, { amount: 6500 }],
    });
    expect(result.gross).toBe(503354.00);
    expect(result.tds).toBe(5033.54);
    expect(result.commission).toBe(24138.60);
    expect(result.accidental).toBe(8046.20);
    expect(result.dieselTotal).toBe(281563.84);
    expect(result.netGST).toBe(80239.50);
    expect(result.otherTotal).toBe(9800.00);
    expect(result.netPayable).toBe(255011.32);
  });

  test('Example 2 — Dec 2025, Vehicle 3444, Dumka+Kurwa', () => {
    const result = calculateSettlement({
      trips: [
        { tonnes: 31.28,   rate_snapshot: 308.13, amount: 9638.31 },
        { tonnes: 2010.14, rate_snapshot: 312.79, amount: 628752.41 },
      ],
      diesel: [{ litres: 3543.45, sell_rate: 94, amount: 333084.30, deleted_at: null }],
      commissionRate: 10, accidentalRate: 5,
      gstEntries: [{ net_gst: 45700.20 }],
      otherDeductions: [],
    });
    expect(result.gross).toBe(638390.72);
    expect(result.totalTonnes).toBe(2041.42);
    expect(result.netPayable).toBe(314001.41);
  });

  test('Soft-deleted diesel excluded', () => {
    const result = calculateSettlement({
      trips: [{ tonnes: 100, rate_snapshot: 300, amount: 30000 }],
      diesel: [
        { litres: 100, sell_rate: 94, amount: 9400, deleted_at: null },
        { litres: 50,  sell_rate: 94, amount: 4700, deleted_at: '2026-03-01T00:00:00Z' },
      ],
      commissionRate: 10, accidentalRate: 5,
      gstEntries: [], otherDeductions: [],
    });
    expect(result.dieselTotal).toBe(9400);
  });

  test('March 2026 Sushil Bhagat balance = ₹11,000', () => {
    const totalIncome = 1348000 + 410000;
    const totalPaid   = [10000,100000,50000,13000,305100,308500,259400,499000,202000].reduce((s,p)=>s+p,0);
    expect(totalIncome).toBe(1758000);
    expect(totalPaid).toBe(1747000);
    expect(totalIncome - totalPaid).toBe(11000);
  });
});
