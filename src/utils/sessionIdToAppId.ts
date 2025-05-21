// Use a Map to store the session ID to app ID mapping
const sessionIdToAppIdMap = new Map<string, string>();

/**
 * Stores the app ID associated with a given session ID.
 * @param sessionId The unique session identifier.
 * @param appId The app ID (or API key) to store.
 */
export function setAppId(sessionId: string, appId: string): void {
  if (!sessionId || typeof sessionId !== 'string') {
    console.warn('Attempted to set app ID with invalid session ID:', sessionId);
    return;
  }
  if (!appId || typeof appId !== 'string') {
    console.warn('Attempted to set invalid app ID for session ID:', sessionId);
    // Decide if you want to store potentially invalid IDs or return/throw
    // Storing it for now, but validation might be desired.
  }
  sessionIdToAppIdMap.set(sessionId, appId);
}

/**
 * Retrieves the app ID associated with a given session ID.
 * @param sessionId The unique session identifier.
 * @returns The associated app ID, or undefined if not found.
 */
export function getAppId(sessionId: string): string | undefined {
  if (!sessionId || typeof sessionId !== 'string') {
    console.warn('Attempted to get app ID with invalid session ID:', sessionId);
    return undefined;
  }
  return sessionIdToAppIdMap.get(sessionId);
}

/**
 * Deletes the mapping for a given session ID.
 * @param sessionId The unique session identifier to remove.
 */
export function deleteAppId(sessionId: string): void {
  if (!sessionId || typeof sessionId !== 'string') {
    console.warn('Attempted to delete app ID with invalid session ID:', sessionId);
    return;
  }
  sessionIdToAppIdMap.delete(sessionId);
}

// Optional: Function to clear the entire map, e.g., for testing or specific resets
export function clearAllAppIds(): void {
  sessionIdToAppIdMap.clear();
}

// Optional: Function to get the current size, useful for debugging
export function getAppIdMapSize(): number {
  return sessionIdToAppIdMap.size;
}
