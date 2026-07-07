# Codex Pixel-Perfect UI Recreation Prompt v2

> **Important:** The two reference images below are the single source of
> truth. Measure layout, spacing, proportions, border radii, blur
> intensity, shadows, and typography from these references instead of
> making assumptions.

## Reference Designs

### Light Theme (Primary Reference)

![Light Theme](light_reference.png)

**Observe carefully:** - Exact sidebar width and spacing - Header
alignment - Card sizes and spacing - Glass transparency and blur -
Rounded corners - Background atmosphere - Typography hierarchy

---

### Dark Theme (Primary Reference)

![Dark Theme](dark_reference.png)

**Observe carefully:** - Same layout as light version - Only
theme/material changes - Deep navy background instead of pure black -
Dark liquid glass materials - Preserve all proportions

---

# Core Rules

- Pixel-perfect recreation.
- Do NOT redesign.
- Do NOT reinterpret.
- Do NOT simplify.
- Light and Dark share identical layout.
- Theme switching only changes colors/materials.
- Build with React 19 + TypeScript + Vite + Tailwind v4 + Framer
  Motion.
- Componentized architecture.
- VisionOS-quality Liquid Glass.
- Reusable design tokens.
- Responsive while preserving proportions.

## Critical Requirements

1.  Treat the images as the single source of truth.
2.  Measure every visible property from the references.
3.  Match spacing, blur, shadows, typography and animation.
4.  Output a complete runnable project.
