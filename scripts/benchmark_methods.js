const fs = require("fs");
const path = require("path");
const vm = require("vm");

const TILE_EMPTY = 0;
const TILE_WALL = 1;
const TILE_BLOCK = 2;
const TILE_GOLD = 3;

const WIDTH = 18;
const HEIGHT = 18;
const WALLS = 50;
const BLOCKS = 50;

const DIRECTIONS = [
	{ name: "left", dx: -1, dy: 0 },
	{ name: "up", dx: 0, dy: -1 },
	{ name: "right", dx: 1, dy: 0 },
	{ name: "down", dx: 0, dy: 1 },
];

function tile(type, level) {
	return { type, level };
}

function place(grid, type, count, level) {
	while (count > 0) {
		const x = (Math.random() * (WIDTH - 2) + 1) >> 0;
		const y = (Math.random() * (HEIGHT - 2) + 1) >> 0;
		if (grid[y][x].type === TILE_EMPTY) {
			grid[y][x] = tile(type, level);
			count -= 1;
		}
	}
}

function isReachable(grid, sx, sy, tx, ty) {
	const queue = [{ x: sx, y: sy }];
	const seen = new Set([sx + "," + sy]);
	for (let cursor = 0; cursor < queue.length; cursor++) {
		const current = queue[cursor];
		if (current.x === tx && current.y === ty) {
			return true;
		}
		for (let i = 0; i < DIRECTIONS.length; i++) {
			const next = {
				x: current.x + DIRECTIONS[i].dx,
				y: current.y + DIRECTIONS[i].dy,
			};
			const key = next.x + "," + next.y;
			if (!seen.has(key) && grid[next.y][next.x].type !== TILE_WALL) {
				seen.add(key);
				queue.push(next);
			}
		}
	}
	return false;
}

function buildMap(goldHeight) {
	const grid = [];
	for (let y = 0; y < HEIGHT; y++) {
		grid[y] = [];
		for (let x = 0; x < WIDTH; x++) {
			const border = y === 0 || y === HEIGHT - 1 || x === 0 || x === WIDTH - 1;
			grid[y][x] = tile(border ? TILE_WALL : TILE_EMPTY, 0);
		}
	}

	place(grid, TILE_BLOCK, BLOCKS, 1);
	place(grid, TILE_WALL, WALLS, 0);

	const goldX = (Math.random() * (WIDTH - 6) + 3) >> 0;
	const goldY = (Math.random() * (HEIGHT - 6) + 3) >> 0;
	grid[goldY][goldX] = tile(TILE_GOLD, goldHeight);

	for (let dy = -2; dy <= 2; dy++) {
		for (let dx = -2; dx <= 2; dx++) {
			const x = goldX + dx;
			const y = goldY + dy;
			if (grid[y][x].type === TILE_WALL) {
				grid[y][x] = tile(TILE_EMPTY, 0);
			}
		}
	}

	let startX = 0;
	let startY = 0;
	while (
		grid[startY][startX].type !== TILE_EMPTY ||
		!isReachable(grid, startX, startY, goldX, goldY)
	) {
		startX = (Math.random() * (WIDTH - 2) + 1) >> 0;
		startY = (Math.random() * (HEIGHT - 2) + 1) >> 0;
	}

	return {
		grid,
		start: { x: startX, y: startY, level: 0, carrying: false },
	};
}

function sense(grid, state) {
	return {
		left: { ...grid[state.y][state.x - 1] },
		up: { ...grid[state.y - 1][state.x] },
		right: { ...grid[state.y][state.x + 1] },
		down: { ...grid[state.y + 1][state.x] },
		type: grid[state.y][state.x].type,
		level: grid[state.y][state.x].level,
	};
}

function applyAction(grid, state, action) {
	const move = DIRECTIONS.find((direction) => direction.name === action);
	if (move) {
		const next = grid[state.y + move.dy][state.x + move.dx];
		if (next.type === TILE_WALL || Math.abs(next.level - state.level) > 1) {
			return false;
		}
		state.x += move.dx;
		state.y += move.dy;
		state.level = next.level;
		return true;
	}

	const current = grid[state.y][state.x];
	if (action === "pickup") {
		if (state.carrying || current.type !== TILE_BLOCK) {
			return false;
		}
		state.carrying = true;
		current.level -= 1;
		current.type = current.level > 0 ? TILE_BLOCK : TILE_EMPTY;
		state.level -= 1;
		return true;
	}

	if (action === "drop") {
		if (!state.carrying) {
			return false;
		}
		state.carrying = false;
		current.type = TILE_BLOCK;
		current.level += 1;
		state.level += 1;
		return true;
	}

	return false;
}

function loadBaseStacker() {
	const solutionPath = path.resolve(__dirname, "..", "solution.js");
	const solutionCode = fs.readFileSync(solutionPath, "utf8") + "\nthis.Stacker = Stacker;";
	const context = {};
	vm.createContext(context);
	vm.runInContext(solutionCode, context);
	return context.Stacker;
}

function runBatch(StackerCtor, options) {
	const results = [];
	for (let run = 0; run < options.runs; run++) {
		const map = buildMap(options.height);
		const agent = new StackerCtor();
		const state = { ...map.start };
		let turns = 0;
		let invalid = 0;
		let won = false;

		for (let cycle = 0; cycle < options.cycleLimit; cycle++) {
			const action = agent.turn(sense(map.grid, state));
			const legal = applyAction(map.grid, state, action);
			if (legal) {
				turns += 1;
			} else {
				invalid += 1;
			}
			if (map.grid[state.y][state.x].type === TILE_GOLD) {
				won = true;
				break;
			}
		}

		results.push({ won, turns, invalid });
	}

	const wins = results.filter((result) => result.won);
	const summary = {
		runs: options.runs,
		height: options.height,
		cycleLimit: options.cycleLimit,
		wins: wins.length,
		losses: options.runs - wins.length,
		successRate: Number(((wins.length / options.runs) * 100).toFixed(1)),
		invalidTotal: results.reduce((sum, result) => sum + result.invalid, 0),
	};

	if (wins.length > 0) {
		const turns = wins.map((result) => result.turns).sort((left, right) => left - right);
		summary.avgTurns = Math.round(turns.reduce((sum, turnCount) => sum + turnCount, 0) / wins.length);
		summary.minTurns = turns[0];
		summary.maxTurns = turns[turns.length - 1];
		summary.p95Turns = turns[Math.max(0, Math.floor(turns.length * 0.95) - 1)];
		if (options.height === 8) {
			summary.winsLe1000 = turns.filter((turnCount) => turnCount <= 1000).length;
		}
	}

	return summary;
}

function buildVariants(BaseStacker) {
	class TunedStacker extends BaseStacker {
		constructor(config) {
			super();
			this.config = config;
		}

		shouldPlanStaircase() {
			return this.knownCount - this.lastPlanKnownCount >= this.config.planInterval;
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

			const reserve = !this.building && this.hasReachableFrontier(reachable) ? this.config.reserve : 0;
			return available >= needed + reserve;
		}
	}

	class AggressiveFast extends TunedStacker {
		constructor() {
			super({ planInterval: 4, reserve: 2 });
		}
	}

	class BalancedFast extends TunedStacker {
		constructor() {
			super({ planInterval: 6, reserve: 4 });
		}
	}

	class ConservativeSafe extends TunedStacker {
		constructor() {
			super({ planInterval: 10, reserve: 8 });
		}
	}

	class AdaptiveReplan extends BaseStacker {
		constructor() {
			super();
			this.stuckCount = 0;
			this.lastTargetKey = null;
			this.lastAction = null;
		}

		nextAction(cell) {
			const action = super.nextAction(cell);
			const target = this.nextStairTarget();
			const key = target ? this.key(target.x, target.y) + ":" + target.level : "done";

			if (
				this.staircase &&
				!this.carrying &&
				this.queue.length === 0 &&
				key === this.lastTargetKey &&
				action === this.lastAction
			) {
				this.stuckCount += 1;
			} else {
				this.stuckCount = 0;
			}

			this.lastTargetKey = key;
			this.lastAction = action;

			if (this.stuckCount > 40 && !this.carrying) {
				this.staircase = null;
				this.reserved = {};
				this.building = false;
				this.lastPlanKnownCount = this.knownCount - 8;
				this.stuckCount = 0;
				return this.explore();
			}

			return action;
		}
	}

	return {
		"Robust Explorer (solution.js)": BaseStacker,
		"Aggressive Fast (variant)": AggressiveFast,
		"Balanced Fast (variant)": BalancedFast,
		"Conservative Safe (variant)": ConservativeSafe,
		"Adaptive Replan (variant)": AdaptiveReplan,
	};
}

function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		runs: 100,
		heights: [8],
		cycleLimit: 30000,
	};

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--runs" && args[i + 1]) {
			options.runs = Number(args[i + 1]);
			i += 1;
		} else if (args[i] === "--cycle-limit" && args[i + 1]) {
			options.cycleLimit = Number(args[i + 1]);
			i += 1;
		} else if (args[i] === "--heights" && args[i + 1]) {
			options.heights = args[i + 1]
				.split(",")
				.map((value) => Number(value.trim()))
				.filter((value) => Number.isFinite(value));
			i += 1;
		}
	}

	return options;
}

function main() {
	const options = parseArgs();
	const started = Date.now();
	const BaseStacker = loadBaseStacker();
	const variants = buildVariants(BaseStacker);

	const report = [];
	for (let hi = 0; hi < options.heights.length; hi++) {
		for (const [name, ctor] of Object.entries(variants)) {
			const summary = runBatch(ctor, {
				runs: options.runs,
				height: options.heights[hi],
				cycleLimit: options.cycleLimit,
			});
			summary.method = name;
			report.push(summary);
		}
	}

	console.log(
		JSON.stringify(
			{
				wallMs: Date.now() - started,
				runs: options.runs,
				heights: options.heights,
				cycleLimit: options.cycleLimit,
				report,
			},
			null,
			2
		)
	);
}

main();
