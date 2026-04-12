// @ts-ignore - Phaser loaded from CDN
const Phaser = window.Phaser;

import { GameScene } from "./scenes/GameScene";

console.log("=== BAR FIGHT GAME ===");
console.log("Phaser:", Phaser);

const config = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#1a1a1a",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    expandParent: false,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 300 },
    },
  },
  scene: [GameScene],
};

console.log("Creating Phaser game...");
const game = new Phaser.Game(config);
console.log("Game instance:", game);

export default game;
