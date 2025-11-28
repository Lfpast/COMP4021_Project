# Project Announcement: Multisweeper

## 1. Title of the Project
Multisweeper

## 2. Game Front Page
### What Will Be in It
The front page serves as the entry point to the game, designed to be user-friendly and informative. 

Initially, the player enters their username and password to log in to the game. The username is for tracking the player's statistics and is unique among the game. After that, the user can log out at any time they want. The user state is also persistent in the browser. In other words, refreshing the website does not automatically log out the user.  

Then, the player can initiate a game by creating a lobby or to join a lobby created by other players by the lobby URL. The player who created the lobby can modify the settings of the game and begin the game when all players joined. If the player wants to play in a single-player mode, they can also begin the game without any other players joining in addition.  

Last, the player who created the lobby sees a selection of game board options with predefined modes: **Classic** (8x8 grid with 10 mines), **Simple** (9x9 with 10 mines), **Medium** (16x16 with 40 mines), **Expert** (30x16 with 99 mines), and **Custom**, for which the player can customize the width, height, and number of mines of the game.

In addition, in the game front page, besides creating a lobby and joining a lobby, the player can also perform the following operations:  
- **Theme Selection**: Users can choose different visual themes for the board, such as classic grid, desert, or space patterns.
- **Statistics Dashboard**: Displays user stats like total games played across modes, total time spent, wins, win rate, and longest winning streak.
- **Side Menu Bar**: Options to adjust game volume, toggle timer, enable/disable end-game animations, and toggle auto-reveal on clicks. There's also a "Gameplay Introduction" section for quick rules, and an "About" section with credits (e.g., production staff, version info).

Player registration and sign-in will be integrated here: new users can create accounts with username and password, and existing users can log in to access personalized stats and multiplayer features.

## 3. Game Play Page
### Describe the Game
Multiplayer Minesweeper builds on the classic Minesweeper mechanics, where players uncover tiles on a grid without hitting mines. The twist is real-time multiplayer collaboration: multiple players share the same board, seeing each other's actions instantly via WebSocket for interactions like reveals, marks, and signals.

The board is a grid of tiles:
- **Empty Tiles**: Safe to click; reveal themselves and adjacent safe areas.
- **Mine Tiles**: Hidden dangers; clicking one ends the game for all.
- **Number Tiles**: Show the count of surrounding mines (in a 3x3 area).

A key rule: Empty and mine tiles aren't directly adjacent; numbers always separate them.

All tiles start unrevealed. Players collaborate to deduce mine locations from revealed numbers.

### How to Play It
- **Basic Actions**:
  - Left-click an unrevealed tile to reveal it. If safe (empty or number), it reveals itself and any connected safe tiles (flood-fill of empty areas).
  - Right-click to mark a tile as a suspected mine (flag icon) – this is visible to all players and helps communication but doesn't affect mechanics.
- **Multiplayer Features**:
  - Real-time updates: All players see reveals, marks, and signals instantly.
  - Signaling: Right-click and drag in a direction to send signals:
    - Right: "On my way" (planning to work there).
    - Left: "Help me" (request assistance).
    - Up: "Don't do" (avoid this area for now, it's tricky).
    - Down: "Question mark" (confused about actions here).
  - These signals appear as temporary icons on the board for collaboration.
  - **Controls**: Mouse for clicks/drags. Game supports real-time interaction for up to multiple players simultaneously.

### How to Win/Lose
- **Win**: Reveal all non-mine tiles (empty and number). All players' names appear on the leaderboard. In edge cases where deduction is impossible, the game auto-resolves safely.
- **Lose**: Any player clicks a mine, ending the game for everyone.

Glossary for clarity:
- **Adjacent Tiles**: The 4 direct neighbors (up, down, left, right). Example ASCII diagram:

  ```
  	A
  	
  A	X	A
  	
  	A
  ```

- **Surrounding Tiles**: The 8 neighbors (including diagonals). Example:

  ```
  S	S	S
  S	X	S
  S	S	S
  ```

- **Indirectly Adjacent/Surrounding**: Chain of connected tiles (transitive closure).

The game duration is designed to be short: 3-4 minutes for standard modes, aligning with quick collaborative play.

## 4. Game Over Page
### What Will Be in It
The page appears after win or lose, with animations and stats.

- **Win Case**:
  - Fireworks animation.
  - All mines revealed with clipping effects.
  - "Congratulations!" message in the center.
  - Stats board: Win confirmation, time used, best personal time, current ranking.
  - Options: Start new game (back to front page) or exit.

- **Lose Case**:
  - Bomb animation on the clicked mine, rippling to all mines.
  - "GAME OVER" message in the center.
  - Stats board: Loss confirmation, time used, best personal time, current ranking.
  - Options: Restart current game (same board), start new game (back to front page), or exit.

Player statistics (e.g., reveals made, signals sent) and overall rankings (based on wins, times) are shown for all participants. Rankings are global, pulled from a database.

## 5. Cheating
### How We Will Support Enabling and Disabling It
Cheat mode is toggled via the 'C' key (press to enable/disable). It's off by default and dynamically adjusts based on game difficulty/player performance (e.g., more help if struggling).

Levels of cheating (escalating strength):
1. **Trial-and-Error Chances (1-3)**: Clicking a mine doesn't end the game; it reveals it's a mine with fun animations (e.g., mine jumps away or explodes harmlessly).
2. **Limited Vision Area**: A magnifying glass tool lets players peek under a small area of unrevealed tiles (shows numbers/empties/mines temporarily).
3. **Full Mine Marking**: Auto-flags all mines.
This makes the game completable much quicker when enabled, but it's optional and can be disabled anytime for fair play.