# Análise Competitiva Klaans vs PalDrivy — Design Spec

**Data:** 2026-07-27  
**Atualizado:** 2026-07-27 (correções + tutorial onboarding + idiomas FR/ZH)  
**Contexto:** Análise de 42 screenshots do app Klaans (concorrente direto, R$29/mês vs PalDrivy ~R$1/mês). Objetivo: identificar gaps, priorizar features e definir melhorias visuais para dominar o segmento.

---

## 1. Contexto Competitivo

| Dimensão | Klaans | PalDrivy |
|---|---|---|
| Preço | R$29/mês (1 mês trial) | ~R$1/mês |
| Plataformas | Android (Google Play billing) | Android + Web |
| Idiomas | Português | PT / EN / ES → + FR / ZH (próximas) |
| Moedas | Real (BRL) | 55+ moedas |
| Foco | Brasil | Internacional |
| Comunidade social | ✅ Feed de motoristas | ❌ |
| GPS / Jornadas | ✅ Rastreio automático | ✅ (shifts) |
| Metas mensais | ✅ Com progresso circular | ❌ |
| Wizard de lançamento | ✅ 10 etapas guiadas | ❌ (entrada direta) |
| Exportar dados | ✅ CSV / PDF / JSON LGPD | ❌ |
| Login biométrico | ✅ Toggle | ❌ |
| Gestão de cartões | ✅ Crédito + vencimento | ❌ |
| Alimentação (despesa) | ✅ Etapa no wizard | ✅ Já existe em Despesas |
| Feedback in-app | ✅ Bug/Sugestão/Feature | ❌ |
| Avaliação do dia | ✅ Bom/Aceitável/Ruim emoji | ❌ |
| Diário de observações | ✅ 1000 chars/dia | ❌ |
| Comunidade social | ✅ | ❌ |
| Paleta visual | Verde neon puro | Navy #0B1221 + Gold #F59E0B ✅ |

| Tutorial de configuração | ✅ Passo a passo interativo | ❌ (onboarding básico) |
| Cores adaptadas por cultura | ❌ (verde fixo) | 🎯 Oportunidade (ZH: vermelho+ouro) |

**Vantagem defensável do PalDrivy:** preço 30× menor, multi-idioma, multi-moeda, paleta mais premium. Qualquer feature nova que adicionarmos se torna 30× mais barata de usar.

**Mercados adicionais imediatos:** Francês (🇫🇷 França, 🇨🇦 Québec, 🇨🇮 África francófona — ~300M falantes com apps de delivery explodindo) e Chinês (🇨🇳 mainland, 🇹🇼 Taiwan, diáspora — Didi/Meituan drivers, mercado bilionário). Esses dois idiomas sozinhos podem multiplicar o TAM por 5×.

---

## 2. Mapeamento Completo do Klaans

### 2.1 Nova Entrada — Wizard 10 etapas

O maior diferencial de UX do Klaans. Cada etapa ocupa a tela inteira com:
- Barra de progresso verde ("Etapa X de 10 / XX%")
- Ícone emoji grande centralizado
- Título + subtítulo explicativo
- Campo único de entrada
- Botões: `< Anterior` | `→ Pular` | `Pr... >` (Próximo verde)

| Etapa | Campo | Detalhe |
|---|---|---|
| 1 | Data | Date picker — "Escolha a data para os lançamentos" |
| 2 | Uber | Valor Recebido + Número de corridas |
| 3 | 99 | Valor Recebido + Número de corridas |
| 4 | KM | Quilômetros totais do dia (0.0) |
| 5 | Horas | Horas trabalhadas (0:00) |
| 6 | Combustível | Tipo (Etanol/Gasolina/GNV/Diesel) + Valor OU litros |
| 7 | Alimentação | Valor gasto com alimentação no dia |
| 8 | Como foi o dia? | Bom 🤑 / Aceitável 😑 / Ruim 😫 |
| 9 | Observações | Diário livre, 0/1000 chars |
| 10 | Resumo | Data + Lucro Líquido → "Confirmar e lançar" |

**Dica de Jornadas:** Ao abrir a etapa 1, aparece modal: *"Para que os campos KM e Horas sejam preenchidos automaticamente, inicie uma jornada no início do expediente."* Com opções "Sempre exibir" / "Não exibir novamente". Ou seja: **Jornadas integra com o wizard**, auto-preenchendo KM e Horas.

### 2.2 Painel (Dashboard)

```
┌─ Olá, [Nome]  [E avatar]               [🔔] ─┐
│ [Banner e-mail não verificado + Reenviar]      │
│ [Hoje] [Ter] [Qua] [Qui] [Sex] [Sáb] [Dom]    │
│  27     28    29    30    31     1     2        │
├── Hoje ─ Semanal ─ Mensal ─ Personalizado ────┤
│ 📅 27/07/2026                                  │
│ ┌── Meta Mensal ──────────────────────────┐    │
│ │  ⊙ 0%     R$ 0,00 / R$ 0,00            │    │
│ │           📅 Fecha... 4 dias            │    │
│ └──────────────────────────────────────────┘   │
│ ┌ Receita Total ┐  ┌ Despesas Totais ┐         │
│ │ R$ 0,00  100% │  │ R$ 0,00  0.00%  │         │
│ └───────────────┘  └─────────────────┘         │
│ ┌ Lucro Líquido ┐  ┌ Reserva >       ┐         │
│ │ R$ 0,00  0%   │  │ R$ 0,00         │         │
│ └───────────────┘  └─────────────────┘         │
├─ Receita por Plataforma ──────────────────────┤
├─ Despesas por Categoria (Mensal) ─────────────┤
├─ Despesas por Categoria (Avulso) ─────────────┤
├─ Métricas de Performance ─────────────────────┤
├─ Impacto no seu dia a dia ─────────────────────│
│  Custo do Dia ÷ KMs do Dia = Custo por KM      │
│  Média/KM   – Custo/KM   = KM Líquido          │
├─ Histórico de Metas ──────────────────────────┤
└───────────────────────────────────────────────┘
```

- Aba de período (Hoje/Semanal/Mensal/Personalizado) com seletor de data
- Calendar strip semanal com "Hoje" destacado
- Meta Mensal: círculo de progresso (%) + R$ atingido / R$ meta + "Fecha em X dias"
- 4 cards: Receita Total (laranja), Despesas Totais (vermelho), Lucro Líquido (azul/teal), Reserva (verde com `>` navegável)
- FAB lightning bolt verde (atalho para lançamento rápido)

### 2.3 Lançamentos

- Busca: "Buscar transações..."
- **Avaliação dos dias** (mês atual):
  - 🤑 BOM: 0 | 😑 ACEITÁVEL: 0 | 😫 RUIM: 0
  - Botão `∨ Mostrar métricas` — expande métricas agregadas do mês
- Lista de transações (vazia = empty state + CTA)
- Bell de notificações no topo direito

### 2.4 Comunidade (MAIOR DIFERENCIAL)

Feed social de motoristas. Único no segmento.

**Perfil próprio:**
- Nome + cidade/estado
- 0 seguidores / 0 seguindo
- Botões: "Encontrar pessoas" | "Buscar usuários"

**Feed de posts:**
- Post exibe: foto de perfil + nome + badge "Membro" + ícone de flag + cidade/estado/data
- Conteúdo do post: receita por plataforma (logos + valor + %) + despesas por categoria (cards com borda vermelha) + **Métricas de Performance 3×3**:
  - Ganho do dia | Média por Hora | Média por Km
  - Total de Horas | Média de Horas | Total de Km
  - Dias Trabalhados | Entregas ou corridas | Média por Corrida/Entrega
- FAB laranja (megaphone) = "Publicar na comunidade"

### 2.5 Jornadas (GPS)

- "Iniciar Jornada" com GPS dot indicator
- Tracker automático de rota (tempo + km)
- Lista "Jornadas do ciclo 01/07-31/07"
- Ao finalizar jornada, KM + Horas ficam disponíveis para auto-preencher o wizard

### 2.6 Configurações — 3 abas

**Perfil:** Nome, E-mail, CPF, Telefone, Alterar Senha, Vincular conta Google, Excluir conta (30 dias), Sair

**Ajustes:** Idioma, Tema (claro/escuro), Moeda, Login Biométrico toggle, Notificações de Metas toggle, Lembretes de Lançamento toggle, Exportar dados (CSV ou PDF), Baixar meus dados (JSON - LGPD)

**Custos:** Histórico por mês, Cartões (data fechamento + vencimento fatura), 10 categorias expandíveis:
1. Custos Fixos/Financeiro
2. Manutenção
3. Pneus
4. Limpeza e Estética
5. Taxas e Operação
6. Documentação
7. Seguro e Proteção
8. Equipamentos e Acessórios
9. Tecnologia
10. Emergências

### 2.7 Feedback in-app

Tabs: Bug | Sugestão | Nova funcionalidade
- Campo de texto + upload até 5 screenshots
- "Meus envios" com histórico Ativos/Arquivados

### 2.8 Plano / Assinatura

- "Assinatura ativa — Período gratuito até 27/08/2026"
- 1 mês de trial gratuito
- Cobrança via Google Play
- Botão "Gerenciar na Google Play"

### 2.9 Menu Overlay (8 itens grid)

Dashboard | Metas | Custos | Veículos | Jornadas | Plano | Configurações | Feedback

---

## 3. Gaps Prioritizados

### TIER 1 — Deve ter (killer features que nos matam se não tivermos)

#### 3.1 Nova Entrada como Wizard Guiado

**Problema atual:** O PalDrivy tem entrada direta (formulário). O Klaans tem wizard de 10 etapas com progresso visual.

**Por que importa:** O wizard reduz abandono, guia motoristas menos experientes, e torna o app "mais fácil" percebido — mesmo que o PalDrivy tenha mais features.

**Design PalDrivy:**
- Manter 10 etapas mas adaptar ao tema navy+gold
- Etapa 1: Data (igual)
- Etapas 2-N: uma por plataforma configurada (Uber, 99, iFood, Lalamove, etc. — baseado nos "Aplicativos Favoritos" do onboarding)
- Etapa KM: Quilômetros (com opção "Usar da jornada" se jornada ativa)
- Etapa Horas: Horas trabalhadas (com opção "Usar da jornada")
- Etapa Combustível: Tipo + Valor OU Litros + Preço/litro
- Etapa Alimentação: nova — valor gasto com alimentação
- Etapa Como foi o dia?: 🤑 Excelente / 😐 Ok / 😫 Ruim (com cor ouro para Excelente)
- Etapa Observações: diário do dia (1000 chars)
- Etapa Resumo: Receita bruta, Despesas, Lucro líquido — "Confirmar"

**Vantagem PalDrivy sobre Klaans:** steps dinâmicos por plataformas ativadas (o Klaans tem Uber+99 fixos). Se o motorista usa Lalamove+iFood, o wizard se adapta.

#### 3.2 Avaliação do Dia (Mood Tracker) na tela de Lançamentos

- Painel "Avaliação do mês": contador de dias Excelente/Ok/Ruim com emojis
- Expandir mostra métricas do mês (receita média, km médio, etc.)
- Fácil de implementar, alta percepção de valor

#### 3.3 Meta Mensal com Progresso Circular

**Design:**
- Card destacado no Dashboard (gold gradient)
- Círculo de progresso animado com % em ouro
- R$ arrecadado / R$ meta
- "Faltam X dias" no mês
- Badge comemorativo quando meta for batida (🏆)
- Pode ser definida no onboarding (tela goal.tsx já existe!)

#### 3.4 Alimentação como Despesa Diária

- Adicionar "Alimentação" como categoria de despesa avulsa no wizard
- Separar das despesas fixas de veículo (manutenção, combustível)
- Mostrar no dashboard na seção "Despesas por Categoria (Avulso)"

### TIER 2 — Alto valor (diferenciadores fortes)

#### 3.5 Comunidade — Feed Social de Motoristas

**O maior diferencial do Klaans. Se o PalDrivy lançar isso primeiro internacionalmente, domina.**

**MVP do Feed:**
- Perfil público: nome + cidade + plataformas + foto
- "Compartilhar meu dia" — post automático com métricas do último lançamento
- Feed de drivers próximos (estado) ou todos
- Reagir (👍 🔥 💪) + comentar
- Ranking semanal regional (opcional)

**Vantagem PalDrivy:** multi-idioma → feed global (drivers de Argentina, Colômbia, Portugal vendo juntos). Isso o Klaans não tem.

**Monetização futura:** plano premium com analytics avançados + destaque no feed.

#### 3.6 Exportar Dados (CSV / PDF / JSON LGPD)

- CSV: planilha com todas as transações do período
- PDF: relatório formatado mensal (como beedika-api já gera)
- JSON: dump LGPD completo (direito do titular)
- Acessível em Configurações > Ajustes > Exportar

#### 3.7 Login Biométrico

- `expo-local-authentication` já disponível no ecossistema Expo
- Toggle em Configurações
- Biometria substitui a senha na reabertura do app

#### 3.8 Gestão de Cartões de Crédito

- Motoristas pagam combustível e manutenção no crédito
- Cadastrar cartão: nome + data de fechamento + data de vencimento fatura
- Dashboard de Custos mostra gastos por cartão no período
- Alerta quando fatura vence em X dias (push notification)

### TIER 3 — Nice to have

#### 3.9 Feedback In-App

- Tela "Enviar feedback" acessível pelo menu "Mais"
- Tabs: Bug / Sugestão / Feature Request
- Campo de texto + upload de screenshots
- Envia para Resend (já integrado no stack)

#### 3.10 10 Categorias de Custo Estruturadas

PalDrivy já tem categorias. Reorganizar para as 10 do Klaans + adicionar campos de histórico mensal por categoria.

#### 3.11 Seção "Impacto no Dia a Dia" (Equações Visuais)

- Custo do Dia ÷ KMs do Dia = Custo por KM (visual com ícones de ÷ e =)
- Média/KM − Custo/KM = KM Líquido
- Apresentar como cards equação, não tabela

---

## 4. Melhorias Visuais para "Matar" o Klaans

### 4.1 Por que o visual do PalDrivy já ganha

O Klaans usa verde neon (#00E587 estimado) em fundo preto puro. É funcional mas genérico — parece qualquer app de fintech neon. O PalDrivy tem:
- Navy profundo `#0B1221` — transmite sofisticação, não "app barato"
- Gold `#F59E0B` — remete a prêmio, conquista, ouro
- Combinação única no segmento de motoristas

### 4.2 Upgrades Visuais Específicos

#### Dashboard
- **Meta Mensal card:** fundo com gradiente sutil `#F59E0B` → `#D97706` + anel de progresso animado com ouro
- **4 cards de resumo:** usar glassmorphism (fundo `rgba(255,255,255,0.05)` + borda `rgba(255,255,255,0.08)`) em vez de fundo sólido cinza
- **Receita Total:** número em ouro grande + % em texto menor
- **Lucro Líquido:** card com destaque especial (borda ouro fina)
- **Receita por Plataforma:** logos das plataformas com fundo colorido (Uber preto, 99 amarelo, iFood vermelho) + barra horizontal proporcional

#### Wizard de Lançamento
- Progress bar em gradiente ouro → âmbar
- Ícone da etapa: fundo `rgba(245,158,11,0.15)` com borda ouro (não emoji puro como o Klaans)
- Step de mood: 3 cards grandes — ouro (Excelente), cinza (Ok), vermelho (Ruim) — com animação de seleção
- Botão "Confirmar" no Resumo: gradiente ouro, texto navy

#### Comunidade (quando lançar)
- Cards de post com borda ouro fina no topo
- Métricas de performance: fonte tabular, highlight em ouro nos melhores números
- Avatar placeholder: iniciais em fundo navy + borda ouro
- FAB: ouro sólido (não laranja como o Klaans)

#### Geral
- **Typography:** usar peso 700 para números financeiros (legibilidade imediata)
- **Empty states:** ilustração minimalista + CTA em ouro (não apenas texto cinza como o Klaans)
- **Micro-animações:** transição suave entre etapas do wizard (slide horizontal com easing)
- **Ícones das abas:** manter Ionicons mas adicionar badge counter (ex: dias sem lançamento)

### 4.3 Tema Escuro vs Claro

O Klaans tem toggle claro/escuro. PalDrivy também deve ter, mas o **tema escuro é o primário** (navy) — transmite premium. Tema claro: fundo `#F8FAFC`, texto navy, acentos ouro.

---

## 5. Tutorial de Onboarding Interativo (Novo — Klaans tem, PalDrivy não tem)

### 5.1 O que o Klaans faz

Ao primeiro login, o Klaans lança um tutorial passo a passo de configuração que guia o motorista por todo o app antes de usá-lo. Isso elimina o atrito de "não sei por onde começar" que faz usuários novos abandonar.

### 5.2 O que o PalDrivy tem hoje

Onboarding linear: consent → locale → vehicle → platforms → goal → app. Funcional mas sem orientação sobre **como usar** depois que o usuário entra. Não há feature discovery. Usuário cai no dashboard vazio sem entender o que fazer.

### 5.3 Design do Tutorial PalDrivy

**Abordagem: Spotlight Tour** (overlay escurecido + janela iluminada + tooltip) que roda automaticamente no primeiro acesso pós-onboarding. O motorista vê o app real com destaques explicativos — mais autêntico do que telas estáticas de onboarding.

**Sequência (6 passos):**

```
Passo 1 — Boas-vindas
  Tela cheia (não spotlight)
  Ícone PalDrivy animado + "Pronto, [Nome]!"
  "Veja como usar o app em 6 passos rápidos"
  [Começar tour] ou [Pular]

Passo 2 — Dashboard
  Spotlight: card Meta Mensal
  Tooltip: "Aqui você acompanha sua meta mensal em tempo real.
            Atualize sempre que quiser no menu Mais > Metas."

Passo 3 — Lançar o dia
  Spotlight: botão central (+) da tab bar
  Tooltip: "Toque aqui ao final de cada dia de trabalho para
            registrar receitas, combustível e como foi o dia."

Passo 4 — Jornadas
  Spotlight: tab Jornadas (shifts)
  Tooltip: "Ative uma jornada quando sair para trabalhar — ela
            mede km e horas automaticamente para você."

Passo 5 — Despesas do veículo
  Spotlight: tab Despesas
  Tooltip: "Registre manutenção, pneus e outros custos fixos.
            O app calcula seu lucro real descontando tudo."

Passo 6 — Pronto!
  Tela cheia
  "Você está pronto para controlar suas finanças!"
  "Dica: use o botão + todo dia, mesmo que seja rápido."
  [Ir para o Dashboard]
```

**Implementação:**
- `app/tutorial/` — componente `SpotlightTour` com `Portal` + overlay
- Controle via AsyncStorage `tutorial_completed` (não Supabase — funciona offline)
- Pode ser reaberto em Configurações > Ajuda > "Ver tutorial novamente"
- Suporte a todos os idiomas via i18n (incluindo FR e ZH)

**Cores do spotlight por locale:**
- PT/EN/ES: overlay navy com destaque ouro
- ZH: overlay vermelho escuro `#1A0505` com destaque ouro `#FFD700` (ouro mais puro, culturalmente correto)
- FR: igual PT/EN/ES (não há conotação cultural forte diferente)

---

## 6. Expansão de Idiomas — FR e ZH

### 6.1 Francês (FR)

**Mercado:** França + Québec + África francófona (Senegal, Costa do Marfim, Camarões, etc.)
- África francófona: Uber, Bolt, e apps locais (Heetch, Yango) crescendo 40%+/ano
- Canadá: Uber + DoorDash + SkipTheDishes + Instacard

**Plataformas a adicionar nos presets:** Bolt, Heetch, Yango, DoorDash, SkipTheDishes

**Moeda principal:** EUR (França), CAD (Canadá), XOF/XAF (África francófona — já suportamos com multi-moeda)

**Arquivo:** `src/i18n/fr.json` (criar do zero — estrutura idêntica ao `en.json`)

### 6.2 Chinês Simplificado (ZH-CN)

**Mercado:** DiDi (China), Meituan Waimai, Ele.me — mas mais relevante: **diáspora chinesa** usando Uber/Lyft na Austrália, EUA, Europa
- DiDi ainda opera em Brasil, México, Australia, Chile, Colômbia — drivers brasileiros de origem chinesa
- App Store China: requer conta developer chinesa separada → não bloqueia Google Play international

**Plataformas preset para ZH:** DiDi, Meituan, Ele.me, Grab (para diáspora no Sudeste Asiático)

**Considerações UI para ZH:**
- Fontes: React Native renderiza caracteres CJK nativamente — sem mudança necessária
- Número de caracteres por string: muito menor em ZH (frases mais curtas → mais espaço vazio → rebalancear padding)
- Direção: LTR (igual PT/EN/ES — sem problema)

**Arquivo:** `src/i18n/zh.json`

### 6.3 Paleta Adaptada por Locale

Não mudar a identidade global, mas adicionar **variáveis de tema por locale**:

```ts
// src/theme/localeThemes.ts
export const localeTheme: Record<string, Partial<ThemeColors>> = {
  'zh': {
    accent: '#FFD700',         // ouro puro (culturalmente: prosperidade)
    background: '#0D0808',     // preto com toque vermelho
    accentDim: 'rgba(255,215,0,0.12)',
  },
  // fr, en, es, pt: tema padrão navy+gold (#F59E0B)
};
```

Isso respeita psicologia cultural de cores sem fragmentar o design. A decisão de ativar por locale fica em `_layout.tsx` com `useLocale()`.

---

## 7. Plano de Ataque — Sequência de Implementação (REVISADO)

### Sprint 1 — Quick wins com impacto alto

> ⚠️ Alimentação já existe em Despesas — remover deste sprint.

1. **Mood tracker** — Etapa "Como foi o dia?" no wizard + card "Avaliação do mês" em Lançamentos
2. **Meta Mensal visual** — Redesign do card no Dashboard (goal.tsx → circular progress gold)
3. **Diário de observações** — Campo por dia (1000 chars) na etapa pós-mood do wizard

### Sprint 2 — Implementar tudo

4. **Wizard 10 etapas completo** — Refatorar entrada como step-by-step dinâmico (plataformas do usuário)
5. **Dashboard kill shot** — Tendência vs mês anterior + R$/hora + R$/km no lucro + barras de plataforma coloridas + glassmorphism cards
6. **Dashboard "Impacto no dia a dia"** — Seção de equações visuais (Custo/KM, KM Líquido)
7. **Exportar dados** — CSV e PDF mensal + JSON LGPD
8. **Login biométrico** — expo-local-authentication com toggle em Configurações
9. **Cartões de crédito** — Cadastro + alerta de vencimento de fatura

### Sprint 3 — Kill shots

10. **Tutorial de onboarding** — SpotlightTour de 6 passos (descrito na seção 5)
11. **Comunidade** — Feed social MVP (perfil + compartilhar dia + feed + reações internacionais)
12. **Feedback in-app** — Tela bug/sugestão/feature integrada ao Resend
13. **Idiomas FR e ZH** — Arquivos i18n + presets de plataformas + tema ZH
14. **Tema por locale** — localeTheme.ts aplicado via _layout.tsx

---

## 8. O Kill Shot Visual — Proposta de Redesign do Dashboard

O Klaans mostra:
```
Receita Total R$ 0,00  |  Despesas Totais R$ 0,00
Lucro Líquido R$ 0,00  |  Reserva R$ 0,00
```

PalDrivy deve mostrar:
```
┌────────────────────────────────────────────────────┐
│  🏆 Meta Mensal                          4 dias ▶  │
│     ════════════════════════░░░░░  72%             │
│     R$ 2.160,00 de R$ 3.000,00                     │
└────────────────────────────────────────────────────┘

┌─ Receita ─────────┐  ┌─ Despesas ─────────┐
│ R$ 2.160,00       │  │ R$ 890,00           │
│ +12% vs mês ant.  │  │ 41% da receita      │
│ ████████░░░░ Uber │  │ ████░░░░░ Combustív │
│ ████░░░░░░░░ 99   │  │ ██░░░░░░░ Manutenç  │
└───────────────────┘  └─────────────────────┘

┌─ Lucro Líquido ─────────────────────────────────┐
│  R$ 1.270,00           R$ 7,94/hora             │
│  Melhor dia: Sábado    Média/km: R$ 1,42        │
└──────────────────────────────────────────────────┘
```

Onde o Klaans tem **números estáticos**, o PalDrivy tem **tendência vs mês anterior** + **breakdown por plataforma integrado** + **R$/hora e R$/km no lucro**.

---

## 9. Resumo Executivo

**O que o Klaans faz melhor:**
- Wizard de entrada guiado (UX superior para novos usuários)
- Comunidade social (único no segmento)
- Meta mensal com progresso visual
- Gestão de cartões
- Exportação de dados completa

**O que o PalDrivy faz melhor:**
- Preço (30× mais barato — vantagem defensável)
- Multi-idioma e multi-moeda (PT/EN/ES → +FR/ZH = mercado total 20× maior)
- Paleta visual mais premium (navy+gold vs verde genérico)
- Stack mais moderno (Expo/React Native)
- Plataformas dinâmicas no wizard (Klaans tem Uber+99 fixos)
- Comunidade potencialmente internacional (Klaans é só Brasil)

**Estratégia:** Não copiar o Klaans — **superá-lo em cada feature**. O wizard deve ser mais flexível. A comunidade deve ser global. O dashboard deve ter insights preditivos. O onboarding deve ser o melhor do segmento. E tudo isso por R$1/mês.

**Frase de posicionamento:** *"O app de motorista mais completo do mundo, por menos de um café por mês."*
