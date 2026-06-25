# DriveWise — Brand Identity Guide

**Tagline:** Drive Smart. Earn More.

## Conceito da Marca

DriveWise combina "Drive" (dirigir, mobilidade) com "Wise" (sábio, inteligente).
O nome comunica: *dirija com inteligência financeira*. É o co-piloto financeiro do motorista.

Público-alvo: motoristas de app (Uber, 99, inDrive) e taxistas — Brasil e global.

---

## Logo

### Conceito do Ícone

Volante estilizado integrado a uma linha de gráfico ascendente ou seta para cima.
Representa a interseção entre mobilidade e crescimento financeiro.

Variações:
- **App Icon**: Ícone quadrado com fundo azul escuro (#0F172A), símbolo verde em destaque
- **Wordmark completo**: Ícone + "DriveWise" em IBM Plex Sans Bold
- **Dark background**: versão principal (app, splash screen)
- **Light background**: versão para materiais impressos ou web claro

Candidatos gerados no Canva:
- Opção 1: https://www.canva.com/d/6MK0j3SyoR-lEOV
- Opção 2: https://www.canva.com/d/2eNoqS03xzazR4g
- Opção 3: https://www.canva.com/d/00wiNC-BViF1wks
- Opção 4: https://www.canva.com/d/OU743fv8SHfClTG

---

## Paleta de Cores

### Cores Primárias

| Papel | Nome | Hex | Uso |
|-------|------|-----|-----|
| Background | Midnight Black | `#020617` | Fundo principal (OLED eficiente) |
| Surface | Navy Deep | `#0F172A` | Cards, header, bottom nav |
| Surface Alt | Slate Dark | `#1E293B` | Cards secundários, inputs |
| Brand | Brand Blue | `#2563EB` | Logo, links, botão primário |
| Border | Slate Border | `#334155` | Bordas, divisores |

### Cores Semânticas

| Papel | Nome | Hex | Uso |
|-------|------|-----|-----|
| Earnings / Positive | Profit Green | `#22C55E` | Lucro, ganhos, meta atingida |
| Fuel / Cost | Fuel Amber | `#F59E0B` | Combustível, custos variáveis |
| Alert / Negative | Alert Red | `#EF4444` | Prejuízo, alerta, erro |
| Neutral | Muted Slate | `#94A3B8` | Texto secundário, placeholders |

### Texto

| Papel | Hex | Uso |
|-------|-----|-----|
| Primary Text | `#F8FAFC` | Texto principal |
| Secondary Text | `#94A3B8` | Labels, subtítulos |
| Disabled | `#475569` | Estado desabilitado |

### Tokens de Design (React Native / NativeWind)

```ts
export const colors = {
  background:    '#020617',
  surface:       '#0F172A',
  surfaceAlt:    '#1E293B',
  brand:         '#2563EB',
  border:        '#334155',

  profit:        '#22C55E',
  fuel:          '#F59E0B',
  alert:         '#EF4444',

  textPrimary:   '#F8FAFC',
  textSecondary: '#94A3B8',
  textDisabled:  '#475569',

  onBrand:       '#FFFFFF',
  onProfit:      '#0F172A',
  onFuel:        '#0F172A',
  onAlert:       '#FFFFFF',
} as const;
```

---

## Tipografia

**Família única:** IBM Plex Sans — financeiro, confiável, profissional, legível em tela.

| Papel | Peso | Tamanho | Line-height |
|-------|------|---------|-------------|
| Display (valores grandes) | Bold 700 | 32–40sp | 1.1 |
| Title / H1 | Bold 700 | 24sp | 1.2 |
| Section Header | SemiBold 600 | 18sp | 1.3 |
| Body | Regular 400 | 16sp | 1.5 |
| Label / Caption | Medium 500 | 13–14sp | 1.4 |
| Micro (dados tabulares) | Regular 400 | 12sp | 1.4 |

Valores monetários e numéricos: usar variant **tabular-nums** para evitar layout shift.

```ts
export const typography = {
  displayLarge:  { fontSize: 40, fontWeight: '700', lineHeight: 44, fontVariant: ['tabular-nums'] },
  displayMedium: { fontSize: 32, fontWeight: '700', lineHeight: 36, fontVariant: ['tabular-nums'] },
  title:         { fontSize: 24, fontWeight: '700', lineHeight: 29 },
  sectionHeader: { fontSize: 18, fontWeight: '600', lineHeight: 23 },
  body:          { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  label:         { fontSize: 14, fontWeight: '500', lineHeight: 20 },
  caption:       { fontSize: 12, fontWeight: '400', lineHeight: 17 },
};
```

---

## Estilo Visual

- **Modo:** Dark Mode OLED apenas (v1) — motoristas trabalham à noite; economiza bateria
- **Cards:** border-radius 12px, sem sombra (flat on dark), borda `#334155` 1px
- **Botões primários:** border-radius 999px (pill), fundo `#2563EB`, texto branco
- **Botões secundários:** border-radius 999px, borda `#334155`, fundo transparente
- **Inputs:** border-radius 8px, borda `#334155`, fundo `#1E293B`
- **Iconografia:** Lucide Icons, stroke 1.5px, tamanho 24px padrão
- **Animações:** 150–250ms, ease-out entrada / ease-in saída (spring para modais)
- **Feedback de toque:** scale 0.97 + haptic medium em ações primárias

---

## Linguagem Visual dos Dados

O app é centrado em números. Hierarquia visual dos valores:

```
Valor principal (lucro líquido)  → Display 40sp Bold #22C55E
Valor secundário (bruto)         → Title 24sp Bold #F8FAFC
Métricas (R$/h, R$/km)          → Body 16sp Medium #94A3B8
Labels                           → Caption 12sp #475569
```

Cores nos números:
- Verde `#22C55E` → valor positivo / lucro
- Vermelho `#EF4444` → valor negativo / custo
- Âmbar `#F59E0B` → combustível / custo variável
- Branco `#F8FAFC` → neutro / bruto

---

## Iconografia de Navegação (Bottom Tab)

| Tab | Ícone Lucide | Label PT | Label EN | Label ES |
|-----|-------------|----------|----------|----------|
| Dashboard | `LayoutDashboard` | Início | Home | Inicio |
| Turnos | `Clock` | Turnos | Shifts | Turnos |
| Combustível | `Fuel` | Combustível | Fuel | Combustible |
| Despesas | `Receipt` | Despesas | Expenses | Gastos |
| Mais | `MoreHorizontal` | Mais | More | Más |

---

## Voz & Tom

- **Direto:** "Seu lucro real hoje: R$ 127,40" — sem rodeios
- **Empoderador:** o app celebra ganhos, não critica gastos
- **Preciso:** sempre mostrar o número exato, nunca aproximações
- **Neutro:** sem julgamento de plataforma (Uber = 99 = Táxi)

Exemplo de copy in-app:
- ✅ "Turno encerrado. Lucro líquido: R$ 43,20 em 4h12min"
- ❌ "Você trabalhou muito hoje! Parabéns pelo seu esforço!"

---

## Apresentação da Marca

Slides gerados no Canva (8 slides, estilo digital):
- Apresentação: após aprovação do outline acima

---

## Arquivos de Marca

```
docs/superpowers/specs/
  2026-06-25-drivewise-brand.md   ← este arquivo
  2026-06-25-app-motorista-design.md  ← spec técnica completa

app-motorista/locales/
  pt.json  ← app_name: "DriveWise"
  en.json  ← app_name: "DriveWise"
  es.json  ← app_name: "DriveWise"
```
