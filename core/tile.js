/**
 * @typedef {{t: typeof TileEmp}} TileEmp
 */
export const TileEmp = "EMP";
/**
 * @typedef {{t: typeof TileMin}} TileMin
 */
export const TileMin = "MIN";
/**
 * @typedef {{t: typeof TileNum, n: number}} TileNum
 */
export const TileNum = "NUM";

/**
 * @typedef {typeof TileHidden} TileHidden
 */
export const TileHidden = "HID";

/**
 * @typedef {typeof TileFlag} TileFlag
 */
export const TileFlag = "FLG";

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
