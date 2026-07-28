# Admin PalDrivy v2 — Feedback Center + BI Reports

## Goal

Expandir o painel admin com dois novos módulos:
- **A) Central de Feedback** — receber, triagem e resolver mensagens Bug/Sugestão/Feature geradas pelo app
- **B) Relatórios BI** — analytics completos com drill-down geográfico (global → país → estado → cidade), cruzamento de receita × despesas × plataformas × assinaturas, exportação CSV + PDF

Mais: atualizar o **Dashboard** para exibir faturamento separado por moeda (LGPD-compliant, sem dados individualizados em exports regionais).

---

## Tech Stack

- React 18 + TypeScript + Vite
- Tailwind CSS v3
- Recharts v2 (charts existentes)
- Supabase JS v2 (queries + RPC)
- `@react-pdf/renderer` — PDF client-side (novo)
- `html2canvas` — captura gráficos para PDF (novo)
- React Router DOM v6

---

## Tipos de Trabalhador (expansão Sprint 4)

O campo `profiles.worker_type` atual tem apenas `driver` | `motoboy`. Expandir para 5 categorias:

| Valor (DB) | Label exibido | Descrição |
|---|---|---|
| `taxi` | Taxista | Táxi convencional / alvará |
| `rideshare` | Motorista de app | Uber, 99, InDriver, Bolt… |
| `motoboy_delivery` | Motoboy entregador | iFood, Rappi, Lalamove… |
| `motoboy_passenger` | Motoboy de passageiros | Transporte de pessoas de moto |
| `delivery` | Entregador | Bicicleta, carro, van — sem moto |

**Migration necessária no app e admin:**
```sql
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_worker_type_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_worker_type_check
  CHECK (worker_type IN ('taxi','rideshare','motoboy_delivery','motoboy_passenger','delivery'));
-- Migrar valores antigos:
UPDATE profiles SET worker_type = 'rideshare' WHERE worker_type = 'driver';
UPDATE profiles SET worker_type = 'motoboy_delivery' WHERE worker_type = 'motoboy';
```

**Impacto no app (`onboarding/vehicle.tsx`):** atualizar o picker de tipo de trabalhador com os 5 novos valores e labels traduzidos em PT/EN/ES/FR/ZH.

**Impacto no admin BI:** o gráfico "Tipo de trabalhador" passa a ter 5 categorias com cores distintas.

---

## Global Constraints

- Todas as strings em pt-BR
- Autenticação: `profiles.role === 'admin'` via AuthGuard (já existente)
- LGPD: exports regionais/globais agrupam por mínimo de 3 usuários; PII (nome, email) nunca aparece em exports de escopo global/regional
- Exports individuais de usuário só via `/users/:id` (já existente)
- Seleção de filtros de exibição persiste em `localStorage` (chave: `pd_report_filters`)
- Paleta existente: dark navy `#0B1221`, accent `#F59E0B`, tailwind dark classes

---

## Módulo 0 — Dashboard Multi-Moeda

### Mudança no card "Faturamento Bruto"

**Antes:** um valor em BRL
**Depois:** um badge por moeda ativa no sistema

```
Faturamento por Moeda
R$ 5.387,81  ·  $ 1.234,00  ·  € 890,40
```

Query: `shifts` agrupado por `profiles.currency`, somando `gross_cents`, no mês atual.
Se todas as moedas são BRL, exibe exatamente como antes.

### Novos cards no Dashboard

- **Feedback não lidos** — count de `app_feedback WHERE status = 'unread'`, badge vermelho, link para `/feedback`
- **Países ativos** — count distinct de `profiles.country` com pelo menos 1 shift este mês
- **Plataforma #1 global** — nome + % de receita da plataforma com maior soma de gross_cents este mês

---

## Módulo A — Central de Feedback `/feedback`

### Migração SQL necessária

```sql
ALTER TABLE app_feedback
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'resolved')),
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_app_feedback_status ON app_feedback(status);
CREATE INDEX IF NOT EXISTS idx_app_feedback_type   ON app_feedback(type);
CREATE INDEX IF NOT EXISTS idx_app_feedback_created ON app_feedback(created_at DESC);
```

### Componentes

**`src/pages/Feedback.tsx`** — página principal

Layout: header com stats + filtros, tabela à esquerda (60%), painel lateral à direita (40%).

**Stats bar (3 cards):**
- Total de feedbacks
- Não lidos (badge vermelho)
- Resolvidos este mês

**Filtros:**
- Tipo: Todos / Bug / Sugestão / Feature
- Status: Todos / Não lido / Lido / Resolvido
- Período: Últimos 7d / 30d / 90d / Custom (date range picker)
- Busca full-text: nome ou e-mail do usuário

**`src/components/FeedbackTable.tsx`**

Colunas da tabela:

| Campo | Detalhe |
|---|---|
| Tipo | Badge colorido: 🔴 Bug · 💡 Sugestão · ⭐ Feature |
| Mensagem | Prévia 100 chars, tooltip com texto completo ao hover |
| Usuário | Nome + e-mail como link para `/users/:id` |
| Data | Relativa (ex: "há 2 dias") com tooltip de data absoluta |
| Status | Badge: Não lido / Lido / Resolvido |

Ordenação por data (desc default). Paginação 25/página.
Row clicável → abre FeedbackSidePanel.

**`src/components/FeedbackSidePanel.tsx`**

Painel lateral deslizante (fixed right, largura 420px):
- Cabeçalho: tipo + data
- Corpo: mensagem completa (sem truncamento)
- Seção usuário: avatar inicial, nome, e-mail, botão "Ver perfil" → `/users/:id`
- Campo "Notas internas" — textarea editável, salvo em `admin_notes` via UPDATE
- Ações: `Marcar como Lido` · `Marcar como Resolvido` · `Reabrir` (volta para unread)
- Transição de status reflete imediatamente na tabela (optimistic update)

**`src/services/feedback.ts`**

```typescript
getFeedback(filters): Promise<FeedbackRow[]>
updateFeedbackStatus(id, status): Promise<void>
updateFeedbackNotes(id, notes): Promise<void>
getFeedbackStats(): Promise<{ total, unread, resolved_this_month }>
```

### Rota

```tsx
<Route path="/feedback" element={<Feedback />} />
```

Adicionada no sidebar entre Notificações e Legal.

---

## Módulo A.2 — UserDetail: abas Sprint 3

Adicionar 2 novas abas na página `/users/:id` existente:

**Aba "Plataformas"**
- Busca turnos do usuário com campo `platforms` JSONB
- Agrega receita por plataforma (mesmo algoritmo do `getMonthPlatformBreakdown` do app)
- Exibe BarChart horizontal: plataforma × gross_cents total
- Tabela: plataforma, total de turnos, receita total, % da receita, receita média/turno

**Aba "Cartões"**
- Lista `credit_cards` do usuário: nome, últimos 4 dígitos, limite, dia de fechamento, dia de vencimento
- Somente leitura (sem edição pelo admin)

---

## Módulo B — Relatórios BI `/reports`

### Arquitetura

Dados agregados server-side via RPC Supabase — nunca traz linhas brutas para o cliente em escopo global/regional.

### Migração SQL — RPC

```sql
CREATE OR REPLACE FUNCTION admin_get_report(
  p_scope        TEXT,    -- 'global' | 'country' | 'state' | 'city'
  p_scope_value  TEXT,    -- 'BR', 'São Paulo', 'Campinas' | '' para global
  p_from         DATE,
  p_to           DATE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Apenas admins
  IF NOT is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;

  WITH
  -- Usuários no escopo
  scoped_users AS (
    SELECT p.id, p.currency, p.worker_type, p.country, p.state, p.city
    FROM profiles p
    WHERE
      (p_scope = 'global') OR
      (p_scope = 'country' AND p.country = p_scope_value) OR
      (p_scope = 'state'   AND p.state   = p_scope_value) OR
      (p_scope = 'city'    AND p.city    = p_scope_value)
  ),
  -- Receita por moeda
  revenue_by_currency AS (
    SELECT su.currency, SUM(s.gross_cents) AS total
    FROM shifts s JOIN scoped_users su ON s.user_id = su.id
    WHERE s.started_at::date BETWEEN p_from AND p_to
    GROUP BY su.currency
  ),
  -- Receita por plataforma (JSONB aggregation)
  -- (client-side aggregation para plataformas dado complexidade de JSONB)
  shifts_data AS (
    SELECT s.gross_cents, s.km_meters, s.duration_seconds,
           s.platforms, s.started_at, su.currency
    FROM shifts s JOIN scoped_users su ON s.user_id = su.id
    WHERE s.started_at::date BETWEEN p_from AND p_to
  ),
  -- Despesas por categoria
  expenses_by_cat AS (
    SELECT e.category, SUM(e.amount_cents) AS total, su.currency
    FROM expenses e JOIN scoped_users su ON e.user_id = su.id
    WHERE e.date BETWEEN p_from AND p_to
    GROUP BY e.category, su.currency
  ),
  -- Combustível
  fuel_data AS (
    SELECT SUM(f.cost_cents) AS total_cost, SUM(f.liters) AS total_liters,
           su.currency
    FROM fuel_entries f JOIN scoped_users su ON f.user_id = su.id
    WHERE f.date BETWEEN p_from AND p_to
    GROUP BY su.currency
  ),
  -- Assinaturas
  sub_distribution AS (
    SELECT pl.name AS plan_name, COUNT(*) AS count
    FROM subscriptions sub
    JOIN scoped_users su ON sub.user_id = su.id
    JOIN plans pl ON sub.plan_id = pl.id
    WHERE sub.status IN ('active','trial','complimentary')
    GROUP BY pl.name
  ),
  -- Tipo trabalhador
  worker_split AS (
    SELECT worker_type, COUNT(*) AS count
    FROM scoped_users GROUP BY worker_type
  ),
  -- Stats gerais
  general AS (
    SELECT
      COUNT(DISTINCT su.id) AS active_users,
      COUNT(s.id) AS total_shifts,
      COALESCE(AVG(s.duration_seconds), 0) AS avg_duration_seconds,
      COALESCE(AVG(s.km_meters), 0) AS avg_km_per_shift,
      COALESCE(SUM(s.km_meters), 0) AS total_km
    FROM scoped_users su
    LEFT JOIN shifts s ON s.user_id = su.id
      AND s.started_at::date BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'active_users',         (SELECT active_users FROM general),
    'total_shifts',         (SELECT total_shifts FROM general),
    'avg_duration_seconds', (SELECT avg_duration_seconds FROM general),
    'avg_km_per_shift',     (SELECT avg_km_per_shift FROM general),
    'total_km',             (SELECT total_km FROM general),
    'revenue_by_currency',  (SELECT jsonb_agg(row_to_json(r)) FROM revenue_by_currency r),
    'expenses_by_category', (SELECT jsonb_agg(row_to_json(e)) FROM expenses_by_cat e),
    'fuel',                 (SELECT jsonb_agg(row_to_json(f)) FROM fuel_data f),
    'subscriptions',        (SELECT jsonb_agg(row_to_json(s)) FROM sub_distribution s),
    'worker_type',          (SELECT jsonb_agg(row_to_json(w)) FROM worker_split w),
    'shifts_raw',           (SELECT jsonb_agg(row_to_json(sh)) FROM shifts_data sh)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
```

Agregação de plataformas (JSONB) e tabela de regiões feita client-side após retorno da RPC.

### Componentes

**`src/pages/Reports.tsx`** — página principal

Layout:
- Sidebar esquerda: filtros de exibição (toggle por seção/métrica)
- Área principal: breadcrumb + período + cards + gráficos + tabela

**`src/components/ReportScopeNav.tsx`**

Breadcrumb clicável:
```
Global  >  Brasil  >  São Paulo  >  Campinas
```
Cada nível é um botão. Clicar num nível anterior sobe o escopo.
Selector de filho: dropdown de países → estados → cidades disponíveis no escopo atual.

**`src/components/ReportFilterPanel.tsx`**

Drawer lateral com checkboxes agrupados por seção:

```
MÉTRICAS
☑ Receita por moeda          ☑ Despesas totais
☑ Combustível                ☑ Manutenção
☑ Seguro                     ☑ Aluguel
☑ Alimentação                ☑ Pedágios
☑ Outros                     ☑ Km médio/turno

PLATAFORMAS
☑ Breakdown de plataformas   ☑ Plataforma #1 por região

DISTRIBUIÇÕES
☑ Tipo de trabalhador        ☑ Planos/assinaturas

GRÁFICOS
☑ Receita ao longo do tempo  ☑ Plataformas (barra)
☑ Despesas (pizza)           ☑ Assinaturas (pizza)
☑ Tipo trabalhador (barra)   ☑ Regiões (tabela cruzada)
```

[Aplicar] [Resetar para padrão]

Estado salvo em `localStorage` chave `pd_report_filters`.

**`src/components/ReportSummaryCards.tsx`**

Cards renderizados condicionalmente conforme filtros ativos:
- Usuários ativos
- Receita (por moeda, badges separados)
- Total de turnos
- Receita média/usuário (por moeda)
- Despesas totais (por categoria selecionada)
- Custo de combustível
- Km total / Km médio por turno

**`src/components/ReportCharts.tsx`**

Gráficos renderizados condicionalmente:

1. **Receita ao longo do tempo** — `LineChart` — eixo X: semanas/meses no período, eixo Y: gross_cents, uma linha por moeda
2. **Plataformas mais lucrativas** — `BarChart` horizontal — top 10 plataformas × receita total (aggregado client-side do JSONB `shifts.platforms`)
3. **Despesas por categoria** — `PieChart` — fatias: manutenção, seguro, aluguel, alimentação, pedágio, combustível, outros
4. **Distribuição de assinaturas** — `PieChart` — Free / Trial / Premium
5. **Tipo de trabalhador** — `BarChart` — motoristas vs motoboys, por região se drill-down ativo

**`src/components/ReportRegionsTable.tsx`**

Tabela cruzada de sub-regiões do escopo atual (ex: no escopo "Brasil", lista estados):

| Região | Usuários | Receita/usuário | Plataforma #1 | Plataforma #2 | Desp. média | Custo/km |
|---|---|---|---|---|---|---|
| São Paulo | 3 | R$ 4.910 | Uber 68% | 99 22% | R$ 2.100 | R$ 0,41 |

Colunas visíveis conforme filtros. Clique numa região navega para aquele escopo.
LGPD: regiões com < 3 usuários mostram `—` nas métricas (não individualizáveis).

**`src/services/reports.ts`**

```typescript
getReport(scope, scopeValue, from, to): Promise<ReportData>
getAvailableRegions(scope, scopeValue): Promise<string[]>
// Aggregação client-side de platforms JSONB:
aggregatePlatforms(shiftsRaw): PlatformStat[]
// Série temporal para LineChart:
buildTimeSeries(shiftsRaw, period): TimeSeriesPoint[]
```

**`src/utils/exportCsv.ts`**

```typescript
exportReportCsv(data: ReportData, scope: string, activeFilters: FilterState): void
// Gera CSV client-side com BOM UTF-8, download automático
// Respects activeFilters — só inclui colunas visíveis
// LGPD: sem PII em exports globais/regionais
```

**`src/utils/exportPdf.ts`**

```typescript
exportReportPdf(data: ReportData, scope: string, activeFilters: FilterState): Promise<void>
// 1. html2canvas captura cada gráfico Recharts visível
// 2. @react-pdf/renderer monta documento:
//    - Cabeçalho: escopo, período, data de geração
//    - Cards de resumo em grid 2×N
//    - Imagens dos gráficos (png de html2canvas)
//    - Tabela de regiões
//    - Rodapé: "Dados anonimizados — LGPD Art. 12"
// 3. Download automático
```

### Rota

```tsx
<Route path="/reports" element={<Reports />} />
```

Adicionada no sidebar entre Estatísticas e Planos.

---

## Navegação (Sidebar)

Ordem final do sidebar:
1. Dashboard
2. Usuários
3. **Feedback** (novo — badge com contagem não lidos)
4. **Relatórios** (novo)
5. Estatísticas
6. Planos
7. Assinaturas
8. Notificações
9. Legal / LGPD
10. Sair

---

## Sequência de Implementação

1. Migration SQL (`app_feedback` + RPC `admin_get_report`)
2. Dashboard: faturamento multi-moeda + novos cards
3. Módulo A: Feedback Center (FeedbackTable + FeedbackSidePanel + service)
4. UserDetail: abas Plataformas + Cartões
5. Módulo B: ReportScopeNav + ReportFilterPanel
6. Módulo B: ReportSummaryCards + ReportCharts
7. Módulo B: ReportRegionsTable
8. Módulo B: exportCsv + exportPdf
9. Sidebar atualizada + rotas
10. Deploy Vercel

---

## Notas LGPD

- Exports CSV/PDF com escopo global ou regional: sem nome, e-mail, telefone
- Regiões com < 3 usuários: métricas exibidas como `—`
- Rodapé obrigatório em PDFs: "Dados agregados e anonimizados conforme LGPD Art. 12 — PalDrivy"
- Exports individuais (via UserDetail) mantêm PII pois são uso interno de admin autenticado
