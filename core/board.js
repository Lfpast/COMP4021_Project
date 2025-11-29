import { range } from "es-toolkit";
import { Tile, TileFlag, TileHidden } from "./tile.js";

/**
 * Get all coordinates of a board with width w and height h.
 * @param {number} w
 * @param {number} h
 * @returns {[number, number][]}
 */
export function board(w, h) {
	/** @type {[number, number][]} */
	const coords = [];
	for (const x of range(w)) {
		for (const y of range(h)) {
			coords.push([x, y]);
		}
	}
	return coords;
}

/**
 * Get the surrounding coordinates of (x, y).
 * @param {number} x
 * @param {number} y
 * @returns {[number, number][]} an array of coordinates
 */
export function surrounding(x, y) {
	/** @type {[number, number][]} */
	const coords = [];
	for (const dx of range(-1, 1 + 1)) {
		for (const dy of range(-1, 1 + 1)) {
			if (dx === 0 && dy === 0) continue;
			coords.push([x + dx, y + dy]);
		}
	}
	return coords;
}

/**
 * A Minesweeper board.
 */
export class Board {
	/** @type {Tile[][]} */
	#tiles;
	/** @type {boolean[][]} */
	#visible;
	/** @type {boolean[][]} */
	#flag;

	#w;
	#h;

	/**
	 * @param {number} w
	 * @param {number} h
	 */
	constructor(w, h) {
		if (!Number.isInteger(w))
			throw new TypeError(`Width must be an integer, got ${w}`);
		if (!Number.isInteger(h))
			throw new TypeError(`Height must be an integer, got ${h}`);
		if (!(w > 0)) throw new RangeError(`Width must be positive, got ${w}`);
		if (!(h > 0)) throw new RangeError(`Height must be positive, got ${h}`);

		this.#w = w;
		this.#h = h;

		this.#tiles = Array(w)
			.fill(null)
			.map(() => Array(h).fill(Tile.Emp));
		this.#visible = Array(w)
			.fill(null)
			.map(() => Array(h).fill(false));
		this.#flag = Array(w)
			.fill(null)
			.map(() => Array(h).fill(false));
	}

	/**
	 * Apply the board as a function. This function returns the {@link Tile} at (x, y) if it is visible,
	 * otherwise it returns {@link TileHidden}. Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @returns {Tile | TileHidden | TileFlag}
	 */
	apply(x, y) {
		if (x < 0 || x >= this.#w || y < 0 || y >= this.#h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${this.#w}, ${this.#h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		if (this.#visible[x][y]) {
			// @ts-expect-error impossible out-of-bounds
			return this.#tiles[x][y];
		} else {
			// @ts-expect-error impossible out-of-bounds
			if (this.#flag[x][y]) {
				return TileFlag;
			} else {
				return TileHidden;
			}
		}
	}

	/**
	 * Get the {@link Tile} at (x, y). Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @returns {Tile}
	 */
	get(x, y) {
		if (x < 0 || x >= this.#w || y < 0 || y >= this.#h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${this.#w}, ${this.#h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		return this.#tiles[x][y];
	}

	/**
	 * Set the {@link Tile} at (x, y) to type t. Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @param {Tile} t
	 */
	set(x, y, t) {
		if (x < 0 || x >= this.#w || y < 0 || y >= this.#h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${this.#w}, ${this.#h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		this.#tiles[x][y] = t;
	}

	/**
	 * Check if the {@link Tile} at (x, y) is visible. Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isVisible(x, y) {
		if (x < 0 || x >= this.#w || y < 0 || y >= this.#h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${this.#w}, ${this.#h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		return this.#visible[x][y];
	}

	/**
	 * Set the visibility of the {@link Tile} at (x, y). Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @param {boolean} v
	 */
	setVisible(x, y, v) {
		if (x < 0 || x >= this.#w || y < 0 || y >= this.#h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${this.#w}, ${this.#h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		this.#visible[x][y] = v;
	}

	/**
	 * Check if the {@link Tile} at (x, y) has a flag. Throw {@link RangeError} if out of bounds.
	 * @param {number} x 
	 * @param {number} y 
	 * @returns {boolean}
	 */
	hasFlag(x, y) {
		if (x < 0 || x >= this.#w || y < 0 || y >= this.#h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${this.#w}, ${this.#h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		return this.#flag[x][y];
	}

	/**
	 * Set the flag of the {@link Tile} at (x, y). Throw {@link RangeError} if out of bounds.
	 * @param {number} x 
	 * @param {number} y 
	 * @param {boolean} f 
	 */
	setFlag(x, y, f) {
		if (x < 0 || x >= this.#w || y < 0 || y >= this.#h) {
			throw new RangeError(
				`Coordinates out of bounds: (${x}, ${y}) for board of size (${this.#w}, ${this.#h})`,
			);
		}
		// @ts-expect-error impossible out-of-bounds
		this.#flag[x][y] = f;
	}


	/**
	 * Convert the board to a plain object representation.
	 * 
	 * @typedef {{w: number, h: number, tiles: Tile[][], visible: boolean[][], flag: boolean[][]}} PlainBoard
	 * @returns {PlainBoard}
	 */
	toPlain() {
		return {
			w: this.#w,
			h: this.#h,
			tiles: this.#tiles,
			visible: this.#visible,
			flag: this.#flag,
		};
	}

}
