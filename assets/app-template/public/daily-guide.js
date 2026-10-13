let guideTrip = readSeedTrip();

// The app passes its current trip so edited or newly added dates use live data.
export function setGuideTrip(trip) {
  if (trip && typeof trip === "object" && !Array.isArray(trip)) guideTrip = trip;
}

function readSeedTrip() {
  try {
    return JSON.parse(document.getElementById("trip-data")?.textContent || "{}");
  } catch {
    return {};
  }
}

function localized(value, language) {
  if (Array.isArray(value)) return value.map((item) => localized(item, language));
  if (!value || typeof value !== "object") return value;
  const base = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "i18n")
      .map(([key, child]) => [key, localized(child, language)])
  );
  const patch = value.i18n?.[language];
  if (!patch || typeof patch !== "object") return base;
  return { ...base, ...localized(patch, language) };
}

function dayFor(dayId) {
  return (Array.isArray(guideTrip.days) ? guideTrip.days : []).find((day) => day && day.id === dayId);
}

function withCategory(items, category) {
  return (Array.isArray(items) ? items : []).filter((item) => item && typeof item === "object").map((item) => ({
    ...item,
    categories: Array.isArray(item.categories) && item.categories.length ? item.categories : [category]
  }));
}

export function getDayArea(dayId, language = "en") {
  const day = localized(dayFor(dayId) || {}, language);
  return day.area || day.route || day.theme || "";
}

export function getDayGuide(dayId, language = "en") {
  const day = localized(dayFor(dayId) || {}, language);
  const rawRecommendations = day.recommendations || day.guide || {};
  const recommendations = rawRecommendations && typeof rawRecommendations === "object" ? rawRecommendations : {};
  const restaurants = (Array.isArray(recommendations.restaurants) ? recommendations.restaurants
    : Array.isArray(recommendations.eat) ? recommendations.eat : [])
    .filter((item) => item && typeof item === "object");
  const extras = [
    ...withCategory(recommendations.seeGo || recommendations.see || [], "see"),
    ...withCategory(recommendations.buy || [], "buy"),
    ...withCategory(recommendations.do || [], "do"),
    ...withCategory(recommendations.snack || [], "snack")
  ];
  return {
    note: typeof recommendations.note === "string" ? recommendations.note : "",
    restaurants,
    extras
  };
}

export function getPlacePhoto(slotId) {
  const slot = (Array.isArray(guideTrip.days) ? guideTrip.days : [])
    .flatMap((day) => (Array.isArray(day?.slots) ? day.slots : Array.isArray(day?.plans) ? day.plans : []))
    .find((candidate) => candidate && candidate.id === slotId);
  if (!slot?.photo) return null;
  return typeof slot.photo === "string" ? { url: slot.photo } : slot.photo;
}
