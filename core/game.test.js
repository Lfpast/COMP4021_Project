import { beforeEach, describe, expect, it } from "bun:test";
import { create, Tile, TileHidden, TileMin } from "./game.js";

describe("Tile Definitions", () => {
    it("should have correct symbols", () => {
        expect(Tile.Emp.t.description).toBe("Empty Tile");
        expect(Tile.Min.t.description).toBe("Mine Tile");
    });

    it("should create number tiles correctly", () => {
        const tile = Tile.Num(3);
        expect(tile.t.description).toBe("Number Tile");
        expect(tile.n).toBe(3);
    });

    it("should throw error for invalid number tiles", () => {
        expect(() => Tile.Num(0)).toThrow(RangeError);
        expect(() => Tile.Num(9)).toThrow(RangeError);
    });
});

describe("Game Factory", () => {
    it("should create a game with valid dimensions", () => {
        const game = create(10, 20);
        expect(game).toBeDefined();
    });

    it("should throw TypeError for non-integer dimensions", () => {
        expect(() => create(10.5, 10)).toThrow(TypeError);
        expect(() => create(10, 10.5)).toThrow(TypeError);
    });

    it("should throw RangeError for non-positive dimensions", () => {
        expect(() => create(0, 10)).toThrow(RangeError);
        expect(() => create(10, -1)).toThrow(RangeError);
    });
});

describe("Game Instance", () => {
    /** @type {import("./game.js").Game} */
    let game;
    const W = 10;
    const H = 10;

    beforeEach(() => {
        game = create(W, H);
    });

    describe("Basic Access", () => {
        it("should initialize with hidden tiles", () => {
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    expect(game.apply(x, y)).toBe(TileHidden);
                }
            }
        });

        it("should get empty tiles by default", () => {
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    expect(game.get(x, y)).toBe(Tile.Emp);
                }
            }
        });

        it("should set and get tiles", () => {
            game.set(0, 0, Tile.Min);
            expect(game.get(0, 0)).toBe(Tile.Min);
        });

        it("should throw on out of bounds access", () => {
            expect(() => game.get(-1, 0)).toThrow(RangeError);
            expect(() => game.get(W, 0)).toThrow(RangeError);
            expect(() => game.set(0, H, Tile.Min)).toThrow(RangeError);
            expect(() => game.apply(W, H)).toThrow(RangeError);
        });
    });

    describe("Initialization (init)", () => {
        it("should place mines and numbers correctly on square board", () => {
            const minesCount = 5;
            game.init(minesCount, 0, 0);

            let mineFound = 0;
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    if (game.get(x, y).t === TileMin) {
                        mineFound++;
                    }
                }
            }
            expect(mineFound).toBe(minesCount);
        });

        it("should place mines and numbers correctly on non-square board", () => {
            const W2 = 3;
            const H2 = 10;
            const game2 = create(W2, H2);
            const minesCount = 5;
            game2.init(minesCount, 0, 0);

            let mineFound = 0;
            for (let x = 0; x < W2; x++) {
                for (let y = 0; y < H2; y++) {
                    if (game2.get(x, y).t === TileMin) {
                        mineFound++;
                    }
                }
            }
            expect(mineFound).toBe(minesCount);
        });

        it("should not place mine at safe coordinates", () => {
            const minesCount = 24; // Almost full board (5x5=25, max mines=24)
            const W3 = 5;
            const H3 = 5;
            const game3 = create(W3, H3);
            const safeX = 2;
            const safeY = 2;
            
            game3.init(minesCount, safeX, safeY);

            expect(game3.get(safeX, safeY).t).not.toBe(TileMin);
            // All others should be mines
            for (let x = 0; x < W3; x++) {
                for (let y = 0; y < H3; y++) {
                    if (x === safeX && y === safeY) continue;
                    expect(game3.get(x, y).t).toBe(TileMin);
                }
            }
        });

        it("should work with 0 mines", () => {
            game.init(0, 0, 0);
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    expect(game.get(x, y)).toBe(Tile.Emp);
                }
            }
        });

        it("should work with max mines (all but one)", () => {
            const maxMines = W * H - 1;
            game.init(maxMines, 0, 0);
            expect(game.get(0, 0)).not.toBe(Tile.Min);
            let mineCount = 0;
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    if (game.get(x, y).t === TileMin) mineCount++;
                }
            }
            expect(mineCount).toBe(maxMines);
        });

        it("should throw TypeError for non-integer mine count", () => {
            expect(() => game.init(5.5, 0, 0)).toThrow(TypeError);
        });

        it("should throw RangeError for invalid mine count", () => {
            expect(() => game.init(-1, 0, 0)).toThrow(RangeError);
            expect(() => game.init(W * H, 0, 0)).toThrow(RangeError);
        });

        it("should throw RangeError for invalid safe coordinates", () => {
            expect(() => game.init(5, -1, 0)).toThrow(RangeError);
            expect(() => game.init(5, W, 0)).toThrow(RangeError);
        });
    });

    describe("Gameplay (reveal)", () => {
        it("should reveal tiles", () => {
            game.set(0, 0, Tile.Min);
            game.reveal(0, 0);
            expect(game.apply(0, 0)).toBe(Tile.Min);
        });

        it("should notify observers on reveal", () => {
            /** @type {[number, number][]} */
            const changes = [];
            const dispose = game.observe((cs) => {
                changes.push(...cs);
            });

            game.reveal(0, 0);
            expect(changes.length).toBeGreaterThan(0);
            expect(changes).toContainEqual([0, 0]);

            dispose();
        });

        it("should stop notifying after dispose", () => {
            let callCount = 0;
            const dispose = game.observe(() => {
                callCount++;
            });

            game.reveal(0, 0);
            expect(callCount).toBe(1);

            dispose();
            game.reveal(1, 1);
            expect(callCount).toBe(1);
        });

        it("should flood reveal empty tiles", () => {
            const W = 3;
            const H = 3;
            const game = create(W, H);

            // Setup board manually
            game.set(2, 2, Tile.Min);
            game.set(1, 1, Tile.Num(1));
            game.set(1, 2, Tile.Num(1));
            game.set(2, 1, Tile.Num(1));

            // Reveal top-left corner
            game.reveal(0, 0);

            // Check that the mine is still hidden
            expect(game.apply(2, 2)).toBe(TileHidden);

            // Check that numbers are revealed
            expect(game.apply(1, 1)).not.toBe(TileHidden);
            expect(game.apply(1, 2)).not.toBe(TileHidden);
            expect(game.apply(2, 1)).not.toBe(TileHidden);

            // Check that empty tiles are revealed
            expect(game.apply(0, 0)).toBe(Tile.Emp);
            expect(game.apply(0, 1)).toBe(Tile.Emp);
            expect(game.apply(0, 2)).toBe(Tile.Emp);
            expect(game.apply(1, 0)).toBe(Tile.Emp);
            expect(game.apply(2, 0)).toBe(Tile.Emp);
        });

        it("should stop flood fill at numbers", () => {
            const W = 5;
            const H = 5;
            const game = create(W, H);

            // Wall of mines at row 2
            for (let x = 0; x < W; x++) {
                game.set(x, 2, Tile.Min);
            }
            // Set numbers for row 1 and 3
            for (let x = 0; x < W; x++) {
                game.set(x, 1, Tile.Num(1));
                game.set(x, 3, Tile.Num(1));
            }

            // Reveal (0, 0)
            game.reveal(0, 0);

            // Row 0 should be revealed (Empty)
            for (let x = 0; x < W; x++) {
                expect(game.apply(x, 0)).toBe(Tile.Emp);
            }
            // Row 1 should be revealed (Numbers)
            for (let x = 0; x < W; x++) {
                expect(game.apply(x, 1)).not.toBe(TileHidden);
                expect(game.apply(x, 1)).not.toBe(Tile.Emp);
            }

            // Row 2 (Mines) should be hidden
            for (let x = 0; x < W; x++) {
                expect(game.apply(x, 2)).toBe(TileHidden);
            }
        });
    });

    describe("Game Over (isGameOver)", () => {
        it("should return false for new game", () => {
            expect(game.isGameOver()).toBe(false);
        });

        it("should return true when mine is revealed (Loss)", () => {
            game.set(0, 0, Tile.Min);
            game.reveal(0, 0);
            expect(game.isGameOver()).toBe(true);
        });

        it("should return true when all safe tiles are revealed (Win)", () => {
            const W = 3;
            const H = 3;
            game = create(W, H);
            // Place one mine at (0,0)
            game.set(0, 0, Tile.Min);
            // All others are safe (Empty by default)
            
            // Reveal all safe tiles
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    if (x === 0 && y === 0) continue;
                    game.reveal(x, y);
                }
            }

            expect(game.isGameOver()).toBe(true);
        });

        it("should return false when game is in progress and NOT ambiguous", () => {
            // I need a case where we can deduce a SAFE tile.
            // 1 2 1 pattern on a wall.
            // 1 2 1
            // A B C
            // A=Mine, C=Mine, B=Safe.
            
            const W3 = 3;
            const H3 = 2;
            game = create(W3, H3);
            
            game.set(0, 0, Tile.Num(1));
            game.set(1, 0, Tile.Num(2));
            game.set(2, 0, Tile.Num(1));
            
            game.set(0, 1, Tile.Min);
            game.set(1, 1, Tile.Emp); // Safe
            game.set(2, 1, Tile.Min);
            
            game.reveal(0, 0);
            game.reveal(1, 0);
            game.reveal(2, 0);
            
            // Now (1,1) is safe and deducible.
            // So isGameOver should be false.
            expect(game.isGameOver()).toBe(false);
        });

        it("should return true when game is ambiguous (Win by Ambiguity)", () => {
            const W = 2;
            const H = 2;
            game = create(W, H);
            
            // Setup:
            // 1 1
            // ? ? (One mine, one empty)
            
            // Let's say (0, 1) is Mine, (1, 1) is Empty.
            game.set(0, 1, Tile.Min);
            game.set(1, 1, Tile.Emp); // Actually Emp is default, but let's be explicit
            
            // Top row are numbers
            game.set(0, 0, Tile.Num(1));
            game.set(1, 0, Tile.Num(1));
            
            // Reveal top row
            game.reveal(0, 0);
            game.reveal(1, 0);
            
            // Now we have:
            // 1 1
            // H H
            // And we know there is 1 mine in the bottom row (because of the 1s).
            // Constraint from (0,0): (0,1) + (1,1) = 1 (Wait, (0,0) neighbors are (0,1), (1,0), (1,1))
            // (1,0) is visible (Num).
            // So neighbors of (0,0) are (0,1) and (1,1).
            // Neighbors of (1,0) are (0,0), (0,1), (1,1).
            
            // Wait, let's check coordinates.
            // (0,0) neighbors: (0,1), (1,0), (1,1).
            // (1,0) neighbors: (0,0), (0,1), (1,1).
            
            // If (0,0) is 1. And (1,0) is 1.
            // (0,0) sees (0,1) and (1,1). Sum = 1.
            // (1,0) sees (0,1) and (1,1). Sum = 1.
            
            // So we have one constraint: A + B = 1.
            // Solutions: A=1, B=0 OR A=0, B=1.
            // A is (0,1), B is (1,1).
            // Neither is always safe.
            // So it is ambiguous.
            
            expect(game.isGameOver()).toBe(true);
        });

        it("should return false when game is NOT ambiguous", () => {
            const W = 3;
            const H = 1;
            game = create(W, H);
            
            // 1 ? 1
            // Mine is at (1,0).
            // (0,0) is 1. (2,0) is 1.
            // (1,0) is Mine.
            
            // Wait, 1D board?
            // (0,0) neighbors (1,0).
            // (2,0) neighbors (1,0).
            
            // If (0,0) is 1, then (1,0) MUST be a mine.
            // If (1,0) is a mine, then (2,0) is satisfied.
            
            // But wait, if (1,0) is a mine, we can't click it.
            // Is there a safe tile?
            // No safe tiles to click.
            // So it is ambiguous?
            // "If there are NO hidden tiles that are guaranteed safe... is it ambiguous?"
            // Yes.
            
            // Let's try a case where we CAN deduce a safe tile.
            // 1 1 ?
            // (0,0) is 1. (1,0) is 1. (2,0) is ?.
            // (0,0) neighbors (1,0) (visible) and (0,1) (invalid) ...
            // Let's use 2D.
            
            // 1 1
            // M E
            // (0,0)=1, (1,0)=1.
            // (0,1)=Mine, (1,1)=Empty.
            
            // Reveal (0,0).
            // (0,0) sees (0,1), (1,0), (1,1).
            // (1,0) is hidden. (0,1) is hidden. (1,1) is hidden.
            // This is too complex.
            
            // Simple case:
            // 1 ?
            // (0,0) is 1. (1,0) is ?.
            // (1,0) MUST be a mine.
            // No safe tile. Ambiguous.
            
            // Case with safe tile:
            // 1 2 1
            // ? ? ?
            // (0,0)=1, (1,0)=2, (2,0)=1.
            // (0,1)=?, (1,1)=?, (2,1)=?.
            // (0,0) sees (0,1), (1,1). Sum=1.
            // (2,0) sees (1,1), (2,1). Sum=1.
            // (1,0) sees (0,1), (1,1), (2,1). Sum=2.
            
            // A+B=1
            // B+C=1
            // A+B+C=2
            
            // (A+B)+C=2 => 1+C=2 => C=1. (2,1) is Mine.
            // A+(B+C)=2 => A+1=2 => A=1. (0,1) is Mine.
            // A+B=1 => 1+B=1 => B=0. (1,1) is Safe.
            
            // So (1,1) is guaranteed safe.
            // Should NOT be ambiguous.
            
            const W2 = 3;
            const H2 = 2;
            game = create(W2, H2);
            
            game.set(0, 0, Tile.Num(1));
            game.set(1, 0, Tile.Num(2));
            game.set(2, 0, Tile.Num(1));
            
            game.set(0, 1, Tile.Min);
            game.set(1, 1, Tile.Emp);
            game.set(2, 1, Tile.Min);
            
            game.reveal(0, 0);
            game.reveal(1, 0);
            game.reveal(2, 0);
            
            expect(game.isGameOver()).toBe(false);
        });
    });
});
