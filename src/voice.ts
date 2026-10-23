// Helpers for spoken responses. Alexa+ reads tool text aloud, so output must stay
// plain sentences: no markdown, pipes, or bullet characters.

export function joinNames(names: string[], limit = 6): string {
  if (names.length > limit) {
    const rest = names.length - limit;
    return `${names.slice(0, limit).join(", ")} and ${rest} more`;
  }
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

export function describeQuantity(item: { name: string; quantity: number; unit: string }): string {
  const q = formatNumber(item.quantity);
  if (item.unit === "item") return item.quantity === 1 ? item.name : `${q} ${item.name}`;
  const plural = item.quantity !== 1 && /^[a-z]{3,}$/i.test(item.unit) && !item.unit.endsWith("s");
  return `${q} ${plural ? `${item.unit}s` : item.unit} of ${item.name}`;
}

/** "today", "tomorrow", "in 3 days", "yesterday", "4 days ago" */
export function relativeDay(daysFromToday: number): string {
  if (daysFromToday === 0) return "today";
  if (daysFromToday === 1) return "tomorrow";
  if (daysFromToday === -1) return "yesterday";
  return daysFromToday > 0 ? `in ${daysFromToday} days` : `${-daysFromToday} days ago`;
}

export function expiryPhrase(daysLeft: number): string {
  return daysLeft < 0 ? `expired ${relativeDay(daysLeft)}` : `expires ${relativeDay(daysLeft)}`;
}
