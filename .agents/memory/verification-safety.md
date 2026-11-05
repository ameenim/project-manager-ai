---
name: Verification safety
description: Keep regression verification isolated from project data and paid AI services.
---

Run regression tests without inherited database and AI credentials unless a test explicitly needs and safely isolates that service.

**Why:** A publishing-readiness check unintentionally made real AI calls and timed out when the app inherited the workspace credentials. The same tests passed against throwaway databases with AI credentials absent.

**How to apply:** For local regression checks, remove DATABASE_URL, REPLIT_DEPLOYMENT, and ANTHROPIC_API_KEY from the test process environment only. Do not delete or modify the project's saved secrets. Verify production connectivity separately through supported read-only tools.
