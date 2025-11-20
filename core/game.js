import { range, sampleSize } from "es-toolkit";
import { isAmbiguous } from "./solver.js";

/**
 * @type {unique symbol}
 * @typedef {{t: typeof TileEmp}} TileEmp
 */
export const TileEmp = Symbol("Empty Tile");
/**
 * @type {unique symbol}
 * @typedef {{t: typeof TileMin}} TileMin
 */
export const TileMin = Symbol("Mine Tile");

/**
 * @type {unique symbol}
 * @typedef {{t: typeof TileNum, n: number}} TileNum
 */
export const TileNum = Symbol("Number Tile");

/**
 * @type {unique symbol}
 * @typedef {typeof TileHidden} TileHidden
 */
export const TileHidden = Symbol("Hidden Tile");

/** @typedef {TileEmp | TileMin | TileNum} Tile */

export const Tile = Object.freeze({
	/** @type {TileEmp} */
	Emp: {
		t: TileEmp,
	},
	/** @type {TileMin} */
	Min: {
		t: TileMin,
	},
	/** @type {(n: number) => TileNum} */
	Num: (n) => {
		if (n <= 0 || n >= 9) {
			throw new RangeError(
				`The number ${n} in a number tile must be between 1 and 8`,
			);
		}
		return {
			t: TileNum,
			n,
		};
	},
});

/** @typedef {(x: number, y: number) => Tile | TileHidden} Apply */
/** @typedef {(x: number, y: number) => Tile} GetTile */
/** @typedef {(x: number, y: number, t: Tile) => void} SetTile */

/**
 * Get all coordinates of a board with width w and height h.
 * @param {number} w
 * @param {number} h
 * @returns {[number, number][]}
 */
const board = (w, h) => {
	/** @type {[number, number][]} */
	const cs = [];
	for (const x of range(w)) {
		for (const y of range(h)) {
			cs.push([x, y]);
		}
	}

	return cs;
};

/**
 * Get the surrounding coordinates of (x, y).
 * @param {number} x
 * @param {number} y
 * @returns {[number, number][]} an array of coordinates
 */
const surrounding = (x, y) => {
	/** @type {[number, number][]} */
	const cs = [];
	for (const dx of range(-1, 1 + 1)) {
		for (const dy of range(-1, 1 + 1)) {
			if (dx === 0 && dy === 0) continue;
			cs.push([x + dx, y + dy]);
		}
	}

	return cs;
};

/**
 * Create a game board.
 *
 * @param {number} w
 * @param {number} h
 * @typedef {ReturnType<typeof create>} Game
 */
export function create(w, h) {
	if (!Number.isInteger(w)) throw new TypeError(`Width must be an integer, got ${w}`);
	if (!Number.isInteger(h)) throw new TypeError(`Height must be an integer, got ${h}`);
	if (!(w > 0)) throw new RangeError(`Width must be positive, got ${w}`);
	if (!(h > 0)) throw new RangeError(`Height must be positive, got ${h}`);

	/** @type {Tile[][]} */
	const tiles = Array(w)
		.fill(null)
		.map(() => Array(h).fill(Tile.Emp));
	/** @type {boolean[][]} */
	const visible = Array(w)
		.fill(null)
		.map(() => Array(h).fill(false));

	/** @typedef {(cs: [number, number][]) => void} Observer */

	/** @type {Observer[]} */
	const observers = [];

	/**
	 * Inserts an observer that is called when the board changes.
	 * @param {Observer} observer 
	 * @returns {() => void} a function to remove the observer
	 */
	const observe = (observer) => {
		observers.push(observer);
		return () => {
			const index = observers.indexOf(observer);
			if (index !== -1) {
				observers.splice(index, 1);
			}
		};
	}

	/** @type {[number, number][]} */
	const changes = [];

	/** @type {(...cs: [number, number][]) => void} */
	const accumulate = (...cs) => {
		changes.push(...cs);
	}

	/** @type {() => void} */
	const notify = () => {
		if (changes.length > 0) {
			const cs = changes.splice(0, changes.length);
			for (const observer of observers) {
				observer(cs);
			}
		}
	}

	/**
	 * Apply the board as a function. This function returns the {@link Tile} at (x, y) if it is visible,
	 * otherwise it returns {@link TileHidden}. Throw {@link RangeError} if out of bounds.
	 * @type {Apply}
	 */
	const apply = (x, y) => {
		if (x < 0 || x >= w || y < 0 || y >= h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${w}, ${h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		if (visible[x][y]) {
			// @ts-expect-error impossible out-of-bounds
			return tiles[x][y];
		}
		return TileHidden;
	};

	/**
	 * Get the {@link Tile} at (x, y). Throw {@link RangeError} if out of bounds.
	 * @type {GetTile}
	 */
	const get = (x, y) => {
		if (x < 0 || x >= w || y < 0 || y >= h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${w}, ${h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		return tiles[x][y];
	};

	/**
	 * Set the {@link Tile} at (x, y) to type t. Throw {@link RangeError} if out of bounds.
	 * @type {SetTile}
	 */
	const set = (x, y, t) => {
		if (x < 0 || x >= w || y < 0 || y >= h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${w}, ${h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		tiles[x][y] = t;
	};

	/**
	 * Initialize the game board randomly.
	 * @param {number} c the count of mines
	 * @param {number} sx the safe x coordinate
	 * @param {number} sy the safe y coordinate
	 */
	const init = (c, sx, sy) => {
		if (!Number.isInteger(c)) throw new TypeError(`Count must be an integer, got ${c}`);
		if (c < 0 || c >= w * h) {
			throw new RangeError(
				`Mine count ${c} must be between 0 and ${w * h - 1} for board of size ${w}x${h}`,
			);
		}
		if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
			throw new RangeError(
				`Safe coordinates (${sx}, ${sy}) out of bounds for board of size (${w}, ${h})`,
			);
		}

		/** @type {[number, number][]} */
		const coordinates = range(w * h).map((n) => [n % w, Math.floor(n / w)]);
		/** @type {[number, number][]} */
		const safeCoordinates = coordinates.filter(
			([x, y]) => !(x === sx && y === sy),
		);
		/** @type {[number, number][]} */
		const mines = sampleSize(safeCoordinates, c);

		// setup tiles of mine
		for (const [mx, my] of mines) {
			set(mx, my, Tile.Min);
		}

		// setup tiles of number
		for (const [x, y] of board(w, h)) {
			if (get(x, y).t === TileMin) continue;
			let n = 0;
			for (const [xx, yy] of surrounding(x, y)) {
				if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
				if (get(xx, yy).t === TileMin) {
					n++;
				}
			}
			if (n > 0) {
				set(x, y, Tile.Num(n));
			}
		}
	};

	/**
	 * @param {number} x
	 * @param {number} y
	 */
	const reveal_rec = (x, y) => {
		if (x < 0 || x >= w || y < 0 || y >= h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${w}, ${h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		visible[x][y] = true;
		accumulate([x, y]);

		const t = get(x, y);
		if (t.t === TileEmp) {
			for (const [xx, yy] of surrounding(x, y)) {
				if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
				if (apply(xx, yy) === TileHidden) {
					reveal_rec(xx, yy);
				}
			}
		}
	};

	/**
	 * Reveal the {@link Tile} at (x, y) so that it becomes visible. Throw {@link RangeError} if out of bounds.
	 * Note that this function performs flood fill according to Minesweeper rules.
	 * @param {number} x
	 * @param {number} y
	 */
	const reveal = (x, y) => {
		reveal_rec(x, y);
		notify();
	};

	/**
	 * Check if the game is over.
	 * The game is over if a mine is revealed (Loss) or if all non-mine tiles are revealed (Win).
	 * @returns {boolean}
	 */
	const isGameOver = () => {
		let lost = false;
		let won = true;
		for (const x of range(w)) {
			for (const y of range(h)) {
				const t = get(x, y);
				// @ts-expect-error impossible out-of-bounds
				const v = visible[x][y];
				if (t.t === TileMin && v) {
					lost = true;
				}
				if (t.t !== TileMin && !v) {
					won = false;
				}
			}
		}
		return lost || won || isAmbiguous(w, h, visible, get);
	};

	return {
		init,
		apply,
		get,
		set,
		reveal,
		observe,
		isGameOver,
	};
}
