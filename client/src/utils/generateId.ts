// src/utils/generateId.ts
/**
 * generateId(prefix)
 *
 * Single source of truth for client-side entity ID generation.
 * Replaces the duplicated generateRoomId() in roomSlice.ts and
 * roomActions.js — the roomActions.js copy was never actually
 * replaced with the FIX-R5 import despite the changelog claiming it was.
 *
 * Format: `${prefix}_${timestamp}_${random5}`
 */
export const generateId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;