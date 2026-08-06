// Great-circle distance.
//
// The live feed gives each train a latitude/longitude and /stations-open gives
// one per post, so the straight-line distance between them is the honest
// answer to "how far away is this train from me". It is not track distance —
// a train on a loop or the far side of a junction will read closer than it
// runs — so it is presented as an approach distance, not a running distance.

const EARTH_RADIUS_KM = 6371

const toRad = (deg: number) => (deg * Math.PI) / 180

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}
