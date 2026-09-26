function validConventionDetails(value) {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.keys(value).some(key => !["meetingPoint", "mapUrl", "arrivalInstructions", "deliveryDays", "deliveryDate"].includes(key))) return false;
  for (const [key, max] of Object.entries({ meetingPoint: 300, mapUrl: 2000, arrivalInstructions: 2000 })) {
    if (value[key] != null && (typeof value[key] !== "string" || value[key].length > max)) return false;
  }
  if (value.deliveryDate != null && (typeof value.deliveryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.deliveryDate) || !Number.isFinite(Date.parse(value.deliveryDate)) || new Date(value.deliveryDate).toISOString().slice(0, 10) !== value.deliveryDate)) return false;
  if (value.mapUrl) { try { if (!["https:", "http:"].includes(new URL(value.mapUrl).protocol)) return false; } catch { return false; } }
  return value.deliveryDays == null || Number.isInteger(value.deliveryDays) && value.deliveryDays >= 0 && value.deliveryDays <= 365;
}
function snapshotConventionDetails(event, date) {
  const source = event?.conventionDetails;
  if (!source || !validConventionDetails(source)) return undefined;
  const value = { meetingPoint: source.meetingPoint || "", mapUrl: source.mapUrl || "", arrivalInstructions: source.arrivalInstructions || "" };
  if (source.deliveryDays != null && /^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + source.deliveryDays);
    if (Number.isFinite(day.getTime())) { value.deliveryDays = source.deliveryDays; value.deliveryDate = day.toISOString().slice(0, 10); }
  }
  return value;
}
function conventionRows(value) {
  if (!value || !validConventionDetails(value)) return [];
  return [{ label: "Meeting point", value: value.meetingPoint }, { label: "Map", value: value.mapUrl }, { label: "Arrival instructions", value: value.arrivalInstructions }, { label: "Agreed delivery target", value: value.deliveryDate }].filter(row => row.value);
}
module.exports = { validConventionDetails, snapshotConventionDetails, conventionRows };
