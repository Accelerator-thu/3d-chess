/* ai-worker.js — runs the engine's search off the main thread so the board stays
 * responsive while the AI thinks. Protocol:
 *   in : { id, size, dims, gravity, moves: [cell...], level }
 *   out: { id, cell, depth, score, nodes } | { id, error }
 */
importScripts("./engine.js");

self.onmessage = (e) => {
  const { id, size, dims, gravity, moves, level } = e.data;
  try {
    const game = new FourEngine.Game(size, dims, gravity);
    for (const c of moves) game.play(c);
    const res = FourEngine.chooseMove(game, level);
    self.postMessage({ id, ...res });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
