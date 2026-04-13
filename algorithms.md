# Algorithms

This file explains the algorithms used by `solution.js` and the local benchmark variants in `scripts/benchmark_methods.js`.

## 1. Main Agent Loop

The `Stacker` class is stateful. On every call to `turn(cell)`, it updates its local map, tries to continue a queued path, asks the planner for a new action, validates that action against the current observed cell, and only then commits the internal state change.

This keeps the agent deterministic and prevents stale plans from desynchronizing the local map from the simulator.

Pseudocode:

```text
turn(cell):
    observe(cell)

    if queued path has actions:
        action = consume next queued action (queue cursor)
        if action is legal in current cell:
            commit action to internal state
            return action
        clear queued path

    action = nextAction(cell)
    if action is legal in current cell:
        commit action to internal state
        return action

    action = fallbackAction(cell)
    if action is legal in current cell:
        commit action to internal state
        return action

    return "up"
```

## 2. Local Map Observation

The simulator only gives the current tile and its four neighbors. The agent creates its own relative coordinate system, starting at `(0, 0)`, and stores every observed tile in `known`.

When the agent moves, it updates its relative `(x, y)`. When it sees gold, it stores the gold position and height.

Pseudocode:

```text
observe(cell):
    save current cell at current position

    for each direction in up, right, down, left:
        neighborPosition = currentPosition + direction offset
        save neighbor tile at neighborPosition

        if neighbor tile is gold:
            remember gold position and level

    if current cell is gold:
        remember current position as gold position
```

## 3. Shortest Path BFS

Most navigation uses breadth-first search over known tiles. A tile is traversable when it is known, is not a wall, is not gold unless explicitly allowed, and differs from the current tile height by at most `1`.

The BFS records the previous tile and action for every visited position. Once it reaches the target, it reconstructs the action list by walking backward through the `previous` table.

Pseudocode:

```text
findPathTo(start, predicate):
    if start tile is unknown:
        return null

    if predicate(start tile):
        return empty path

    queue = [start]
    visited = { start }
    previous = empty map

    while queue is not empty:
        current = next item in queue

        for each direction:
            next = current + direction offset

            if next was visited:
                continue

            if current tile cannot move to next tile:
                continue

            mark next as visited
            previous[next] = { from: current, action: direction }

            if predicate(next tile):
                return reconstructPath(start, next, previous)

            add next to queue

    return null
```

```text
reconstructPath(start, end, previous):
    actions = []
    cursor = end

    while cursor is not start:
        step = previous[cursor]
        if step does not exist:
            return null
        append step.action to actions
        cursor = step.from

    reverse actions
    return actions
```

## 4. Exploration

Before the agent knows the gold position or enough block supply, it explores the nearest known tile that has at least one unknown neighbor. This expands the map while only moving through currently legal known terrain.

If no BFS frontier exists, it chooses the first legal known neighbor. If even that fails, it rotates through directions as a deterministic fallback.

Pseudocode:

```text
explore():
    path = BFS path to nearest tile with an unknown neighbor

    if path exists and is not empty:
        queue all path actions after the first one
        return first path action

    action = first legal known neighboring move
    if action exists:
        return action

    return next direction from deterministic fallback rotation
```

## 5. Staircase Planning

Once gold is known, the agent searches for a staircase path of length equal to the gold height. The path ends next to the gold and starts at a level `0` base tile. It is built backward from the gold, using a bounded depth-first search over known, non-wall, non-gold tiles.

Each candidate path is filtered and scored:

- The base must be reachable from the current position.
- The staircase must not require more drops than the reachable block capacity near the base can provide.
- Lower score is better: entry path length + needed drops - a small capacity bonus.

Pseudocode:

```text
planStaircase():
    if gold is unknown:
        return null

    candidates = []
    height = gold.level

    for each tile adjacent to gold:
        if tile can be used as the highest stair step:
            collectStairPaths(tile, [tile], height, candidates)

    bestPath = null
    bestScore = infinity

    for each path in candidates:
        entryPath = BFS path from current position to path base
        if entryPath does not exist:
            continue

        neededDrops = total drops needed to raise path
        capacity = reachable block capacity from path base
        if capacity < neededDrops:
            continue

        score = entryPath length + neededDrops - capacity / 10
        if score < bestScore:
            bestScore = score
            bestPath = path

    return bestPath
```

```text
collectStairPaths(current, pathFromGold, height, candidates):
    if too many candidates were already found:
        return

    if pathFromGold length equals height:
        staircase = reverse(pathFromGold)
        if staircase base has level 0:
            add staircase to candidates
        return

    targetIndexFromStart = height - pathFromGold length - 1

    for each direction:
        next = current + direction offset

        if next is already in pathFromGold:
            continue

        if next cannot be used as stair tile at targetIndexFromStart:
            continue

        append next to pathFromGold
        collectStairPaths(next, pathFromGold, height, candidates)
        remove next from pathFromGold
```

## 6. Stair Tile Suitability

A tile can be part of the planned staircase if it is known, is not a wall, is not gold, and is not already higher than the level it should eventually support.

This avoids planning a ramp through blocked terrain or through a height that would make the staircase impossible to build layer by layer.

Pseudocode:

```text
canUseStairTile(x, y, targetLevel):
    tile = known tile at (x, y)

    if tile is unknown:
        return false

    if tile is wall or gold:
        return false

    return tile.level <= targetLevel
```

## 7. Needed Drops Calculation

The planned staircase path is indexed from base to gold. The base stays at level `0`, step `1` should reach level `1`, step `2` should reach level `2`, and so on.

For each step, the agent counts how many more blocks must be dropped to reach the target level.

Pseudocode:

```text
neededDropsFor(path):
    drops = 0

    for index from 1 to path length - 1:
        tile = known tile at path[index]
        currentLevel = tile.level or 0
        targetLevel = index
        drops += max(0, targetLevel - currentLevel)

    return drops
```

## 8. Block Capacity Check

A candidate staircase is only accepted if enough blocks are reachable from the base while avoiding reserved staircase tiles. This prevents the agent from selecting a ramp that becomes a dead end after it starts raising the higher steps.

The algorithm runs a BFS from the base, skips reserved staircase cells, and sums the levels of reachable non-reserved block tiles.

Pseudocode:

```text
sourceCapacityFromBase(path):
    reserved = all tiles in path
    start = path base
    queue = [start]
    visited = { start }
    capacity = 0

    while queue is not empty:
        current = next item in queue

        for each direction:
            next = current + direction offset

            if next was visited:
                continue

            if next is reserved:
                continue

            if current tile cannot move to next tile:
                continue

            mark next as visited

            if next is a block with level greater than 0:
                capacity += next.level

            add next to queue

    return capacity
```

## 9. Known Block Supply Gate

Even after a staircase is planned, the agent may keep exploring until it knows enough reachable source blocks. If exploration is still possible, it requires a small reserve so it does not start building too early with a fragile supply estimate.

Pseudocode:

```text
hasEnoughKnownBlocks():
    if no staircase is planned:
        return false

    reachable = BFS distances from current position
    needed = neededDropsFor(staircase)
    available = 1 if carrying a block else 0

    for each known tile:
        if tile is reachable and tile is a valid source block:
            available += tile.level

    reserve = 0
    if not currently building and a reachable frontier still exists:
        reserve = 4

    return available >= needed + reserve
```

## 10. Layer-By-Layer Stair Building

The staircase is built by layers instead of completing one tile at a time. For a gold height of `8`, the agent first raises every future step from index `1` through `7` to level `1`, then raises index `2` through `7` to level `2`, and continues until the last step reaches level `7`.

This keeps the ramp traversable because adjacent stair tiles never get too far apart in height.

Pseudocode:

```text
nextStairTarget():
    for layer from 1 to gold.level - 1:
        for index from layer to staircase length - 1:
            step = staircase[index]
            tile = known tile at step

            if tile is unknown or tile.level < layer:
                return { step.x, step.y, targetLevel: layer }

    return null
```

## 11. Safe Source Selection

To get a block, the agent runs BFS over reachable tiles and evaluates each safe source tile with a target-aware score:

- walk distance from agent to source
- plus path length from source to current stair target after simulated pickup
- minus a small bonus for multi-level sources (to reduce revisits)

Before scoring a source, it simulates pickup locally because pickup lowers both tile and agent by `1`. The agent temporarily applies that change to the known map, checks pathability to the current build target, and restores the original tile.

The BFS loop can stop early once the current BFS distance is already worse than the best known full-trip score.

Pseudocode:

```text
pathToNearestSafeSource(target):
    run BFS from current position
    bestSource = none
    bestScore = infinity

    for each reachable tile in BFS order:
        if tile is not a valid source:
            continue

        pathToTarget = pathFromSourceAfterPickup(tile, target)
        if pathToTarget does not exist:
            continue

        score = distance(agent -> tile) + length(pathToTarget) - sourceLevelBonus(tile)
        if score is better than bestScore:
            bestSource = tile
            bestScore = score

        if current BFS distance >= bestScore:
            break

    if bestSource exists:
        return path from current position to bestSource

    return null
```

```text
pathFromSourceAfterPickup(source, target):
    if source is not a block with level greater than 0:
        return null

    save original source tile
    lower source tile by 1 in known map
    if lowered level is 0, mark source as empty

    path = BFS path from source to target

    restore original source tile
    return path
```

## 12. Build Action Selection

The planner alternates between carrying a block to the next build target and finding another safe block source. If the agent is carrying and standing on the target, it drops. If it is not carrying and standing on a safe source, it picks up.

Pseudocode:

```text
nextAction(cell):
    if gold is unknown:
        return explore()

    if no staircase is planned and enough new map was discovered:
        staircase = planStaircase()
        if staircase exists:
            reserve all staircase tiles

    if no staircase exists or not enough blocks are known:
        return explore()

    target = nextStairTarget()
    if target does not exist:
        return finish()

    if carrying a block:
        if current position equals target:
            return "drop"
        return move toward target

    if current cell is a safe source and pickup still leaves a path to target:
        mark building as true
        return "pickup"

    path = path to nearest safe source for target
    if path exists:
        mark building as true
        queue path actions after the first one
        return first path action

    return explore()
```

## 13. Finish Step

When all needed staircase levels are complete, the agent moves to the final stair step and then moves onto the adjacent gold tile.

Normal BFS avoids stepping on gold, so the final move uses a direct direction lookup.

Pseudocode:

```text
finish():
    lastStep = final tile in staircase

    if current position is not lastStep:
        return move toward lastStep

    return direction from current position to gold
```

## 14. Action Validation And State Commit

Every planned action is checked against the current observed `cell` before it is returned. Movement is legal if the target is not a wall and the height difference is at most `1`. Pickup is legal only when not already carrying and standing on a block. Drop is legal only when carrying.

After a valid action is chosen, the agent updates its internal position or tile state to match the simulator mechanics.

Pseudocode:

```text
isLegal(action, cell):
    if action is "pickup":
        return not carrying and current cell is a block

    if action is "drop":
        return carrying

    if action is a direction:
        target = neighboring cell in that direction
        return target is not wall and abs(target.level - cell.level) <= 1

    return false
```

```text
commit(action, cell):
    if action is "pickup":
        carrying = true
        lower current known tile by 1
        if new level is 0, mark tile as empty
        return action

    if action is "drop":
        carrying = false
        raise current known tile by 1
        mark tile as block
        return action

    if action is a direction:
        update current x and y by direction offset
        return action
```

## 15. Benchmark Variant Algorithms

The submitted `solution.js` uses the robust explorer described above. The local benchmark script also compares a few small variants. These variants reuse the same core algorithms and only change replanning or supply thresholds.

### Robust Explorer

Uses the default `solution.js` behavior:

- Replans staircase candidates after every `6` newly discovered tiles.
- Requires a reserve of `4` extra reachable block levels when not yet building and exploration is still available.
- Never consumes reserved staircase tiles as source blocks.

Pseudocode:

```text
shouldPlanStaircase():
    return knownCount - lastPlanKnownCount >= 6

knownBlockReserve():
    if not building and reachable frontier exists:
        return 4
    return 0
```

### Aggressive Fast

Tries to start sooner. It replans more often and uses a smaller reserve, which can reduce turns but gives less safety margin.

Pseudocode:

```text
shouldPlanStaircase():
    return knownCount - lastPlanKnownCount >= 4

knownBlockReserve():
    if not building and reachable frontier exists:
        return 2
    return 0
```

### Balanced Fast

Uses the same thresholds as `solution.js` in the benchmark harness. It is kept as a named benchmark variant for comparison.

Pseudocode:

```text
shouldPlanStaircase():
    return knownCount - lastPlanKnownCount >= 6

knownBlockReserve():
    if not building and reachable frontier exists:
        return 4
    return 0
```

### Conservative Safe

Waits longer before replanning and requires more reserve block supply. This favors reliability over speed.

Pseudocode:

```text
shouldPlanStaircase():
    return knownCount - lastPlanKnownCount >= 10

knownBlockReserve():
    if not building and reachable frontier exists:
        return 8
    return 0
```

### Adaptive Replan

Uses the base robust explorer, but watches for repeated behavior while building. If it appears stuck on the same target/action pattern for too long, it clears the staircase plan and explores so it can plan again with newer map information.

Pseudocode:

```text
nextAction(cell):
    action = robustExplorerNextAction(cell)
    targetKey = current stair target and target level, or "done"

    if staircase exists
       and not carrying
       and queued path is empty
       and targetKey equals lastTargetKey
       and action equals lastAction:
        stuckCount += 1
    else:
        stuckCount = 0

    lastTargetKey = targetKey
    lastAction = action

    if stuckCount > 40 and not carrying:
        clear staircase
        clear reserved tiles
        mark building as false
        allow near-term replanning
        stuckCount = 0
        return explore()

    return action
```
