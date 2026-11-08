---
name: unslop
description: Use before and after any UI change in Project Manager AI. Removes the visual habits that make an interface read as AI generated, while keeping the Project Manager AI design system as the single source of truth.
---

# Unslop

This skill is a lens on top of the design system in `public/styles.css`. It never replaces it. If this skill and the design system disagree, the design system wins.

## When to use it

1. Build mode: read the rules below before you design or change any screen, dialog, widget or marketing page.
2. Audit mode: run `node scripts/unslop-scan.js` after the change. Fix every HIGH finding. Review every MEDIUM finding and either fix it or note why it stays.

## The tells to remove

HIGH, always fix:

1. Purple or violet blended into blue as a gradient (hero bands, buttons, logo tiles, meters, progress lines). Use one solid token such as `--primary`.
2. Gradient filled heading text (`background-clip: text`). Headings use `--text`. A single accent word may use `--primary`.
3. Emoji used as icons or illustrations (folders, checks, party poppers in empty and success states). Use the SVG `icon()` set so the stroke, size and color follow the theme.
4. Inter, Geist or Roboto as the first font. The product font is IBM Plex Sans, with IBM Plex Sans Arabic for Arabic.
5. Neon glow: a zero offset, large blur shadow in a brand color. Shadows come from `--shadow` and `--shadow-lg`. Focus rings are the 2px `--primary` ring.

MEDIUM, review:

6. Hover that lifts more than 2px, rotates or scales an icon. The design system allows 1px at most. No bouncing or spinning.
7. A shimmer sweep across buttons, or a spotlight that follows the cursor. Hover is a small background change.
8. A centered hero followed by three identical cards. Vary the layout when the content is not equal in weight.
9. Cards inside cards, and every block wrapped in the same rounded card.
10. Decorative motion. Motion must explain a change.

## What is not a tell here

Subtle grid or tint backgrounds, glass headers that keep a visible edge, and bento style dashboards are fine when they carry meaning. Violet stays only as the token for milestones and AI suggestions (`--violet`), never as the brand color.

## Native browser controls

Date fields use the shared picker in `public/datepicker.js`. It upgrades every `type=date` and `type=datetime-local` field automatically, so keep using those input types and load the script on any new page that has date fields. Do not style or rebuild the browser calendar.

## Brand artwork

The logo mark in `public/logo.js` and `public/brand/` uses a blue to violet gradient. It is brand identity, not UI styling. Do not change it as part of an unslop pass. Raise it as an owner decision.

## Always keep

Tokens for color, size and spacing. Light and dark. Arabic and right to left. Tooltips on icon buttons. US English, sentence case, no dashes or semicolons in user facing text. Empty, loading and error states. Reduced motion respected.

## Done check

1. `node scripts/unslop-scan.js` reports 0 HIGH findings.
2. The design system checklist passes (font audit OFF SCALE 0, light, dark, mobile, Arabic).
3. `npm test` passes.
