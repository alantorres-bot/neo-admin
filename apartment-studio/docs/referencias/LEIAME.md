# Fotos de referência do Alan

Cópias reduzidas (até 1000 px) das 13 fotos que o Alan enviou em 13/11/2026, para que as próximas conversas
consigam vê-las — os anexos de uma conversa não ficam acessíveis nas outras. Nos prints de rede social
ficou só a imagem: a interface do aplicativo, nomes de contas e de pessoas e o letreiro do empreendimento
foram recortados. Não entram no aplicativo nem na página publicada (ficam só aqui, em `docs/`).

| Arquivo | O que mostra | Item no modelo | O que foi tirado da foto |
|---|---|---|---|
| `rack-medidas.jpg` | Desenho do fabricante com cotas | `sala-rack` (`rack-ripado`) | Tampo 175, corpo 170, profundidade 38, altura 50,2 (pés 15 + corpo 33 + tampo), nicho de 55 com 2 vãos de ≈15 |
| `rack-frente.jpg` | Rack de frente | `sala-rack` | Marrom médio (`#6d5a46`), 8 ripas horizontais por porta, moldura fina, 2 pés palito inclinados em cada ponta e 2 retos sob o nicho |
| `cadeira.jpg` | Cadeira (com mesa ao fundo) | `jan-cadeira-1..4` (`cadeira-palhinha`) | Madeira natural/mel, encosto retangular de palhinha em quadro de madeira, inclinado; assento cinza-claro sobre bandeja; sem braços. **Sem cotas** |
| `geladeira.jpg` | LG inox, freezer embaixo | `coz-geladeira` | Divisão a ≈38% da altura, visor vertical na porta de cima, sem puxador aparente |
| `lava-loucas.jpg` | Electrolux 8 serviços | `coz-lavaloucas` | Porta inox, painel preto em cima com puxador embutido |
| `micro-ondas.jpg` | Midea | `coz-microondas` | Corpo branco, porta preta, puxador vertical prata, teclado preto à direita |
| `lava-e-seca.jpg` | Midea grafite, abertura frontal | `coz-lava-e-seca` | Porta redonda grande, visor em cima no centro, gaveta à esquerda, tampa redonda do filtro embaixo à direita |
| `cozinha-referencia-1.jpg` | Cozinha planejada de referência (inteira) | grupo `cozinha` | Armários de baixo verde sálvia com puxador cava; bancada branca; frontão claro salpicado; aéreo de baixo em madeira com nicho aberto do micro-ondas; faixa verde-escura; aéreo de cima off-white até o teto, passando por cima da geladeira (sem painel lateral); pedra em L sob a janela; fitas de LED embutidas no teto |
| `cozinha-referencia-2.jpg` | A mesma cozinha, mais de perto | grupo `cozinha` | Detalhe do cava (rebaixo escuro no topo de cada frente), gaveteiro de 4 gavetas, cooktop sobre forno preto, cuba inox |
| `decorado-cozinha.jpg` | Cozinha do apartamento decorado do prédio | planta (cozinha/serviço) | Geladeira perto da entrada, pia, fogão, máquina e tanque no fundo, janela na parede do fundo, península de granito; piso claro em placas grandes |
| `decorado-banheiro.jpg` | Banheiro do decorado | `ban-*` | Box de vidro com perfil branco; vaso com caixa acoplada entre o box e a pia; gabinete branco com puxadores pretos redondos; granito cinza salpicado com cuba oval; **armário de espelho de várias portas cobrindo o vaso e a pia**, com LED quente embaixo; plafon quadrado |
| `decorado-area-de-servico.jpg` | Canto do tanque no decorado | planta (`j-servico`, `p-shaft`) e `coz-tanque` | Tanque no canto, torneira na parede ao lado da janela; janela à direita, com peitoril ≈25–30 cm acima do tanque; painel ripado entre o fogão e a máquina |

Ainda **sem foto nesta conversa** (descrições vieram só do texto da outra conversa): sofá, luminária de piso,
cortina, quadro, prateleira, remos, guarda-roupa (estilo e modelo) e a mesa.

Para conferir o modelo contra as fotos: `npm run build && node tests/e2e/capturar-detalhes.mjs` gera fotos de
perto dos mesmos itens em `tests/e2e/capturas/detalhes/`.
