// constants/defaults.ts

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const monthKey = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const monthLabel = (mk: string): string => {
  const [y, m] = mk.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m) - 1]} ${y}`;
};

export const fmt = (n: number): string =>
  '₹' + Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

export const fmtShort = (n: number): string => {
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + 'Cr';
  if (n >= 100000)   return '₹' + (n / 100000).toFixed(2) + 'L';
  if (n >= 1000)    return '₹' + (n / 1000).toFixed(1) + 'K';
  return fmt(n);
};

export const getFortnight = (dateStr: string): 1 | 2 => {
  const day = new Date(dateStr).getDate();
  return day <= 15 ? 1 : 2;
};

export const fmtDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const d = dateStr.toString().split('T')[0];
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

export const prevMonth = (m: string): string => {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const nextMonth = (m: string): string => {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const TDS_RATE = 0.01;
export const BUY_RATE = 92.92;
export const SELL_RATE = 94.00;
