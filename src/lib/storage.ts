import { useEffect, useState } from 'react'

const PREFIX = 'simrail-edr:'

function read<T>(key: string, initial: T): T {
  if (typeof window === 'undefined') return initial
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (raw === null) return initial
    return JSON.parse(raw) as T
  } catch {
    return initial
  }
}

export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, initial))

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // ignore quota / private mode
    }
  }, [key, value])

  return [value, setValue]
}
