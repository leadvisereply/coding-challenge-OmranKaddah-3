# Agent Instructions

## Repository Context

This is a plain browser JavaScript coding challenge. The judged entry point is `solution.js`, which must expose a global `Stacker` class with a synchronous `turn(cell)` method.

Do not modify `challenge.js`, `challenge.html`, `Slider.js`, or static assets unless the user explicitly asks for simulator changes. Treat `README..md` as the original challenge statement.

## JavaScript Practices

- Keep `solution.js` dependency-free and build-free. It should run directly in the browser after `challenge.js` loads.
- Return only legal action strings from `turn(cell)`: `"left"`, `"up"`, `"right"`, `"down"`, `"pickup"`, or `"drop"`.
- Do not read the DOM, canvas, global simulator internals, timers, or private variables from `challenge.js` inside the agent.
- Do not use async work in `turn(cell)`. The simulator expects an immediate string return.
- Avoid `console.log` in benchmark code because it distorts runtime and can make ultrafast runs unusably slow.
- Prefer constants for tile and action names over repeated magic numbers or strings.
- Keep movement and planning logic deterministic. If randomness is added for exploration, make it a fallback only and document why.
- Use small helper methods for BFS, map lookup, action validation, and pickup/drop state updates.
- Always model pickup/drop carefully: pickup lowers the current tile and agent by 1; drop raises both by 1.
- Validate planned actions against the current `cell` before returning them so internal state stays aligned with the simulator.
- Prefer action constants and a direction lookup map (for example `DIRECTION_BY_ACTION`) over repeated string comparisons and repeated scans through direction arrays.
- For coordinate-keyed dictionaries (`known`, `visited`, `reserved`, `previous`, `distances`), prefer `Object.create(null)` maps to avoid prototype-key collisions.
- Avoid `Array.prototype.shift()` in hot loops; use a queue cursor/index and helper methods like `hasQueuedAction`, `takeQueuedAction`, and `clearQueue`.
- Keep refactors behavior-preserving first, then verify with both `node --check solution.js` and benchmark runs before treating the change as an optimization.

## Testing Practices

- Run `node --check solution.js` after edits.
- Run the browser `challenge.html` runner with Ultrafast enabled for final manual validation.
- When using a local test harness, keep it outside the submitted files or clearly separate it from challenge code.
- Benchmark over at least 100 generated maps and record wins, average turns, max turns, p95 turns, invalid actions, and runtime.
