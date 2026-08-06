export type Station = {
  id: string
  name: string
  difficulty: number
  multiPost: boolean
}

export type Train = {
  number: string
  type: string
  category: 'passenger' | 'freight'
  from: string
  toPost: string
  arrival: string
  departure: string
  platform: string
  delay: number
  status: 'approaching' | 'enroute' | 'standing' | 'scheduled'
  distance: number
}

export type DestinationInfo = {
  next: string
  direction: string
  color: string
  badge: string
}

export const STATIONS: Station[] = [
  { id: 'ske', name: 'Skierniewice', difficulty: 5, multiPost: true },
  { id: 'ply', name: 'Płyćwia', difficulty: 2, multiPost: false },
  { id: 'rog', name: 'Rogów', difficulty: 1, multiPost: false },
  { id: 'zyr', name: 'Żyrardów', difficulty: 3, multiPost: false },
  { id: 'kol', name: 'Koluszki', difficulty: 4, multiPost: true },
  { id: 'grodzisk', name: 'Grodzisk Mazowiecki', difficulty: 4, multiPost: false },
  { id: 'pruszkow', name: 'Pruszków', difficulty: 4, multiPost: false },
]

// KEY FIX: Map internal post codes → real next stations
export const POST_DESTINATION_MAP: Record<string, DestinationInfo> = {
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
}

export const TRAINS: Train[] = [
  {
    number: '13103',
    type: 'EIE',
    category: 'passenger',
    from: 'Warszawa Centralna',
    toPost: 'Skierniewice P',
    arrival: '08:14',
    departure: '08:16',
    platform: 'II 3',
    delay: -2,
    status: 'approaching',
    distance: 4.2,
  },
  {
    number: '16122',
    type: 'MOJ',
    category: 'passenger',
    from: 'Łódź Fabryczna',
    toPost: 'Skierniewice M',
    arrival: '08:21',
    departure: '08:23',
    platform: 'I 1',
    delay: 3,
    status: 'approaching',
    distance: 7.8,
  },
  {
    number: '44612',
    type: 'TME',
    category: 'freight',
    from: 'Łódź Olechów',
    toPost: 'Skierniewice M',
    arrival: '08:28',
    departure: '08:35',
    platform: '-',
    delay: 12,
    status: 'enroute',
    distance: 18.5,
  },
  {
    number: '13105',
    type: 'EIE',
    category: 'passenger',
    from: 'Warszawa Wschodnia',
    toPost: 'Skierniewice P',
    arrival: '08:32',
    departure: '08:34',
    platform: 'II 4',
    delay: 0,
    status: 'scheduled',
    distance: 22,
  },
  {
    number: '24217',
    type: 'ROJ',
    category: 'passenger',
    from: 'Koluszki',
    toPost: 'Skierniewice S',
    arrival: '08:37',
    departure: '08:39',
    platform: 'I 2',
    delay: -1,
    status: 'approaching',
    distance: 3.1,
  },
  {
    number: '44108',
    type: 'TNE',
    category: 'freight',
    from: 'Skierniewice',
    toPost: 'Skierniewice P',
    arrival: '08:41',
    departure: '08:50',
    platform: 'Tow.',
    delay: 8,
    status: 'standing',
    distance: 0,
  },
  {
    number: '13107',
    type: 'EIE',
    category: 'passenger',
    from: 'Warszawa Centralna',
    toPost: 'Skierniewice P',
    arrival: '08:48',
    departure: '08:50',
    platform: 'II 3',
    delay: 0,
    status: 'scheduled',
    distance: 35,
  },
  {
    number: '16204',
    type: 'MOJ',
    category: 'passenger',
    from: 'Łódź Widzew',
    toPost: 'Skierniewice M',
    arrival: '08:55',
    departure: '08:57',
    platform: 'I 1',
    delay: 5,
    status: 'enroute',
    distance: 12.4,
  },
  {
    number: '40684',
    type: 'ROJ',
    category: 'passenger',
    from: 'Płyćwia',
    toPost: 'Skierniewice S',
    arrival: '09:02',
    departure: '09:04',
    platform: 'I 2',
    delay: -3,
    status: 'approaching',
    distance: 5.6,
  },
  {
    number: '44501',
    type: 'TME',
    category: 'freight',
    from: 'Warszawa Praga',
    toPost: 'Skierniewice M',
    arrival: '09:10',
    departure: '09:25',
    platform: '-',
    delay: 18,
    status: 'enroute',
    distance: 28,
  },
  {
    number: '13109',
    type: 'EIE',
    category: 'passenger',
    from: 'Warszawa Centralna',
    toPost: 'Skierniewice P',
    arrival: '09:14',
    departure: '09:16',
    platform: 'II 3',
    delay: 0,
    status: 'scheduled',
    distance: 48,
  },
  {
    number: '24219',
    type: 'ROJ',
    category: 'passenger',
    from: 'Koluszki',
    toPost: 'Skierniewice S',
    arrival: '09:18',
    departure: '09:20',
    platform: 'I 2',
    delay: 1,
    status: 'scheduled',
    distance: 15,
  },
]

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
