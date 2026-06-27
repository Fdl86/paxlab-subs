export function parseTimestamp(value: string): number {
  const cleaned = value.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length < 2 || parts.length > 3) return 0;

  const secondsPart = Number(parts.pop());
  const minutes = Number(parts.pop() ?? 0);
  const hours = Number(parts.pop() ?? 0);

  if (!Number.isFinite(secondsPart) || !Number.isFinite(minutes) || !Number.isFinite(hours)) return 0;
  return hours * 3600 + minutes * 60 + secondsPart;
}

export function formatSrtTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const totalMillis = Math.round(safe * 1000);
  const hours = Math.floor(totalMillis / 3_600_000);
  const minutes = Math.floor((totalMillis % 3_600_000) / 60_000);
  const secs = Math.floor((totalMillis % 60_000) / 1000);
  const millis = totalMillis % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${String(millis).padStart(3, '0')}`;
}

export function formatVttTime(seconds: number): string {
  return formatSrtTime(seconds).replace(',', '.');
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`;
  return `${minutes}:${pad(secs)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
