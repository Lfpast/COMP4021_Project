import { range, sampleSize } from "es-toolkit";
import { Board, board, surrounding } from "./board.js";
import { isAmbiguous } from "./solver.js";
import {
	Tile,
	TileEmp,
	TileFlag,
	TileHidden,
	TileMin,
	TileNum,
} from "./tile.js";

/** @typedef {(b: Board, cs: [number, number][]) => void} Observer */

export class Game {
	/** @type {Board} */
	#board;
	/** @type {[number, number][]} */
	#changes = [];
	/** @type {Observer[]} */
	#observers = [];

	w;
	h;
	mines;

	#initial = true;
	#lives = 0;
	#defused = new Set();

	/**
	 * Create a game board.
	 * @param {number} w
	 * @param {number} h
	 * @param {number} c the count of mines
	 */
	constructor(w, h, c) {
		this.#board = new Board(w, h);
		if (!Number.isInteger(c))
			throw new TypeError(`Count must be an integer, got ${c}`);
		if (c < 0 || c > w * h - 9) {
			throw new RangeError(
				`Mine count ${c} must be between 0 and ${w * h - 9} for board of size ${w}x${h}`,
			);
		}
		this.w = w;
		this.h = h;
		this.mines = c;
	}

	/**
	 * Inserts an observer that is called when the board changes.
	 * @param {Observer} observer
	 * @returns {() => void} a function to remove the observer
	 */
	subscribe(observer) {
		this.#observers.push(observer);
		return () => {
			const index = this.#observers.indexOf(observer);
			if (index !== -1) {
				this.#observers.splice(index, 1);
			}
		};
	}

	/** @param {...[number, number]} cs */
	#accumulate(...cs) {
		this.#changes.push(...cs);
	}

	#notify() {
		if (this.#changes.length > 0) {
			const b = this.#board;
			const cs = this.#changes;
			for (const observer of this.#observers) {
				observer(b, cs);
			}
			this.#changes = [];
		}
	}

	/**
	 * Initialize the game board randomly.
	 * @param {number} sx the safe x coordinate
	 * @param {number} sy the safe y coordinate
	 */
	#init(sx, sy) {
		const w = this.w;
		const h = this.h;
		const c = this.mines;

		if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
			throw new RangeError(
				`Safe coordinates (${sx}, ${sy}) out of bounds for board of size (${w}, ${h})`,
			);
		}

		/** @type {[number, number][]} */
		const coordinates = range(w * h).map((n) => [n % w, Math.floor(n / w)]);
		/** @type {[number, number][]} */
		const choosableCoordinates = coordinates.filter(
			([x, y]) =>
				!(x === sx && y === sy) &&
				!surrounding(sx, sy).some(([xx, yy]) => xx === x && yy === y),
		);
		/** @type {[number, number][]} */
		const mines = sampleSize(choosableCoordinates, c);

		// setup tiles of mine
		for (const [mx, my] of mines) {
			this.#board.set(mx, my, Tile.Min);
		}

		// setup tiles of number
		for (const [x, y] of board(w, h)) {
			if (this.#board.get(x, y).t === TileMin) continue;
			let n = 0;
			for (const [xx, yy] of surrounding(x, y)) {
				if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
				if (this.#board.get(xx, yy).t === TileMin) {
					n++;
				}
			}
			if (n > 0) {
				this.#board.set(x, y, Tile.Num(n));
			}
		}
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 */
	#revealRec(x, y) {
		const w = this.w;
		const h = this.h;
		this.#board.setVisible(x, y, true);
		this.#accumulate([x, y]);

		const t = this.#board.get(x, y);
		if (t.t === TileEmp) {
			for (const [xx, yy] of surrounding(x, y)) {
				if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
				if (this.#board.apply(xx, yy) === TileHidden) {
					this.#revealRec(xx, yy);
				}
			}
		}
	}

	/**
	 * Reveal the {@link Tile} at (x, y) so that it becomes visible. Throw {@link RangeError} if out of bounds.
	 * Note that this function performs flood fill according to Minesweeper rules.
	 *
	 * In the first reveal, the board is initialized such that the tile at (x, y) is never a mine.
	 *
	 * @param {number} x
	 * @param {number} y
	 */
	reveal(x, y) {
		if (this.#initial) {
			this.#init(x, y);
			this.#initial = false;
		}

		const t = this.apply(x, y);
		
		// Check for mine hit with lives
		if (this.#board.get(x, y).t === TileMin && !this.#board.isVisible(x, y)) {
			if (this.#lives > 0) {
				this.#lives--;
				this.#board.setVisible(x, y, true);
				this.#defused.add(`${x},${y}`);
				this.#accumulate([x, y]);
				this.#notify();
				return; // Saved by life
			}
		}

		if (t !== TileHidden && t !== TileFlag && t.t === TileNum && t.n > 0) {
			// Reveal surrounding tiles if number of flags equals the number
			const mines = surrounding(x, y)
				.filter(([xx, yy]) => xx >= 0 && xx < this.w && yy >= 0 && yy < this.h)
				.filter(([xx, yy]) => {
					const tile = this.apply(xx, yy);
					return tile === TileFlag || (tile.t === TileMin);
				}).length;
			if (mines === t.n) {
				for (const [xx, yy] of surrounding(x, y)) {
					if (xx < 0 || xx >= this.w || yy < 0 || yy >= this.h) continue;
					if (this.apply(xx, yy) === TileHidden) {
						this.#revealRec(xx, yy);
					}
				}
			}
		}

		if (t === TileFlag) return;

		this.#revealRec(x, y);
		this.#notify();
	}

	/**
	 * Flag or unflag the tile at (x, y).
	 * @param {number} x
	 * @param {number} y
	 */
	flag(x, y) {
		this.#board.setFlag(x, y, !this.#board.hasFlag(x, y));
		this.#accumulate([x, y]);
		this.#notify();
	}

	/**
	 * Check if the game is over.
	 * The game is over if a mine is revealed (Loss) or if all non-mine tiles are revealed (Win).
	 * @returns {"GAMING" | "LOSS" | "WIN"}
	 */
	isGameOver() {
		let win = true;
		for (const [x, y] of board(this.w, this.h)) {
			const { t } = this.#board.get(x, y);
			const v = this.#board.isVisible(x, y);
			if (v && t === TileMin) {
				if (!this.#defused.has(`${x},${y}`)) {
					return "LOSS";
				}
			}
			if (!v && t !== TileMin) {
				win = false;
			}
		}
		if (
			win ||
			(this.w * this.h <= 480 &&
				isAmbiguous(
					this.w,
					this.h,
					this.#board.isVisible.bind(this.#board),
					this.#board.get.bind(this.#board),
				))
		) {
			return "WIN";
		}
		return "GAMING";
	}

	/**
	 * Apply the board as a function. This function returns the {@link Tile} at (x, y) if it is visible,
	 * otherwise it returns {@link TileHidden}. Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @returns {Tile | TileHidden | TileFlag}
	 */
	apply(x, y) {
		return this.#board.apply(x, y);
	}

	/**
	 * Get the {@link Tile} at (x, y). Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @returns {Tile}
	 */
	get(x, y) {
		return this.#board.get(x, y);
	}

	/**
	 * Set the {@link Tile} at (x, y) to type t. Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @param {Tile} t
	 */
	set(x, y, t) {
		this.#board.set(x, y, t);
	}

	board() {
		return this.#board;
	}

	get flags() {
		return this.#board.flagCount;
	}

	isInitial() {
		return this.#initial;
	}

	/**
	 * Flag all mines on the board. For cheating purposes only.
	 */
	cheat() {
		if (this.#initial) return;
		for (const [x, y] of board(this.w, this.h)) {
			if (this.#board.get(x, y).t === TileMin) {
				this.#board.setFlag(x, y, !this.#board.hasFlag(x, y));
				this.#accumulate([x, y]);
			}
		}
		this.#notify();
	}

	addLives(n) {
		this.#lives += n;
	}

	/**
	 * Peek at a 3x3 area around (x, y).
	 * @param {number} x
	 * @param {number} y
	 * @returns {{x: number, y: number, t: Tile}[]}
	 */
	peek(x, y) {
		const result = [];
		// Include center and surrounding
		const targets = [...surrounding(x, y), [x, y]];
		for (const [xx, yy] of targets) {
			if (xx >= 0 && xx < this.w && yy >= 0 && yy < this.h) {
				result.push({ x: xx, y: yy, t: this.#board.get(xx, yy) });
			}
		}
		return result;
	}
}
