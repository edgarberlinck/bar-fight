import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface GameSnapshot {
  health: number;
  stamina: number;
  score: number;
  kills: number;
  wave: number;
  combo: string;
  boss: string;
  running: boolean;
  paused: boolean;
  gameOver: boolean;
}

interface Fighter {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  healthBar: THREE.Group;
  healthFill: THREE.Mesh;
  health: number;
  maxHealth: number;
  radius: number;
  speed: number;
  damage: number;
  velocity: THREE.Vector3;
  facing: number;
  phase: number;
  cooldown: number;
  hurt: number;
  dead: number;
  jump: number;
  jumpVelocity: number;
  attack: Attack | null;
  boss: number;
  special: number;
  telegraph: THREE.Mesh | null;
  chargeDirection: THREE.Vector3;
  charging: number;
}

interface Attack {
  kind: "punch" | "kick";
  step: number;
  elapsed: number;
  duration: number;
  hit: boolean;
  airborne: boolean;
  strength: number;
}

interface Obstacle {
  x: number;
  z: number;
  width: number;
  depth: number;
  root?: THREE.Group;
  health?: number;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  floor: number;
  spin: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const PUNCHES = ["Jab", "Jab", "Direto", "Cruzado"];
const KICKS = ["Chute", "Chute", "Outra perna", "Giratório"];
const BOSSES = ["BIG RUST · O COBRADOR", "MAD DOG · CORRENTE SOLTA", "IRON MA · ÚLTIMA DOSE"];

export class GameScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly textures: THREE.Texture[] = [];
  private readonly keys = new Set<string>();
  private readonly enemies: Fighter[] = [];
  private readonly obstacles: Obstacle[] = [];
  private readonly chairs: Obstacle[] = [];
  private readonly particles: Particle[] = [];
  private readonly right = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly player: Fighter;
  private readonly resizeObserver: ResizeObserver;
  private readonly dynamic = new THREE.Group();
  private readonly chairGroup = new THREE.Group();
  private readonly floorMarks = new THREE.Group();
  private state: GameSnapshot = {
    health: 100, stamina: 100, score: 0, kills: 0, wave: 0,
    combo: "", boss: "", running: false, paused: false, gameOver: false,
  };
  private frame = 0;
  private disposed = false;
  private lastTime = 0;
  private time = 0;
  private publishTime = 0;
  private attackDelay = 0;
  private regenDelay = 0;
  private comboTime = 0;
  private punchStep = 0;
  private kickStep = 0;
  private lastKind = "";
  private queuedAttack: "punch" | "kick" | null = null;
  private invulnerable = 0;
  private nextWave = -1;
  private shake = 0;
  private readonly cameraHome = new THREE.Vector3(15, 20, 24);
  private readonly aim = new THREE.Vector3(0, 0.3, 0);

  constructor(private readonly container: HTMLElement, private readonly onUpdate: (state: GameSnapshot) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.domElement.style.cssText = "display:block;width:100%;height:100%;outline:none;touch-action:none";
    this.renderer.domElement.setAttribute("aria-label", "Arena 3D de um bar. WASD move, H soca, J chuta, K pula.");
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x100c12);
    this.scene.fog = new THREE.FogExp2(0x21191f, 0.016);
    this.camera.position.copy(this.cameraHome);
    this.camera.lookAt(this.aim);
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, UP).normalize();
    this.scene.add(this.dynamic, this.chairGroup, this.floorMarks);
    this.buildBar();
    this.player = this.createFighter("jack", 0);
    this.player.root.position.set(0, 0, 2.7);
    this.player.facing = Math.PI;
    this.player.root.rotation.y = Math.PI;
    this.dynamic.add(this.player.root);
    this.buildChairs();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.blur);
    document.addEventListener("visibilitychange", this.visibility);
    this.resize();
    this.renderer.render(this.scene, this.camera);
    this.publish();
    this.frame = requestAnimationFrame(this.tick);
  }

  start(): void {
    if (this.disposed) return;
    for (const enemy of this.enemies) this.dynamic.remove(enemy.root);
    this.enemies.length = 0;
    for (const particle of this.particles) this.dynamic.remove(particle.mesh);
    this.particles.length = 0;
    this.floorMarks.clear();
    this.state = {
      health: 100, stamina: 100, score: 0, kills: 0, wave: 0,
      combo: "", boss: "", running: true, paused: false, gameOver: false,
    };
    this.keys.clear();
    this.queuedAttack = null;
    this.attackDelay = this.regenDelay = this.comboTime = this.invulnerable = this.shake = 0;
    this.punchStep = this.kickStep = 0;
    this.lastKind = "";
    this.nextWave = -1;
    this.player.root.position.set(0, 0, 3);
    this.player.root.rotation.set(0, Math.PI, 0);
    this.player.body.rotation.set(0, 0, 0);
    this.player.velocity.set(0, 0, 0);
    this.player.facing = Math.PI;
    this.player.health = 100;
    this.player.hurt = this.player.dead = this.player.jump = this.player.jumpVelocity = 0;
    this.player.attack = null;
    this.buildChairs();
    this.spawnWave();
    this.animateFighter(this.player, 0);
    this.publish();
  }

  togglePause(): void {
    if (!this.state.running || this.state.gameOver || this.disposed) return;
    this.state.paused = !this.state.paused;
    this.keys.clear();
    this.queuedAttack = null;
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.blur);
    document.removeEventListener("visibilitychange", this.visibility);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        if (object instanceof THREE.Mesh) geometries.add(object.geometry);
        const entries = Array.isArray(object.material) ? object.material : [object.material];
        entries.forEach(material => materials.add(material));
      }
    });
    this.geometries.forEach(geometry => geometries.add(geometry));
    this.materials.forEach(material => materials.add(material));
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep the entire arena visible on narrow displays without changing movement axes.
    const fit = Math.max(1, 1.45 / this.camera.aspect);
    this.camera.position.copy(this.cameraHome).multiplyScalar(fit);
    this.camera.lookAt(this.aim);
    this.camera.updateProjectionMatrix();
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const key = event.code;
    if (!["KeyW", "KeyA", "KeyS", "KeyD", "KeyH", "KeyJ", "KeyK"].includes(key)) return;
    if (!this.state.running || this.state.paused || this.state.gameOver) return;
    event.preventDefault();
    this.keys.add(key);
    if (!event.repeat) {
      if (key === "KeyH") this.queuedAttack = "punch";
      if (key === "KeyJ") this.queuedAttack = "kick";
      if (key === "KeyK" && this.player.jump <= 0.01 && this.state.stamina >= 8) {
        this.player.jumpVelocity = 7.8;
        this.state.stamina -= 8;
        this.regenDelay = 0.65;
      }
    }
  };

  private readonly keyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private readonly blur = (): void => {
    this.keys.clear();
    this.queuedAttack = null;
    if (this.state.running && !this.state.paused && !this.state.gameOver) {
      this.state.paused = true;
      this.publish();
    }
  };
  private readonly visibility = (): void => { if (document.hidden) this.blur(); };

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min((now - (this.lastTime || now)) / 1000, 0.04);
    this.lastTime = now;
    if (!this.state.paused) {
      this.time += dt;
      if (this.state.running && !this.state.gameOver) this.updateCombat(dt);
      else if (!this.state.gameOver) this.animateFighter(this.player, dt);
      if (this.state.gameOver) {
        this.player.dead += dt;
        this.animateFighter(this.player, dt);
      }
      this.updateParticles(dt);
      this.shake = Math.max(0, this.shake - dt * 1.4);
    }
    const fit = Math.max(1, 1.45 / this.camera.aspect);
    this.camera.position.copy(this.cameraHome).multiplyScalar(fit);
    if (!this.state.paused && this.shake > 0) {
      this.camera.position.x += Math.sin(this.time * 91) * this.shake;
      this.camera.position.y += Math.cos(this.time * 77) * this.shake * 0.45;
    }
    this.camera.lookAt(this.aim);
    this.renderer.render(this.scene, this.camera);
    this.publishTime += dt;
    if (this.publishTime > 0.09) { this.publishTime = 0; this.publish(); }
    this.frame = requestAnimationFrame(this.tick);
  };

  private publish(): void { this.onUpdate({ ...this.state }); }

  private geometry(shape: string): THREE.BufferGeometry {
    let geometry = this.geometries.get(shape);
    if (!geometry) {
      geometry = shape === "sphere" ? new THREE.SphereGeometry(1, 8, 6)
        : shape === "cylinder" ? new THREE.CylinderGeometry(1, 1, 1, 10)
        : shape === "cone" ? new THREE.ConeGeometry(1, 1, 7)
        : shape === "ring" ? new THREE.TorusGeometry(1, 0.035, 4, 36)
        : new THREE.BoxGeometry(1, 1, 1);
      this.geometries.set(shape, geometry);
    }
    return geometry;
  }

  private material(color: number, metalness = 0, emissive = 0): THREE.MeshStandardMaterial {
    const key = `${color}-${metalness}-${emissive}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color, roughness: metalness ? 0.38 : 0.85, metalness,
        emissive: color, emissiveIntensity: emissive,
      });
      this.materials.set(key, material);
    }
    return material;
  }

  private mesh(parent: THREE.Object3D, shape: string, color: number, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, metalness = 0, emissive = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(shape), this.material(color, metalness, emissive));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private box(parent: THREE.Object3D, color: number, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, metalness = 0, emissive = 0): THREE.Mesh {
    return this.mesh(parent, "box", color, x, y, z, sx, sy, sz, metalness, emissive);
  }

  private label(text: string, color: string, width: number, height: number, fontSize = 52): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#110e14";
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.strokeRect(13, 13, 998, 230);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.font = `900 ${fontSize}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 512, 132, 960);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    return mesh;
  }

  private buildBar(): void {
    this.scene.add(new THREE.HemisphereLight(0xa5b5d7, 0x493322, 1.65));
    const key = new THREE.DirectionalLight(0xffcf91, 3.1);
    key.position.set(2, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -15, right: 15, top: 13, bottom: -13, near: 1, far: 40 });
    key.shadow.bias = -0.0007;
    key.shadow.normalBias = 0.04;
    this.scene.add(key);
    const neon = new THREE.PointLight(0xff315f, 34, 17, 2);
    neon.position.set(-2, 3.7, -7);
    const blue = new THREE.PointLight(0x36b8dc, 23, 13, 2);
    blue.position.set(9, 3.1, -2);
    this.scene.add(neon, blue);
    this.box(this.scene, 0x171215, 0, -0.42, 0, 24.5, 0.65, 19.5);
    // Individual planks, nail heads, spilled drinks and scratches give the floor depth.
    for (let row = 0; row < 31; row++) {
      for (let column = 0; column < 8; column++) {
        const x = -10.5 + column * 3;
        const z = -8.7 + row * 0.58;
        const colors = [0x493222, 0x543928, 0x62432e, 0x3e2b22, 0x5a3b2b];
        this.box(this.scene, colors[(row * 7 + column * 3) % colors.length], x, -0.045, z, 2.96, 0.14, 0.555);
        if ((row + column) % 3 === 0) {
          this.box(this.scene, 0x241e1c, x - 1.32, 0.031, z, 0.025, 0.005, 0.055);
          this.box(this.scene, 0x241e1c, x + 1.32, 0.031, z, 0.025, 0.005, 0.055);
        }
      }
    }
    for (let i = 0; i < 65; i++) {
      const x = Math.sin(i * 71.37) * 10.9;
      const z = Math.cos(i * 29.53) * 8.3;
      const stain = this.mesh(this.scene, "cylinder", i % 3 ? 0x30251f : 0x6d4b2c, x, 0.035, z,
        0.12 + (i % 6) * 0.06, 0.006, 0.1 + (i % 4) * 0.08);
      stain.rotation.y = i;
      if (i % 3 === 0) {
        const paper = this.box(this.scene, 0x9f977b, x + 0.5, 0.043, z, 0.19, 0.01, 0.26);
        paper.rotation.y = i * 4.3;
      }
    }
    // Back and left walls only: the open camera-facing sides never hide combat.
    this.box(this.scene, 0x29272a, 0, 2.7, -9, 24, 5.4, 0.3);
    this.box(this.scene, 0x2b2929, -12, 2.4, 0, 0.25, 4.8, 18);
    for (let row = 0; row < 10; row++) {
      for (let column = 0; column < 30; column++) {
        const x = -11.65 + column * 0.8 + (row % 2) * 0.4;
        if (x < 11.8) this.box(this.scene, [0x53342d, 0x624036, 0x493431, 0x704538][(row + column * 7) % 4],
          x, 0.3 + row * 0.47, -8.81, 0.76, 0.43, 0.07);
      }
    }
    this.box(this.scene, 0x211d1b, 0, 0.55, -8.55, 24, 1.1, 0.2);
    for (let i = 0; i < 48; i++) this.box(this.scene, 0x493023, -11.75 + i * 0.5, 0.6, -8.4, 0.46, 1.12, 0.1);
    this.box(this.scene, 0x95653c, 0, 1.23, -8.35, 24, 0.1, 0.13);
    this.box(this.scene, 0x201c1c, 0, 4.9, -8.55, 24, 0.28, 0.45);
    this.box(this.scene, 0x292425, -11.76, 2.5, 0, 0.2, 0.15, 18, 0.7);
    this.box(this.scene, 0x292425, -11.76, 4.1, 0, 0.2, 0.13, 18, 0.7);
    const sign = this.label("THE LAST ROUND", "#ff4775", 6.5, 1.5, 94);
    sign.position.set(-1.3, 4.05, -8.4);
    this.scene.add(sign);
    const subtitle = this.label("COLD BEER · BAD DECISIONS", "#efbf79", 4.2, 0.55, 56);
    subtitle.position.set(-1.3, 2.95, -8.37);
    this.scene.add(subtitle);
    this.buildCounter();
    this.buildPoolTable(5.5, -2);
    this.buildBooth(-9.8, -1.5);
    this.buildBooth(-9.8, 4.5);
    this.buildJukebox(10.4, -6.8);
    for (const [x, z] of [[-5.6, 3.8], [5.6, 5.3]]) {
      this.mesh(this.scene, "cylinder", 0x292426, x, 0.56, z, 0.11, 1.1, 0.11, 0.7);
      this.mesh(this.scene, "cylinder", 0x262323, x, 0.12, z, 0.55, 0.13, 0.55, 0.65);
      this.mesh(this.scene, "cylinder", 0x6b4328, x, 1.15, z, 0.95, 0.18, 0.95);
      this.bottle(this.scene, x + 0.25, 1.24, z, 0x475e30);
      this.bottle(this.scene, x - 0.3, 1.24, z + 0.23, 0x735022);
      this.obstacles.push({ x, z, width: 1.9, depth: 1.9 });
    }
    for (const x of [-7, 2, 8]) {
      this.box(this.scene, 0x17181b, x, 5.8, -2.8, 0.055, 1.3, 0.055, 0.7);
      this.mesh(this.scene, "cone", 0x30332e, x, 5.1, -2.8, 0.62, 0.38, 0.62, 0.5);
      this.mesh(this.scene, "sphere", 0xffcb73, x, 4.91, -2.8, 0.17, 0.11, 0.17, 0, 2);
      const light = new THREE.PointLight(0xffb45f, 12, 10, 2);
      light.position.set(x, 4.6, -2.8);
      this.scene.add(light);
    }
    const posters = [
      { x: -9.1, y: 3.2, text: "LIVE / LOUD", color: "#edb766" },
      { x: 5.2, y: 3.6, text: "NO CREDIT", color: "#d5c795" },
      { x: 8, y: 3.6, text: "HELL RIDERS", color: "#dd6657" },
    ];
    for (const poster of posters) {
      const mesh = this.label(poster.text, poster.color, 1.9, 1.3, 86);
      mesh.position.set(poster.x, poster.y, -8.59);
      mesh.rotation.z = poster.x * 0.007;
      this.scene.add(mesh);
    }
    const exit = this.label("EXIT →", "#72d4a5", 1.5, 0.5, 100);
    exit.position.set(-10.6, 4.1, -8.5);
    this.scene.add(exit);
    this.box(this.scene, 0x243029, -10.6, 1.7, -8.53, 1.6, 3.3, 0.17);
    this.box(this.scene, 0xa69264, -10.05, 1.5, -8.4, 0.08, 0.1, 0.08, 0.8);
    // A rusty motorcycle wheel and crossed pool cues decorate the wall.
    const wheel = this.mesh(this.scene, "ring", 0x17181a, -6.6, 3.55, -8.3, 0.78, 0.78, 0.78, 0.4);
    wheel.rotation.z = 0.2;
    for (let i = 0; i < 8; i++) {
      const spoke = this.box(this.scene, 0x716d65, -6.6, 3.55, -8.26, 0.025, 1.43, 0.025, 0.7);
      spoke.rotation.z = i * Math.PI / 8;
    }
    for (const angle of [-0.55, 0.55]) {
      const cue = this.box(this.scene, 0xb28b51, 6.5, 3.2, -8.3, 0.05, 2.8, 0.05);
      cue.rotation.z = angle;
    }
    for (const x of [-11.4, 11.4]) {
      this.box(this.scene, 0x1b1d20, x, 0.65, 7.9, 0.9, 1.3, 0.8, 0.25);
      this.mesh(this.scene, "cylinder", 0x363638, x, 0.8, 8.32, 0.28, 0.04, 0.28).rotation.x = Math.PI / 2;
    }
    this.batchEnvironment();
  }

  private batchEnvironment(): void {
    // Batch the hundreds of individual bricks, planks and bottles into a few draw calls.
    const batches = new Map<string, THREE.Mesh[]>();
    this.scene.updateMatrixWorld(true);
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      const key = `${object.geometry.uuid}/${object.material.uuid}/${object.castShadow}`;
      const batch = batches.get(key) || [];
      batch.push(object);
      batches.set(key, batch);
    });
    for (const meshes of batches.values()) {
      if (meshes.length < 3) continue;
      const first = meshes[0];
      const instanced = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
      instanced.castShadow = first.castShadow;
      instanced.receiveShadow = true;
      meshes.forEach((mesh, index) => {
        instanced.setMatrixAt(index, mesh.matrixWorld);
        mesh.removeFromParent();
      });
      instanced.computeBoundingSphere();
      this.scene.add(instanced);
    }
  }

  private bottle(parent: THREE.Object3D, x: number, y: number, z: number, color: number): void {
    this.mesh(parent, "cylinder", color, x, y + 0.18, z, 0.095, 0.36, 0.095, 0.15);
    this.mesh(parent, "cylinder", color, x, y + 0.43, z, 0.043, 0.18, 0.043, 0.15);
    this.mesh(parent, "cylinder", 0xc8a95d, x, y + 0.52, z, 0.047, 0.045, 0.047, 0.5);
    this.box(parent, 0xc7ba83, x, y + 0.19, z + 0.093, 0.12, 0.14, 0.013);
  }

  private buildCounter(): void {
    this.box(this.scene, 0x31241d, -1.7, 0.78, -6.5, 12.8, 1.5, 1.6);
    for (let i = 0; i < 16; i++) this.box(this.scene, i % 2 ? 0x553522 : 0x64412b,
      -7.65 + i * 0.8, 0.74, -5.66, 0.73, 1.3, 0.1);
    this.box(this.scene, 0x966a42, -1.7, 1.6, -6.5, 13.3, 0.23, 2);
    this.box(this.scene, 0x32241d, -1.7, 1.74, -6.5, 13.15, 0.045, 1.91);
    this.box(this.scene, 0x9d8052, -1.7, 0.27, -5.36, 12.9, 0.08, 0.08, 0.7);
    this.obstacles.push({ x: -1.7, z: -6.5, width: 13.4, depth: 2.1 });
    for (const x of [-7, -4.8, -2.6, -0.4, 1.8, 4]) {
      this.mesh(this.scene, "cylinder", 0x292a2c, x, 0.56, -4.6, 0.075, 1.08, 0.075, 0.8);
      this.mesh(this.scene, "cylinder", 0x342e2a, x, 0.1, -4.6, 0.35, 0.08, 0.35, 0.7);
      this.mesh(this.scene, "cylinder", 0x652e2d, x, 1.13, -4.6, 0.37, 0.17, 0.37);
      const ring = this.mesh(this.scene, "ring", 0x86725a, x, 0.43, -4.6, 0.27, 0.27, 0.27, 0.8);
      ring.rotation.x = Math.PI / 2;
      this.obstacles.push({ x, z: -4.6, width: 0.64, depth: 0.64 });
    }
    for (let shelf = 0; shelf < 2; shelf++) {
      this.box(this.scene, 0x775031, -1.8, 1.8 + shelf * 0.65, -8.24, 11.7, 0.12, 0.65);
      for (let i = 0; i < 25; i++) {
        if (i % 7 === shelf) continue;
        this.bottle(this.scene, -7.3 + i * 0.46, 1.86 + shelf * 0.65, -8.2,
          [0x3c6039, 0x805323, 0x3d625e, 0x705a39][i % 4]);
      }
    }
    for (let i = 0; i < 9; i++) this.bottle(this.scene, -7 + i * 1.22, 1.77, -6.3,
      i % 2 ? 0x405b32 : 0x78552c);
    this.box(this.scene, 0x93908a, 2.3, 1.99, -6.7, 0.75, 0.48, 0.48, 0.55);
    this.box(this.scene, 0x272a24, 2.3, 2.27, -6.7, 0.66, 0.1, 0.4);
    this.box(this.scene, 0x5cf0b1, 2.3, 2.25, -6.44, 0.34, 0.14, 0.025, 0, 0.5);
  }

  private buildPoolTable(x: number, z: number): void {
    for (const dx of [-1.15, 1.15]) for (const dz of [-1.65, 1.65])
      this.box(this.scene, 0x3c2c25, x + dx, 0.55, z + dz, 0.32, 1.1, 0.32);
    this.box(this.scene, 0x432d23, x, 1.08, z, 3.2, 0.45, 4.5);
    this.box(this.scene, 0x205b50, x, 1.32, z, 2.82, 0.08, 4.1);
    for (const dx of [-1.49, 1.49]) this.box(this.scene, 0x91603b, x + dx, 1.38, z, 0.25, 0.2, 4.55);
    for (const dz of [-2.15, 2.15]) this.box(this.scene, 0x91603b, x, 1.38, z + dz, 2.85, 0.2, 0.25);
    for (const dx of [-1.3, 1.3]) for (const dz of [-1.93, 0, 1.93])
      this.mesh(this.scene, "cylinder", 0x10191a, x + dx, 1.43, z + dz, 0.14, 0.025, 0.14);
    for (let i = 0; i < 10; i++) {
      const colors = [0xd6cbb6, 0xbd3930, 0xd8b54d, 0x2b3557, 0x191b20, 0x773966];
      this.mesh(this.scene, "sphere", colors[i % colors.length], x + Math.sin(i * 4) * 0.9, 1.45,
        z + Math.cos(i * 2.1) * 1.5, 0.095, 0.095, 0.095);
    }
    const cue = this.box(this.scene, 0xc4a36b, x + 0.3, 1.49, z, 0.035, 0.035, 3.4);
    cue.rotation.y = 0.31;
    this.obstacles.push({ x, z, width: 3.35, depth: 4.6 });
  }

  private buildBooth(x: number, z: number): void {
    this.box(this.scene, 0x27211e, x, 0.35, z, 2.4, 0.6, 2.25);
    this.box(this.scene, 0x643632, x, 0.78, z, 2.35, 0.3, 2.2);
    this.box(this.scene, 0x522b2c, x - 0.85, 1.3, z, 0.42, 1.65, 2.3);
    for (let i = 0; i < 6; i++) this.box(this.scene, 0x75443b, x - 0.61, 1.3, z - 0.92 + i * 0.37,
      0.035, 1.3, 0.025);
    this.box(this.scene, 0x473126, x + 1.15, 1.02, z, 1.5, 0.16, 1.8);
    this.box(this.scene, 0x252323, x + 1.15, 0.48, z, 0.12, 1, 0.12, 0.7);
    this.bottle(this.scene, x + 1.2, 1.11, z + 0.3, 0x475a32);
    this.obstacles.push({ x: x + 0.35, z, width: 3.45, depth: 2.4 });
  }

  private buildJukebox(x: number, z: number): void {
    this.box(this.scene, 0x382925, x, 1.35, z, 1.5, 2.7, 0.9);
    this.box(this.scene, 0x6f3e29, x, 1.38, z + 0.48, 1.39, 2.55, 0.12);
    this.box(this.scene, 0x2d3334, x, 0.75, z + 0.56, 1.1, 0.95, 0.04);
    for (let i = 0; i < 9; i++) this.box(this.scene, 0x86735d, x - 0.46 + i * 0.115, 0.75,
      z + 0.59, 0.025, 0.85, 0.02, 0.7);
    this.box(this.scene, 0x7ee5d4, x, 2.05, z + 0.56, 1.02, 0.75, 0.04, 0, 0.7);
    for (const dx of [-0.66, 0.66]) this.box(this.scene, 0xff6c87, x + dx, 1.45, z + 0.58,
      0.07, 2.2, 0.07, 0, 1.6);
    const text = this.label("ROCK / 66", "#f6d278", 1.25, 0.36, 90);
    text.position.set(x, 2.71, z + 0.5);
    this.scene.add(text);
    this.obstacles.push({ x, z, width: 1.7, depth: 1.2 });
  }

  private buildChairs(): void {
    this.chairGroup.clear();
    this.chairs.length = 0;
    for (const [x, z, angle] of [[-4.3, 2, 0.4], [-6.4, 5.4, -0.7], [4.3, 6.8, 0.8],
      [7.5, 5.3, -0.9], [-1.9, -2.3, 0.2], [8.4, 1.7, 0.7]]) {
      const chair = new THREE.Group();
      chair.position.set(x, 0, z);
      chair.rotation.y = angle;
      this.box(chair, 0x7b5031, 0, 0.64, 0, 0.73, 0.13, 0.72);
      for (const dx of [-0.28, 0.28]) for (const dz of [-0.27, 0.27])
        this.box(chair, 0x664027, dx, 0.3, dz, 0.09, 0.6, 0.09);
      for (const dx of [-0.28, 0.28]) this.box(chair, 0x775033, dx, 1.06, -0.27, 0.09, 0.8, 0.09);
      for (const y of [0.95, 1.25, 1.43]) this.box(chair, 0x835638, 0, y, -0.27, 0.63, 0.12, 0.07);
      this.chairGroup.add(chair);
      this.chairs.push({ x, z, width: 0.82, depth: 0.82, root: chair, health: 30 });
    }
  }

  private createFighter(style: string, boss: number): Fighter {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const jack = style === "jack";
    const punk = style === "punk";
    const homeless = style === "homeless";
    const skin = jack ? 0xc49879 : homeless ? 0x9a8067 : punk ? 0xc39a81 : 0xb98d70;
    const jacket = jack ? 0x171a20 : punk ? 0x40264d : homeless ? 0x665b41 : boss ? 0x69292b : 0x282b2d;
    const pants = jack ? 0x365071 : punk ? 0x30313c : homeless ? 0x434432 : 0x24262c;
    this.box(body, jacket, 0, 1.25, 0, 0.68, 0.77, 0.4);
    this.box(body, 0x17191c, 0, 0.86, 0, 0.65, 0.16, 0.43);
    this.box(body, 0xa29c8e, 0.04, 0.87, 0.23, 0.13, 0.1, 0.04, 0.8);
    this.box(body, jack ? 0x6f6b65 : 0x292524, 0, 1.25, 0.211, 0.23, 0.63, 0.035);
    // Open leather lapels, belt, rivets and a back patch.
    for (const side of [-1, 1]) {
      const lapel = this.box(body, jacket, side * 0.16, 1.43, 0.24, 0.14, 0.36, 0.05);
      lapel.rotation.z = side * -0.28;
      this.box(body, 0xb9ada0, side * 0.24, 1.48, 0.259, 0.035, 0.035, 0.025, 0.8);
      this.box(body, 0x111418, side * 0.23, 1.1, 0.224, 0.17, 0.08, 0.025);
    }
    if (!homeless) {
      this.box(body, 0xc1b396, 0, 1.35, -0.213, 0.36, 0.33, 0.02);
      this.box(body, 0x333132, 0, 1.36, -0.231, 0.23, 0.2, 0.02);
      this.box(body, 0xc1b396, 0, 1.4, -0.247, 0.13, 0.12, 0.015);
    }
    if (jack || boss) {
      this.box(body, jack ? 0xb32d35 : 0x9a7945, 0, 1.61, 0, 0.46, 0.16, 0.46);
      const scarf = this.box(body, jack ? 0xa92130 : 0xa08051, 0.16, 1.36, 0.27, 0.14, 0.42, 0.045);
      scarf.rotation.z = -0.2;
    }
    const head = new THREE.Group();
    head.position.y = 1.69;
    body.add(head);
    this.mesh(head, "sphere", skin, 0, 0.19, 0.015, 0.255, 0.3, 0.24);
    this.box(head, skin, 0, 0.14, 0.246, 0.09, 0.11, 0.09);
    for (const side of [-1, 1]) this.box(head, skin, side * 0.255, 0.18, 0, 0.07, 0.14, 0.1);
    this.box(head, 0x513a32, 0, 0.015, 0.18, 0.16, 0.04, 0.07);
    if (jack) {
      this.box(head, 0x121318, 0, 0.39, -0.02, 0.48, 0.19, 0.4);
      this.box(head, 0x121318, 0.19, 0.29, -0.09, 0.1, 0.24, 0.29);
      const quiff = this.box(head, 0x1d1c21, -0.045, 0.49, 0.08, 0.4, 0.14, 0.3);
      quiff.rotation.z = -0.17;
    } else if (punk) {
      for (let i = 0; i < 5; i++) this.mesh(head, "cone", 0xbd365e, 0, 0.51, -0.16 + i * 0.085, 0.08, 0.3, 0.08);
      this.mesh(head, "ring", 0xb8b7ac, 0.29, 0.07, 0.04, 0.06, 0.06, 0.06, 0.9);
    } else if (homeless) {
      this.mesh(head, "sphere", 0x685d45, 0, 0.39, -0.02, 0.28, 0.17, 0.26);
      this.box(head, 0x5e4e3e, 0, -0.01, 0.09, 0.34, 0.22, 0.27);
      this.box(body, 0x827152, -0.16, 1.19, 0.22, 0.18, 0.21, 0.025);
    } else {
      this.box(head, boss ? 0x222124 : 0x57372d, 0, 0.37, -0.025, 0.5, 0.16, 0.4);
      this.box(head, 0x4a3029, 0, 0, 0.04, 0.35, 0.18, 0.28);
      if (boss) this.box(head, 0xb5803e, 0, 0.32, 0.11, 0.53, 0.09, 0.34);
    }
    for (const side of [-1, 1]) {
      this.box(head, jack || !punk && !homeless ? 0x080f17 : 0x292124, side * 0.115, 0.235, 0.218,
        0.18, 0.095, 0.045, 0.4);
      if (jack) this.box(head, 0x6b8b9d, side * 0.13, 0.25, 0.244, 0.08, 0.015, 0.008, 0.7);
    }
    this.box(head, 0x222426, 0, 0.24, 0.24, 0.08, 0.025, 0.035, 0.7);
    const limb = (side: number, arm: boolean): THREE.Group => {
      const group = new THREE.Group();
      group.position.set(side * (arm ? 0.43 : 0.19), arm ? 1.54 : 0.84, 0);
      body.add(group);
      if (arm) {
        this.box(group, jacket, 0, -0.2, 0, 0.25, 0.43, 0.3);
        this.box(group, jack ? jacket : skin, 0, -0.46, 0.025, 0.21, 0.2, 0.25);
        this.box(group, skin, 0, -0.62, 0.03, 0.22, 0.22, 0.24);
        this.box(group, 0x242326, 0, -0.52, 0.03, 0.235, 0.09, 0.265, 0.35);
        if (punk || boss) for (let i = 0; i < 3; i++)
          this.mesh(group, "cone", 0xaaa7a0, side * 0.1, -0.08 - i * 0.09, 0, 0.06, 0.12, 0.06, 0.8).rotation.z = side * -Math.PI / 2;
      } else {
        this.box(group, pants, 0, -0.3, 0, 0.27, 0.62, 0.32);
        this.box(group, 0x17191d, 0, -0.7, 0.065, 0.3, 0.3, 0.43, 0.15);
        this.box(group, 0x393a3d, 0, -0.82, 0.085, 0.32, 0.07, 0.46);
        if (jack) {
          this.box(group, skin, 0, -0.34, 0.167, 0.18, 0.12, 0.012);
          this.box(group, 0x9aabac, 0, -0.3, 0.18, 0.23, 0.025, 0.015);
          this.box(group, 0x9aabac, 0, -0.4, 0.18, 0.21, 0.02, 0.015);
        }
      }
      return group;
    };
    const leftArm = limb(-1, true), rightArm = limb(1, true);
    const leftLeg = limb(-1, false), rightLeg = limb(1, false);
    this.batchCharacter([body, head, leftArm, rightArm, leftLeg, rightLeg], `${style}-${!!boss}`);
    const healthBar = new THREE.Group();
    healthBar.position.set(0, boss ? 3.1 : 2.65, 0);
    const backing = this.box(healthBar, 0x17151b, 0, 0, 0, 0.86, 0.105, 0.035);
    backing.castShadow = false;
    const healthFill = this.box(healthBar, boss ? 0xffb14d : 0xf16564, 0, 0, 0.024, 0.79, 0.055, 0.015, 0, 0.45);
    healthFill.castShadow = false;
    root.add(healthBar);
    healthBar.visible = !jack;
    const size = boss ? 1.35 + Math.min(boss, 4) * 0.035 : style === "biker" ? 1.06 : 1;
    body.scale.setScalar(size);
    return {
      root, body, head, leftArm, rightArm, leftLeg, rightLeg, healthBar, healthFill,
      health: 100, maxHealth: 100, radius: boss ? 0.65 : 0.43,
      speed: 2, damage: 9, velocity: new THREE.Vector3(), facing: 0,
      phase: Math.random() * Math.PI * 2, cooldown: 1, hurt: 0, dead: 0,
      jump: 0, jumpVelocity: 0, attack: null, boss, special: boss ? 3 : 0,
      telegraph: null, chargeDirection: new THREE.Vector3(), charging: 0,
    };
  }

  private batchCharacter(parts: THREE.Group[], style: string): void {
    let material = this.materials.get("fighter");
    if (!material) {
      material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
      this.materials.set("fighter", material);
    }
    parts.forEach((part, index) => {
      const meshes = part.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
      const key = `fighter-${style}-${index}`;
      let geometry = this.geometries.get(key);
      if (!geometry) {
        const pieces = meshes.map(mesh => {
          mesh.updateMatrix();
          const piece = mesh.geometry.clone().applyMatrix4(mesh.matrix);
          const color = (mesh.material as THREE.MeshStandardMaterial).color;
          const colors = new Float32Array(piece.getAttribute("position").count * 3);
          for (let i = 0; i < colors.length; i += 3) {
            colors[i] = color.r;
            colors[i + 1] = color.g;
            colors[i + 2] = color.b;
          }
          piece.setAttribute("color", new THREE.BufferAttribute(colors, 3));
          return piece;
        });
        geometry = mergeGeometries(pieces)!;
        pieces.forEach(piece => piece.dispose());
        this.geometries.set(key, geometry);
      }
      meshes.forEach(mesh => part.remove(mesh));
      const merged = new THREE.Mesh(geometry, material);
      merged.castShadow = true;
      merged.receiveShadow = true;
      part.add(merged);
    });
  }

  private spawnWave(): void {
    this.state.wave++;
    const wave = this.state.wave;
    const isBoss = wave % 3 === 0;
    const count = Math.min(10, 2 + Math.ceil(wave * 0.8));
    this.state.boss = isBoss ? BOSSES[(Math.floor(wave / 3) - 1) % BOSSES.length] : "";
    for (let i = 0; i < count; i++) {
      const boss = isBoss && i === 0 ? Math.floor(wave / 3) : 0;
      const style = ["punk", "biker", "homeless"][(i + wave) % 3];
      const enemy = this.createFighter(style, boss);
      enemy.maxHealth = enemy.health = boss ? 200 + wave * 22 : 43 + Math.min(wave, 30) * 7 + (style === "biker" ? 13 : 0);
      enemy.speed = boss ? 1.65 : (style === "punk" ? 2.75 : style === "homeless" ? 1.8 : 2.15) + Math.min(wave, 20) * 0.035;
      enemy.damage = boss ? 17 + Math.min(wave, 40) : 6 + Math.min(wave, 30) * 0.65;
      enemy.cooldown = 1 + i * 0.22;
      // Seek a clear spawn point away from Jack and furniture.
      for (let attempt = 0; attempt < 80; attempt++) {
        const angle = (i / count) * Math.PI * 2 + attempt * 0.83;
        enemy.root.position.set(Math.sin(angle) * (8.5 - attempt % 3),
          0, Math.cos(angle) * 6.7);
        if (this.isClear(enemy.root.position.x, enemy.root.position.z, enemy.radius + 0.25)
          && enemy.root.position.distanceTo(this.player.root.position) > 4
          && !this.enemies.some(other => other.root.position.distanceTo(enemy.root.position) < 1.4)) break;
      }
      this.enemies.push(enemy);
      this.dynamic.add(enemy.root);
    }
    this.nextWave = -1;
    this.publish();
  }

  private isClear(x: number, z: number, radius: number): boolean {
    if (x < -11.2 + radius || x > 11.2 - radius || z < -8.1 + radius || z > 8.2 - radius) return false;
    return ![...this.obstacles, ...this.chairs].some(obstacle =>
      x + radius > obstacle.x - obstacle.width / 2 && x - radius < obstacle.x + obstacle.width / 2
      && z + radius > obstacle.z - obstacle.depth / 2 && z - radius < obstacle.z + obstacle.depth / 2);
  }

  private updateCombat(dt: number): void {
    this.attackDelay = Math.max(0, this.attackDelay - dt);
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.comboTime -= dt;
    if (this.comboTime <= 0) {
      this.punchStep = this.kickStep = 0;
      this.lastKind = "";
      this.state.combo = "";
    }
    if (this.regenDelay <= 0 && !this.player.attack) this.state.stamina = Math.min(100, this.state.stamina + dt * 15);
    const move = new THREE.Vector3();
    const horizontal = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA"));
    const vertical = Number(this.keys.has("KeyW")) - Number(this.keys.has("KeyS"));
    move.addScaledVector(this.right, horizontal).addScaledVector(this.forward, vertical);
    if (move.lengthSq() > 0) {
      move.normalize();
      if (!this.player.attack || this.player.attack.elapsed > this.player.attack.duration * 0.8)
        this.player.facing = Math.atan2(move.x, move.z);
    }
    const speed = this.player.attack ? (this.player.jump > 0 ? 4 : 1.7) : 4.8;
    const blend = 1 - Math.exp(-dt * (move.lengthSq() ? 13 : 17));
    this.player.velocity.x = THREE.MathUtils.lerp(this.player.velocity.x, move.x * speed, blend);
    this.player.velocity.z = THREE.MathUtils.lerp(this.player.velocity.z, move.z * speed, blend);
    this.moveFighter(this.player, dt);
    if (this.player.jumpVelocity !== 0 || this.player.jump > 0) {
      this.player.jumpVelocity -= dt * 20;
      this.player.jump = Math.max(0, this.player.jump + this.player.jumpVelocity * dt);
      if (this.player.jump === 0) this.player.jumpVelocity = 0;
    }
    this.player.root.position.y = this.player.jump;
    if (!this.player.attack && this.attackDelay <= 0) {
      const kind = this.queuedAttack || (this.keys.has("KeyH") ? "punch" : this.keys.has("KeyJ") ? "kick" : null);
      if (kind) this.beginAttack(kind, move.lengthSq() === 0);
      this.queuedAttack = null;
    }
    this.updatePlayerAttack(dt);
    this.player.hurt = Math.max(0, this.player.hurt - dt);
    this.animateFighter(this.player, dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (enemy.health <= 0) {
        enemy.dead += dt;
        this.animateFighter(enemy, dt);
        if (enemy.dead > 2) { this.dynamic.remove(enemy.root); this.enemies.splice(i, 1); }
      } else {
        this.updateEnemy(enemy, dt);
        this.animateFighter(enemy, dt);
      }
    }
    this.separateFighters();
    this.state.health = Math.max(0, this.player.health);
    if (this.player.health <= 0) {
      this.state.running = false;
      this.state.gameOver = true;
      this.state.combo = "";
      this.player.attack = null;
      this.player.dead = 0.001;
      this.keys.clear();
      this.publish();
      return;
    }
    if (!this.enemies.some(enemy => enemy.health > 0)) {
      this.state.boss = "";
      if (this.nextWave < 0) {
        this.nextWave = 2.4;
        this.state.health = this.player.health = Math.min(100, this.player.health + 8);
        this.state.stamina = Math.min(100, this.state.stamina + 20);
      }
      this.nextWave -= dt;
      if (this.nextWave <= 0) this.spawnWave();
    }
  }

  private beginAttack(kind: "punch" | "kick", aimAssist: boolean): void {
    const step = this.lastKind === kind ? (kind === "punch" ? this.punchStep : this.kickStep) : 0;
    const cost = kind === "punch" ? 8 + (step === 3 ? 4 : 0) : 13 + (step === 3 ? 5 : 0);
    if (this.state.stamina < cost) { this.attackDelay = 0.12; return; }
    const strength = this.state.stamina >= 70 ? 1.3 : this.state.stamina < 25 ? 0.85 : 1;
    this.state.stamina -= cost;
    this.regenDelay = 0.9;
    this.lastKind = kind;
    if (kind === "punch") { this.punchStep = (step + 1) % 4; this.kickStep = 0; }
    else { this.kickStep = (step + 1) % 4; this.punchStep = 0; }
    this.comboTime = 1.45;
    const airborne = this.player.jump > 0.12 || this.player.jumpVelocity > 0;
    this.state.combo = `${airborne ? "Aéreo · " : ""}${(kind === "punch" ? PUNCHES : KICKS)[step]}${step === 3 ? "!" : ""}`;
    if (aimAssist) {
      const candidates = this.enemies.filter(enemy => enemy.health > 0
        && enemy.root.position.distanceToSquared(this.player.root.position) < 10);
      candidates.sort((a, b) => a.root.position.distanceToSquared(this.player.root.position) - b.root.position.distanceToSquared(this.player.root.position));
      if (candidates[0]) this.player.facing = Math.atan2(
        candidates[0].root.position.x - this.player.root.position.x,
        candidates[0].root.position.z - this.player.root.position.z);
    }
    this.player.attack = {
      kind, step, duration: kind === "punch" ? (step === 3 ? 0.45 : 0.31) : (step === 3 ? 0.69 : 0.47),
      elapsed: 0, hit: false, airborne, strength,
    };
  }

  private updatePlayerAttack(dt: number): void {
    const attack = this.player.attack;
    if (!attack) return;
    attack.elapsed += dt;
    if (!attack.hit && attack.elapsed >= attack.duration * 0.37) {
      attack.hit = true;
      const kick = attack.kind === "kick";
      const range = kick ? 2.05 : 1.52;
      const damage = (kick ? 23 : 15) * (1 + attack.step * 0.17) * attack.strength * (attack.airborne ? 1.3 : 1);
      let hits = 0;
      for (const enemy of this.enemies) {
        if (enemy.health <= 0) continue;
        const dx = enemy.root.position.x - this.player.root.position.x;
        const dz = enemy.root.position.z - this.player.root.position.z;
        const distance = Math.hypot(dx, dz);
        const dot = (dx * Math.sin(this.player.facing) + dz * Math.cos(this.player.facing)) / Math.max(distance, 0.01);
        if (distance < range + enemy.radius * 0.4 && (dot > (attack.step === 3 ? -0.5 : 0.22) || distance < 0.7)) {
          // Furniture blocks blows as well as bodies.
          if (!this.clearLine(this.player.root.position, enemy.root.position)) continue;
          this.hurtEnemy(enemy, damage, kick ? 3.8 : 2.5, attack.airborne);
          hits++;
          if (!kick && attack.step < 3) break;
        }
      }
      for (let i = this.chairs.length - 1; i >= 0; i--) {
        const chair = this.chairs[i];
        const dx = chair.x - this.player.root.position.x, dz = chair.z - this.player.root.position.z;
        const distance = Math.hypot(dx, dz);
        const dot = (dx * Math.sin(this.player.facing) + dz * Math.cos(this.player.facing)) / Math.max(distance, 0.01);
        if (distance < range && (dot > 0.2 || attack.step === 3)) {
          chair.health = (chair.health || 0) - damage;
          if (chair.health <= 0) this.breakChair(i);
        }
      }
      if (hits) this.shake = Math.max(this.shake, kick ? 0.12 : 0.065);
    }
    if (attack.elapsed >= attack.duration) {
      this.player.attack = null;
      this.attackDelay = 0.055;
    }
  }

  private clearLine(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const samples = Math.ceil(distance / 0.2);
    for (let i = 1; i < samples; i++) {
      const x = THREE.MathUtils.lerp(from.x, to.x, i / samples);
      const z = THREE.MathUtils.lerp(from.z, to.z, i / samples);
      if (this.obstacles.some(obstacle => Math.abs(x - obstacle.x) < obstacle.width / 2
        && Math.abs(z - obstacle.z) < obstacle.depth / 2)) return false;
    }
    return true;
  }

  private hurtEnemy(enemy: Fighter, damage: number, knockback: number, airborne: boolean): void {
    enemy.health = Math.max(0, enemy.health - damage);
    enemy.hurt = enemy.boss ? 0.19 : 0.36;
    enemy.attack = null;
    if (enemy.telegraph) { enemy.root.remove(enemy.telegraph); enemy.telegraph = null; enemy.special = 3; }
    enemy.charging = 0;
    const direction = new THREE.Vector3().subVectors(enemy.root.position, this.player.root.position);
    direction.y = 0;
    direction.normalize();
    enemy.velocity.addScaledVector(direction, knockback / (enemy.boss ? 2 : 1));
    this.splatter(enemy.root.position, 5, false, airborne ? 1.6 : 1.2);
    if (enemy.health <= 0) {
      enemy.dead = 0.001;
      enemy.healthBar.visible = false;
      this.state.kills++;
      this.state.score += enemy.boss ? 600 + this.state.wave * 40 : 100 + this.state.wave * 10;
      if (enemy.boss) this.state.boss = "";
      this.splatter(enemy.root.position, 7, false, 0.9);
    }
  }

  private updateEnemy(enemy: Fighter, dt: number): void {
    enemy.hurt = Math.max(0, enemy.hurt - dt);
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    const dx = this.player.root.position.x - enemy.root.position.x;
    const dz = this.player.root.position.z - enemy.root.position.z;
    const distance = Math.hypot(dx, dz);
    const toward = new THREE.Vector3(dx, 0, dz).normalize();
    enemy.facing = Math.atan2(dx, dz);
    if (enemy.hurt > 0) {
      enemy.velocity.multiplyScalar(Math.exp(-dt * 7));
      this.moveFighter(enemy, dt);
      return;
    }
    if (enemy.boss && this.updateBoss(enemy, dt, distance, toward)) return;
    if (enemy.attack) {
      enemy.velocity.multiplyScalar(Math.exp(-dt * 13));
      enemy.attack.elapsed += dt;
      if (!enemy.attack.hit && enemy.attack.elapsed > enemy.attack.duration * 0.57) {
        enemy.attack.hit = true;
        if (distance < (enemy.boss ? 2.1 : 1.48) && this.clearLine(enemy.root.position, this.player.root.position))
          this.hurtPlayer(enemy, enemy.damage, false);
      }
      if (enemy.attack.elapsed >= enemy.attack.duration) {
        enemy.attack = null;
        enemy.cooldown = enemy.boss ? 0.8 : 0.9 + Math.random() * 0.65;
      }
    } else if (distance < (enemy.boss ? 1.8 : 1.25) && enemy.cooldown <= 0
      && this.clearLine(enemy.root.position, this.player.root.position)) {
      enemy.attack = { kind: enemy.boss || Math.random() < 0.22 ? "kick" : "punch", step: 0,
        elapsed: 0, duration: enemy.boss ? 0.85 : 0.7, hit: false, airborne: false, strength: 1 };
    } else {
      // A short polar search steers around table corners instead of sticking to them.
      const desired = distance > 1.08 ? enemy.speed : 0;
      let steering = toward.clone();
      let best = -Infinity;
      const angles = [0, 0.55, -0.55, 1.1, -1.1, 1.65, -1.65, 2.2, -2.2];
      for (const angle of angles) {
        const candidate = toward.clone().applyAxisAngle(UP, angle);
        const probe = enemy.root.position.clone().addScaledVector(candidate, 0.85);
        if (!this.isClear(probe.x, probe.z, enemy.radius + 0.06)) continue;
        let score = candidate.dot(toward) * 2;
        for (const other of this.enemies) {
          if (other !== enemy && other.health > 0 && probe.distanceToSquared(other.root.position) < 1) score -= 0.65;
        }
        if (score > best) { best = score; steering = candidate; }
      }
      enemy.velocity.lerp(steering.multiplyScalar(desired), 1 - Math.exp(-dt * 6));
    }
    this.moveFighter(enemy, dt);
  }

  private updateBoss(enemy: Fighter, dt: number, distance: number, toward: THREE.Vector3): boolean {
    if (enemy.charging > 0) {
      enemy.charging -= dt;
      enemy.velocity.copy(enemy.chargeDirection).multiplyScalar(10);
      this.moveFighter(enemy, dt);
      if (distance < 1.65 && this.clearLine(enemy.root.position, this.player.root.position)) {
        this.hurtPlayer(enemy, enemy.damage * 1.5, true);
        enemy.charging = 0;
      }
      for (let i = this.chairs.length - 1; i >= 0; i--) {
        if (Math.hypot(enemy.root.position.x - this.chairs[i].x, enemy.root.position.z - this.chairs[i].z) < 1.3)
          this.breakChair(i);
      }
      return true;
    }
    enemy.special -= dt;
    if (enemy.special > 0 || enemy.attack) return false;
    if (!enemy.telegraph) {
      enemy.telegraph = this.mesh(enemy.root, "ring", 0xff5535, 0, 0.07, 0, 2.85, 2.85, 2.85, 0, 1.8);
      enemy.telegraph.rotation.x = Math.PI / 2;
      enemy.chargeDirection.copy(toward);
    }
    enemy.velocity.multiplyScalar(Math.exp(-dt * 12));
    enemy.telegraph.scale.setScalar(2.85 + Math.sin(this.time * 19) * 0.12);
    if (enemy.special < -1.05) {
      enemy.root.remove(enemy.telegraph);
      enemy.telegraph = null;
      enemy.special = 4.5;
      if (enemy.boss % 3 === 2 && distance > 2.2) {
        enemy.charging = 0.7;
      } else {
        // The stomp can be jumped; the sweeping chain must be escaped.
        const stomp = enemy.boss % 3 !== 2;
        if (distance < 3.15 && this.clearLine(enemy.root.position, this.player.root.position)
          && (!stomp || this.player.jump < 0.55)) this.hurtPlayer(enemy, enemy.damage * 1.3, !stomp);
        this.shake = 0.22;
        this.splatter(enemy.root.position, 10, true, 0.2);
        enemy.attack = { kind: "kick", step: 3, elapsed: 0.35, duration: 0.6, hit: true, airborne: false, strength: 1 };
        for (let i = this.chairs.length - 1; i >= 0; i--)
          if (Math.hypot(this.chairs[i].x - enemy.root.position.x, this.chairs[i].z - enemy.root.position.z) < 3.2) this.breakChair(i);
      }
    }
    return true;
  }

  private hurtPlayer(enemy: Fighter, damage: number, high: boolean): void {
    if (this.invulnerable > 0 || this.player.health <= 0 || (!high && this.player.jump > 0.62)) return;
    this.player.health = Math.max(0, this.player.health - damage * (this.state.stamina < 15 ? 1.5 : 1));
    this.player.hurt = 0.3;
    this.invulnerable = 0.48;
    this.shake = 0.17;
    const direction = new THREE.Vector3().subVectors(this.player.root.position, enemy.root.position);
    direction.y = 0;
    this.player.velocity.addScaledVector(direction.normalize(), 5);
    this.moveFighter(this.player, 0.045);
    this.splatter(this.player.root.position, 5, false, 1.3);
  }

  private moveFighter(fighter: Fighter, dt: number): void {
    fighter.root.position.x += fighter.velocity.x * dt;
    fighter.root.position.z += fighter.velocity.z * dt;
    this.resolveWorld(fighter);
  }

  private resolveWorld(fighter: Fighter): void {
    const position = fighter.root.position;
    const radius = fighter.radius;
    position.x = THREE.MathUtils.clamp(position.x, -11.2 + radius, 11.2 - radius);
    position.z = THREE.MathUtils.clamp(position.z, -8.1 + radius, 8.2 - radius);
    for (let pass = 0; pass < 2; pass++) {
      for (const obstacle of [...this.obstacles, ...this.chairs]) {
        const minX = obstacle.x - obstacle.width / 2, maxX = obstacle.x + obstacle.width / 2;
        const minZ = obstacle.z - obstacle.depth / 2, maxZ = obstacle.z + obstacle.depth / 2;
        const closestX = THREE.MathUtils.clamp(position.x, minX, maxX);
        const closestZ = THREE.MathUtils.clamp(position.z, minZ, maxZ);
        const dx = position.x - closestX, dz = position.z - closestZ;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.00001 && distance < radius) {
          position.x += dx / distance * (radius - distance);
          position.z += dz / distance * (radius - distance);
        } else if (distance <= 0.00001) {
          const edges = [Math.abs(position.x - minX), Math.abs(maxX - position.x),
            Math.abs(position.z - minZ), Math.abs(maxZ - position.z)];
          const edge = edges.indexOf(Math.min(...edges));
          if (edge === 0) position.x = minX - radius;
          if (edge === 1) position.x = maxX + radius;
          if (edge === 2) position.z = minZ - radius;
          if (edge === 3) position.z = maxZ + radius;
        }
      }
    }
  }

  private separateFighters(): void {
    const fighters = [this.player, ...this.enemies.filter(enemy => enemy.health > 0)];
    for (let i = 0; i < fighters.length; i++) for (let j = i + 1; j < fighters.length; j++) {
      const a = fighters[i], b = fighters[j];
      const dx = b.root.position.x - a.root.position.x, dz = b.root.position.z - a.root.position.z;
      const distance = Math.hypot(dx, dz);
      const minimum = a.radius + b.radius;
      if (distance < minimum) {
        const directionX = distance > 0.001 ? dx / distance : 1;
        const directionZ = distance > 0.001 ? dz / distance : 0;
        const overlap = (minimum - distance) * 0.5;
        a.root.position.x -= directionX * overlap;
        a.root.position.z -= directionZ * overlap;
        b.root.position.x += directionX * overlap;
        b.root.position.z += directionZ * overlap;
        this.resolveWorld(a);
        this.resolveWorld(b);
      }
    }
  }

  private animateFighter(fighter: Fighter, dt: number): void {
    if (fighter.health <= 0) {
      fighter.body.rotation.z = THREE.MathUtils.lerp(fighter.body.rotation.z, -Math.PI / 2, Math.min(1, dt * 8));
      fighter.body.position.y = Math.max(-0.6, -Math.max(0, fighter.dead - 1.2) * 0.7);
      fighter.leftArm.rotation.x = -0.8;
      fighter.rightArm.rotation.x = 0.7;
      fighter.healthBar.visible = false;
      return;
    }
    const speed = Math.hypot(fighter.velocity.x, fighter.velocity.z);
    fighter.phase += dt * (speed > 0.2 ? speed * 3.2 : 1.6);
    const stride = Math.min(speed / 4, 1);
    const walk = Math.sin(fighter.phase) * stride;
    fighter.leftLeg.rotation.set(walk * 0.65, 0, -0.035);
    fighter.rightLeg.rotation.set(-walk * 0.65, 0, 0.035);
    fighter.leftArm.rotation.set(-0.22 - walk * 0.4, 0, -0.1);
    fighter.rightArm.rotation.set(-0.22 + walk * 0.4, 0, 0.1);
    fighter.body.position.y = Math.abs(Math.sin(fighter.phase)) * stride * 0.065 + Math.sin(this.time * 2.4 + fighter.phase) * 0.012;
    fighter.body.rotation.set(0, 0, 0);
    fighter.head.rotation.set(0, 0, 0);
    if (fighter.jump > 0) {
      fighter.leftLeg.rotation.x = -0.45;
      fighter.rightLeg.rotation.x = 0.5;
      fighter.leftArm.rotation.z = -0.4;
      fighter.rightArm.rotation.z = 0.4;
    }
    const attack = fighter.attack;
    if (attack) {
      const progress = Math.min(1, attack.elapsed / attack.duration);
      const swing = Math.sin(progress * Math.PI);
      const strike = Math.sin(Math.min(1, progress / 0.52) * Math.PI);
      if (attack.kind === "punch") {
        const arm = attack.step % 2 === 0 ? fighter.leftArm : fighter.rightArm;
        arm.rotation.x = -strike * 1.9 - 0.25;
        arm.rotation.z = (arm === fighter.leftArm ? -1 : 1) * swing * 0.25;
        fighter.body.rotation.y = Math.sin(progress * Math.PI * 2) * (attack.step === 3 ? 0.8 : 0.32);
        fighter.body.rotation.x = -swing * 0.12;
        fighter.head.rotation.y = -fighter.body.rotation.y * 0.4;
      } else {
        const leg = attack.step === 2 ? fighter.leftLeg : fighter.rightLeg;
        leg.rotation.x = -swing * (attack.airborne ? 2.0 : 1.6);
        leg.rotation.z = attack.step === 3 ? -swing * 0.5 : 0;
        fighter.body.rotation.x = swing * 0.23;
        fighter.leftArm.rotation.x = -0.7;
        fighter.rightArm.rotation.z = 0.5;
        if (attack.step === 3) fighter.body.rotation.y = progress * Math.PI * 2;
      }
    }
    if (fighter.hurt > 0) {
      fighter.body.rotation.x = -Math.sin(fighter.hurt * 15) * 0.22;
      fighter.head.rotation.x = -0.2;
    }
    if (fighter.telegraph) {
      fighter.leftArm.rotation.x = -1.8;
      fighter.rightArm.rotation.x = -1.8;
      fighter.body.position.y -= 0.12;
    }
    const angleDelta = Math.atan2(Math.sin(fighter.facing - fighter.root.rotation.y), Math.cos(fighter.facing - fighter.root.rotation.y));
    fighter.root.rotation.y += angleDelta * Math.min(1, dt * 20);
    fighter.healthBar.quaternion.copy(this.camera.quaternion);
    fighter.healthBar.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, -fighter.root.rotation.y));
    const ratio = Math.max(0, fighter.health / fighter.maxHealth);
    fighter.healthFill.scale.x = 0.79 * ratio;
    fighter.healthFill.position.x = -0.395 * (1 - ratio);
  }

  private breakChair(index: number): void {
    const chair = this.chairs[index];
    if (chair.root) this.chairGroup.remove(chair.root);
    const origin = new THREE.Vector3(chair.x, 0.5, chair.z);
    this.splatter(origin, 9, true, 0.2);
    this.chairs.splice(index, 1);
  }

  private splatter(position: THREE.Vector3, count: number, wood: boolean, height: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 150) {
        const oldest = this.particles.shift()!;
        this.dynamic.remove(oldest.mesh);
      }
      const size = wood ? 0.08 + Math.random() * 0.07 : 0.045 + Math.random() * 0.04;
      const mesh = this.box(this.dynamic, wood ? (i % 2 ? 0x93613c : 0x533823) : 0x8c242c,
        position.x, position.y + height, position.z, size, wood ? size * 4 : size, size);
      mesh.castShadow = wood;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * (wood ? 3.2 : 1.5);
      const life = wood ? 6 + Math.random() * 3 : 0.6 + Math.random() * 0.6;
      this.particles.push({
        mesh, velocity: new THREE.Vector3(Math.cos(angle) * speed, 2 + Math.random() * 3, Math.sin(angle) * speed),
        life, maxLife: life, floor: size * 0.6 + 0.04, spin: Math.random() * 8 - 4,
      });
    }
    if (!wood && this.floorMarks.children.length < 55) {
      const mark = this.mesh(this.floorMarks, "cylinder", 0x51272a, position.x + (Math.random() - 0.5) * 0.4,
        0.043, position.z, 0.08 + Math.random() * 0.1, 0.004, 0.07 + Math.random() * 0.1);
      mark.castShadow = false;
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        this.dynamic.remove(particle.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      if (particle.mesh.position.y > particle.floor || particle.velocity.y > 0) {
        particle.velocity.y -= dt * 12;
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        particle.mesh.rotation.x += particle.spin * dt;
        particle.mesh.rotation.z += particle.spin * dt * 0.7;
        if (particle.mesh.position.y < particle.floor) {
          particle.mesh.position.y = particle.floor;
          particle.velocity.set(0, 0, 0);
          particle.mesh.rotation.x = Math.PI / 2;
        }
      }
      if (particle.life < 0.5) particle.mesh.scale.multiplyScalar(Math.exp(-dt * 6));
    }
  }
}
