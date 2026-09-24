/** The engine's name as it appears in render records and logs. */
export const ENGINE_NAME = 'hyperframes' as const;

export const ENGINE_VERSION = '1.2.0';

/**
 * The scene contract: what a scene is told and what it must return.
 *
 * Part of every cache key. A scene written under an older contract was written
 * to rules that are no longer the rules, and serving it again would make the
 * master differ from what the current engine would produce for no reason the
 * render record could explain.
 */
export const SCENE_CONTRACT_VERSION = 4;
