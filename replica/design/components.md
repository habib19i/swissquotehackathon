# Components

Swissquote Wallet's components in Swissquote's design system (tokens in [`tokens.json`](tokens.json),
styles in [`apps/web/app/globals.css`](../../apps/web/app/globals.css)). Base font 18 px for older clients;
one main action per screen, at thumb height. Check contrast after any change:
`node replica/design/contrast.mjs replica/design/tokens.json`.

```
Top bar
  layout    white bar, 64px, 1px line below; brand name left, "Hackathon prototype" pill right (always visible)
  tokens    surface, line, surface-alt, text-muted

Button (.button)
  variants  primary (accent fill, black text), secondary (white, 2px text border), quiet (underlined text)
  size      60px high, full width, pill radius; quiet 48px
  states    default, hover (accent-hover / surface-alt), focus-visible (3px focus ring), disabled (45% opacity)
  a11y      real <button> or <a>; label stays while busy ("Sending…")

Icon button (.icon-button)
  size      60px round; send = accent fill; microphone = outlined, accent fill while listening (aria-pressed)

Input (.input)
  size      60px, radius 8, 1px border-input; focus: focus border + 3px soft ring

Card list (.rows / .row)
  layout    white card, radius 12, shadow s; rows separated by 1px line; avatar = accent-tint circle, accent-text initial

Notice (.notice: plain, ok, warn, error)
  layout    radius 12, 1px border, shadow s; ok success-bg, warn warning-bg, error danger-bg with danger text

Safe door (Home total)
  layout    night panel, radius 16, 4px accent top edge, shadow m; total 48px bold; three key holders

Payment slip (.slip)
  layout    white, radius 16, shadow m; amount 48px bold; details below a dashed divider

Segmented control (.segmented)
  layout    surface-alt pill track; selected = white pill with shadow s (aria-pressed)

Plan choice (.plan)
  states    selected: accent border (aria-checked)

Chat bubbles (.bubble)
  client    night fill, white text; assistant: white card with shadow s

Badges
  mock      warning-bg pill, warning text: every mock is labelled "Mock"
  protected success text with shield icon ("Protected by Swissquote")
```

The Swissquote logo (`apps/web/public/swissquote-logo.png`, also the favicon) was supplied by the team for
this Swissquote prototype. Not taken from swissquote.com: its icons, illustrations and photos (the app keeps
its own inline icons), and its licensed fonts (SwissquoteCT, GT America, GT Sectra), replaced by Geist.
