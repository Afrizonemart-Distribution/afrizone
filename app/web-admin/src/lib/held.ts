/**
 * Stores and couriers are on hold (server: src/util/held.ts). Their screens and
 * settings are hidden here; the server answers 404 behind them regardless.
 */
export const HELD = { stores: true, couriers: true } as const
