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
  maxSpeed: number
  signalState: SignalState
  stops: Stop[]
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
      direction: toPost,
      color: 'dest-other',
      badge: '?',
    }
  )
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
