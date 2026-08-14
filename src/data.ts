// SimRail Mobile EDR — data model
// Phase 0: expanded types + realistic mock data for dispatching UX.

export type StopType = 'ph' | 'pt' | 'tech'

export type Stop = {
  station: string
  arrival: string
  departure: string
  platform: string
  type: StopType
}

export type Platform = {
  id: string
  tracks: string[]
  length: number
}

export type Post = {
  code: string
  direction: string
  servesPlatforms: string[]
}

export type Station = {
  id: string
  name: string
  difficulty: number
  multiPost: boolean
  line: string[]
  platforms: Platform[]
  posts: Post[]
}

/**
 * A dispatch post the player can actually take, as reported by the panel API.
 *
 * `name` is the key: it must equal the timetable's `supervisedBy` value, which
 * is how trains are scoped to a post. 54 of the 61 playable stations match
 * exactly; the remainder have no booked traffic at all and are likely
 * sub-posts controlled under a parent name.
 *
 * Station prefixes are NOT unique (two stations share "KO"), so never key on
 * them.
 */
export type DispatchStation = {
  name: string
  prefix: string
  difficulty: number
  /** How many players are currently signed in to this post. */
  dispatchedBy: number
  /** Post position, used for straight-line distance to approaching trains. */
  lat: number | null
  lon: number | null
}

export type SignalState = 'green' | 'yellow' | 'red' | 'unknown'
export type Driver = 'player' | 'bot'
export type Category = 'passenger' | 'freight'
export type TrainStatus = 'approaching' | 'enroute' | 'standing' | 'scheduled'

export type Train = {
  number: string
  type: string
  category: Category
  driver: Driver
  priority: number
  line: string
  from: string
  toPost: string
  arrival: string
  departure: string
  platform: string
  delay: number
  status: TrainStatus
  distance: number
  length: number
  weight: number
  speed: number
  /** Permitted maximum. 0 when unknown (live feed carries no consist data). */
  maxSpeed: number
  signalState: SignalState
  stops: Stop[]

  // --- Live telemetry. Present only on trains sourced from the panel API,
  // which reports position and signalling but no timetable. ---

  /** True when this record came from the live API (has position/signal telemetry). */
  live?: boolean
  /** True once a timetable has been merged in, making arr/dep/platform real. */
  hasTimetable?: boolean
  /** Index of the stop the train is currently working towards. */
  timetableIndex?: number
  /** Next timetable point ahead of the train, wherever it is on its run. */
  nextPoint?: string
  /** Point the train is routed to after leaving the current dispatch post. */
  onwardPoint?: string
  /** Line number the train departs the current post onto. */
  onwardLine?: number | null
  /** Track within the platform at the current post. */
  track?: number | null
  /**
   * Bare platform, without the track suffix that `platform` carries for
   * display. Conflict detection groups on this: "II" and "II 1" are the same
   * platform and must be compared, not hashed apart.
   */
  platformId?: string | null
  /** True once the train has worked past the last point this post controls. */
  clearedPost?: boolean
  /** Index of this post's stop in the train's own schedule. */
  postStopIndex?: number
  /** Metres to the next signal ahead. */
  signalDistance?: number
  /** Speed permitted at the next signal, km/h. Undefined when unrestricted. */
  signalSpeed?: number
  /** Raw SimRail vehicle ids, locomotive first. */
  vehicles?: string[]
  /** Steam64 id of the player driving, when it is not an AI train. */
  controlledBy?: string
  /** Live position, used for real distance to the dispatch post. */
  lat?: number
  lon?: number
}

export type DestinationInfo = {
  next: string
  direction: string
  color: string
  badge: string
}

// Priority: 1 = highest, 6 = lowest.
// EIP (Pendolino) > EIC > IC > TLK > regional > freight.
const PRIORITY_MAP: Record<string, number> = {
  EIP: 1,
  EIC: 2,
  IC: 3,
  TLK: 4,
  MOJ: 5,
  ROJ: 5,
  R: 5,
  TME: 6,
  TNE: 6,
  TPE: 6,
}

export function getPriority(type: string): number {
  return PRIORITY_MAP[type.toUpperCase()] ?? 5
}

// Public SimRail servers, grouped by region.
// Order within a region mirrors SimRail's own listing (PL1 = flagship).
export type ServerRegion = 'PL' | 'EN' | 'DE' | 'CS' | 'FR'

export type Server = {
  code: string
  region: ServerRegion
  label: string
}

export const SERVERS: Server[] = [
  { code: 'pl1', region: 'PL', label: 'Poland 1' },
  { code: 'pl2', region: 'PL', label: 'Poland 2' },
  { code: 'pl3', region: 'PL', label: 'Poland 3' },
  { code: 'pl4', region: 'PL', label: 'Poland 4' },
  { code: 'pl5', region: 'PL', label: 'Poland 5' },
  { code: 'en1', region: 'EN', label: 'English 1' },
  { code: 'en2', region: 'EN', label: 'English 2' },
  { code: 'en3', region: 'EN', label: 'English 3' },
  { code: 'en4', region: 'EN', label: 'English 4' },
  { code: 'de1', region: 'DE', label: 'Deutsch 1' },
  { code: 'de2', region: 'DE', label: 'Deutsch 2' },
  { code: 'de3', region: 'DE', label: 'Deutsch 3' },
  { code: 'cs1', region: 'CS', label: 'Česky 1' },
  { code: 'cs2', region: 'CS', label: 'Česky 2' },
  { code: 'fr1', region: 'FR', label: 'Français 1' },
]

export const REGION_LABEL: Record<ServerRegion, string> = {
  PL: 'Poland',
  EN: 'English',
  DE: 'Deutsch',
  CS: 'Česky',
  FR: 'Français',
}

export const STATIONS: Station[] = [
  {
    id: 'ske',
    name: 'Skierniewice',
    difficulty: 5,
    multiPost: true,
    line: ['1', '11'],
    platforms: [
      { id: 'I', tracks: ['1', '2'], length: 400 },
      { id: 'II', tracks: ['3', '4'], length: 400 },
      { id: 'III', tracks: ['5'], length: 300 },
    ],
    posts: [
      { code: 'P', direction: 'Płyćwia / Łowicz', servesPlatforms: ['I'] },
      { code: 'S', direction: 'Platforms / Sidings', servesPlatforms: ['I', 'II', 'III'] },
      { code: 'M', direction: 'Koluszki / Żyrardów', servesPlatforms: ['II'] },
    ],
  },
  {
    id: 'ply',
    name: 'Płyćwia',
    difficulty: 2,
    multiPost: false,
    line: ['11'],
    platforms: [{ id: 'I', tracks: ['1', '2'], length: 200 }],
    posts: [],
  },
  {
    id: 'rog',
    name: 'Rogów',
    difficulty: 1,
    multiPost: false,
    line: ['1'],
    platforms: [{ id: 'I', tracks: ['1', '2'], length: 200 }],
    posts: [],
  },
  {
    id: 'zyr',
    name: 'Żyrardów',
    difficulty: 3,
    multiPost: false,
    line: ['1'],
    platforms: [
      { id: 'I', tracks: ['1', '2'], length: 300 },
      { id: 'II', tracks: ['3', '4'], length: 300 },
    ],
    posts: [],
  },
  {
    id: 'kol',
    name: 'Koluszki',
    difficulty: 4,
    multiPost: true,
    line: ['1', '17', '25'],
    platforms: [
      { id: 'I', tracks: ['1', '2'], length: 300 },
      { id: 'II', tracks: ['3', '4'], length: 300 },
      { id: 'III', tracks: ['5', '6'], length: 250 },
    ],
    posts: [
      { code: 'N', direction: 'Skierniewice / Warszawa', servesPlatforms: ['I'] },
      { code: 'S', direction: 'Piotrków / Tomaszów', servesPlatforms: ['II'] },
      { code: 'L', direction: 'Łódź Widzew', servesPlatforms: ['III'] },
    ],
  },
  {
    id: 'grodzisk',
    name: 'Grodzisk Mazowiecki',
    difficulty: 4,
    multiPost: false,
    line: ['1', '447'],
    platforms: [
      { id: 'I', tracks: ['1', '2'], length: 300 },
      { id: 'II', tracks: ['3', '4'], length: 300 },
    ],
    posts: [],
  },
  {
    id: 'pruszkow',
    name: 'Pruszków',
    difficulty: 4,
    multiPost: false,
    line: ['1', '447'],
    platforms: [
      { id: 'I', tracks: ['1', '2'], length: 300 },
      { id: 'II', tracks: ['3', '4'], length: 300 },
    ],
    posts: [],
  },
]

/**
 * Earlier builds stored the mock station id ("ske"); the post is now keyed by
 * name so it can be matched against the timetable. Without this, an existing
 * install silently jumps to whichever station sorts first.
 */
export function legacyStationName(stored: string): string | null {
  return STATIONS.find((s) => s.id === stored)?.name ?? null
}

/**
 * First-paint station list, used until the live one arrives (or if it fails).
 * The real list is 61 posts from /stations-open — see useStations.
 */
export const FALLBACK_STATIONS: DispatchStation[] = STATIONS.map((s) => ({
  name: s.name,
  prefix: s.id.slice(0, 3).toUpperCase(),
  difficulty: s.difficulty,
  dispatchedBy: 0,
  // Coordinates only come from the API; without them distance is simply
  // not shown rather than guessed.
  lat: null,
  lon: null,
}))

// Post code → destination info (what dispatcher actually needs to see).
// Keys: full form 'Station X' + short form 'X' for Skierniewice legacy.
export const POST_DESTINATION_MAP: Record<string, DestinationInfo> = {
  // Skierniewice
  'Skierniewice P': {
    next: 'Płyćwia',
    direction: 'Łowicz / Płyćwia direction',
    color: 'dest-plycwia',
    badge: 'P',
  },
  'Skierniewice S': {
    next: 'Platforms / Sidings',
    direction: 'Station area movements',
    color: 'dest-other',
    badge: 'S',
  },
  'Skierniewice M': {
    next: 'Koluszki / Żyrardów',
    direction: 'Main line (Warszawa ↔ Łódź)',
    color: 'dest-koluszki',
    badge: 'M',
  },
  P: {
    next: 'Płyćwia',
    direction: 'Łowicz direction',
    color: 'dest-plycwia',
    badge: 'P',
  },
  S: {
    next: 'Main platforms',
    direction: 'Local movements',
    color: 'dest-other',
    badge: 'S',
  },
  M: {
    next: 'Żyrardów / Koluszki',
    direction: 'Main line',
    color: 'dest-zyrardow',
    badge: 'M',
  },

  // Koluszki
  'Koluszki N': {
    next: 'Rogów / Skierniewice',
    direction: 'Warszawa direction',
    color: 'dest-koluszki',
    badge: 'N',
  },
  'Koluszki S': {
    next: 'Baby / Piotrków',
    direction: 'Piotrków / Tomaszów direction',
    color: 'dest-other',
    badge: 'S',
  },
  'Koluszki L': {
    next: 'Gałkówek / Łódź Widzew',
    direction: 'Łódź direction',
    color: 'dest-zyrardow',
    badge: 'L',
  },

  // Żyrardów (single post)
  Żyrardów: {
    next: 'Jaktorów / Skierniewice',
    direction: 'Line 1 through',
    color: 'dest-zyrardow',
    badge: 'Ż',
  },

  // Grodzisk Mazowiecki
  'Grodzisk Mazowiecki': {
    next: 'Brwinów / Żyrardów',
    direction: 'Line 1 + CMK junction',
    color: 'dest-other',
    badge: 'G',
  },

  // Pruszków
  Pruszków: {
    next: 'Warszawa Zach. / Grodzisk',
    direction: 'Line 1 through',
    color: 'dest-other',
    badge: 'Pr',
  },
}

export function resolveDestination(toPost: string): DestinationInfo {
  return (
    POST_DESTINATION_MAP[toPost] || {
      next: toPost,
      // Live trains carry their final station here rather than a mapped
      // dispatch post, so label it instead of repeating the name.
      direction: 'Destination',
      color: 'dest-other',
      badge: toPost.trim().charAt(0).toUpperCase() || '?',
    }
  )
}

// Only P / S / M have a dedicated badge colour in index.css; anything else
// (live destinations) falls back to a neutral chip.
const BADGE_CLASSES = new Set(['p', 's', 'm'])

export function badgeClass(badge: string): string {
  const key = badge.toLowerCase()
  return BADGE_CLASSES.has(key) ? `badge-${key}` : 'badge-other'
}

// Realistic mock trains for Skierniewice dispatch window ~08:00–09:30.
export const TRAINS: Train[] = [
  {
    number: '13103',
    type: 'EIE',
    category: 'passenger',
    driver: 'player',
    priority: 2,
    line: '1',
    from: 'Warszawa Centralna',
    toPost: 'Skierniewice P',
    arrival: '08:14',
    departure: '08:16',
    platform: 'II 3',
    delay: -2,
    status: 'approaching',
    distance: 4.2,
    length: 200,
    weight: 380,
    speed: 118,
    maxSpeed: 160,
    signalState: 'green',
    stops: [
      { station: 'Warszawa Centralna', arrival: '07:45', departure: '07:48', platform: '4', type: 'ph' },
      { station: 'Warszawa Zachodnia', arrival: '07:52', departure: '07:54', platform: '5', type: 'ph' },
      { station: 'Skierniewice', arrival: '08:14', departure: '08:16', platform: 'II 3', type: 'ph' },
      { station: 'Łowicz Główny', arrival: '08:38', departure: '08:40', platform: '1', type: 'ph' },
      { station: 'Kutno', arrival: '09:10', departure: '09:12', platform: '2', type: 'ph' },
    ],
  },
  {
    number: '16122',
    type: 'MOJ',
    category: 'passenger',
    driver: 'bot',
    priority: 5,
    line: '1',
    from: 'Łódź Fabryczna',
    toPost: 'Skierniewice M',
    arrival: '08:21',
    departure: '08:23',
    platform: 'I 1',
    delay: 3,
    status: 'approaching',
    distance: 7.8,
    length: 140,
    weight: 260,
    speed: 95,
    maxSpeed: 120,
    signalState: 'yellow',
    stops: [
      { station: 'Łódź Fabryczna', arrival: '07:20', departure: '07:25', platform: '3', type: 'ph' },
      { station: 'Koluszki', arrival: '07:48', departure: '07:52', platform: 'I 1', type: 'ph' },
      { station: 'Rogów', arrival: '08:02', departure: '08:03', platform: '1', type: 'ph' },
      { station: 'Skierniewice', arrival: '08:21', departure: '08:23', platform: 'I 1', type: 'ph' },
      { station: 'Warszawa Wschodnia', arrival: '09:15', departure: '09:20', platform: '2', type: 'ph' },
    ],
  },
  {
    number: '44612',
    type: 'TME',
    category: 'freight',
    driver: 'bot',
    priority: 6,
    line: '1',
    from: 'Łódź Olechów',
    toPost: 'Skierniewice M',
    arrival: '08:28',
    departure: '08:35',
    platform: '-',
    delay: 12,
    status: 'enroute',
    distance: 18.5,
    length: 620,
    weight: 2400,
    speed: 62,
    maxSpeed: 90,
    signalState: 'yellow',
    stops: [
      { station: 'Łódź Olechów', arrival: '06:15', departure: '06:30', platform: 'Tow.', type: 'tech' },
      { station: 'Koluszki', arrival: '07:20', departure: '07:35', platform: 'Tow.', type: 'tech' },
      { station: 'Skierniewice', arrival: '08:28', departure: '08:35', platform: '-', type: 'tech' },
      { station: 'Warszawa Praga', arrival: '09:45', departure: '10:00', platform: 'Tow.', type: 'tech' },
    ],
  },
  {
    number: '13105',
    type: 'EIE',
    category: 'passenger',
    driver: 'bot',
    priority: 2,
    line: '1',
    from: 'Warszawa Wschodnia',
    toPost: 'Skierniewice P',
    arrival: '08:32',
    departure: '08:34',
    platform: 'II 4',
    delay: 0,
    status: 'scheduled',
    distance: 22,
    length: 200,
    weight: 380,
    speed: 145,
    maxSpeed: 160,
    signalState: 'green',
    stops: [
      { station: 'Warszawa Wschodnia', arrival: '08:00', departure: '08:03', platform: '3', type: 'ph' },
      { station: 'Warszawa Centralna', arrival: '08:07', departure: '08:10', platform: '4', type: 'ph' },
      { station: 'Skierniewice', arrival: '08:32', departure: '08:34', platform: 'II 4', type: 'ph' },
      { station: 'Łowicz Główny', arrival: '08:56', departure: '08:58', platform: '1', type: 'ph' },
    ],
  },
  {
    number: '24217',
    type: 'ROJ',
    category: 'passenger',
    driver: 'player',
    priority: 5,
    line: '1',
    from: 'Koluszki',
    toPost: 'Skierniewice S',
    arrival: '08:37',
    departure: '08:39',
    platform: 'I 2',
    delay: -1,
    status: 'approaching',
    distance: 3.1,
    length: 90,
    weight: 180,
    speed: 80,
    maxSpeed: 120,
    signalState: 'green',
    stops: [
      { station: 'Koluszki', arrival: '08:15', departure: '08:18', platform: 'I 2', type: 'ph' },
      { station: 'Rogów', arrival: '08:25', departure: '08:26', platform: '1', type: 'ph' },
      { station: 'Skierniewice', arrival: '08:37', departure: '08:39', platform: 'I 2', type: 'ph' },
      { station: 'Płyćwia', arrival: '08:48', departure: '08:49', platform: '1', type: 'ph' },
    ],
  },
  {
    number: '44108',
    type: 'TNE',
    category: 'freight',
    driver: 'bot',
    priority: 6,
    line: '1',
    from: 'Skierniewice',
    toPost: 'Skierniewice P',
    arrival: '08:41',
    departure: '08:50',
    platform: 'Tow.',
    delay: 8,
    status: 'standing',
    distance: 0,
    length: 480,
    weight: 1850,
    speed: 0,
    maxSpeed: 80,
    signalState: 'red',
    stops: [
      { station: 'Skierniewice', arrival: '08:41', departure: '08:50', platform: 'Tow.', type: 'tech' },
      { station: 'Płyćwia', arrival: '09:05', departure: '09:07', platform: '2', type: 'tech' },
      { station: 'Łowicz Główny', arrival: '09:30', departure: '09:45', platform: 'Tow.', type: 'tech' },
    ],
  },
  {
    number: '13107',
    type: 'EIE',
    category: 'passenger',
    driver: 'bot',
    priority: 2,
    line: '1',
    from: 'Warszawa Centralna',
    toPost: 'Skierniewice P',
    arrival: '08:48',
    departure: '08:50',
    platform: 'II 3',
    delay: 0,
    status: 'scheduled',
    distance: 35,
    length: 200,
    weight: 380,
    speed: 158,
    maxSpeed: 160,
    signalState: 'green',
    stops: [
      { station: 'Warszawa Centralna', arrival: '08:15', departure: '08:18', platform: '4', type: 'ph' },
      { station: 'Skierniewice', arrival: '08:48', departure: '08:50', platform: 'II 3', type: 'ph' },
      { station: 'Łowicz Główny', arrival: '09:12', departure: '09:14', platform: '1', type: 'ph' },
    ],
  },
  {
    number: '16204',
    type: 'MOJ',
    category: 'passenger',
    driver: 'bot',
    priority: 5,
    line: '1',
    from: 'Łódź Widzew',
    toPost: 'Skierniewice M',
    arrival: '08:55',
    departure: '08:57',
    platform: 'I 1',
    delay: 5,
    status: 'enroute',
    distance: 12.4,
    length: 140,
    weight: 260,
    speed: 100,
    maxSpeed: 120,
    signalState: 'green',
    stops: [
      { station: 'Łódź Widzew', arrival: '07:50', departure: '07:53', platform: '2', type: 'ph' },
      { station: 'Koluszki', arrival: '08:15', departure: '08:20', platform: 'I 1', type: 'ph' },
      { station: 'Rogów', arrival: '08:32', departure: '08:33', platform: '1', type: 'ph' },
      { station: 'Skierniewice', arrival: '08:55', departure: '08:57', platform: 'I 1', type: 'ph' },
      { station: 'Warszawa Centralna', arrival: '09:45', departure: '09:50', platform: '4', type: 'ph' },
    ],
  },
  {
    // Demo: platform I 1 with 08:56-08:58 window overlaps train 16204
    // (I 1, 08:55-08:57) — surfaces conflict detection in mock data.
    number: '40684',
    type: 'ROJ',
    category: 'passenger',
    driver: 'bot',
    priority: 5,
    line: '11',
    from: 'Płyćwia',
    toPost: 'Skierniewice S',
    arrival: '08:56',
    departure: '08:58',
    platform: 'I 1',
    delay: 0,
    status: 'approaching',
    distance: 2.1,
    length: 90,
    weight: 180,
    speed: 75,
    maxSpeed: 100,
    signalState: 'yellow',
    stops: [
      { station: 'Łowicz Główny', arrival: '08:29', departure: '08:32', platform: '1', type: 'ph' },
      { station: 'Płyćwia', arrival: '08:46', departure: '08:47', platform: '1', type: 'ph' },
      { station: 'Skierniewice', arrival: '08:56', departure: '08:58', platform: 'I 1', type: 'ph' },
      { station: 'Rogów', arrival: '09:06', departure: '09:07', platform: '1', type: 'ph' },
      { station: 'Koluszki', arrival: '09:19', departure: '09:22', platform: 'I 2', type: 'ph' },
    ],
  },
  {
    number: '44501',
    type: 'TME',
    category: 'freight',
    driver: 'bot',
    priority: 6,
    line: '1',
    from: 'Warszawa Praga',
    toPost: 'Skierniewice M',
    arrival: '09:10',
    departure: '09:25',
    platform: '-',
    delay: 18,
    status: 'enroute',
    distance: 28,
    length: 560,
    weight: 2100,
    speed: 55,
    maxSpeed: 90,
    signalState: 'red',
    stops: [
      { station: 'Warszawa Praga', arrival: '07:30', departure: '07:50', platform: 'Tow.', type: 'tech' },
      { station: 'Pruszków', arrival: '08:15', departure: '08:20', platform: 'Tow.', type: 'tech' },
      { station: 'Grodzisk Mazowiecki', arrival: '08:35', departure: '08:40', platform: 'Tow.', type: 'tech' },
      { station: 'Skierniewice', arrival: '09:10', departure: '09:25', platform: '-', type: 'tech' },
      { station: 'Koluszki', arrival: '10:15', departure: '10:35', platform: 'Tow.', type: 'tech' },
    ],
  },
  {
    number: '13109',
    type: 'EIE',
    category: 'passenger',
    driver: 'bot',
    priority: 2,
    line: '1',
    from: 'Warszawa Centralna',
    toPost: 'Skierniewice P',
    arrival: '09:14',
    departure: '09:16',
    platform: 'II 3',
    delay: 0,
    status: 'scheduled',
    distance: 48,
    length: 200,
    weight: 380,
    speed: 160,
    maxSpeed: 160,
    signalState: 'green',
    stops: [
      { station: 'Warszawa Centralna', arrival: '08:45', departure: '08:48', platform: '4', type: 'ph' },
      { station: 'Skierniewice', arrival: '09:14', departure: '09:16', platform: 'II 3', type: 'ph' },
      { station: 'Łowicz Główny', arrival: '09:38', departure: '09:40', platform: '1', type: 'ph' },
    ],
  },
  {
    number: '24219',
    type: 'ROJ',
    category: 'passenger',
    driver: 'player',
    priority: 5,
    line: '1',
    from: 'Koluszki',
    toPost: 'Skierniewice S',
    arrival: '09:18',
    departure: '09:20',
    platform: 'I 2',
    delay: 1,
    status: 'scheduled',
    distance: 15,
    length: 90,
    weight: 180,
    speed: 92,
    maxSpeed: 120,
    signalState: 'green',
    stops: [
      { station: 'Koluszki', arrival: '08:55', departure: '08:58', platform: 'I 2', type: 'ph' },
      { station: 'Rogów', arrival: '09:07', departure: '09:08', platform: '1', type: 'ph' },
      { station: 'Skierniewice', arrival: '09:18', departure: '09:20', platform: 'I 2', type: 'ph' },
      { station: 'Płyćwia', arrival: '09:30', departure: '09:31', platform: '1', type: 'ph' },
    ],
  },
]

// Deterministic per-server view of the mock TRAINS list.
// Each server gets a stable subset + a stable delay jitter so switching
// servers produces a visibly different (but reproducible) timetable.
// Phase 4 will replace this with a live fetch to the SimRail API.
function hashCode(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function trainsForServer(code: string): Train[] {
  const seed = hashCode(code)
  // Rank each train by a stable per-server hash — lowest ranks are kept.
  const ranked = TRAINS.map((t, i) => ({
    t,
    i,
    rank: hashCode(code + ':' + t.number),
  })).sort((a, b) => a.rank - b.rank)

  // How many trains this server carries. PL1 = flagship (all). Others vary.
  const min = 4
  const max = TRAINS.length
  const keep =
    code === 'pl1' ? max : min + (seed % (max - min + 1))

  return ranked.slice(0, keep).map(({ t, i }) => {
    const jitter = ((hashCode(code + ':d:' + t.number) % 7) - 3) // -3..+3
    const newDelay = Math.max(-3, t.delay + jitter)
    return {
      ...t,
      delay: newDelay,
      // Give some variance to speed too so live view feels alive per-server.
      speed:
        t.status === 'standing'
          ? 0
          : Math.max(
              0,
              Math.min(
                t.maxSpeed,
                t.speed + (((seed + i) % 21) - 10),
              ),
            ),
    }
  })
}
