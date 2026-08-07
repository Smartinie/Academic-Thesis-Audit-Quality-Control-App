# Avante Writings — Thesis Audit Quality-Control App

Avante Writings is the brand and editorial agency for which this application was built. This app is Avante Writings' internal quality-control tool for client theses: it extracts structure and text from submitted thesis documents, runs a multi-stage automated audit (grammar, punctuation, structure, cross-document consistency, references), and returns annotated feedback plus corrected artifacts for editors.

This README describes how the app is organized, how to run it locally, and where to look in code for the core review logic.

---

## Key capabilities
- Upload DOCX / Markdown files and extract structured text (headings, paragraphs, lists)
- Multi-pass automated review pipeline:
  - Grammar & punctuation
  - Structural consistency (headings, section ordering)
  - Cross-checks (citations, references, internal consistency)
  - Final stylistic pass and corrected output generation
- Inline suggestions, downloadable corrected DOCX, and persisted review history
- Lightweight audio utilities for spoken feedback (optional)

---

## Tech stack
- Frontend: React + Vite (TypeScript)
- Server: Node.js + Express (server-side orchestration & LLM calls)
- Document parsing/generation: `mammoth`, `docx`
- LLM integration: `@google/genai` (server-side)
- Persistence: `better-sqlite3`
- Tooling: Tailwind tooling, TypeScript, Vite

---

## Quickstart (developer)
1. Clone and install:
   ```bash
   git clone https://github.com/Smartinie/Academic-Thesis-Audit-Quality-Control-App.git
   cd Academic-Thesis-Audit-Quality-Control-App
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env to add:
   # - server LLM API key(s) for @google/genai (or other provider)
   # - UPLOAD_DIR and DB_PATH (for file storage and sqlite file)
   # - PORT (if needed)
   ```

3. Run in development:
   ```bash
   npm run dev
   ```
   The Vite dev server will serve the frontend; if the backend is a separate Node process, follow the repo's server-start instructions or run the backend entry point (inspect package.json or server code).

4. Build / preview:
   ```bash
   npm run build
   npm run preview
   ```

5. Type check:
   ```bash
   npm run lint
   ```

---

## Environment variables
Check `.env.example` for required keys. Typical values:
- LLM_API_KEY (or provider-specific key)
- UPLOAD_DIR (folder for uploaded DOCX)
- DB_PATH (sqlite file path used by better-sqlite3)
- NODE_ENV, PORT

Do not commit secrets to source control.

---

## Where to find important code
- App / UI: `src/App.tsx`, `src/components/*`, `src/main.tsx`
- LLM orchestration & multi-pass review pipeline: `src/services/gemini.ts` (server-side orchestration and prompt/chain logic)
- DOCX/Markdown parsing and generation: search for usage of `mammoth` and `docx` (services and server endpoints)
- Persistence: places where `better-sqlite3` is created/used (DB open / schema code)
- Environment & build: `package.json`, `vite.config.ts`, `tsconfig.json`

---

## How the review pipeline works (high-level)
1. Document upload → server parses DOCX to structured blocks (headings, paragraphs) using `mammoth` / `docx`.
2. Server runs multiple LLM review passes (via GenAI client):
   - Stage 1: Grammar and punctuation corrections
   - Stage 2: Structural checks and heading consistency
   - Stage 3: Cross-document checks (citations, references, figures)
   - Stage 4: Polishing and final QA
3. Each pass returns structured suggestions and optionally rewritten text segments. The frontend presents diffs and inline comments to Avante editors.
4. Editors accept or revise suggestions; corrected DOCX can be generated and downloaded.

---

## Development notes & gotchas
- Large DOCX files may require increased server timeouts and memory; test with real client documents.
- Complex Word features (tracked changes, embedded objects) may not translate perfectly — validate outputs before final delivery.
- LLM prompt & chain logic live in `src/services/gemini.ts` — treat prompts as critical, guarded code. Keep prompt history and examples under version control in code comments when iterating.
- SQLite (better-sqlite3) is used for simplicity; if you need higher concurrency, move to a server DB.

---

## Contributing (for Avante internal devs)
- Open issues for bugs and feature requests.
- Branch naming: `feature/<short-desc>` or `fix/<short-desc>`.
- Keep changes small and add notes about prompt adjustments for the LLM pipeline when changing `src/services/gemini.ts`.
- Run TypeScript checks before PR: `npm run lint`

---

## Troubleshooting
- LLM calls failing? Check `.env` API key and network access from the server process.
- Parse errors with DOCX? Try converting problematic documents to newer DOCX or Markdown first and re-test parsing.
- Unexpected results from the LLM? Check prompt and the data passed in each review stage — logs are your friend.

---

## License & legal
- No license file is included. Add an appropriate license (e.g., MIT or internal company license) if you plan to share the code outside the organization.

---

## Contact & next steps
- Repo owner: Smartinie (Avante Writings)
- For questions about the LLM prompts or audit policy, open an internal issue and tag the editorial lead.
