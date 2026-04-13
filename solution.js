const TILE_EMPTY = 0;
const TILE_WALL = 1;
const TILE_BLOCK = 2;
const TILE_GOLD = 3;

const ACTION_UP = "up";
const ACTION_RIGHT = "right";
const ACTION_DOWN = "down";
const ACTION_LEFT = "left";
const ACTION_PICKUP = "pickup";
const ACTION_DROP = "drop";

const DIRECTIONS = [
	{ name: ACTION_UP, dx: 0, dy: -1 },
	{ name: ACTION_RIGHT, dx: 1, dy: 0 },
	{ name: ACTION_DOWN, dx: 0, dy: 1 },
	{ name: ACTION_LEFT, dx: -1, dy: 0 },
];

const DIRECTION_BY_ACTION = Object.create(null);
for (let i = 0; i < DIRECTIONS.length; i++) {
	const direction = DIRECTIONS[i];
	DIRECTION_BY_ACTION[direction.name] = direction;
}

function createLookup() {
	return Object.create(null);
}

// Stateful local-perception agent. It never reads simulator internals; it builds
// a relative map from the current cell and four observed neighbors.
class Stacker {
	constructor() {
		this.x = 0;
		this.y = 0;
		this.carrying = false;
		this.known = createLookup();
		this.knownCount = 0;
		this.queue = [];
		this.queueIndex = 0;
		this.gold = null;
		this.staircase = null;
		this.reserved = createLookup();
		this.building = false;
		this.lastPlanKnownCount = -8;
		this.lastFallback = 0;
	}

	turn(cell) {
		this.observe(cell);

		if (this.hasQueuedAction()) {
			const next = this.takeQueuedAction();
			if (this.isLegal(next, cell)) {
				return this.commit(next, cell);
			}
			this.clearQueue();
		}

		const planned = this.nextAction(cell);
		if (this.isLegal(planned, cell)) {
			return this.commit(planned, cell);
		}

		const fallback = this.fallbackAction(cell);
		if (this.isLegal(fallback, cell)) {
			return this.commit(fallback, cell);
		}
		return ACTION_UP;
	}

	hasQueuedAction() {
		return this.queueIndex < this.queue.length;
	}

	takeQueuedAction() {
		const action = this.queue[this.queueIndex];
		this.queueIndex += 1;
		if (this.queueIndex >= this.queue.length) {
			this.clearQueue();
		}
		return action;
	}

	clearQueue() {
		this.queue = [];
		this.queueIndex = 0;
	}

	nextAction(cell) {
		if (!this.gold) {
			return this.explore();
		}

		if (!this.building && !this.staircase && this.shouldPlanStaircase()) {
			const staircase = this.planStaircase();
			this.lastPlanKnownCount = this.knownCount;
			if (staircase) {
				this.staircase = staircase;
				this.reserved = this.buildReservedSet(this.staircase);
			}
		}

		if (!this.staircase || !this.hasEnoughKnownBlocks()) {
			return this.explore();
		}

		const target = this.nextStairTarget();
		if (!target) {
			return this.finish();
		}

		if (this.carrying) {
			if (this.samePosition(target)) {
				return ACTION_DROP;
			}
			return this.moveToward(target);
		}

		if (
			cell.type === TILE_BLOCK &&
			this.isSource(this.x, this.y) &&
			this.pathFromSourceAfterPickup({ x: this.x, y: this.y }, target)
		) {
			this.building = true;
			return ACTION_PICKUP;
		}

		const sourcePath = this.pathToNearestSafeSource(target);
		if (sourcePath) {
			this.building = true;
			return this.enqueueAndTake(sourcePath);
		}

		return this.explore();
	}

	observe(cell) {
		this.setTile(this.x, this.y, cell.type, cell.level);

		for (let i = 0; i < DIRECTIONS.length; i++) {
			const direction = DIRECTIONS[i];
			const neighbor = cell[direction.name];
			const nx = this.x + direction.dx;
			const ny = this.y + direction.dy;
			this.setTile(nx, ny, neighbor.type, neighbor.level);
			if (neighbor.type === TILE_GOLD) {
				this.gold = { x: nx, y: ny, level: neighbor.level };
			}
		}

		if (cell.type === TILE_GOLD) {
			this.gold = { x: this.x, y: this.y, level: cell.level };
		}
	}

	setTile(x, y, type, level) {
		const key = this.key(x, y);
		if (!this.known[key]) {
			this.knownCount++;
		}
		this.known[key] = { type, level };
	}

	getTile(x, y) {
		return this.known[this.key(x, y)];
	}

	key(x, y) {
		return x + "," + y;
	}

	samePosition(position) {
		return this.x === position.x && this.y === position.y;
	}

	isReserved(x, y) {
		return !!this.reserved[this.key(x, y)];
	}

	buildReservedSet(staircase) {
		const reserved = createLookup();
		if (!staircase) {
			return reserved;
		}
		for (let i = 0; i < staircase.length; i++) {
			reserved[this.key(staircase[i].x, staircase[i].y)] = true;
		}
		return reserved;
	}

	shouldPlanStaircase() {
		return this.knownCount - this.lastPlanKnownCount >= 6;
	}

	isSource(x, y) {
		const tile = this.getTile(x, y);
		return (
			tile &&
			tile.type === TILE_BLOCK &&
			tile.level > 0 &&
			!this.isReserved(x, y) &&
			!this.isGold(x, y)
		);
	}

	isGold(x, y) {
		return !!this.gold && this.gold.x === x && this.gold.y === y;
	}

	nextStairTarget() {
		if (!this.staircase || !this.gold) {
			return null;
		}

		// Build by layers, not by cells: first raise every future step to 1,
		// then the suffix to 2, and so on. This keeps the ramp traversable.
		for (let layer = 1; layer < this.gold.level; layer++) {
			for (let index = layer; index < this.staircase.length; index++) {
				const step = this.staircase[index];
				const tile = this.getTile(step.x, step.y);
				if (!tile || tile.level < layer) {
					return { x: step.x, y: step.y, level: layer };
				}
			}
		}

		return null;
	}

	planStaircase() {
		if (!this.gold) {
			return null;
		}

		const height = this.gold.level;
		const candidates = [];

		for (let i = 0; i < DIRECTIONS.length; i++) {
			const direction = DIRECTIONS[i];
			const endpoint = {
				x: this.gold.x + direction.dx,
				y: this.gold.y + direction.dy,
			};
			const tile = this.getTile(endpoint.x, endpoint.y);
			if (tile && this.canUseStairTile(endpoint.x, endpoint.y, height - 1)) {
				this.collectStairPaths(endpoint, [endpoint], height, candidates);
			}
		}

		let best = null;
		let bestScore = Infinity;
		for (let i = 0; i < candidates.length; i++) {
			const path = candidates[i];
			const entryPath = this.findPath({ x: this.x, y: this.y }, path[0]);
			if (!entryPath) {
				continue;
			}
			const neededDrops = this.neededDropsFor(path);
			const sourceCapacity = this.sourceCapacityFromBase(path);
			if (sourceCapacity < neededDrops) {
				continue;
			}
			const score = entryPath.length + neededDrops - sourceCapacity / 10;
			if (score < bestScore) {
				bestScore = score;
				best = path;
			}
		}

		return best;
	}

	sourceCapacityFromBase(path) {
		const reserved = this.buildReservedSet(path);
		const start = path[0];
		const startKey = this.key(start.x, start.y);
		const queue = [{ x: start.x, y: start.y }];
		const visited = createLookup();
		let capacity = 0;
		visited[startKey] = true;

		// The base must connect to enough non-stair blocks. Otherwise a ramp can
		// become a cul-de-sac once the higher steps are raised.
		for (let cursor = 0; cursor < queue.length; cursor++) {
			const current = queue[cursor];
			const currentTile = this.getTile(current.x, current.y);

			for (let i = 0; i < DIRECTIONS.length; i++) {
				const direction = DIRECTIONS[i];
				const next = {
					x: current.x + direction.dx,
					y: current.y + direction.dy,
				};
				const nextKey = this.key(next.x, next.y);
				const nextTile = this.getTile(next.x, next.y);
				if (
					visited[nextKey] ||
					reserved[nextKey] ||
					!this.canMove(currentTile, nextTile, false)
				) {
					continue;
				}

				visited[nextKey] = true;
				if (nextTile.type === TILE_BLOCK && nextTile.level > 0) {
					capacity += nextTile.level;
				}
				queue.push(next);
			}
		}

		return capacity;
	}

	collectStairPaths(current, pathFromGold, height, candidates) {
		if (candidates.length > 80) {
			return;
		}

		if (pathFromGold.length === height) {
			const staircase = pathFromGold.slice().reverse();
			const start = staircase[0];
			const startTile = this.getTile(start.x, start.y);
			if (startTile && startTile.level === 0) {
				candidates.push(staircase);
			}
			return;
		}

		const targetIndexFromStart = height - pathFromGold.length - 1;
		for (let i = 0; i < DIRECTIONS.length; i++) {
			const direction = DIRECTIONS[i];
			const next = { x: current.x + direction.dx, y: current.y + direction.dy };
			if (this.pathContains(pathFromGold, next.x, next.y)) {
				continue;
			}
			if (!this.canUseStairTile(next.x, next.y, targetIndexFromStart)) {
				continue;
			}
			pathFromGold.push(next);
			this.collectStairPaths(next, pathFromGold, height, candidates);
			pathFromGold.pop();
		}
	}

	canUseStairTile(x, y, targetLevel) {
		const tile = this.getTile(x, y);
		if (!tile || tile.type === TILE_WALL || tile.type === TILE_GOLD) {
			return false;
		}
		return tile.level <= targetLevel;
	}

	pathContains(path, x, y) {
		for (let i = 0; i < path.length; i++) {
			if (path[i].x === x && path[i].y === y) {
				return true;
			}
		}
		return false;
	}

	neededDropsFor(path) {
		let drops = 0;
		for (let i = 1; i < path.length; i++) {
			const tile = this.getTile(path[i].x, path[i].y);
			drops += Math.max(0, i - (tile ? tile.level : 0));
		}
		return drops;
	}

	hasEnoughKnownBlocks() {
		if (!this.staircase) {
			return false;
		}

		const reachable = this.findPathsFrom({ x: this.x, y: this.y }).distances;
		const needed = this.neededDropsFor(this.staircase);
		let available = this.carrying ? 1 : 0;
		const keys = Object.keys(this.known);
		for (let i = 0; i < keys.length; i++) {
			const tile = this.known[keys[i]];
			const position = this.parseKey(keys[i]);
			if (reachable[keys[i]] !== undefined && this.isSource(position.x, position.y)) {
				available += tile.level;
			}
		}

		const reserve = !this.building && this.hasReachableFrontier(reachable) ? 4 : 0;
		return available >= needed + reserve;
	}

	hasReachableFrontier(reachable) {
		const keys = Object.keys(this.known);
		for (let i = 0; i < keys.length; i++) {
			const position = this.parseKey(keys[i]);
			if (reachable[keys[i]] !== undefined && this.hasUnknownNeighbor(position.x, position.y)) {
				return true;
			}
		}
		return false;
	}

	finish() {
		const lastStep = this.staircase[this.staircase.length - 1];
		if (!this.samePosition(lastStep)) {
			return this.moveToward(lastStep);
		}
		return this.directionTo(this.gold);
	}

	moveToward(target) {
		const path = this.findPath({ x: this.x, y: this.y }, target);
		if (path) {
			return this.enqueueAndTake(path);
		}
		return this.explore();
	}

	explore() {
		const path = this.pathToNearest((tile, x, y) => this.hasUnknownNeighbor(x, y));
		if (path && path.length) {
			return this.enqueueAndTake(path);
		}

		const localFrontier = this.bestKnownNeighbor();
		if (localFrontier) {
			return localFrontier;
		}

		return DIRECTIONS[this.lastFallback++ % DIRECTIONS.length].name;
	}

	hasUnknownNeighbor(x, y) {
		const tile = this.getTile(x, y);
		if (!tile || tile.type === TILE_WALL || tile.type === TILE_GOLD) {
			return false;
		}

		for (let i = 0; i < DIRECTIONS.length; i++) {
			const direction = DIRECTIONS[i];
			if (!this.getTile(x + direction.dx, y + direction.dy)) {
				return true;
			}
		}
		return false;
	}

	bestKnownNeighbor() {
		const current = this.getTile(this.x, this.y);
		if (!current) {
			return null;
		}

		for (let i = 0; i < DIRECTIONS.length; i++) {
			const direction = DIRECTIONS[i];
			const tile = this.getTile(this.x + direction.dx, this.y + direction.dy);
			if (tile && this.canMove(current, tile, false)) {
				return direction.name;
			}
		}
		return null;
	}

	pathToNearest(predicate) {
		return this.findPathTo({ x: this.x, y: this.y }, predicate);
	}

	pathToNearestSafeSource(target) {
		const startKey = this.key(this.x, this.y);
		const startTile = this.getTile(this.x, this.y);
		if (!startTile) {
			return null;
		}

		const queue = [{ x: this.x, y: this.y }];
		const visited = createLookup();
		const previous = createLookup();
		const distances = createLookup();
		let best = null;
		let bestScore = Infinity;
		visited[startKey] = true;
		distances[startKey] = 0;

		for (let cursor = 0; cursor < queue.length; cursor++) {
			const current = queue[cursor];
			const currentKey = this.key(current.x, current.y);
			const currentTile = this.getTile(current.x, current.y);
			const currentDistance = distances[currentKey];

			// BFS visits by non-decreasing distance. If the walk-to-source distance
			// already exceeds the best full-trip score, no later node can improve it.
			if (best && currentDistance >= bestScore) {
				break;
			}

			for (let i = 0; i < DIRECTIONS.length; i++) {
				const direction = DIRECTIONS[i];
				const next = {
					x: current.x + direction.dx,
					y: current.y + direction.dy,
				};
				const nextKey = this.key(next.x, next.y);
				const nextTile = this.getTile(next.x, next.y);
				if (visited[nextKey] || !this.canMove(currentTile, nextTile, false)) {
					continue;
				}

				visited[nextKey] = true;
				previous[nextKey] = { key: currentKey, action: direction.name };
				distances[nextKey] = currentDistance + 1;

				if (this.isSource(next.x, next.y)) {
					const pathToTarget = this.pathFromSourceAfterPickup(next, target);
					if (pathToTarget) {
						const nextTileLevel = nextTile.level;
						const sourceBonus = Math.min(2, nextTileLevel - 1) * 0.25;
						const score = distances[nextKey] + pathToTarget.length - sourceBonus;
						if (!best || score < bestScore) {
							best = nextKey;
							bestScore = score;
						}
					}
				}
				queue.push(next);
			}
		}

		if (!best) {
			return null;
		}
		return this.reconstructPath(startKey, best, previous);
	}

	pathFromSourceAfterPickup(source, target) {
		const key = this.key(source.x, source.y);
		const tile = this.known[key];
		if (!tile || tile.type !== TILE_BLOCK || tile.level <= 0) {
			return null;
		}

		const original = { type: tile.type, level: tile.level };
		const nextLevel = tile.level - 1;
		// Pickup lowers both the source tile and the agent. Verify that this
		// source still leaves a path back to the current build target.
		this.known[key] = {
			type: nextLevel > 0 ? TILE_BLOCK : TILE_EMPTY,
			level: nextLevel,
		};
		const path = this.findPath(source, target);
		this.known[key] = original;
		return path;
	}

	findPath(start, target) {
		return this.findPathTo(start, (tile, x, y) => x === target.x && y === target.y);
	}

	findPathsFrom(start) {
		const startKey = this.key(start.x, start.y);
		const startTile = this.getTile(start.x, start.y);
		const distances = createLookup();
		const previous = createLookup();
		if (!startTile) {
			return { distances, previous };
		}

		const queue = [{ x: start.x, y: start.y }];
		distances[startKey] = 0;

		for (let cursor = 0; cursor < queue.length; cursor++) {
			const current = queue[cursor];
			const currentKey = this.key(current.x, current.y);
			const currentTile = this.getTile(current.x, current.y);

			for (let i = 0; i < DIRECTIONS.length; i++) {
				const direction = DIRECTIONS[i];
				const next = {
					x: current.x + direction.dx,
					y: current.y + direction.dy,
				};
				const nextKey = this.key(next.x, next.y);
				const nextTile = this.getTile(next.x, next.y);
				if (distances[nextKey] !== undefined || !this.canMove(currentTile, nextTile, false)) {
					continue;
				}

				distances[nextKey] = distances[currentKey] + 1;
				previous[nextKey] = { key: currentKey, action: direction.name };
				queue.push(next);
			}
		}

		return { distances, previous };
	}

	findPathTo(start, predicate) {
		const startKey = this.key(start.x, start.y);
		const startTile = this.getTile(start.x, start.y);
		if (!startTile) {
			return null;
		}

		if (predicate(startTile, start.x, start.y)) {
			return [];
		}

		const queue = [{ x: start.x, y: start.y }];
		const visited = createLookup();
		const previous = createLookup();
		visited[startKey] = true;

		for (let cursor = 0; cursor < queue.length; cursor++) {
			const current = queue[cursor];
			const currentTile = this.getTile(current.x, current.y);

			for (let i = 0; i < DIRECTIONS.length; i++) {
				const direction = DIRECTIONS[i];
				const next = {
					x: current.x + direction.dx,
					y: current.y + direction.dy,
				};
				const nextKey = this.key(next.x, next.y);
				const nextTile = this.getTile(next.x, next.y);
				if (visited[nextKey] || !this.canMove(currentTile, nextTile, false)) {
					continue;
				}

				visited[nextKey] = true;
				previous[nextKey] = { key: this.key(current.x, current.y), action: direction.name };

				if (predicate(nextTile, next.x, next.y)) {
					return this.reconstructPath(startKey, nextKey, previous);
				}
				queue.push(next);
			}
		}

		return null;
	}

	reconstructPath(startKey, endKey, previous) {
		const actions = [];
		let cursor = endKey;
		while (cursor !== startKey) {
			const step = previous[cursor];
			if (!step) {
				return null;
			}
			actions.push(step.action);
			cursor = step.key;
		}
		actions.reverse();
		return actions;
	}

	canMove(fromTile, toTile, allowGold) {
		if (!fromTile || !toTile || toTile.type === TILE_WALL) {
			return false;
		}
		if (!allowGold && toTile.type === TILE_GOLD) {
			return false;
		}
		return Math.abs(toTile.level - fromTile.level) <= 1;
	}

	enqueueAndTake(actions) {
		if (!actions || !actions.length) {
			return this.explore();
		}
		this.queue = actions;
		this.queueIndex = 1;
		if (this.queueIndex >= this.queue.length) {
			this.clearQueue();
		}
		return actions[0];
	}

	directionTo(target) {
		for (let i = 0; i < DIRECTIONS.length; i++) {
			const direction = DIRECTIONS[i];
			if (this.x + direction.dx === target.x && this.y + direction.dy === target.y) {
				return direction.name;
			}
		}
		return this.explore();
	}

	isLegal(action, cell) {
		if (action === ACTION_PICKUP) {
			return !this.carrying && cell.type === TILE_BLOCK;
		}
		if (action === ACTION_DROP) {
			return this.carrying;
		}
		const direction = DIRECTION_BY_ACTION[action];
		if (direction) {
			const target = cell[action];
			return target.type !== TILE_WALL && Math.abs(target.level - cell.level) <= 1;
		}
		return false;
	}

	commit(action, cell) {
		if (action === ACTION_PICKUP) {
			this.carrying = true;
			const nextLevel = Math.max(0, cell.level - 1);
			this.setTile(this.x, this.y, nextLevel > 0 ? TILE_BLOCK : TILE_EMPTY, nextLevel);
			return action;
		}

		if (action === ACTION_DROP) {
			this.carrying = false;
			this.setTile(this.x, this.y, TILE_BLOCK, cell.level + 1);
			return action;
		}
		const direction = DIRECTION_BY_ACTION[action];
		if (direction) {
			this.x += direction.dx;
			this.y += direction.dy;
			return action;
		}

		return ACTION_UP;
	}

	fallbackAction(cell) {
		const current = { type: cell.type, level: cell.level };
		for (let i = 0; i < DIRECTIONS.length; i++) {
			const direction = DIRECTIONS[(this.lastFallback + i) % DIRECTIONS.length];
			const target = cell[direction.name];
			if (this.canMove(current, target, true)) {
				this.lastFallback = (this.lastFallback + i + 1) % DIRECTIONS.length;
				return direction.name;
			}
		}
		if (!this.carrying && cell.type === TILE_BLOCK) {
			return ACTION_PICKUP;
		}
		if (this.carrying) {
			return ACTION_DROP;
		}
		return ACTION_UP;
	}

	parseKey(key) {
		const parts = key.split(",");
		return { x: Number(parts[0]), y: Number(parts[1]) };
	}
}
