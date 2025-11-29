import { beforeEach, describe, expect, it } from "bun:test";
import { Board, board as boardRange, surrounding } from "./board.js";
import { Tile, TileHidden } from "./tile.js";

describe("Board Helper Functions", () => {
	describe("board", () => {
		it("should return all coordinates for given dimensions", () => {
			const w = 2;
			const h = 2;
			const range = boardRange(w, h);
			expect(range).toHaveLength(4);
			expect(range).toContainEqual([0, 0]);
			expect(range).toContainEqual([0, 1]);
			expect(range).toContainEqual([1, 0]);
			expect(range).toContainEqual([1, 1]);
		});

		it("should return empty array for 0 dimensions", () => {
			expect(boardRange(0, 5)).toHaveLength(0);
			expect(boardRange(5, 0)).toHaveLength(0);
		});

		it("should return empty array for negative dimensions", () => {
			expect(boardRange(-1, 5)).toHaveLength(0);
			expect(boardRange(5, -1)).toHaveLength(0);
		});
	});

	describe("surrounding", () => {
		it("should return 8 neighbors for a central tile", () => {
			const neighbors = surrounding(1, 1);
			expect(neighbors).toHaveLength(8);
			expect(neighbors).toContainEqual([0, 0]);
			expect(neighbors).toContainEqual([0, 1]);
			expect(neighbors).toContainEqual([0, 2]);
			expect(neighbors).toContainEqual([1, 0]);
			// [1, 1] should not be included
			expect(neighbors).toContainEqual([1, 2]);
			expect(neighbors).toContainEqual([2, 0]);
			expect(neighbors).toContainEqual([2, 1]);
			expect(neighbors).toContainEqual([2, 2]);
		});

		it("should return neighbors including negatives (caller handles bounds)", () => {
			const neighbors = surrounding(0, 0);
			expect(neighbors).toHaveLength(8);
			expect(neighbors).toContainEqual([-1, -1]);
		});
	});
});

describe("Board Class", () => {
	describe("Constructor", () => {
		it("should create a board with valid dimensions", () => {
			const board = new Board(10, 20);
			expect(board.#w).toBe(10);
			expect(board.h).toBe(20);
		});

		it("should throw TypeError for non-integer dimensions", () => {
			expect(() => new Board(10.5, 10)).toThrow(TypeError);
			expect(() => new Board(10, 10.5)).toThrow(TypeError);
		});

		it("should throw RangeError for non-positive dimensions", () => {
			expect(() => new Board(0, 10)).toThrow(RangeError);
			expect(() => new Board(10, 0)).toThrow(RangeError);
			expect(() => new Board(-1, 10)).toThrow(RangeError);
			expect(() => new Board(10, -1)).toThrow(RangeError);
		});

		it("should initialize tiles to Empty and visible to false", () => {
			const board = new Board(2, 2);
			for (let x = 0; x < 2; x++) {
				for (let y = 0; y < 2; y++) {
					expect(board.get(x, y)).toBe(Tile.Emp);
					expect(board.isVisible(x, y)).toBe(false);
					expect(board.apply(x, y)).toBe(TileHidden);
				}
			}
		});
	});

	describe("Accessors (get/set/apply/isVisible/setVisible)", () => {
		/** @type {Board} */
		let board;
		const W = 5;
		const H = 5;

		beforeEach(() => {
			board = new Board(W, H);
		});

		it("should set and get tiles", () => {
			board.set(0, 0, Tile.Min);
			expect(board.get(0, 0)).toBe(Tile.Min);
		});

		it("should throw on out of bounds access for get", () => {
			expect(() => board.get(-1, 0)).toThrow(RangeError);
			expect(() => board.get(W, 0)).toThrow(RangeError);
			expect(() => board.get(0, -1)).toThrow(RangeError);
			expect(() => board.get(0, H)).toThrow(RangeError);
		});

		it("should throw on out of bounds access for set", () => {
			expect(() => board.set(0, H, Tile.Min)).toThrow(RangeError);
			expect(() => board.set(-1, 0, Tile.Min)).toThrow(RangeError);
		});

		it("should set and get visibility", () => {
			expect(board.isVisible(0, 0)).toBe(false);
			board.setVisible(0, 0, true);
			expect(board.isVisible(0, 0)).toBe(true);
			board.setVisible(0, 0, false);
			expect(board.isVisible(0, 0)).toBe(false);
		});

		it("should throw on out of bounds access for isVisible", () => {
			expect(() => board.isVisible(-1, 0)).toThrow(RangeError);
			expect(() => board.isVisible(W, 0)).toThrow(RangeError);
		});

		it("should throw on out of bounds access for setVisible", () => {
			expect(() => board.setVisible(-1, 0, true)).toThrow(RangeError);
			expect(() => board.setVisible(W, 0, true)).toThrow(RangeError);
		});

		it("should apply visibility correctly", () => {
			board.set(0, 0, Tile.Min);
			// Initially hidden
			expect(board.apply(0, 0)).toBe(TileHidden);

			// Set visible using public method
			board.setVisible(0, 0, true);
			expect(board.apply(0, 0)).toBe(Tile.Min);
		});

		it("should throw on out of bounds access for apply", () => {
			expect(() => board.apply(W, H)).toThrow(RangeError);
			expect(() => board.apply(-1, 0)).toThrow(RangeError);
		});
	});
});
