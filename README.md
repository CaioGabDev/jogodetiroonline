# Arena FPS Online

Jogo de tiro em primeira pessoa multiplayer (até 10 jogadores) que roda direto no navegador.
Feito com **Vite + TypeScript + Three.js**, multiplayer **P2P via WebRTC (PeerJS)** e sem nenhum asset externo:
geometria feita em código, texturas geradas em canvas e sons sintetizados com a Web Audio API.

Funciona como site estático (Vercel, Netlify, GitHub Pages…): não existe servidor de jogo.
Quem cria a sala vira o **host** e roda a simulação oficial no próprio navegador.

---

## Como jogar

1. Abra o site, digite seu **nickname** e clique em **Criar Sala**.
2. Clique em **Copiar link** no lobby e mande para seus amigos (ou passe o código de 6 letras).
3. Os amigos abrem o link (`?sala=CODIGO`) ou digitam o código e clicam em **Entrar na Sala**.
4. O host escolhe o modo, limite de kills, tempo e fogo amigo e clica em **Iniciar partida**.
5. Clique na tela para capturar o mouse. `Esc` abre o menu de pausa (o jogo continua rodando).

**Treino Offline** abre o mapa sozinho com alvos (parado, móvel, agachado e na plataforma) para testar armas e configurações.

### Controles padrão (todos podem ser alterados em Configurações → Controles)

| Ação | Tecla |
| --- | --- |
| Mover | W A S D |
| Pular | Espaço |
| Correr | Shift |
| Agachar | C ou Ctrl (segurar ou alternar) |
| Atirar | Botão esquerdo |
| Mirar / luneta | Botão direito (segurar ou alternar) |
| Recarregar | R |
| Trocar arma | 1 – 4 ou roda do mouse |
| Placar | Tab (segurar) |
| Chat (todos) / chat do time | Enter / Y |
| Pausa | Esc |

> Dica: no navegador, **Ctrl+W fecha a aba**. Se costuma agachar com Ctrl, prefira o `C`.

### Armas

| # | Arma | Dano | Cadência | Pente | Observações |
| --- | --- | --- | --- | --- | --- |
| 1 | Rifle automático | 20 | 600 RPM | 30 | recoil com padrão fixo |
| 2 | Pistola | 25 | semi-auto | 12 | reserva infinita |
| 3 | Escopeta | 8 × 12 | semi-auto | 6 | dano cai com a distância |
| 4 | Sniper | 90 | semi-auto | 5 | luneta com zoom; headshot mata |

Headshot causa dano dobrado em todas as armas. Kits de vida (+50) e caixas de munição reaparecem 20 s após serem pegos.

### Modos

- **Mata-mata (FFA):** todos contra todos. Vence quem atingir o limite de kills ou tiver mais kills no fim do tempo.
- **Mata-mata em equipe (TDM):** Vermelho × Azul, escolha de time no lobby, auto-balanceamento e fogo amigo configurável.

No fim da partida aparece o placar com MVP; o host pode pedir **Revanche** ou **Voltar ao lobby**.

---

## Rodando localmente

Requer Node.js 20.19+ (ou 22.12+).

```bash
npm install
npm run dev        # http://localhost:5173 (também acessível na rede local)
```

Para testar o multiplayer na mesma máquina, abra duas abas (ou uma aba anônima): crie a sala numa e entre pelo código na outra.

```bash
npm run build      # checagem de tipos + build de produção em dist/
npm run preview    # serve o build de dist/
```

---

## Deploy na Vercel

O projeto já vem com `vercel.json` (build `npm run build`, saída `dist/`, rewrite de SPA para `index.html`).

**Pelo painel:**
1. Suba o projeto para um repositório no GitHub/GitLab/Bitbucket.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório.
3. A Vercel detecta Vite automaticamente; não precisa mudar nada. Clique em **Deploy**.

**Pela CLI:**
```bash
npm i -g vercel
vercel          # primeiro deploy (preview)
vercel --prod   # produção
```

Não há variáveis de ambiente nem backend: o site é 100% estático.

---

## Rede: como funciona

- **Sinalização:** o PeerJS usa o servidor público gratuito `0.peerjs.com` só para os navegadores se encontrarem.
  O ID do host no PeerJS é `arenafps-v1-` + código da sala (o prefixo evita colisão com outros apps no servidor público).
  Depois disso, os dados do jogo vão direto entre os navegadores (WebRTC DataChannel).
- **Host autoritativo:** o host decide vida, dano, kills, placar, respawn, pickups e timer. Ele fica com uma conexão
  em memória (loopback) para o próprio jogador, então joga com latência zero.
- **Taxas:** clientes enviam posição/inputs a 30 Hz; o host envia snapshots a 20 Hz.
- **Suavidade:** cada jogador prediz o próprio movimento localmente; os outros são interpolados com buffer de ~100 ms.
- **Tiros hitscan com lag compensation:** o cliente envia origem, direção(ões) e o instante (no relógio do host) que
  estava vendo; o host rebobina as posições (histórico de 1 s, limitado pelo RTT do atirador) e faz o raycast contra
  as hitboxes de cabeça e corpo.
- **Anti-trapaça básico:** orçamento de velocidade de movimento, posição dentro de paredes, cadência de tiro
  (token bucket), munição, recarga e distância da origem do tiro. Movimentos inválidos são corrigidos pelo host.
- **Desconexões:** quem sai é removido e todos recebem aviso. Se o host sair, os clientes voltam ao menu com
  "Host saiu da partida". O host continua simulando mesmo com a aba em segundo plano (timer em Web Worker).

### Amigos não conseguem conectar? Adicione um servidor TURN

Só com STUN (padrão: `stun.l.google.com:19302`) a conexão funciona na maioria das redes domésticas, mas pode falhar
em NAT simétrico, redes corporativas/escolares ou 4G. Edite **`src/net/iceConfig.ts`** e adicione um TURN, por exemplo:

```ts
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: ['turn:seu-turn.exemplo.com:3478', 'turns:seu-turn.exemplo.com:5349'],
    username: 'usuario',
    credential: 'senha',
  },
];
```

Serviços com plano gratuito: Metered (Open Relay), Twilio Network Traversal, Cloudflare Calls TURN,
ou hospede o seu com `coturn`. No mesmo arquivo dá para apontar `PEER_SERVER` para um servidor PeerJS próprio.

Para depurar a conexão, rode no console do navegador `localStorage.setItem('arenafps.peerdebug', '1')` e recarregue:
o PeerJS passa a registrar tudo no console.

---

## Configurações

Ficam salvas no `localStorage` e são aplicadas na hora:

- **Controles:** sensibilidade (0,1–10, slider + campo numérico), sensibilidade de mira (escalada pelo zoom),
  inverter Y, remapear todas as teclas (2 por ação, inclusive botões do mouse), segurar/alternar para mirar e agachar.
- **Vídeo:** FOV (70–110), qualidade baixa/média/alta (sombras, pixel ratio, antialias), sombras liga/desliga,
  limite de FPS e escala de resolução.
- **Áudio:** volume geral, efeitos e interface.
- **Mira:** cruz, ponto ou círculo; cor, tamanho, espessura, gap, contorno e ponto central, com pré-visualização.
- **HUD:** mostrar FPS, mostrar ping e tamanho do killfeed.
- Botão **Restaurar padrão**.

---

## Estrutura do código

```
src/
  main.ts            orquestra telas, conexão e o loop
  style.css
  core/              loop (60 Hz fixo + render interpolado), input, settings, audio, utilidades
  render/            cena/renderer, mapa, texturas procedurais, modelos, arma em 1ª pessoa, efeitos
  game/              constantes, dados do mapa, física (AABB + rampas), armas, hitboxes, jogador remoto, partida (cliente)
  net/               protocol.ts (mensagens tipadas), peer (PeerJS + loopback), host (simulação autoritativa), client, iceConfig
  ui/                menu, lobby, HUD, placar, chat, configurações, pausa, resultados, toasts
```

Todo texto vindo de jogadores (nicks com até 16 caracteres e chat com até 120) é sanitizado e exibido via
`textContent`, nunca `innerHTML`.
