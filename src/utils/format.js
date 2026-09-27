// Single source for currency formatting across patient + staff surfaces.
//
// `peso` was re-defined verbatim in Dashboard, TrackStatus, RequestAssistance,
// admin/Requests and BalanceHero (each `toLocaleString()` with no fixed
// locale). Consolidated here so grouping stays consistent everywhere and the
// Philippine grouping is explicit — e.g. peso(25000) === '₱25,000'.
export const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH')}`
