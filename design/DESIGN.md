---
name: Liquid Glass Security
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1b1b1d'
  surface-container: '#1f1f21'
  surface-container-high: '#2a2a2c'
  surface-container-highest: '#353437'
  on-surface: '#e4e2e4'
  on-surface-variant: '#c4c7c8'
  inverse-surface: '#e4e2e4'
  inverse-on-surface: '#303032'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c6c6c7'
  primary: '#ffffff'
  on-primary: '#2f3131'
  primary-container: '#e2e2e2'
  on-primary-container: '#636565'
  inverse-primary: '#5d5f5f'
  secondary: '#aac7ff'
  on-secondary: '#003064'
  secondary-container: '#3e90ff'
  on-secondary-container: '#002957'
  tertiary: '#ffffff'
  on-tertiary: '#690004'
  tertiary-container: '#ffdad5'
  on-tertiary-container: '#c61818'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c7'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#d6e3ff'
  secondary-fixed-dim: '#aac7ff'
  on-secondary-fixed: '#001b3e'
  on-secondary-fixed-variant: '#00468d'
  tertiary-fixed: '#ffdad5'
  tertiary-fixed-dim: '#ffb4aa'
  on-tertiary-fixed: '#410001'
  on-tertiary-fixed-variant: '#930007'
  background: '#131315'
  on-background: '#e4e2e4'
  surface-variant: '#353437'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: -0.02em
  card-title:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '500'
    lineHeight: '1.5'
  body-details:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.6'
  metadata:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
    letterSpacing: 0.01em
  code-path:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-padding: 24px
  card-gap: 16px
  element-margin: 12px
  inner-padding: 8px
---

## Brand & Style
The design system for this developer security tool is built upon the **Liquid Glass** aesthetic, drawing inspiration from spatial computing and high-end hardware interfaces. The brand personality is clinical, precise, and sophisticated—evoking the feeling of a high-tech diagnostic terminal. 

The UI should feel lightweight and atmospheric. By utilizing depth, refraction, and specular highlights, the interface moves away from flat "software" containers toward a "physical lens" metaphor. Every surface acts as a filter over the underlying environment, providing a sense of transparency and trust necessary for security-focused tools.

## Colors
The color strategy relies on **Neutral Glass** surfaces rather than solid fills. The core palette uses "Glass Grays" to define structure, while semantic colors are reserved strictly for status communication to maintain a high signal-to-noise ratio.

- **Light Mode:** Surfaces are white-tinted glass (70-80% opacity) with a `saturate(180%)` filter to pull warmth from background elements.
- **Dark Mode:** Surfaces are black-tinted glass (60-70% opacity) for a deep, obsidian-like feel.
- **Accents:** Semantic colors should be applied as thin 1.5px lines, 8px dots, or circular progress indicators. They should never be used as large block backgrounds.
- **Contrast:** Text must maintain WCAG AA compliance against the blurred backgrounds, using high-contrast white or deep black depending on the mode.

## Typography
Typography is functional and systematic. **Inter** is used for the majority of the interface to ensure maximum legibility through varying levels of glass transparency. For developer-centric data such as file paths and terminal outputs, **Geist** (monospace) provides the necessary technical precision.

- **Headlines:** Keep short and punchy. Use semi-bold weights to "pierce" through the background blur.
- **Metadata:** Use slightly increased letter spacing for the 12px size to maintain readability at small scales.
- **Hierarchy:** Use font weight (Medium to Semi-Bold) rather than color shifts to establish hierarchy, as color shifts can get lost against refractive glass backgrounds.

## Layout & Spacing
The layout follows a **Fluid Grid** approach with generous margins to allow the "Liquid Glass" effects room to breathe. 

- **Breathing Room:** Avoid dense, cramped layouts. The refraction effects require space to show the "edge" of the glass.
- **Breakpoints:**
  - **Desktop (1280px+):** 12-column grid, 24px margins.
  - **Tablet (768px-1279px):** 8-column grid, 20px margins.
  - **Mobile (<767px):** 4-column grid, 16px margins. 
- **Alignment:** All elements should align to a 4px baseline grid to ensure the thin 1px glass borders meet precisely at intersections.

## Elevation & Depth
Depth is the most critical component of this design system. It is achieved through a combination of backdrop filters and "Specular Highlights."

- **The Glass Layer:** Every primary container must have `backdrop-filter: blur(20px) saturate(180%)`.
- **Specular Highlights:** Apply a 1px inner border using a linear gradient. The gradient should run from top-left (White at 30% opacity) to bottom-right (Transparent) to simulate a light source hitting the edge of the glass.
- **Shadows:** Use "Deep Field" shadows—highly diffused, low-opacity (#000000 at 15%) with a large blur radius (40px+) to suggest the surface is floating significantly above the background.
- **Refraction:** Secondary layers (nested cards) should have a slightly higher opacity and lower blur to appear "closer" to the user.

## Shapes
Shapes are organic and soft, mimicking the tension of liquid.

- **Dialogs/Modals:** 24-28px radius for a friendly, approachable high-level container.
- **Cards/Modules:** 16-20px radius to create a distinct nested look within dialogs.
- **Buttons:** Always capsule-shaped (fully rounded) to maximize the "Liquid" aesthetic and differentiate interactive elements from structural ones.
- **Input Fields:** 12px radius to balance between the sharpness of the text and the softness of the containers.

## Components
- **Capsule Buttons:** High-contrast fills (White in Dark Mode, Black in Light Mode) with minimal 12px horizontal padding. Icons inside buttons should be 16px.
- **Risk Status Dots:** 8px circles using semantic colors. For "High Risk," add a subtle outer glow (2px blur) in the same color to suggest urgency.
- **Circular Progress Gauges:** Use a 1.5px stroke width. The "track" should be 10% opacity of the semantic color, while the "indicator" is 100% opacity.
- **Input Fields:** Semi-transparent glass background (10% opacity) with the 1px specular border highlight. Focus state is indicated by increasing the border opacity to 50%.
- **Lists:** Use subtle 1px horizontal dividers with a gradient (Transparent -> White 10% -> Transparent) to separate items without creating hard visual breaks.
- **Icons:** Use 1.5px stroke SVG line icons. Avoid filled icons unless used as a status indicator inside a dot.