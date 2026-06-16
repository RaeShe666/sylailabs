// Absolute timestamp for anything fed to the model (conversation, recall, emotion,
// memory). Always absolute (never "N ago"). Formatted in the user's local timezone
// when tzOffset (minutes east of UTC, e.g. 480 for UTC+8) is given, else UTC — so
// the model reasons about "today / 3am / etc." in the user's clock, not the server's.
// Format: "YYYY-MM-DD HH:MM (UTC+8)". Accepts an epoch ms number, ISO string, or Date.
export function formatAbsTime(value, tzOffset = null) {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  if (typeof tzOffset === 'number' && Number.isFinite(tzOffset)) {
    const shifted = new Date(date.getTime() + tzOffset * 60000)
    const stamp = shifted.toISOString().slice(0, 16).replace('T', ' ')
    const sign = tzOffset >= 0 ? '+' : '-'
    const hours = Math.abs(tzOffset) / 60
    const label = Number.isInteger(hours) ? `${hours}` : hours.toFixed(1)
    return `${stamp} (UTC${sign}${label})`
  }
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
