# App para Motoristas — Especificação de Design

**Data:** 2026-06-25  
**Status:** Aprovado  
**Produto:** App de controle financeiro para motoristas de Uber, 99, inDrive, taxistas e outros

---

## 1. Visão Geral

App mobile + web para motoristas de aplicativo e taxistas controlarem ganhos, custos e lucro real, com planejamento financeiro para manutenções e troca de veículo. Responde a pergunta central:

> **"Esse período de trabalho realmente valeu a pena?"**

**Diferencial principal:** comparativo multi-plataforma (Uber + 99 + inDrive + táxi convencional etc.) em um único painel, com lançamento global (multi-país, multi-moeda, multi-idioma) desde o MVP.

---

## 2. Público-Alvo

- Motoristas de aplicativo (1 ou múltiplas plataformas)
- Taxistas (convencional, rádio táxi, táxi por app)
- Motoristas com carro próprio, alugado ou financiado
- Entregadores e profissionais de mobilidade
- Motoristas de frota (fase futura)

---

## 3. Stack Técnica

| Camada | Tecnologia |
|---|---|
| Mobile | React Native + Expo Router v3 |
| Web | Expo Router Web (PWA instalável) |
| Backend | Supabase (Postgres + Auth + Storage) |
| Cálculos | Supabase Edge Functions (Deno/TypeScript) |
| i18n | expo-localization + i18next |
| Moedas/datas | Intl.NumberFormat + Intl.DateTimeFormat |
| Testes | Jest (unit) · Detox (mobile E2E) · Playwright (web E2E) |

---

## 4. Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                  EXPO ROUTER v3                      │
│         (iOS · Android · Web PWA)                    │
│                                                      │
│  /app/(auth)   /app/(tabs)   /app/planning           │
│   login         dashboard     manutenção             │
│   register      turnos        troca veículo          │
│                 combustível   simulações             │
└────────────────────────┬────────────────────────────┘
                         │ Supabase SDK
┌────────────────────────▼────────────────────────────┐
│                   SUPABASE                           │
│                                                      │
│  Auth (email + Google OAuth)                         │
│  Postgres + RLS (dados isolados por usuário)         │
│  Edge Functions:                                     │
│    · calculate-shift    (lucro real por turno)       │
│    · cost-allocation    (rateio de custos fixos)     │
│    · maintenance-fund   (reserva por km)             │
│    · vehicle-swap-sim   (simulação troca de carro)   │
│    · scenario-compare   (próprio vs alugado etc.)    │
│  Storage (comprovantes, fotos de odômetro)           │
└─────────────────────────────────────────────────────┘
```

**Regra central:** campos calculados (lucro líquido, custo/km, reserva acumulada) nunca ficam persistidos como source-of-truth — são computados pelas Edge Functions e opcionalmente cacheados em `reports_snapshots`.

---

## 5. Modelo de Dados

```sql
-- Identidade
profiles (
  id, name, email, phone,
  country, city, currency_code,
  distance_unit,   -- km | mi
  volume_unit,     -- liters | gallons
  timezone, locale,
  created_at
)

-- Veículos
vehicles (
  id, user_id, brand, model, year, plate,
  fuel_type,               -- gasoline | ethanol | diesel | gnv | electric | hybrid
  avg_consumption_per_100, -- litros/100km ou equivalente
  ownership_type,          -- own | rent | financed
  monthly_cost,            -- aluguel ou parcela de financiamento
  monthly_insurance,
  current_odometer,
  purchase_price,          -- para cálculo de depreciação
  purchase_date,
  target_swap_years,       -- em quantos anos quer trocar
  target_swap_budget,      -- quanto quer ter na mão na troca
  is_taxi,                 -- habilita campos e categorias específicas de táxi
  taxi_license_monthly,    -- custo mensal do alvará/licença de táxi
  created_at
)

-- Plataformas (seed global)
platforms (
  id, name, country_code, active,
  type  -- rideshare | taxi_app | taxi_conventional | delivery
  -- rideshare:   Uber, 99, inDrive, Lyft, Bolt, Cabify, DiDi, Ola, Grab, Gojek, FreeNow...
  -- taxi_app:    99Táxi, Táxi.Rio, Easy Taxi, inDriver Táxi...
  -- taxi_conventional: "Convencional" (ponto, radio táxi, chamada direta)
)

-- Turnos
shifts (
  id, user_id, vehicle_id,
  started_at, ended_at,
  start_odometer, end_odometer,
  tips, bonuses, tolls, parking_cost,
  food_cost,   -- alimentação e snacks durante o turno
  region, notes,
  created_at
)

shift_earnings (
  id, shift_id, platform_id, gross_amount
)

-- Combustível
fuel_entries (
  id, user_id, vehicle_id,
  filled_at, odometer,
  fuel_type, volume, total_amount, price_per_unit,
  station_name, is_full_tank, notes,
  created_at
)

-- Despesas
expenses (
  id, user_id, vehicle_id, category_id,
  expense_date, amount, description,
  is_recurring, recurrence_period,
  created_at
)

expense_categories (
  id, name,
  type  -- fixed | variable
  -- Categorias fixas pré-cadastradas incluem:
  --   Aluguel do carro, Financiamento, Seguro, Internet/celular,
  --   Alvará/licença de táxi (específico taxista), Taxímetro (manutenção),
  --   Rastreador, Licenciamento/IPVA
  -- Categorias variáveis pré-cadastradas incluem:
  --   Combustível, Lavagem, Manutenção, Pneus, Troca de óleo,
  --   Pedágios, Estacionamento, Alimentação/snacks, Multas
)

-- Planejamento financeiro
maintenance_schedule (
  id, user_id, vehicle_id, task_name,
  interval_km, interval_days,
  last_done_at, last_done_odometer,
  estimated_cost,
  next_due_odometer, next_due_date
)

maintenance_fund (
  user_id, vehicle_id,
  cost_per_km,           -- calculado pela Edge Function
  accumulated_reserve,   -- cresce a cada turno encerrado
  last_updated_at
)

vehicle_swap_fund (
  user_id, vehicle_id,
  monthly_target,        -- calculado pela simulação
  accumulated,
  projected_swap_date
)

-- Metas
goals (
  id, user_id,
  type,          -- daily | weekly | monthly | per_hour | per_km
  period,
  target_amount, target_unit,
  starts_at, ends_at
)

-- Cache de relatórios
reports_snapshots (
  id, user_id, period_type, period_start, period_end,
  data_json,
  generated_at
)

-- Assinaturas
subscriptions (
  id, user_id, plan,   -- free | pro
  status, current_period_end
)
```

---

## 6. Edge Functions

### `calculate-shift`
```
entrada: shift_id
calcula:
  duration_hours = ended_at - started_at
  distance = end_odometer - start_odometer
  gross_earnings = Σ shift_earnings
  estimated_fuel_cost = distance × (avg_consumption/100) × last_fuel_price
  allocated_fixed_cost = (monthly_cost + insurance) / days_in_month × shift_days
  net_earnings = gross - fuel - fixed_alloc - tolls - parking - food - other_variable
  net_per_hour = net / duration_hours
  net_per_km = net / distance
saída: objeto com todos os campos calculados
```

### `maintenance-fund`
```
entrada: vehicle_id, km_driven (do turno)
calcula:
  cost_per_km = Σ(estimated_cost / interval_km) para todas as tarefas agendadas
  accumulated_reserve += km_driven × cost_per_km
atualiza: maintenance_fund
```

### `vehicle-swap-sim`
```
entrada: vehicle_id
calcula:
  target_swap_date = purchase_date + target_swap_years (em anos)
  years_owned = (today − purchase_date) em anos
  depreciation = purchase_price × (1 − depreciation_rate)^years_owned
    -- depreciation_rate padrão: 0.15/ano (mercado BR); configurável por país
  residual_value = depreciation
  needed = target_swap_budget − residual_value
  months_remaining = (target_swap_date − today) em meses
  monthly_target = needed / months_remaining
atualiza: vehicle_swap_fund
```

### `scenario-compare`
```
entrada: vehicle_id, cenários (próprio / alugado / financiado com parâmetros)
retorna: tabela comparativa com custo fixo/mês, custo variável/km,
         lucro líquido/mês, break-even diário, recomendação
```

---

## 7. Fluxo de Telas

### Onboarding (uma vez)
1. Idioma + país + moeda + unidade (km/mi, L/gal)
2. Cadastro do veículo
3. Meta mensal (opcional)

### Navegação principal
```
[Dashboard]  [Turnos]  [+ Registrar]  [Planejar]  [Mais]
```

### Dashboard
- **Turno ativo** (quando em andamento): tempo decorrido · km parcial estimado · ganho parcial
- Ganho bruto / Lucro líquido do dia
- Horas trabalhadas · km rodados
- Lucro/hora · Lucro/km
- Melhor plataforma do dia
- Progresso da meta
- Alertas de manutenção pendentes
- Saldo dos fundos (manutenção + troca de carro)

### Registrar Turno — Fluxo em duas etapas

**Etapa 1 — Iniciar turno** (toque único no botão central):
- Grava `started_at` = timestamp atual
- Motorista informa `start_odometer`
- Botão central muda para "Encerrar turno" (turno ativo visível no dashboard)

**Etapa 2 — Encerrar turno** (< 30 segundos):
1. `end_odometer` (km final) → app calcula distância e horas automaticamente
2. Plataformas + valores (1 ou múltiplas)
3. Custos do turno *(opcional)*: pedágios · estacionamento · alimentação/snacks · outros
4. [Salvar] → exibe resumo: horas trabalhadas · km rodados · lucro líquido · lucro/hora · lucro/km

> Os timestamps `started_at` e `ended_at` são o source-of-truth para duração.
> O motorista pode corrigir manualmente caso esqueça de tocar "Iniciar".

### Combustível
- Km atual · litros · valor total · tanque cheio?
- Calcula consumo real e atualiza custo/km automaticamente

### Planejar
- **Manutenções:** agenda por km e data, estimativa de custo, saldo acumulado
- **Troca de carro:** simulação de depreciação, meta de fundo, aporte mensal necessário
- **Simular cenário:** comparativo próprio vs alugado vs financiado em tempo real

### Relatórios
- Filtros: Hoje / Semana / Mês / Ano / Por Plataforma
- Gráficos: linha (evolução do lucro) + barras (por plataforma e dia da semana)
- Exportação: PDF · CSV

---

## 8. Internacionalização (Global by Design)

| Aspecto | Implementação |
|---|---|
| Idiomas MVP | Português · Inglês · Espanhol |
| Moedas | Detectadas por país; formatadas via `Intl.NumberFormat` |
| Unidades | km/mi e L/gal por preferência de perfil |
| Datas | `Intl.DateTimeFormat` por locale do usuário |
| Plataformas | Filtradas por `country_code` na seed |
| Fusos horários | Armazenados no perfil; usados em todos os cálculos de turno |

Mercados iniciais: Brasil → América Latina → EUA → Europa

---

## 9. Monetização

### Plano Gratuito
- 1 veículo
- Histórico: 60 dias
- Até 2 plataformas
- Dashboard diário e semanal
- 1 alerta de manutenção

### Plano Pro
- Veículos ilimitados
- Histórico completo
- Plataformas ilimitadas
- Módulo de planejamento financeiro completo
- Simulador de cenários
- Relatórios mensais e anuais
- Exportação PDF/CSV
- Alertas de manutenção ilimitados
- Relatório para contador

**Preços:** R$ 9,90/mês · R$ 79,90/ano (Brasil) | US$ 5,99/mês (EUA) | EUR 4,99/mês (Europa)

---

## 10. Fases de Lançamento

### Fase 1 — MVP (Brasil)
Turno · combustível · despesas · dashboard · metas básicas · freemium ativo

### Fase 2 — Planejamento Financeiro
Reserva para manutenção · fundo de troca de carro · agenda com alertas · simulador de cenários

### Fase 3 — Global
i18n completo (pt/en/es) · plataformas por país · moedas · unidades · App Store EUA + LATAM

### Fase 4 — Inteligência
OCR de prints dos apps · recomendações de horários lucrativos · relatório para contador · plano frota

---

## 11. Estratégia de Testes

| Tipo | Ferramenta | O que cobre |
|---|---|---|
| Unit | Jest | Todas as Edge Functions (cálculo de lucro, rateio, simulações) |
| Integration | Supabase local | Fluxo turno → Edge Function → dashboard |
| E2E Mobile | Detox | Registrar turno, ver lucro, agenda de manutenção |
| E2E Web | Playwright | Mesmos fluxos críticos no browser |

---

## 12. Próximos Passos

1. Definir nome do produto e identidade visual
2. Criar projeto Expo Router v3 com Supabase
3. Modelar banco no Supabase (migrations)
4. Implementar Edge Functions de cálculo com testes unit
5. Construir telas do MVP (onboarding → turno → dashboard)
6. Validar com motoristas reais no Brasil
7. Ajustar cálculos com base no uso real
8. Lançar Fase 2 (planejamento financeiro)
