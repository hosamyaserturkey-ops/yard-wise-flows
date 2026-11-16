/**
 * The yard list is remembered so every screen does not ask for it again, but
 * only for the person it was loaded for. What a person may see depends on who
 * they are (a car-lot admin sees their own yard, the owner sees all), so a list
 * loaded for nobody, or for someone else, must never be reused.
 *
 * It used to be one list for the whole browser session. Opening the app signed
 * out cached an empty list, and signing in afterwards kept using it, so a
 * car-lot admin was shown the container yard's screens.
 */
export interface CachedYards<T> {
  userId: string;
  yards: T[];
}

/** The remembered list if it belongs to this user, else null (it must be loaded). */
export function cachedFor<T>(cache: CachedYards<T> | null, userId: string | null | undefined): T[] | null {
  if (!cache || !userId || cache.userId !== userId) return null;
  return cache.yards;
}
