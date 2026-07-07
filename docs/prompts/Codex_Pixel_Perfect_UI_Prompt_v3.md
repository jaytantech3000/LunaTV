# Codex Pixel-Perfect UI Recreation Prompt v3

> **Important:** Recreate the UI as real components, not as a flattened screenshot. The two reference images below are the only visual source of truth for geometry, spacing, materials, typography, and atmosphere.

## Objective

Rebuild the desktop UI shown in the reference images with pixel-accurate layout and matching visual tone. The result must feel like the same product, not an interpretation of it.

## Reference Assets

### Light Theme

![Light Theme](light_reference.png)

- File: `light_reference.png`
- Canvas size: `1584x993`
- Role: layout master and light-theme material master

### Dark Theme

![Dark Theme](dark_reference.png)

- File: `dark_reference.png`
- Canvas size: `1584x993`
- Role: dark-theme material and color master
- Constraint: geometry must remain identical to the light version

## Non-Negotiable Rules

- Do not redesign.
- Do not reinterpret.
- Do not simplify.
- Do not invent missing sections, states, or content blocks.
- Do not create a mobile version for this task.
- Do not use the full-page screenshots as a rendered page background, iframe, or single-image cheat.
- Build the interface out of real React components.
- You may crop poster art or other local image fragments from the provided references only when no standalone asset exists.
- If a value is visible in the references, measure it from the references instead of guessing.
- If an exact font cannot be identified, use the closest visible match and document that choice briefly.

## Primary Fidelity Target

- Treat `1584x993` as the only pixel-perfect acceptance size.
- At `1584x993`, match the reference layout within roughly `1-2px` for the major structural measurements:
  - sidebar width
  - outer page padding
  - top utility icon placement
  - segmented control size and alignment
  - section heading offsets
  - card width, height, radius, and gap
  - right-side scroll indicator position
- Preserve the same card count, row density, and visual hierarchy at the primary size.

## Responsive Constraint

- The design is desktop-first.
- Below the primary canvas, preserve proportions as long as possible before changing structure.
- Prefer proportional scaling and controlled spacing reduction over reflowing the layout.
- Do not invent a drawer, bottom nav, or mobile-specific pattern.

## Visual Landmarks That Must Match

- Full-bleed scenic background with strong atmospheric blur and depth.
- Tall left glass sidebar with the `Luna` wordmark, compact menu trigger, and stacked navigation.
- Centered top segmented control with a filled active pill.
- Three top-right utility icons with airy spacing.
- Large first content row with translucent media cards and clear active-state treatment.
- Lower content row with poster-heavy cards and floating score badges.
- Slim vertical progress or scroll indicator on the right edge.

## Theme Rules

- Light and dark themes must share the same layout, dimensions, spacing, radii, and component structure.
- Theme switching may change only:
  - color
  - opacity
  - blur strength
  - border color
  - glow
  - shadow
- The dark theme should use deep navy and teal tones, not pure black.
- The light theme should keep the warm misty sage and ivory atmosphere from the reference.
- Do not introduce unrelated brand colors or generic purple glassmorphism.

## Material Rules

- Recreate the layered liquid-glass look using separate fill, border, blur, and shadow treatment.
- Match the relative opacity differences between cards, sidebar, pills, and chrome.
- Match the perceived softness of edges, bloom, and background haze.
- Borders should remain subtle and luminous, never heavy or flat.

## Typography Rules

- Preserve the Chinese copy shown in the references.
- Match perceived font size, weight, spacing, and hierarchy from the screenshots.
- Preserve the visual character of the `Luna` brand wordmark.
- Avoid default-looking typography choices that break the reference mood.

## Motion Rules

Because the inputs are static screenshots, use restrained motion only.

- Theme transition: `200-250ms`, smooth crossfade of materials and colors.
- Segmented control thumb: `180-220ms`, ease-out or light spring.
- Card hover or focus: subtle lift or glow only, `160-200ms`.
- Avoid exaggerated scaling, parallax, staggered entrances, or decorative motion that is not implied by the references.

## Implementation Stack

- React `19`
- TypeScript
- Vite
- Tailwind CSS `v4`
- Framer Motion

## Implementation Requirements

- Output a complete runnable project.
- Use a componentized architecture, not one monolithic page.
- Extract reusable design tokens for colors, blur, radii, spacing, and shadows.
- Keep layout constants explicit and traceable to the references.
- Use local assets only.
- Do not depend on remote image URLs for core visuals.

## Suggested Component Breakdown

- `AppShell`
- `Sidebar`
- `TopActions`
- `ThemeToggle`
- `SegmentedControl`
- `SectionHeader`
- `FeaturedMediaRow`
- `PosterMediaRow`
- `MediaCard`
- `ScoreBadge`
- `MetadataPill`
- `ScrollIndicator`

## Acceptance Checklist

- The app runs successfully with standard install and dev commands.
- The primary desktop screenshot at `1584x993` closely matches the light reference.
- The dark theme matches the dark reference with identical geometry.
- Theme switching does not shift layout.
- No major landmark from the references is missing.
- No placeholder lorem ipsum or substitute artwork unrelated to the references appears.
- No obvious default UI patterns replace the reference composition.

## Final Instruction

Recreate what is shown. If forced to choose between "cleaner modern UI" and "closer to the reference," choose the reference every time.
