/**
 * Ambient chevron-motif overlay (fixed, behind everything).
 *
 * Previously also rendered an animated gradient-mesh (four blurred blobs) and a
 * grain layer. Both existed to give the near-black dark theme some depth; on
 * the sand ground they read as stains rather than atmosphere, so they were
 * removed along with their CSS when the admin moved to the light palette.
 */
export default function Background() {
  return <div className="app-motif" aria-hidden="true" />
}
