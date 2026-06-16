// Absolute timestamp for anything fed to the model (conversation, recall, emotion,
// memory). Always absolute (never "N ago") and in UTC so it is unambiguous; the
// model is also given the current time, so it can reason about recency itself.
// Format: "YYYY-MM-DD HH:MM UTC". Accepts an epoch ms number, an ISO string, or a Date.
export function formatAbsTime(value) {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
