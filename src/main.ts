import { GameScene, type GameSnapshot } from "./scenes/GameScene";
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `
  <header class="masthead">
    <a class="wordmark" href="./" aria-label="Bar Fight — início">BF<span>★</span></a>
    <span class="edition">JACK'S LAST CALL <i>/</i> UM JOGO DE SOBREVIVÊNCIA</span>
    <button id="pause" class="quiet" disabled>Ⅱ PAUSAR <kbd>ESC</kbd></button>
  </header>
  <main>
    <section class="game-shell" aria-label="Bar Fight, arena 3D">
      <div id="arena"></div>
      <div class="vignette"></div>
      <div class="hud" id="hud" hidden>
        <div class="vitals">
          <div class="identity"><span class="avatar">J</span><div><strong>JACK</strong><small>O ÚLTIMO A CAIR.</small></div></div>
          <div class="meter-label"><span>VIDA</span><b id="health-value">100</b></div>
          <div class="meter health" role="progressbar" aria-label="Vida" aria-valuemin="0" aria-valuemax="100"><div id="health-bar"></div></div>
          <div class="meter-label"><span>STAMINA</span><b id="stamina-value">100</b></div>
          <div class="meter stamina" role="progressbar" aria-label="Stamina" aria-valuemin="0" aria-valuemax="100"><div id="stamina-bar"></div></div>
          <small id="exhausted" class="exhausted" hidden>EXAUSTO · VOCÊ RECEBE MAIS DANO</small>
        </div>
        <div class="scoreboard"><small>PONTUAÇÃO</small><strong id="score">000000</strong><span><b id="kills">0</b> NO CHÃO <i>/</i> ONDA <b id="wave">1</b></span></div>
      </div>
      <div id="boss" class="boss" hidden></div>
      <div id="combo" class="combo"></div>
      <div class="location"><span class="live-dot"></span> THE RUSTY NAIL <span>EST. 1987</span></div>
      <div id="overlay" class="overlay">
        <div class="menu">
          <div class="eyebrow"><span></span> NINGUÉM SAI INTEIRO.</div>
          <h1>BAR<br><span>FIGHT</span><sup>★</sup></h1>
          <p class="tagline">Uma noite ruim. Um bar pior.<br>E Jack não veio fazer amigos.</p>
          <button id="start" class="primary">ENTRAR NA BRIGA <span>↗</span></button>
          <p class="menu-note">3D · SOBREVIVÊNCIA SEM FIM · SEM DESCULPAS</p>
        </div>
        <div class="menu-side"><span>01 / A ÚLTIMA RODADA</span><p>JAQUETA DE COURO.<br>LENÇO VERMELHO.<br><b>PUNHOS FECHADOS.</b></p></div>
      </div>
      <div id="result" class="overlay result" hidden>
        <div class="result-card">
          <div class="eyebrow" id="result-eyebrow">FIM DA NOITE</div>
          <h2 id="result-title">JACK CAIU.</h2>
          <p id="result-copy"></p>
          <button id="restart" class="primary">MAIS UMA RODADA <span>↗</span></button>
        </div>
      </div>
      <div id="error" class="error" role="alert" hidden></div>
    </section>
    <section class="control-strip" aria-label="Controles">
      <div class="controls-title"><span>COMO SOBREVIVER</span><small>APRENDA RÁPIDO.</small></div>
      <div class="control"><div class="key-cluster"><kbd>W</kbd><span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div><span>MOVER<small>PELO BAR</small></span></div>
      <div class="control"><kbd>H</kbd><span>SOCAR<small>JAB → JAB → DIRETO → CRUZADO</small></span></div>
      <div class="control"><kbd>J</kbd><span>CHUTAR<small>CHUTE ×2 → OUTRA PERNA → GIRO</small></span></div>
      <div class="control"><kbd>K</kbd><span>PULAR<small>VALE BATER NO AR</small></span></div>
    </section>
    <footer><span>QUANTO MAIS FÔLEGO, MAIS ESTRAGO.</span><span>RECUPERE A STAMINA ENTRE OS GOLPES. <b>NÃO DÊ MOLE.</b></span></footer>
  </main>`;

const el = (id: string) => document.getElementById(id)!;
const pauseButton = el("pause") as HTMLButtonElement;
let game: GameScene;
let lastState: GameSnapshot | undefined;
let resultMode = "";

function update(state: GameSnapshot) {
  lastState = state;
  el("health-value").textContent = String(Math.ceil(state.health));
  el("stamina-value").textContent = String(Math.floor(state.stamina));
  for (const [name, value] of [["health", state.health], ["stamina", state.stamina]] as const) {
    el(`${name}-bar`).style.width = `${Math.max(0, Math.min(100, value))}%`;
    el(`${name}-bar`).parentElement!.setAttribute("aria-valuenow", String(Math.round(value)));
  }
  el("exhausted").hidden = state.stamina >= 20;
  el("score").textContent = String(state.score).padStart(6, "0");
  el("kills").textContent = String(state.kills);
  el("wave").textContent = String(state.wave);
  el("combo").textContent = state.combo;
  el("boss").hidden = !state.boss || !state.running;
  el("boss").textContent = `⚠ ${state.boss}`;
  pauseButton.disabled = !state.running || state.gameOver;
  pauseButton.innerHTML = state.paused ? "▶ CONTINUAR <kbd>ESC</kbd>" : "Ⅱ PAUSAR <kbd>ESC</kbd>";
  const mode = state.gameOver ? "over" : state.paused ? "pause" : "";
  el("result").hidden = !mode;
  if (mode && mode !== resultMode) {
    el("result-eyebrow").textContent = state.gameOver ? "FIM DA NOITE" : "RESPIRE UM POUCO";
    el("result-title").textContent = state.gameOver ? "JACK CAIU." : "ÚLTIMA RODADA?";
    el("result-copy").textContent = state.gameOver
      ? `${state.kills} no chão. ${state.score} pontos. Você chegou à onda ${state.wave}.`
      : "A briga espera. Seu fôlego também.";
    el("restart").innerHTML = state.gameOver ? "MAIS UMA RODADA <span>↗</span>" : "VOLTAR À BRIGA <span>↗</span>";
    el("restart").focus();
  }
  resultMode = mode;
}

function start() {
  el("overlay").hidden = true;
  el("hud").hidden = false;
  game.start();
  (document.activeElement as HTMLElement | null)?.blur();
}

try {
  game = new GameScene(el("arena"), update);
  el("start").addEventListener("click", start);
  el("restart").addEventListener("click", () => {
    if (lastState?.gameOver) start();
    else game.togglePause();
  });
  pauseButton.addEventListener("click", () => game.togglePause());
  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && !event.repeat && lastState?.running && !lastState.gameOver) game.togglePause();
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) game.dispose();
  });
} catch (error) {
  el("error").hidden = false;
  el("error").textContent = "Não foi possível iniciar o 3D. Ative a aceleração gráfica e recarregue em um navegador desktop atualizado.";
  (el("start") as HTMLButtonElement).disabled = true;
  console.error(error);
}
