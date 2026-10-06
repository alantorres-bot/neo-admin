# Visual do Neo Admin (estilo ERP Consistem)

Mesmo visual do Vigilância Fiscal (`neo-fiscal-navigator`), aplicado em 06/10/2026.

- **Moldura** (`components/plataforma/casca.tsx`): trilho escuro de ícones (68 px, fixo, serve também no celular), barra vermelha no topo com a "aba" da tela atual, trilha de navegação (`… Área › Módulo`) com o último item em vermelho.
- **Cores** (tokens em `app/globals.css`): `marca` (vermelho #d63e3d), `trilho`, `botao` (cinza), `grade`/`grade-clara`, `cabecalho`, `elo` (azul de link), `texto`. Os tokens do shadcn apontam para eles: `primary` = botão cinza, `destructive` = vermelho da marca, `border` = grade.
- **Tipografia:** Roboto (corpo, 13 px) e Roboto Condensed (títulos de tela e botões, em negrito).
- **Componentes** (`components/ui`): cantos de 3 px; botão cinza-escuro com texto condensado (primário), cinza-claro com borda (secundário/contorno) e vermelho (destrutivo); cartão com borda fina e cabeçalho cinza; tabela com cabeçalho cinza e linhas finas; abas com sublinhado vermelho.
- **Tela de login:** cabeçalho vermelho com o nome do sistema.
