// @ts-ignore
const Phaser = window.Phaser;

interface Player {
  sprite: any;
  speed: number;
  jumpPower: number;
}

interface GameState {
  isGameRunning: boolean;
  score: number;
  health: number;
}

export class GameScene extends Phaser.Scene {
  add: any;
  input: any;
  scene: any;
  cameras: any;
  physics: any;
  time: any;

  player: Player | null = null;
  gameState: GameState = {
    isGameRunning: false,
    score: 0,
    health: 100,
  };
  cursors: any;
  scoreText: any;

  constructor() {
    super("GameScene");
  }

  preload() {
    console.log("GameScene: preload");
  }

  create() {
    console.log("GameScene: create");

    // Background
    this.cameras.main.setBackgroundColor("#1a1a1a");

    // Title
    this.add
      .text(640, 100, "Bar Fight Game", {
        fontSize: "56px",
        color: "#ff4444",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // Instructions
    this.add
      .text(640, 200, "A/D - Move | SPACE - Jump | Click to Start", {
        fontSize: "18px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    // Start button area
    const button = this.add
      .rectangle(640, 350, 200, 60, 0xff4444)
      .setInteractive({ useHandCursor: true });

    this.add
      .text(640, 350, "START GAME", {
        fontSize: "24px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    button.on("pointerdown", () => {
      this.startGame();
    });

    // Setup input
    this.cursors = this.input.keyboard?.createCursorKeys();
  }

  startGame() {
    console.log("Game started!");
    this.gameState.isGameRunning = true;

    // Clear UI
    this.add.clearMask(true);

    // Create player
    this.player = {
      sprite: this.add.rectangle(640, 500, 40, 60, 0x00ff00),
      speed: 300,
      jumpPower: 400,
    };

    this.physics.add.existing(this.player.sprite);
    this.player.sprite.body.setBounce(0.2);
    this.player.sprite.body.setCollideWorldBounds(true);

    // Score display
    this.scoreText = this.add.text(20, 20, "Score: 0", {
      fontSize: "24px",
      color: "#ffffff",
    });
  }

  update() {
    if (!this.gameState.isGameRunning || !this.player) return;

    const { sprite } = this.player;

    // Horizontal movement
    if (this.cursors.left?.isDown) {
      sprite.body.setVelocityX(-this.player.speed);
    } else if (this.cursors.right?.isDown) {
      sprite.body.setVelocityX(this.player.speed);
    } else {
      sprite.body.setVelocityX(0);
    }

    // Jump
    if (this.cursors.space?.isDown && sprite.body.touching.down) {
      sprite.body.setVelocityY(-this.player.jumpPower);
    }

    // Update score
    this.gameState.score += 1;
    this.scoreText.setText(`Score: ${Math.floor(this.gameState.score / 10)}`);
  }
}
